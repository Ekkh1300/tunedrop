/**
 * Songs routes: upload / list / stream (with HTTP Range for seeking) / cover /
 * delete / URL import.
 *
 * Every route requires the room code + secret — via headers normally, via
 * query params for the media endpoints that <audio>/<img> tags hit directly.
 */
import { Router } from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { COVER_DIR } from '../config.js'
import { ApiError } from '../utils/errors.js'
import { MAX_FILE_BYTES, UPLOAD_DIR } from '../config.js'
import { roomFromHeaders, roomFromQuery } from '../services/rooms.js'
import {
  deleteSong, finalizeSong, getSong, listSongs, openSongStream,
} from '../services/songs.js'
import { importFromUrl } from '../services/importer.js'
import { sanitizeFilename } from '../utils/fileTypes.js'
import { emitToRoom } from '../sockets.js'
import { allow, retryAfterMs } from '../utils/rateLimit.js'

const router = Router()
const now = () => Date.now()

/* --------------------------------------------------------------- middleware */

/** header-based room auth for the JSON routes (list/upload/import/delete) */
const requireRoom = (req, res, next) => {
  try {
    req.room = roomFromHeaders(req.headers)
    next()
  } catch (err) {
    next(err)
  }
}

/** bulk upload moves bytes once per request; still keep a ceiling on frequency */
const uploadLimiter = (req, res, next) => {
  const key = `upload:${req.ip}`
  if (allow(key, 40, 60_000)) return next()
  res.set('Retry-After', String(Math.ceil(retryAfterMs(key) / 1000) || 30))
  next(new ApiError('RATE_LIMITED', 'Too many uploads in a row — take a breath and try again.', 429))
}

const urlImportLimiter = (req, res, next) => {
  const key = `import:${req.ip}`
  if (allow(key, 5, 60_000)) return next()
  res.set('Retry-After', String(Math.ceil(retryAfterMs(key) / 1000) || 30))
  next(new ApiError('RATE_LIMITED', 'Only a few links per minute, to stop abuse.', 429))
}

/** UUID temp names — client filenames never touch the disk path. */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `up-${crypto.randomUUID()}.tmp`),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 6, fields: 8, fieldSize: 8192 },
})

/* -------------------------------------------------------------------- list */

router.get('/api/songs', requireRoom, (req, res) => {
  res.json({ songs: listSongs(req.room.id) })
})

/* ------------------------------------------------------------------ upload */

router.post('/api/songs/upload', requireRoom, uploadLimiter, upload.array('files', 6), async (req, res, next) => {
  try {
    const files = req.files ?? []
    if (!files.length) throw new ApiError('NO_FILES', 'Choose at least one audio file.', 400)
    const deviceId = req.headers['x-tunedrop-device'] ?? null
    const results = []
    for (const file of files) {
      try {
        const song = await finalizeSong({
          tempPath: file.path,
          originalName: file.originalname,
          mimetypeHint: file.mimetype,
          roomId: req.room.id,
          sourceType: 'upload',
          sourceUrl: null,
          uploaderDevice: deviceId,
          sizeBytes: file.size,
          filenameHint: null,
        })
        results.push({ ok: true, song })
        emitToRoom(req.room.id, 'song:added', song)
      } catch (err) {
        results.push({
          ok: false,
          file: file.originalname,
          code: err.code ?? 'UNKNOWN',
          message: err.message ?? 'The upload failed.',
        })
        if (!(err instanceof ApiError)) console.error('[upload] unexpected error', err)
      }
    }
    const failed = results.filter((r) => !r.ok).length
    res.status(failed === results.length ? 422 : 201).json({ results })
  } catch (err) {
    next(err)
  }
})

/* -------------------------------------------------------------- url import */

router.post('/api/songs/import-url', requireRoom, urlImportLimiter, async (req, res, next) => {
  try {
    const url = req.body?.url
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new ApiError('INVALID_URL', 'Paste a link to an audio file first.', 400)
    }
    const deviceId = req.headers['x-tunedrop-device'] ?? null
    const song = await importFromUrl(url.trim(), req.room.id, deviceId)
    emitToRoom(req.room.id, 'song:added', song)
    res.status(201).json({ song })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ stream */

/**
 * Range-aware audio streaming. Supports:
 *   - no Range header → 200, whole file
 *   - "bytes=N-" , "bytes=N-M" (open tail "bytes=-K" unsupported → 416)
 *   - garbage → 200 fallback (players self-correct)
 */
router.get('/api/songs/:id/stream', async (req, res, next) => {
  try {
    const room = roomFromQuery(new URLSearchParams(req.query))
    const song = getSong(req.params.id)
    if (!song || song.room_id !== room.id) {
      throw new ApiError('NOT_FOUND', 'Song not found.', 404)
    }
    const filePath = path.join(UPLOAD_DIR, song.stored_name)
    // defense in depth: the row was created by us, but never trust an old row
    if (path.resolve(filePath) !== path.resolve(path.join(UPLOAD_DIR, path.basename(song.stored_name)))) {
      throw new ApiError('NOT_FOUND', 'Song not found.', 404)
    }
    const { size } = await stat(filePath)

    const baseHeaders = {
      'content-type': song.mime_type,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=0, must-revalidate',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(sanitizeFilename(song.original_name))}`,
    }

    const rangeHeader = req.headers.range
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      let start = match ? (match[1] === '' ? null : Number(match[1])) : null
      const end = match && match[2] !== '' ? Number(match[2]) : null

      if (!match || (start === null && (end === null || end === 0))) {
        // unsupported form (e.g. open-tail) — negotiate from scratch
        res.set('content-range', `bytes */${size}`)
        res.set('accept-ranges', 'bytes')
        return res.status(416).end()
      }
      if (start === null) {
        // "bytes=-K" → last K bytes; rare, but cheap to support
        start = Math.max(0, size - Number(end))
      }
      // unsatisfiable per RFC 7233: first-byte-pos ≥ length → 416 Keep-Range
      if (start >= size) {
        res.set('content-range', `bytes */${size}`)
        return res.status(416).end()
      }
      const streamEnd = end === null ? size - 1 : Math.min(end, size - 1)
      if (start > streamEnd || start < 0) {
        res.set('content-range', `bytes */${size}`)
        return res.status(416).end()
      }
      res.writeHead(206, {
        ...baseHeaders,
        'content-range': `bytes ${start}-${streamEnd}/${size}`,
        'content-length': streamEnd - start + 1,
      })
      const stream = openSongStream(song, start, streamEnd)
      stream.on('error', () => res.destroy())
      req.on('close', () => stream.destroy()) // user skipped/aborted
      stream.pipe(res)
    } else {
      res.writeHead(200, { ...baseHeaders, 'content-length': size })
      const stream = openSongStream(song, 0, size - 1)
      stream.on('error', () => res.destroy())
      req.on('close', () => stream.destroy())
      stream.pipe(res)
    }
  } catch (err) {
    if (!res.headersSent) next(err)
    else res.destroy()
  }
})

/* --------------------------------------------------------------- cover art */

router.get('/api/songs/:id/cover', async (req, res, next) => {
  try {
    const room = roomFromQuery(new URLSearchParams(req.query))
    const song = getSong(req.params.id)
    if (!song || song.room_id !== room.id || !song.cover_name) {
      throw new ApiError('NOT_FOUND', 'No cover art for this song.', 404)
    }
    const target = path.join(COVER_DIR, song.cover_name)
    if (path.resolve(target) !== path.resolve(path.join(COVER_DIR, path.basename(song.cover_name)))) {
      throw new ApiError('NOT_FOUND', 'No cover art for this song.', 404)
    }
    let fileStat
    try {
      fileStat = await stat(target)
    } catch {
      throw new ApiError('NOT_FOUND', 'No cover art for this song.', 404)
    }
    res.set({
      'content-type': song.cover_name.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'content-length': fileStat.size,
      'cache-control': 'private, max-age=86400',
    })
    res.sendFile(target)
  } catch (err) {
    if (!res.headersSent) next(err)
    else res.destroy()
  }
})

/* ------------------------------------------------------------------ remove */

router.delete('/api/songs/:id', requireRoom, async (req, res, next) => {
  try {
    const song = getSong(req.params.id)
    if (!song || song.room_id !== req.room.id) {
      throw new ApiError('NOT_FOUND', 'Song not found.', 404)
    }
    await deleteSong(song)
    emitToRoom(req.room.id, 'song:removed', { id: song.id })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
