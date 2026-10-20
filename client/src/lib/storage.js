/**
 * Pairing credentials + device identity, persisted in localStorage.
 * One place knows the key names; the room secret never reaches events or QR.
 */

const K = {
  deviceId: 'tunedrop.deviceId',
  deviceName: 'tunedrop.deviceName',
  roomCode: 'tunedrop.roomCode',
  roomSecret: 'tunedrop.roomSecret',
}

function read(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // storage can be blocked (private mode) — app still works in memory
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* ignore */ }
}

export const storage = {
  get deviceId() {
    let id = read(K.deviceId)
    if (!id) {
      id = crypto.randomUUID()
      write(K.deviceId, id)
    }
    return id
  },
  get deviceName() {
    return read(K.deviceName) ?? ''
  },
  set deviceName(name) {
    write(K.deviceName, String(name ?? '').slice(0, 40))
  },
  get room() {
    const code = read(K.roomCode)
    const secret = read(K.roomSecret)
    if (!code || !secret) return null
    return { code, secret }
  },
  setRoom({ code, secret }) {
    write(K.roomCode, code)
    write(K.roomSecret, secret)
  },
  clearRoom() {
    write(K.roomCode, null)
    write(K.roomSecret, null)
  },
}
