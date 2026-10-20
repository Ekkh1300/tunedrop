/**
 * Looks up the host's LAN addresses so the QR code can carry a URL the phone
 * can actually open ("http://192.168.x.x:PORT").
 * Virtual adapters (WSL, Hyper-V, Docker, VMware…) are pushed to the end of
 * the list and the UI lets the user switch if our first guess is wrong.
 */
import os from 'node:os'

const VIRTUAL_HINTS = /wsl|vethernet|hyper-?v|vmware|virtualbox|docker|loopback|tailscale|zerotier|hamachi|clash|nord|openvpn|wan\s?miniport|x-?ray|v2ray|hysteria|sing-?box|tun2socks|wireguard|proton|surfshark|mullvad|hotspot/i

/** Home-gateway-looking ranges beat everything else. */
const RANGE_SCORE = [
  [/^192\.168\./, 0],
  [/^10\./, 1],
  [/^172\.(1[6-9]|2\d|3[01])\./, 2],
]

/**
 * @returns {Array<{ name: string, address: string }>} candidate LAN addresses
 *          in preference order (real-looking adapters first).
 */
export function lanAddresses() {
  const rawAddrs = []
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      // keep only IPv4 private space families (the LAN use case); trim zone ids
      const address = iface.address.split('%')[0]
      if (!/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(address)) continue
      rawAddrs.push({ name, address, virtual: VIRTUAL_HINTS.test(name), range: RANGE_SCORE.find(([re]) => re.test(address))?.[1] ?? 3 })
    }
  }
  // real adapters first, then home-gateway ranges before registry-or-virtual leftovers
  rawAddrs.sort((a, b) => (Number(a.virtual) - Number(b.virtual)) || (a.range - b.range))
  return rawAddrs.map(({ name, address, virtual }) => ({ name: `${name}${virtual ? ' (virtual)' : ''}`, address }))
}

/**
 * Best guess at the URL a phone should open.
 * @returns {string}
 */
export function bestLanUrl(port) {
  const [first] = lanAddresses()
  return first ? `http://${first.address}:${port}` : `http://localhost:${port}`
}
