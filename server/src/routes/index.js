/**
 * HTTP + socket.io wiring: rooms and songs routes under one router,
 * plus a tiny /api/config endpoint that publishes client-safe limits
 * (so the browser can pre-check file sizes before wasting an upload).
 */
import { Router } from 'express'
import roomsRouter from './rooms.js'
import songsRouter from './songs.js'
import { MAX_UPLOAD_MB, MAX_ROOM_STORAGE_MB } from '../config.js'
import { AUDIO_TYPES } from '../utils/fileTypes.js'

const router = Router()

router.get('/api/config', (req, res) => {
  res.json({
    maxUploadMb: MAX_UPLOAD_MB,
    maxRoomStorageMb: MAX_ROOM_STORAGE_MB,
    formats: Object.keys(AUDIO_TYPES),
  })
})

router.use(roomsRouter)
router.use(songsRouter)

export default router
