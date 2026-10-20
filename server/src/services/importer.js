/**
 * Import a song from a pasted URL.
 *
 * Flow: structural validation → SSRF-guarded download into the uploads dir
 * (temp name) → the same finalizeSong() pipeline as phone uploads (sniff +
 * metadata + cover + db row + websocket broadcast).
 *
 * Everything is bounded: redirect hops re-validated, byte cap enforced inside
 * ssrf.js, and the whole fetch must finish within IMPORT_TIMEOUT_MS.
 */
import path from 'node:path'
import crypto from 'node:crypto'
import { rm } from 'node:fs/promises'
import {
  IMPORT_MAX_REDIRECTS, IMPORT_TIMEOUT_MS, MAX_FILE_BYTES, UPLOAD_DIR,
} from '../config.js'
import { assertSafeUrl, downloadToFile } from '../utils/ssrf.js'
import { sanitizeFilename } from '../utils/fileTypes.js'
import { ApiError } from '../utils/errors.js'
import { finalizeSong } from './songs.js'

/** Content types a URL may *look like*; bytes decide the rest. */
const LOOSE_ACCEPT = [
  '', // unknown / missing
  'audio/', 'application/ogg', 'application/octet-stream',
  'video/mp4', 'video/webm',
]
function looksLikeAudio(contentType) {
  if (!contentType) return true
  const ct = contentType.toLowerCase()
  return LOOSE_ACCEPT.some((t) => (t.endsWith('/') ? ct.startsWith(t) : ct === t))
}

function nameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : ''
  } catch {
    return ''
  }
}

/**
 * @param {string} rawUrl user-pasted link
 * @returns {Promise<object>} song DTO
 */
export async function importFromUrl(rawUrl, roomId, deviceId) {
  const url = assertSafeUrl(rawUrl) // throws human-mapped ApiErrors
  const tempPath = path.join(UPLOAD_DIR, `in-${crypto.randomUUID()}.tmp`)

  const result = await downloadToFile(url.toString(), tempPath, {
    maxBytes: MAX_FILE_BYTES,
    timeoutMs: IMPORT_TIMEOUT_MS,
    maxRedirects: IMPORT_MAX_REDIRECTS,
  })

  if (!looksLikeAudio(result.contentType)) {
    await rm(tempPath, { force: true })
    throw new ApiError('UNSUPPORTED_FORMAT', 'That link does not point to an audio file.', 415)
  }

  const originalName = sanitizeFilename(result.filenameHint ?? nameFromUrl(result.finalUrl) ?? '')
  return finalizeSong({
    tempPath,
    originalName: originalName || 'downloaded-song',
    mimetypeHint: result.contentType,
    roomId,
    sourceType: 'url',
    sourceUrl: result.finalUrl,
    uploaderDevice: deviceId ?? null,
    sizeBytes: result.bytes,
    filenameHint: originalName || null,
  })
}
