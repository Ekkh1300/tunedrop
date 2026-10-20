/**
 * Realtime layer (socket.io):
 *  - clients join the socket room of their library (code + secret are checked);
 *  - presence (online devices) aggregates per deviceId, so a second browser tab
 *    on the same device does not create a phantom entry;
 *  - the server broadcasts  song:added / song:removed / presence;
 *  - a reconnecting client re-joins with its stored secret, then refetches the
 *    library over HTTP — no missed events, even when offline during upload.
 */
import { Server } from 'socket.io'
import { timingSafeEqual } from 'node:crypto'
import { db } from './db.js'
import { DEV_ORIGIN } from './config.js'

let io = null

/** socket.id → { deviceId, name, roomId } */
const socketsMeta = new Map()
/** roomId → Map(deviceId → { name, connections:Set<socket.id>, lastSeen }) */
const presenceByRoom = new Map()

/** @param {import('node:http').Server} httpServer */
export function initSockets(httpServer, { dev = false } = {}) {
  io = new Server(httpServer, {
    cors: {
      origin: dev ? [DEV_ORIGIN, 'http://127.0.0.1:5173', 'http://localhost:5173'] : [],
      credentials: false,
    },
    // production is same-origin; in dev the vite proxy forwards socket.io
    transports: ['websocket', 'polling'],
    pingInterval: 20_000,
    pingTimeout: 20_000,
  })

  io.on('connection', (socket) => {
    socket.on('room:join', (payload = {}, ack) => {
      try {
        const { code, secret, deviceId, name } = payload ?? {}
        if (!code || !secret) throw new Error('missing credentials')
        const room = db.prepare(`SELECT * FROM rooms WHERE code = ?`).get(String(code))
        if (!room || !secretsEqual(room.secret, String(secret))) {
          throw new Error('bad room credentials')
        }
        const meta = {
          deviceId: String(deviceId ?? socket.id.slice(-8)),
          name: String(name ?? 'Device'),
          roomId: room.id,
        }
        socket.join(`room:${room.id}`)
        socketsMeta.set(socket.id, meta)
        joinPresence(room.id, socket.id, meta)
        broadcastPresence(room.id)
        if (typeof ack === 'function') ack({ ok: true })
      } catch {
        if (typeof ack === 'function') ack({ ok: false })
      }
    })

    socket.on('disconnect', () => {
      const meta = socketsMeta.get(socket.id)
      if (!meta) return
      socketsMeta.delete(socket.id)
      leavePresence(meta.roomId, socket.id, meta)
      broadcastPresence(meta.roomId)
    })
  })

  return io
}

function secretsEqual(secret, given) {
  const a = Buffer.from(String(secret).padEnd(64, '\0').slice(0, 64), 'utf8')
  const b = Buffer.from(given.padEnd(64, '\0').slice(0, 64), 'utf8')
  return timingSafeEqual(a, b)
}

function joinPresence(roomId, socketId, { deviceId, name }) {
  let byDevice = presenceByRoom.get(roomId)
  if (!byDevice) presenceByRoom.set(roomId, (byDevice = new Map()))
  const entry = byDevice.get(deviceId) ?? { name, connections: new Set(), lastSeen: Date.now() }
  entry.name = name || entry.name
  entry.connections.add(socketId)
  entry.lastSeen = Date.now()
  byDevice.set(deviceId, entry)
}

function leavePresence(roomId, socketId, { deviceId }) {
  const byDevice = presenceByRoom.get(roomId)
  if (!byDevice) return
  const entry = byDevice.get(deviceId)
  if (!entry) return
  entry.connections.delete(socketId)
  if (entry.connections.size === 0) {
    byDevice.delete(deviceId)
    if (byDevice.size === 0) presenceByRoom.delete(roomId)
  }
}

function broadcastPresence(roomId) {
  const byDevice = presenceByRoom.get(roomId)
  const devices = []
  if (byDevice) {
    for (const [deviceId, { name, connections, lastSeen }] of byDevice.entries()) {
      devices.push({ deviceId, name, connections: connections.size, lastSeen })
    }
  }
  emitToRoom(roomId, 'presence', { devices })
}

/**
 * Server-side helper used by route handlers after a mutation.
 * (Import-safe: no-ops before initSockets runs.)
 */
export function emitToRoom(roomId, event, payload) {
  if (!io) return
  io.to(`room:${roomId}`).emit(event, payload)
}

export function socketServer() {
  return io
}
