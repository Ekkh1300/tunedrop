/**
 * URL import guard + downloader.
 *
 * Threat model (a user pastes a URL and our server fetches it):
 *  - SSRF into private / loopback / link-local / metadata ranges  → every resolved
 *    address is checked before connecting.
 *  - DNS rebinding between the check and the connect             → we resolve
 *    ourselves and pin one verified IP for the actual socket.
 *  - Redirect bounces to blocked hosts                          → every hop is
 *    re-validated from scratch.
 *  - Endless / oversized downloads                              → hard byte cap +
 *    absolute deadline.
 *
 * node's global fetch cannot pin a resolved IP, so this module speaks raw
 * http/https: it connects to the verified IP while keeping the real hostname in
 * the TLS servername (SNI) and the Host header, so certificate verification and
 * virtual hosts keep working.
 */
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { isIP } from 'node:net'
import { ApiError } from './errors.js'

const httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 8 })
const httpAgent = new http.Agent({ keepAlive: false, maxSockets: 8 })

/* ------------------------------------------------------------------ ranges */

function ipToLong(ip) {
  return ((ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0)) >>> 0)
}

const blockedV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]

const blockedV4Compiled = blockedV4.map(([baseIp, plen]) => {
  const mask = plen === 0 ? 0 : (0xFFFFFFFF << (32 - plen)) >>> 0
  return { net: (ipToLong(baseIp) & mask) >>> 0, mask }
})

/** @returns {boolean} true if this bare IPv4 address must never be fetched */
export function isForbiddenIPv4(ip) {
  if (isIP(ip) !== 4) return true
  const n = ipToLong(ip)
  return blockedV4Compiled.some(({ net, mask }) => ((n & mask) >>> 0) === net)
}

/** `::0123:4567:89ab:cdef` → 8 sixteen-bit groups; null if unparseable. */
function v6Groups(ip) {
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0]
  const inner = bare.includes('%25') ? bare.replaceAll('%25', '%').split('%')[0] : bare
  const groups = inner.includes('::')
    ? (() => {
        const [l, r] = inner.split('::')
        const ls = l ? l.split(':') : []
        const rs = r ? r.split(':') : []
        const fill = Math.max(0, 8 - ls.length - rs.length)
        return [...ls, ...Array(fill).fill('0'), ...rs]
      })()
    : inner.split(':')
  if (groups.length !== 8) return null
  return groups.map((h) => Number.parseInt(h, 16))
}

function embeddedV4(hiGroup, loGroup) {
  return `${hiGroup >> 8}.${hiGroup & 255}.${loGroup >> 8}.${loGroup & 255}`
}

/** @returns {boolean} true if this bare IPv6 address must never be fetched */
export function isForbiddenIPv6(ip) {
  const g = v6Groups(ip)
  if (!g) return true
  const [a, b, c, d, e, f, h, i] = g
  // IPv4-mapped ::ffff:x.x.x.x and deprecated IPv4-compatible ::x.x.x.x
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
    if (f === 0xffff) return isForbiddenIPv4(embeddedV4(h, i))
    if (f === 0) {
      if (h === 0 && i === 0) return true           // :: unspecified
      if (h === 0 && i === 1) return true           // ::1 loopback
      return isForbiddenIPv4(embeddedV4(h, i))      // ::x.y.z.v leftwards-compatible
    }
  }
  if (a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0)
    return isForbiddenIPv4(embeddedV4(h, i))        // NAT64 64:ff9b::/96
  if (a === 0x2001 && (b === 0x0db8 || b === 0x0000)) return true // docs + teredo
  if (a === 0x2002) return true                     // 6to4 (embedded v4)
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true // discard-only
  if (a >= 0xfc00 && a <= 0xfdff) return true       // unique local fc00::/7
  if (a >= 0xfe80 && a <= 0xfebf) return true       // link-local fe80::/10
  if (a >= 0xff00) return true                      // multicast ff00::/8
  return false
}

/** Is this literal address (from dns.lookup or a URL host) connectable? */
export function isForbiddenAddress(address, family) {
  return Number(family) === 6 ? isForbiddenIPv6(address) : isForbiddenIPv4(address)
}

/* ---------------------------------------------------------------- validate */

/** Structural validation only (no DNS). Returns a WHATWG URL or throws. */
export function assertSafeUrl(raw) {
  let url
  try {
    url = new URL(String(raw).trim())
  } catch {
    throw new ApiError('INVALID_URL', 'That does not look like a valid URL.', 400)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError('INVALID_URL', 'Only http and https links can be imported.', 400)
  }
  if (url.username || url.password) {
    throw new ApiError('INVALID_URL', 'Links containing a password cannot be imported.', 400)
  }
  if (!url.hostname) {
    throw new ApiError('INVALID_URL', 'That does not look like a valid URL.', 400)
  }
  return url
}

/**
 * Resolve every address of a hostname; reject when ANY result points to a
 * forbidden range. Literal IPs in URLs are checked the same way.
 * @returns {Promise<Array<{ address: string, family: number }>>}
 */
export async function resolveVerified(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '')
  const family = isIP(bare)
  if (family) {
    if (isForbiddenAddress(bare, family)) {
      throw new ApiError('BLOCKED_HOST', 'Private and local addresses cannot be imported.', 400)
    }
    return [{ address: bare, family }]
  }
  if (/^localhost\.?$/i.test(bare) || /\.localhost$/i.test(bare)) {
    throw new ApiError('BLOCKED_HOST', 'Local hostnames cannot be imported.', 400)
  }
  let addrs
  try {
    addrs = await dns.promises.lookup(bare, { all: true, verbatim: true })
  } catch {
    throw new ApiError('DNS_FAILURE', 'Could not resolve that address.', 502)
  }
  if (!addrs.length) throw new ApiError('DNS_FAILURE', 'Could not resolve that address.', 502)
  if (addrs.some((a) => isForbiddenAddress(a.address, a.family))) {
    throw new ApiError('BLOCKED_HOST', 'Private and local addresses cannot be imported.', 400)
  }
  return addrs
}

/* ---------------------------------------------------------------- downloading */

function parseFilenameHint(headers) {
  const cd = String(headers['content-disposition'] ?? '')
  if (!cd) return null
  const star = /filename\*=(?:UTF-8|utf-8)?''([^;]+)/.exec(cd)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replaceAll('"', ''))
    } catch {
      return star[1].trim().replaceAll('"', '')
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd)
  return plain ? plain[1] : null
}

/**
 * Download a URL to `destPath` with full SSRF + size-cap enforcement.
 *
 * @returns {Promise<{ bytes: number, contentType: string,
 *   filenameHint: string | null, finalUrl: string }>}
 */
export function downloadToFile(rawUrl, destPath, { maxBytes, timeoutMs, maxRedirects }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let deadline = null
    let active = null // { req, res, sink } for cleanup on settle

    const settle = (ok, value) => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      const a = active
      if (!ok && a) {
        try {
          a.sink?.destroy()
          a.res?.destroy()
          a.req?.destroy()
        } catch { /* already dead */ }
      }
      ok ? resolve(value) : cleanupAndReject(value)
    }

    async function cleanupAndReject(err) {
      // a partially written download must not linger on disk
      try { await unlink(destPath) } catch { /* never created */ }
      reject(err)
    }

    const hop = (logicalUrl, redirectsLeft) => {
      const url = assertSafeUrl(logicalUrl)
      const isHttps = url.protocol === 'https:'

      resolveVerified(url.hostname)
        .then((verified) => {
          // pin the first verified family-address (v4 preferred by dns order)
          const pinned = verified[0]
          if (!pinned) throw new ApiError('DNS_FAILURE', 'Could not resolve that address.', 502)
          const req = (isHttps ? https : http).request({
            host: pinned.address,
            port: url.port || (isHttps ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            method: 'GET',
            servername: isHttps && isIP(pinned.address) === 0 ? url.hostname : undefined,
            setHost: false,
            headers: {
              host: url.host,
              'user-agent': 'TuneDrop/1.0 (local music transfer; URL import)',
              accept: 'audio/*,*/*;q=0.8',
              'accept-encoding': 'identity',
              connection: 'close',
            },
            agent: isHttps ? httpsAgent : httpAgent,
          })

          deadline = setTimeout(() => {
            settle(false, new ApiError('TIMEOUT', 'Import timed out.', 504))
          }, timeoutMs)

          active = { req }
          req.on('error', () =>
            settle(false, new ApiError('FETCH_FAILED', 'Could not reach that link.', 502)))
          req.on('response', (res) => onResponse(res, req, url, redirectsLeft))
          req.end()
        })
        .catch((err) => settle(false, err instanceof ApiError
          ? err
          : new ApiError('FETCH_FAILED', 'Could not reach that link.', 502)))
    }

    const onResponse = (res, req, url, redirectsLeft) => {
      active = { req, res }
      const status = res.statusCode ?? 0
      const location = res.headers.location

      if (location && [301, 302, 303, 307, 308].includes(status)) {
        res.resume()
        if (redirectsLeft <= 0) return settle(false, new ApiError('TOO_MANY_REDIRECTS', 'That link redirected too many times.', 502))
        let next
        try {
          next = new URL(location, url)
        } catch {
          return settle(false, new ApiError('INVALID_URL', 'That link redirects somewhere invalid.', 502))
        }
        return setImmediate(() => {
          try { hop(next.toString(), redirectsLeft - 1) } catch (err) { settle(false, err) }
        })
      }

      if (status < 200 || status >= 300) {
        res.resume()
        return settle(false, new ApiError(
          'FETCH_FAILED',
          status === 404 ? 'That link does not exist.' : `The server refused the import (HTTP ${status}).`,
          status === 404 ? 404 : 502,
        ))
      }

      const contentType = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      const declared = Number(res.headers['content-length'] ?? NaN)
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy()
        return settle(false, new ApiError('FILE_TOO_LARGE', 'That file is too large to import.', 413))
      }

      const sink = createWriteStream(destPath)
      active = { req, res, sink }
      let bytes = 0
      let sinkOk = true

      sink.on('error', () => {
        sinkOk = false
        res.destroy()
        settle(false, new ApiError('WRITE_FAILED', 'The download could not be written to disk.', 500))
      })

      res.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > maxBytes) {
          res.destroy()
          return settle(false, new ApiError('FILE_TOO_LARGE', 'That file is too large to import.', 413))
        }
        if (sinkOk) sink.write(chunk)
      })

      res.on('end', () => {
        sink.end(() => {
          settle(true, {
            bytes,
            contentType,
            filenameHint: parseFilenameHint(res.headers),
            finalUrl: url.toString(),
          })
        })
      })
      res.on('error', () => settle(false, new ApiError('FETCH_FAILED', 'The download was interrupted.', 502)))
    }

    try {
      hop(rawUrl, maxRedirects)
    } catch (err) {
      settle(false, err instanceof ApiError ? err : new ApiError('INVALID_URL', 'That does not look like a valid URL.', 400))
    }
  })
}
