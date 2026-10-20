/**
 * Central configuration. Every tunable is an environment variable so the
 * same build serves development and later deployment (Phase 3, WAN).
 *
 * Exe mode: when bundled into the single-file TuneDrop.exe (see
 * scripts/build-exe.mjs) TUNEDROP_BUNDLED is a build-time constant, everything
 * anchors to the exe location and the UI comes from embedded SEA assets.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Truthy string injected by esbuild for the single-exe build. */
export const BUNDLED = Boolean(process.env.TUNEDROP_BUNDLED)

let here = path.resolve('server') // fallback used only when bundled
if (!BUNDLED) {
  // esbuild-cjs turns import.meta into {} — the try/catch keeps that risk dead
  try {
    here = path.dirname(fileURLToPath(import.meta.url))
  } catch {
    here = process.cwd()
  }
  here = path.resolve(here, '..') // src/ → server/
}
let serverDir = here
if (BUNDLED) {
  // exe directory — source-relative lookups would be meaningless inside the blob
  serverDir = path.dirname(process.execPath)
}

export const SERVER_DIR = serverDir
export const PROJECT_DIR = path.resolve(SERVER_DIR, '..')
export const CLIENT_DIST_DIR = path.join(PROJECT_DIR, 'client', 'dist')

/** Runtime data directory: sqlite db, uploaded songs, extracted covers.
 *  exe mode keeps data next to the exe so the folder stays portable. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(SERVER_DIR, 'data'))
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
export const COVER_DIR = path.join(DATA_DIR, 'covers')
export const DB_PATH = path.join(DATA_DIR, 'tunedrop.db')

export const PORT = Number(process.env.PORT ?? 8787)
export const HOST = process.env.HOST ?? '0.0.0.0'
export const DEV_ORIGIN = process.env.DEV_ORIGIN ?? 'http://localhost:5173'

/**
 * Port that goes into QR pairing URLs. Defaults to `PORT`; override when the
 * phone should open the vite dev server (or a reverse proxy) instead.
 */
export const PUBLIC_PORT = Number(process.env.PUBLIC_PORT ?? PORT)

/**
 * Optional public base for QR pairing URLs ("http://tunnel.example.com:9000").
 * Set it when the phone is on ANOTHER network and the PC is reachable through
 * a tunnel (cloudflared, ngrok, ssh -R, Tailscale serve). When set it wins
 * over the LAN address for the QR, while the panel keeps showing the LAN
 * candidates too.
 */
export const PUBLIC_HOST = (process.env.PUBLIC_HOST ?? '').trim().replace(/\/+$/, '')

/** @returns {string} public base URL or `null` when PUBLIC_HOST is unset. */
export function publicBaseUrl() {
  if (!PUBLIC_HOST) return null
  return PUBLIC_HOST.startsWith('http') ? PUBLIC_HOST : `http://${PUBLIC_HOST}`
}

/** Max size of a single song (upload or URL import). */
export const MAX_UPLOAD_MB = clampInt(process.env.MAX_UPLOAD_MB, 20, 2000, 150)
export const MAX_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024

/** Per-room library storage ceiling, protects the host disk. */
export const MAX_ROOM_STORAGE_MB = clampInt(process.env.MAX_ROOM_STORAGE_MB, 50, 50_000, 2048)

/** Pairing */
export const JOIN_TOKEN_TTL_MS = clampInt(process.env.JOIN_TOKEN_TTL_SEC, 60, 86_400, 15 * 60) * 1000

/** Housekeeping: rooms with no songs and no activity for a week sweep away. */
export const ROOM_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** URL import fetcher */
export const IMPORT_TIMEOUT_MS = clampInt(process.env.IMPORT_TIMEOUT_SEC, 10, 600, 90) * 1000
export const IMPORT_MAX_REDIRECTS = 4

function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
