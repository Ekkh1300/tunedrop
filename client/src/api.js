/**
 * API client. All requests carry the pair credentials (code via header for
 * JSON calls, query param for <audio>/<img> stream URLs). Failures throw a
 * `ClientError` whose `.message` is the human text from the server.
 */
import { storage } from './lib/storage.js'

export class ClientError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

function credHeaders(extra = {}) {
  return {
    'X-TuneDrop-Code': storage.room?.code ?? '',
    'X-TuneDrop-Secret': storage.room?.secret ?? '',
    ...extra,
  }
}

async function request(path, { method = 'GET', body, headers } = {}) {
  let res
  const finalHeaders = { ...credHeaders(headers) }
  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders['content-type'] = 'application/json'
  }
  try {
    res = await fetch(path, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ClientError('NETWORK', 'Cannot reach the TuneDrop server.', 0)
  }
  let data = null
  try {
    data = await res.json()
  } catch { /* non-JSON body */ }
  if (!res.ok) {
    throw new ClientError(data?.error?.code ?? 'HTTP_' + res.status, data?.error?.message ?? 'Something went wrong.', res.status)
  }
  return data
}

/** XHR upload so the browser can report progress. */
function uploadWithProgress(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/songs/upload')
    for (const [k, v] of Object.entries(credHeaders())) xhr.setRequestHeader(k, v)
    xhr.responseType = 'json'
    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort()
        reject(new ClientError('ABORTED', 'Upload cancelled.', 0))
      })
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onerror = () => reject(new ClientError('NETWORK', 'Connection lost during upload.', 0))
    xhr.onload = () => {
      const body = xhr.response ?? {}
      if (xhr.status === 413 && body?.error) {
        reject(new ClientError('FILE_TOO_LARGE', 'File is too large.', 413))
        return
      }
      const r = body?.results?.[0]
      if (xhr.status >= 200 && xhr.status < 300 && r?.ok) {
        resolve(r.song)
      } else {
        reject(new ClientError(r?.code ?? body?.error?.code ?? 'FAILED', r?.message ?? body?.error?.message ?? 'The upload failed.', xhr.status))
      }
    }
    const fd = new FormData()
    fd.append('files', file, file.name)
    xhr.send(fd)
  })
}

export const api = {
  config: () => request('/api/config'),

  createRoom: async () => {
    const res = await fetch('/api/rooms', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new ClientError(data?.error?.code ?? 'FAILED', data?.error?.message ?? 'Could not create the library.', res.status)
    return data
  },

  joinRoom: (code, token) => request(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: token ? { token } : {} }),

  listSongs: () => request('/api/songs'),

  deleteSong: (id) => request(`/api/songs/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  importUrl: (url) => request('/api/songs/import-url', { method: 'POST', body: { url } }),

  /** fresh join token + rendered QR svg (members only) */
  qr: (code, iface) => request(`/api/rooms/${encodeURIComponent(code)}/qr`, { method: 'POST', body: iface ? { iface } : {} }),

  uploadFile: uploadWithProgress,

  /** URLs an <audio>/<img> tag can hit (query auth — no headers possible) */
  streamUrl: (id) => `/api/songs/${id}/stream?room=${encodeURIComponent(storage.room?.code ?? '')}&secret=${encodeURIComponent(storage.room?.secret ?? '')}`,
  coverUrl: (id) => `/api/songs/${id}/cover?room=${encodeURIComponent(storage.room?.code ?? '')}&secret=${encodeURIComponent(storage.room?.secret ?? '')}`,
}
