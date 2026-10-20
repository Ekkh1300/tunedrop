/* Full "two devices through a tunnel" simulation — everything goes through
 * the fake-tunnel front (:8899) as if it were the public address:
 *  PC (host)   → creates the room through the tunnel front
 *  phone       → joins by the QR token through the tunnel front
 *  phone       → uploads a song through the tunnel front
 */
const PUBLIC = 'http://localhost:8899'
const FILE = 'C:/Users/META PC/AppData/Local/Temp/opencode/big-id3.mp3'
import fs from 'node:fs'

/* PC — the host creates its library through the tunnel front */
const room = await (await fetch(`${PUBLIC}/api/rooms`, { method: 'POST' })).json()
console.log('[pc]   room created via tunnel:', room.code)

/* host panel — QR must encode the PUBLIC address */
const qr = await (await fetch(`${PUBLIC}/api/rooms/${room.code}/qr`, {
  method: 'POST',
  headers: { 'X-TuneDrop-Code': room.code, 'X-TuneDrop-Secret': room.secret },
})).json()
const host = new URL(qr.joinUrl).host
const viaPublic = qr.publicUrl ? qr.publicUrl.includes('localhost:8899') : false
console.log('[pc]   qr address:', host, '| publicUrl set:', viaPublic)

/* phone — scans the QR (has only code+token, no secret) and joins */
const token = qr.joinUrl.match(/token=([^&]+)/)?.[1]
const join = await (await fetch(`${PUBLIC}/api/rooms/${room.code}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),
})).json()
console.log('[phone] joined, secret received:', Boolean(join.secret))

/* phone — uploads a song through the tunnel */
const H = { 'X-TuneDrop-Code': room.code, 'X-TuneDrop-Secret': join.secret }
const fd = new FormData()
fd.append('files', new Blob([fs.readFileSync(FILE)], { type: 'audio/mpeg' }), 'tunnel-song.mp3')
const up = await (await fetch(`${PUBLIC}/api/songs/upload`, { method: 'POST', headers: H, body: fd })).json()
const song = up.results?.[0]?.song
console.log('[phone] uploaded:', up.results?.[0]?.ok, song ? `dur=${Math.round(song.duration)}s` : '')

/* both sides see the same library through the tunnel */
const lib = await (await fetch(`${PUBLIC}/api/songs`, { headers: H })).json()
console.log('[both] library count via tunnel:', lib.songs.length)

const ok = viaPublic && join.secret && up.results?.[0]?.ok && lib.songs.length === 1
console.log(ok ? 'TUNNEL-SIM-PASS' : 'TUNNEL-SIM-FAIL')
process.exit(ok ? 0 : 1)
