/**
 * Song pipeline shared by both entry points:
 *   phone upload (multer temp file)  ─┐
 *   URL import (downloaded temp file) ┴→ finalizeSong() → db row → broadcast
 *
 * finalizeSong() sniffs the bytes, extracts metadata + cover art, gives the
 * file its permanent UUID name, inserts the row and notifies the room.
 */
import crypto from 'node:crypto'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { queries } from '../db.js'
import { COVER_DIR, MAX_ROOM_STORAGE_MB, UPLOAD_DIR } from '../config.js'
import { ApiError } from '../utils/errors.js'
import { CONTAINER_INFO, extractId3Text, extractMeta, requireAudioFile, sanitizeFilename, titleFromFilename } from '../utils/fileTypes.js'

const now = () => Date.now()

/**
 * Move a validated temp audio file into the library.
 *
 * @param {object} opts
 * @param {string} opts.tempPath       where the bytes currently are
 * @param {string} opts.originalName   client filename (display only)
 * @param {string} opts.mimetypeHint   client mime (advisory)
 * @param {string} opts.roomId
 * @param {'upload'|'url'} opts.sourceType
 * @param {string|null} opts.sourceUrl
 * @param {string|null} opts.uploaderDevice
 * @param {number} opts.sizeBytes
 * @param {string|null} opts.filenameHint  from Content-Disposition (url import)
 * @returns {Promise<object>} song DTO
 */
export async function finalizeSong(opts) {
  const {
    tempPath, originalName, mimetypeHint, roomId,
    sourceType, sourceUrl, uploaderDevice, sizeBytes, filenameHint,
  } = opts

  await enforceRoomQuota(roomId, sizeBytes)

  // 1 — authoritative type check on the bytes themselves
  let gate
  try {
    gate = await requireAudioFile(tempPath, originalName, mimetypeHint, {
      allowUntyped: sourceType === 'url',
    })
  } catch (err) {
    await rm(tempPath, { force: true })
    throw err
  }

  // 2 — permanent home: data/uploads/<uuid>.<ext>
  const id = crypto.randomUUID()
  const storedName = `${id}.${gate.ext}`
  const finalPath = path.join(UPLOAD_DIR, storedName)
  try {
    await rename(tempPath, finalPath)
  } catch (err) {
    await rm(tempPath, { force: true })
    throw new ApiError('IO_ERROR', 'The song could not be saved.', 500, { cause: err })
  }

  // 3 — metadata + cover art (best effort; silence is a perfectly good title)
  let meta = {}
  let id3Text = {}
  try {
    meta = await extractMeta(finalPath)
  } catch { /* unparsable metadata is not fatal */ }
  if (!meta.common?.title) {
    try {
      id3Text = await extractId3Text(finalPath)
    } catch { /* no tag text either — filename it is */ }
  }

  let coverName = null
  const picture = meta.common?.picture?.[0]
  if (picture?.data?.length) {
    const ext = String(picture.format ?? 'image/jpeg').includes('png') ? 'png' : 'jpg'
    coverName = `${id}.${ext}`
    try {
      await writeFile(path.join(COVER_DIR, coverName), picture.data)
    } catch {
      coverName = null // cover art is optional decoration
    }
  }

  const displayOriginal = sanitizeFilename(filenameHint ?? originalName)
  const song = {
    id,
    roomId,
    originalName: displayOriginal,
    storedName,
    ext: gate.ext,
    mime: gate.mime,
    size: sizeBytes,
    duration: meta.format?.duration ?? null,
    title: (meta.common?.title ?? id3Text?.title ?? titleFromFilename(displayOriginal)).trim() || 'Untitled',
    artist: meta.common?.artist ?? id3Text?.artist ?? null,
    album: meta.common?.album ?? id3Text?.album ?? null,
    coverName,
    sourceType,
    sourceUrl,
    uploaderDevice,
    createdAt: now(),
  }

  queries.insertSong.run(
    song.id, song.roomId, song.originalName, song.storedName, song.mime, song.ext,
    song.size, song.duration, song.title, song.artist, song.album, song.coverName,
    song.sourceType, song.sourceUrl, song.uploaderDevice, song.createdAt,
  )
  // re-read the row so the DTO shape is identical to list/stream reads
  return toDto(queries.songById.get(id))
}

async function enforceRoomQuota(roomId, incomingBytes) {
  const { total } = queries.roomStorageBytes.get(roomId)
  const cap = MAX_ROOM_STORAGE_MB * 1024 * 1024
  if (total + incomingBytes > cap) {
    throw new ApiError('STORAGE_FULL', 'The library storage limit is full — delete a few songs first.', 507)
  }
}

/** Database row → the DTO every client sees (never contains secrets). */
export function toDto(row) {
  return {
    id: row.id,
    originalName: row.original_name,
    ext: row.ext,
    mimeType: row.mime_type,
    size: row.size,
    duration: row.duration,
    title: row.title,
    artist: row.artist,
    album: row.album,
    hasCover: Boolean(row.cover_name),
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    uploaderDevice: row.uploader_device,
    createdAt: row.created_at,
  }
}

export function listSongs(roomId) {
  return queries.songsByRoom.all(roomId).map(toDto)
}

export function getSong(id) {
  return queries.songById.get(id)
}

/** hard delete: file + cover + row */
export async function deleteSong(song) {
  queries.deleteSong.run(song.id)
  await Promise.allSettled([
    rm(path.join(UPLOAD_DIR, song.stored_name), { force: true }),
    song.cover_name ? rm(path.join(COVER_DIR, song.cover_name), { force: true }) : Promise.resolve(),
  ])
}

/** open the song's audio bytes for streaming (Range handled by the route) */
export function openSongStream(song, start, end) {
  return createReadStream(path.join(UPLOAD_DIR, song.stored_name), { start, end })
}
