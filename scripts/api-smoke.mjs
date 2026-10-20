/**
 * API smoke test — no framework, just fetch against a running server.
 *
 *   npm run smoke        (starts nothing; expects the server on :8787)
 *   node scripts/api-smoke.mjs
 *
 * Covers: room create/join auth, WAV upload pipeline (sniff+metadata),
 * library list, Range streaming, delete, bad-secret rejection, and SSRF
 * guards (localhost + private literals must never be fetchable).
 */
import { Buffer } from 'node:buffer'

const BASE = process.env.SMOKE_URL ?? 'http://127.0.0.1:8787'

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failed++
    console.log(`FAIL  ${name} ${extra}`)
  }
}

/** tiny valid PCM WAV: 0.5 s, 8 kHz, mono, 16-bit */
function makeWav(seconds = 0.5, rate = 8000) {
  const n = Math.floor(seconds * rate)
  const dataSize = n * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000)
    buf.writeInt16LE(v, 44 + i * 2)
  }
  return buf
}

async function main() {
  /* 1 — rooms */
  const created = await fetch(`${BASE}/api/rooms`, { method: 'POST' })
  check('POST /api/rooms → 201', created.status === 201)
  const room = await created.json()
  check('room has 6-digit code + secret', /^\d{6}$/.test(room.code) && room.secret.length >= 20)

  const H = { 'X-TuneDrop-Code': room.code, 'X-TuneDrop-Secret': room.secret }

  /* 2 — join flow (like the phone) */
  const joined = await fetch(`${BASE}/api/rooms/${room.code}/join`, { method: 'POST', body: '{}' })
  check('join → secret matches members', joined.status === 200 && (await joined.json()).secret === room.secret)

  const badJoin = await fetch(`${BASE}/api/rooms/000000/join`, { method: 'POST', body: '{}' })
  check('unknown code → 404', badJoin.status === 404)

  /* 3 — auth on songs API */
  const noAuth = await fetch(`${BASE}/api/songs`)
  check('songs without credentials → 401', noAuth.status === 401)
  const badSecret = await fetch(`${BASE}/api/songs`, { headers: { 'X-TuneDrop-Code': room.code, 'X-TuneDrop-Secret': 'wrong-secret-aaaaaaaaaaaaaaaaaaaaa' } })
  check('songs with bad secret → 403', badSecret.status === 403)

  /* 4 — list STS currently empty */
  const list0 = await fetch(`${BASE}/api/songs`, { headers: H })
  const lib0 = await list0.json()
  check('empty library', Array.isArray(lib0.songs) && lib0.songs.length === 0)

  /* 5 — upload a real WAV */
  const fd = new FormData()
  fd.append('files', new Blob([makeWav()], { type: 'audio/wav' }), 'Test Tone 440.wav')
  const up = await fetch(`${BASE}/api/songs/upload`, { method: 'POST', headers: H, body: fd })
  check('upload → 201', up.status === 201, `status=${up.status}`)
  const upBody = await up.json()
  const song = upBody.results?.[0]?.song
  check('upload result has id + sniffed mime', Boolean(song?.id) && song.mimeType === 'audio/wav')
  check('duration ≈ 0.5s', Math.abs((song?.duration ?? 0) - 0.5) < 0.1, `duration=${song?.duration}`)

  /* 6 — library reflects it */
  const lib1 = await (await fetch(`${BASE}/api/songs`, { headers: H })).json()
  check('song appears in library', lib1.songs?.length === 1)

  /* 7 — stream: full + Range */
  const streamUrl = `${BASE}/api/songs/${song.id}/stream?room=${room.code}&secret=${encodeURIComponent(room.secret)}`
  const full = await fetch(streamUrl)
  check('stream 200 with content-type audio/wav', full.status === 200 && full.headers.get('content-type') === 'audio/wav')
  check('accept-ranges bytes', full.headers.get('accept-ranges') === 'bytes')
  const ranged = await fetch(streamUrl, { headers: { Range: 'bytes=0-99' } })
  check('range 0-99 → 206 + 100 bytes', ranged.status === 206 && (await ranged.arrayBuffer()).byteLength === 100)
  const mid = await fetch(streamUrl, { headers: { Range: 'bytes=1000-1099' } })
  check('range 1000-1099 → 206', mid.status === 206 && mid.headers.get('content-range')?.startsWith('bytes 1000-1099/'))
  const over = await fetch(streamUrl, { headers: { Range: 'bytes=999999-' } })
  check('range past end → 416', over.status === 416)

  /* 8 — cover 404 (WAV has no art) */
  const cover = await fetch(`${BASE}/api/songs/${song.id}/cover?room=${room.code}&secret=${encodeURIComponent(room.secret)}`)
  check('cover without art → 404', cover.status === 404)

  /* 9 — SSRF guards via the URL import endpoint */
  const self = await fetch(`${BASE}/api/songs/import-url`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ url: `${BASE}/api/config` }),
  })
  check('loopback import blocked', self.status === 400, `status=${self.status}`)
  const privLiteral = await fetch(`${BASE}/api/songs/import-url`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://192.168.1.1/x.mp3' }),
  })
  check('private literal blocked', privLiteral.status === 400)
  const badProto = await fetch(`${BASE}/api/songs/import-url`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'ftp://example.com/song.mp3' }),
  })
  check('non-http proto rejected', badProto.status === 400)
  const notFoundUrl = await fetch(`${BASE}/api/songs/import-url`, {
    method: 'POST', headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.invalid/song.mp3' }),
  })
  check('unresolvable host → human error', (await notFoundUrl.json())?.error?.code === 'DNS_FAILURE')

  /* 10 — delete */
  const del = await fetch(`${BASE}/api/songs/${song.id}`, { method: 'DELETE', headers: H })
  check('delete → ok', del.status === 200)
  const lib2 = await (await fetch(`${BASE}/api/songs`, { headers: H })).json()
  check('library empty again', lib2.songs?.length === 0)

  console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED\n' : `\n${failed} FAILED\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('smoke crashed:', err)
  process.exit(1)
})
