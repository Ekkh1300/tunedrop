/**
 * Rooms — the pairing container. A room binds devices together and scopes the
 * song library: only members (holders of the room secret) can list or upload.
 *
 * Security model:
 *  - `code`       6 digits, guessable → join is rate-limited, and its main job
 *                 is only to *find* the room.
 *  - `secret`     random, never appears in QR codes or events, required on
 *                 every songs API call.
 *  - `join token` short-lived (15 min), lives inside the QR code and refreshes
 *                 automatically — so the QR never carries a permanent credential.
 */
import crypto from 'node:crypto'
import { db, queries } from '../db.js'
import { JOIN_TOKEN_TTL_MS, PORT } from '../config.js'
import { ApiError, notFound } from '../utils/errors.js'
import { bestLanUrl, lanAddresses } from '../utils/lan.js'

const now = () => Date.now()

const newCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
const newSecret = () => crypto.randomBytes(24).toString('base64url')

/**
 * Create a room plus its first join token and pairing metadata.
 * @returns {{ room: object } & ReturnType<typeof pairingFor>}
 */
export function createRoom() {
  for (let i = 0; i < 50; i++) {
    const id = crypto.randomUUID()
    const code = newCode()
    try {
      queries.insertRoom.run(id, code, newSecret(), now(), now())
      const room = queries.roomByCode.get(code)
      return { room, ...pairingFor(room) }
    } catch {
      // UNIQUE(code) collision → different digits, retry (50 draws ≈ 0.5% total failure)
    }
  }
  throw new ApiError('ROOM_CREATE_FAILED', 'Could not create the library right now.', 500)
}

/**
 * Current pairing info for a room: a fresh join token + the LAN URLs to show
 * with the QR code.
 */
export function pairingFor(room) {
  return createJoinToken(room.id)
}

/** Issue a fresh short-lived join token for a room. */
export function createJoinToken(roomId) {
  const token = newSecret()
  const expiresAt = now() + JOIN_TOKEN_TTL_MS
  queries.insertJoinToken.run(crypto.randomUUID(), roomId, token, expiresAt, now())
  return {
    joinToken: token,
    joinTokenExpiresAt: expiresAt,
    lanUrl: bestLanUrl(PORT),
    lanIfaces: lanAddresses().map(({ name, address }) => ({ name, address })),
    port: PORT,
  }
}

/** Validate a token: correct room and unexpired. Consumed on first use. */
export function verifyJoinToken(room, token) {
  const row = queries.joinTokenByToken.get(String(token ?? ''))
  if (!row || row.room_id !== room.id || row.expires_at < now()) return false
  queries.deleteJoinToken.run(row.id)
  return true
}

/**
 * Join by 6-digit code (+ optional join token from the QR).
 * Rate limiting is enforced by the route before this runs.
 * @returns {object} room (caller receives room.secret only on success)
 */
export function joinRoom(code, token) {
  const room = queries.roomByCode.get(String(code ?? ''))
  if (!room) throw notFound('Library')
  if (token) {
    if (!verifyJoinToken(room, token)) {
      throw new ApiError('BAD_JOIN_TOKEN', 'That pairing code expired — refresh the QR on the PC and try again.', 401)
    }
  }
  queries.touchRoom.run(now(), room.id)
  return room
}

/**
 * Authorization for songs APIs from HTTP headers (the normal path).
 * @param {object} headers express request headers
 */
export function roomFromHeaders(headers) {
  const code = headers['x-tunedrop-code']
  const secret = headers['x-tunedrop-secret']
  return authorize(code, secret)
}

/**
 * Authorization for GET endpoints consumed by <audio>/<img> tags, where client
 * headers are impossible: room + secret come from the query string instead.
 * @param {URLSearchParams} searchParams
 */
export function roomFromQuery(searchParams) {
  return authorize(searchParams.get('room'), searchParams.get('secret'))
}

function authorize(code, secret) {
  if (!code || !secret) {
    throw new ApiError('UNAUTHENTICATED', 'Pair with this library first.', 401)
  }
  const room = queries.roomByCode.get(String(code))
  if (!room) {
    throw new ApiError('UNAUTHENTICATED', 'Pair with this library first.', 401)
  }
  const equal = crypto.timingSafeEqual(
    Buffer.from(room.secret.padEnd(64, '\x00').slice(0, 64), 'utf8'),
    Buffer.from(String(secret).padEnd(64, '\x00').slice(0, 64), 'utf8'),
  )
  if (!equal) {
    throw new ApiError('FORBIDDEN', 'This device is not a member of that library.', 403)
  }
  queries.touchRoom.run(now(), room.id)
  return room
}

/**
 * Housekeeping: expired tokens go; rooms idle for 7 days go — but never rooms
 * that still hold songs (a library must not be silently destroyed).
 */
export function housekeeping() {
  queries.pruneJoinTokens.run(now())
  const cutoff = now() - 7 * 24 * 60 * 60 * 1000
  const result = queries.deleteIdleRooms.run({ cutoff })
  if (result.changes > 0) {
    console.log(`[housekeeping] removed ${result.changes} idle empty room(s)`)
  }
}
