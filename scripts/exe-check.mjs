/* E2E check against a running TuneDrop instance (used for the exe test). */
const BASE = process.argv[2] || 'http://127.0.0.1:8899'
const FILE = 'C:/Users/META PC/AppData/Local/Temp/opencode/big-id3.mp3'
import fs from 'node:fs'

const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json()
console.log('room', room.code)
const qr = await (await fetch(`${BASE}/api/rooms/${room.code}/qr`, {
  method: 'POST',
  headers: { 'X-TuneDrop-Code': room.code, 'X-TuneDrop-Secret': room.secret },
})).json()
const H = { 'X-TuneDrop-Code': room.code, 'X-TuneDrop-Secret': room.secret }

const fd = new FormData()
fd.append('files', new Blob([fs.readFileSync(FILE)], { type: 'audio/mpeg' }), '1. Serenade No.13.mp3')
const up = await (await fetch(`${BASE}/api/songs/upload`, { method: 'POST', headers: H, body: fd })).json()
const song = up.results?.[0]?.song
console.log('upload', up.status_within ?? 201, song ? `ext=${song.ext} dur=${Math.round(song.duration)} title=${JSON.stringify(song.title)}` : JSON.stringify(up).slice(0, 120))
if (!song) process.exit(1)

const st = await fetch(`${BASE}/api/songs/${song.id}/stream?room=${room.code}&secret=${room.secret}`, {
  headers: { ...H, range: 'bytes=0-99' },
})
const buf = await st.arrayBuffer()
console.log('stream', st.status, st.headers.get('content-type'), 'firstbytes=' + buf.byteLength)

const lib = await (await fetch(`${BASE}/api/songs`, { headers: H })).json()
console.log('library count', lib.songs.length)

const ok = up.results?.[0]?.ok && st.status === 206 && buf.byteLength === 100 && lib.songs.length === 1
console.log(ok ? 'EXE-E2E-PASS' : 'EXE-E2E-FAIL')
process.exit(ok ? 0 : 1)
