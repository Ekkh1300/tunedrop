/**
 * Audio file validation: extension + MIME whitelist and magic-byte sniffing.
 * The client's MIME type is treated as a hint; the first bytes on disk decide.
 */
import { createReadStream } from 'node:fs'
import { ApiError } from './errors.js'
import { parseFile, parseStream } from 'music-metadata'

/** Extensions we accept, mapped to their canonical mime type. */
export const AUDIO_TYPES = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg', // opus-in-ogg container
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  webm: 'audio/webm',
}

const CLIENT_MIME_ALIASES = {
  'audio/mp3': 'mp3', 'audio/mpeg': 'mp3', 'audio/mpeg3': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wav': 'wav',
  'audio/ogg': 'ogg', 'application/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a',
  'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
}

/**
 * Strip directories, dangerous characters and control characters from a
 * client-supplied filename. Never used for disk paths — those are UUIDs —
 * only for display and metadata extraction.
 */
export function sanitizeFilename(name) {
  const base = String(name ?? '')
    .split(/[/\\]/)          // drop any directory part (path traversal)
    .pop()
    .replaceAll('\x00', '')
    .replaceAll(/[\u0000-\u001f\u007f]/g, '') // control chars
    .replace(/^[.\s]+/, '')  // no leading dots/spaces
    .trim()
  return base.slice(0, 180) || 'song'
}

/** Derive a display title from the (already-sanitized) filename. */
export function titleFromFilename(name) {
  return sanitizeFilename(name).replace(/\.[^.]+$/, '') || 'Untitled'
}

const EXT_MIME = new Map(Object.entries(AUDIO_TYPES))

/**
 * Decide what a client-supplied extension + mime *hint* maps to.
 * Returns the canonical ext, or an extension from the hint's filename.
 * Purely advisory — sniffAudioFile has the final say on disk.
 */
export function acceptExtension(originalName, mimetype) {
  const clean = sanitizeFilename(originalName)
  const ext = (clean.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()
  if (ext && EXT_MIME.has(ext)) {
    // client says x-wav, filenames say .wav — canonicalize to our map
    return { ext, mime: EXT_MIME.get(ext) }
  }
  const fromMime = CLIENT_MIME_ALIASES[String(mimetype ?? '').toLowerCase()]
  if (fromMime) return { ext: fromMime, mime: EXT_MIME.get(fromMime) }
  return null
}

/* ----------------------------------------------------------- magic sniffing */

/**
 * Read the first bytes of a file and identify the audio container.
 * Two-phase: read a 48-byte head; when an ID3 tag registers, jump past its
 * declared size and probe there — cover-art tags routinely reach hundreds of
 * KB, far beyond any fixed window.
 * @param {string} filePath
 * @returns {Promise<'mp3'|'mp4'|'flac'|'ogg'|'wav'|'aac'|'webm'|null>}
 */
export async function sniffAudioFile(filePath) {
  const head = await readRange(filePath, 0, 47)
  if (head.length < 12) return null
  if (head.subarray(0, 3).toString('latin1') !== 'ID3') return sniff(head)
  const tagSize = syncsafeAt(head, 6)
  const post = await readRange(filePath, 10 + tagSize, 10 + tagSize + 47)
  return post.length >= 12 ? sniff(post) : null // a tag alone is not a container
}

/** Read byte range [start, end] inclusive; shortens at EOF; empty on failure. */
function readRange(filePath, start, end) {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { start, end, highWaterMark: Math.max(16, end - start + 1) })
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('error', () => resolve(Buffer.alloc(0)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function syncsafeAt(buf, at) {
  return ((buf[at] & 0x7f) << 21) | ((buf[at + 1] & 0x7f) << 14) | ((buf[at + 2] & 0x7f) << 7) | (buf[at + 3] & 0x7f)
}

function sniff(buf) {
  if (buf.length < 12) return null
  const ascii = (start, len) => buf.subarray(start, start + len).toString('latin1')
  const syncAt = (off) =>
    buf[off] === 0xff && (buf[off + 1] & 0xe0) === 0xe0



  // bare MP3 frame sync (tolerant)
  if (syncAt(0)) return 'mp3'
  // MP4 family (M4A/M4B): "ftyp" at offset 4
  if (ascii(4, 4) === 'ftyp') return 'mp4'
  // FLAC
  if (ascii(0, 4) === 'fLaC') return 'flac'
  // Ogg (Vorbis / Opus)
  if (ascii(0, 4) === 'OggS') return 'ogg'
  // WebM / Matroska
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'
  // RIFF … WAVE
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav'
  // ADTS AAC: syncword
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return 'aac'
  return null
}

/**
 * Metadata extraction with one pragmatic fallback:
 * music-metadata loses track of WAVE/FLAC/OGG payloads that carry a leading
 * ID3v2 tag (it expects mp3 after ID3). We detect the tag length and re-parse
 * the stream after it.
 *
 * @returns {*} music-metadata result (possibly an empty object)
 */
export async function extractMeta(filePath) {
  let meta
  try {
    meta = await parseFile(filePath)
    if (meta?.format?.duration) return meta
  } catch { /* fall through to ID3-skip parsing */ }

  const offset = await leadingId3Offset(filePath)
  if (offset > 0) {
    try {
      const reParsed = await parseStream(createReadStream(filePath, { start: offset }))
      return reParsed ?? meta ?? {}
    } catch { /* give up quietly — metadata is best effort */ }
  }
  return meta ?? {}
}

/** How many bytes does a leading ID3v2 tag occupy at the head of this file? */
async function leadingId3Offset(filePath) {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { start: 0, end: 9, highWaterMark: 16 })
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('error', () => resolve(0))
    stream.on('end', () => {
      const buf = Buffer.concat(chunks)
      if (buf.subarray(0, 3).toString('latin1') !== 'ID3') return resolve(0)
      const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
      resolve(10 + size)
    })
  })
}

/**
 * Read the text frames (TIT2/TPE1/TALB) of a leading ID3v2.3/2.4 tag.
 * Only used when music-metadata could not recover them (the "audio after ID3
 * is WAVE" family). Minimal by design — cover art and duration still come
 * from music-metadata paths.
 *
 * @returns {Promise<{ title?: string, artist?: string, album?: string }>}
 */
export async function extractId3Text(filePath) {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { start: 0, end: 4607, highWaterMark: 4608 })
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('error', () => resolve({}))
    stream.on('end', () => {
      try {
        resolve(parseId3Text(Buffer.concat(chunks)))
      } catch {
        resolve({})
      }
    })
  })
}

function parseId3Text(buf) {
  if (buf.length < 10 || buf.subarray(0, 3).toString('latin1') !== 'ID3') return {}
  const major = buf[3]
  const flags = buf[5]
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
  if (flags & 0x40) { /* extended header present */ }
  const end = Math.min(10 + size, buf.length)
  let p = 10
  // v2.3/v2.4 extended header: skip it when present
  if (flags & 0x40 && p + 4 <= end) {
    const extSize = major === 4
      ? ((buf[p] & 0x7f) << 21) | ((buf[p + 1] & 0x7f) << 14) | ((buf[p + 2] & 0x7f) << 7) | (buf[p + 3] & 0x7f)
      : buf.readUInt32BE(p)
    p += extSize
  }

  const textFor = (body, encByte) => {
    let raw = encByte === 2
      ? rawUtf16(body, true)
      : encByte === 1
        ? rawUtf16(body, false)
        : body.toString('latin1')
    return clean(raw)
  }
  const rawUtf16 = (body, be) => {
    const s = body.subarray(0, Math.max(0, Math.floor(body.length / 2) * 2))
    return s.toString(be ? 'utf16le' : 'utf16le') // node wants LE; BOM decides order
      // NOTE: utf16be handled by byte-swapping below
      .split('\u0000')[0]
  }
  const clean = (s) => String(s ?? '').replace(/\u0000.*$/, '').trim()

  const out = {}
  while (p + 10 <= end) {
    const id = buf.subarray(p, p + 4).toString('latin1')
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    let frameSize = buf.readUInt32BE(p + 4)
    if (major === 4) {
      // v2.4 frame sizes are syncsafe
      frameSize = ((buf[p + 4] & 0x7f) << 21) | ((buf[p + 5] & 0x7f) << 14) | ((buf[p + 6] & 0x7f) << 7) | (buf[p + 7] & 0x7f)
    }
    const bodyStart = p + 10
    if (frameSize <= 0 || bodyStart + frameSize > end) break
    const encByte = buf[bodyStart]
    const body = buf.subarray(bodyStart + 1, bodyStart + frameSize)

    const map = { TIT2: 'title', TPE1: 'artist', TALB: 'album' }
    if (map[id] && !out[map[id]]) {
      let text
      if (encByte === 1) text = body[0] === 0xfe && body[1] === 0xff
        ? swapBe(body.subarray(2)).toString('utf16le')
        : body.subarray(2).toString('utf16le')
      else if (encByte === 2) text = body.toString('utf16le') // utf16be-bom stripped? rare; swap
      else text = body.toString('latin1')
      const value = clean(text)
      if (value) out[map[id]] = value
    }
    p = bodyStart + frameSize
  }
  return out
}

function swapBe(b) {
  const out = Buffer.from(b)
  out.swap16()
  return out
}


/* --------------------------------------------- derived canonical types */

/** What we *derive* from sniffed bytes — authoritative, unlike client hints. */
export const CONTAINER_INFO = {
  mp3:  { ext: 'mp3',  mime: 'audio/mpeg' },
  mp4:  { ext: 'm4a',  mime: 'audio/mp4' },
  flac: { ext: 'flac', mime: 'audio/flac' },
  ogg:  { ext: 'ogg',  mime: 'audio/ogg' },
  wav:  { ext: 'wav',  mime: 'audio/wav' },
  webm: { ext: 'webm', mime: 'audio/webm' },
  aac:  { ext: 'aac',  mime: 'audio/aac' },
}

/**
 * Full gate for an audio file that already sits on disk (temp name).
 *  1. cheap gate: extension/mime hint must be a known audio type — unless
 *     `allowUntyped`, used for URL imports where filenames/mime are unreliable
 *  2. authoritative gate 1: the file's first bytes must sniff as audio
 *  3. authoritative gate 2: when the magic-byte list misses, music-metadata
 *     acts as the referee — it knows a long tail of exotic-but-real containers
 *
 * @returns {Promise<{ container: 'mp3'|'mp4'|'flac'|'ogg'|'wav'|'webm'|'aac',
 *                     ext: string, mime: string }>}
 */
export async function requireAudioFile(filePath, originalName, mimetype, { allowUntyped = false } = {}) {
  if (!allowUntyped && !acceptExtension(originalName, mimetype)) {
    throw new ApiError('UNSUPPORTED_FORMAT', 'That file type is not an audio format we accept.', 415)
  }
  const container = await sniffAudioFile(filePath)
  if (CONTAINER_INFO[container]) {
    const info = CONTAINER_INFO[container]
    return { container, ext: info.ext, mime: info.mime }
  }

  // the magic bytes did not match — trust the metadata parser if it can place
  // the file in a browser-playable container
  let parsed = null
  try {
    parsed = await parseFile(filePath)
  } catch { /* unknown file indeed */ }
  const key = containerFromMeta(parsed)
  if (!key) {
    throw new ApiError('UNSUPPORTED_FORMAT', 'That file does not look like a valid audio file.', 415)
  }
  const info = CONTAINER_INFO[key]
  return { container: key, ext: info.ext, mime: info.mime }
}

/** music-metadata mime types → our canonical containers (browser-playable only). */
const PARSED_MIME_TO_CONTAINER = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mp4',
  'audio/aac': 'aac',
  'audio/aacp': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
}

/** `format.container` spellings (MPEG / OGG-OPUS / WAVE …) → canonical container. */
function containerFromMeta(meta) {
  const mime = meta?.fileType?.mimeType
  if (mime) return PARSED_MIME_TO_CONTAINER[mime.toLowerCase()] ?? null
  const c = (meta?.format?.container ?? '').toUpperCase()
  if (!c) return null
  if (c.includes('MPEG')) return 'mp3'
  if (c.includes('FLAC')) return 'flac'
  if (c.includes('WAVE')) return 'wav'
  if (c.includes('OPUS') || c.includes('VORBIS') || c.includes('OGG')) return 'ogg'
  if (c.includes('M4A') || c.includes('MP4')) return 'mp4'
  if (c.includes('WEBM') || c.includes('MATROSKA')) return 'webm'
  if (c.includes('AAC') || c.includes('ADTS')) return 'aac'
  return null
}
