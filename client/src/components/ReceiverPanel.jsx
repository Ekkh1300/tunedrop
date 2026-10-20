/**
 * The pairing "receiver" panel — the identity moment of the app.
 * Boxed readout with the 6-digit code, the QR that leads the phone here, a
 * countdown on the token, and the interface switcher for multi-NIC machines.
 * Panel shows once a room exists (host); used to pair every extra device.
 */
import { useState } from 'react'
import { useStore } from '../store.jsx'
import { Refresh } from './Icons.jsx'

function Chip({ children, tone = 'line' }) {
  const tones = {
    line: 'border-line text-dim',
    amber: 'border-amber/50 text-amber',
  }
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] leading-none ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function ReceiverPanel({ compact = false }) {
  const { room, qr, presence, fetchQr } = useStore()
  const [iface, setIface] = useState(null)
  if (!room) return null

  const digits = room.code
  const seconds = qr?.joinTokenExpiresAt
    ? Math.max(0, Math.round((qr.joinTokenExpiresAt - Date.now()) / 1000))
    : null
  const mmss = seconds == null
    ? ''
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  const CopyJump = (
    <div className="w-full">
      <a
        href={qr?.joinUrl ?? '#'}
        className="readout block w-full text-center text-[13px] text-dim transition hover:text-amber"
        onClick={(e) => e.preventDefault()}
        title={qr?.joinUrl}
      >
        {qr?.chosenUrl ?? `${location.origin}`}
      </a>
      {qr?.publicUrl && (
        <a
          href={qr.publicUrl}
          className="readout mt-1 block w-full text-center text-[11px] text-amber/90 transition hover:text-amber"
          onClick={(e) => e.preventDefault()}
          title={qr.publicUrl}
        >
          over the internet: {qr.publicUrl.replace(/^https?:\/\//, '')}
        </a>
      )}
    </div>
  )

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-amber animate-breathe" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">Library code</p>
          <p className="readout text-lg tracking-[0.3em] text-amber">{digits}</p>
        </div>
      </div>
    )
  }

  return (
    <section
      aria-label="Pair a device"
      className="rounded-2xl border border-line bg-surface p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-dim">Pair a device</h2>
        {presence.length > 0 && (
          <Chip tone="amber">{presence.length} connected</Chip>
        )}
      </header>

      <div className="mt-4 flex flex-col items-center gap-4">
        {/* QR — rendered server-side from the member-only join URL */}
        <div
          className="w-[188px] rounded-xl border border-line bg-cream p-2"
          dangerouslySetInnerHTML={{ __html: qr?.qrSvg ?? '' }}
        />

        {/* code — the fallback when the camera is not an option */}
        <div className="w-full rounded-xl border border-amber/40 bg-ink/60 px-4 py-3 text-center">
          <p className="text-[11px] text-faint">Pairing code</p>
          <p className="readout mt-0.5 text-[28px] leading-none tracking-[0.35em] text-amber">
            {digits}
          </p>
          {CopyJump}
        </div>

        <p className="text-center text-xs leading-relaxed text-dim">
          Open TuneDrop on the phone and scan the code —
          {' '}or type the pairing code on the library screen.
        </p>

        {qr?.joinTokenExpiresAt && (
          <div className="flex items-center gap-2 text-[11px] text-faint">
            <span>code refreshes in <span className="readout">{mmss}</span></span>
            <button
              type="button"
              onClick={() => fetchQr(iface ?? undefined)}
              className="grid size-6 place-items-center rounded-md border border-line text-dim transition hover:border-amber/50 hover:text-amber"
              title="Refresh pairing code now"
            >
              <Refresh size={13} />
            </button>
          </div>
        )}

        {/* network — where the QR points: each LAN adapter, or the public base */}
        {(qr?.lanIfaces?.length > 1 || qr?.publicUrl) && (
          <label className="flex w-full items-center gap-2 text-[11px] text-faint">
            Network
            <select
              className="readout min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 text-[11px] text-dim"
              value={iface ?? (qr.publicUrl ? '__public__' : qr.lanIfaces[0]?.address)}
              onChange={(e) => {
                setIface(e.target.value)
                fetchQr(e.target.value)
              }}
            >
              {qr.publicUrl && (
                <option value="__public__">
                  internet — {String(qr.publicUrl).replace(/^https?:\/\//, '')}
                </option>
              )}
              {(qr.lanIfaces ?? []).map((i) => (
                <option key={i.address} value={i.address}>
                  {i.name} — {i.address}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </section>
  )
}
