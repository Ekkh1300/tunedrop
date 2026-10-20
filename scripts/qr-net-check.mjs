/* QR network-selector check: __public__ vs LAN iface vs default. */
const BASE = process.argv[2] ?? 'http://127.0.0.1:8902'

const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json()
const H = { 'X-TuneDrop-Code': room.code, 'X-TuneDrop-Secret': room.secret }
const post = (body) => fetch(`${BASE}/api/rooms/${room.code}/qr`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
})

const logQr = (label, j) => {
  if (j.joinUrl) {
    console.log(label, '→', new URL(j.joinUrl).host, j.publicUrl ? `(publicUrl ${j.publicUrl})` : '')
  } else {
    console.log(label, '→', 'refused:', j.error?.code, '—', j.error?.message)
  }
}

const r1 = await post({ iface: '__public__' })
logQr('public  ', await r1.json())

const r2 = await post({ iface: null })
const j2 = await r2.json()
logQr('default ', j2)

const r3 = await post({ iface: j2.lanIfaces?.[0]?.address })
logQr('lan[0]  ', await r3.json())
