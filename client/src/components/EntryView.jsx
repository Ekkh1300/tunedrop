/**
 * Entry screen for unpaired devices. Desktops default to broadcasting (they
 * become the host and show the QR). On small screens joining a code comes
 * first, with "broadcast" one tap away.
 */
import { useState } from 'react'
import { useStore } from '../store.jsx'
import { Monitor, Phone, Spinner } from './Icons.jsx'

export function Heading() {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-cream sm:text-3xl">
        Send music between your devices
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-dim">
        Pick a song on the phone, play it on the PC. Everything travels over your
        own Wi-Fi — nothing leaves the room.
      </p>
    </div>
  )
}

export function EntryView({ initialCode = '' }) {
  const { createRoom, joinByCode, joining } = useStore()
  const [mode, setMode] = useState('join')
  const [code, setCode] = useState(initialCode)

  return (
    <main className="reveal flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Heading />

        <div className="mt-8 space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex rounded-lg border border-line bg-raised p-0.5" role="tablist">
            <button
              role="tab"
              aria-selected={mode === 'join'}
              type="button"
              onClick={() => setMode('join')}
              className={`flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition ${
                mode === 'join' ? 'bg-surface text-cream' : 'text-dim hover:text-cream'
              }`}
            >
              <Phone size={14} />
              Join a library
            </button>
            <button
              role="tab"
              aria-selected={mode === 'create'}
              type="button"
              onClick={() => setMode('create')}
              className={`flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition ${
                mode === 'create' ? 'bg-surface text-cream' : 'text-dim hover:text-cream'
              }`}
            >
              <Monitor size={14} />
              Broadcast from here
            </button>
          </div>

          {mode === 'join' ? (
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (/^\d{6}$/.test(code)) await joinByCode(code)
              }}
            >
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                autoFocus={true}
                placeholder="123456"
                value={code}
                dir="ltr"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="readout min-w-0 flex-1 rounded-lg border border-line bg-raised px-4 py-3 text-center text-lg tracking-[0.45em] text-amber placeholder:text-faint"
                aria-label="6-digit pairing code"
              />
              <button
                type="submit"
                disabled={joining || !/^\d{6}$/.test(code)}
                className="grid size-[46px] shrink-0 place-items-center rounded-lg bg-amber text-ink transition hover:bg-amber-deep disabled:opacity-40"
                title="Join"
              >
                {joining ? <Spinner size={18} /> : '→'}
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={joining}
              onClick={createRoom}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber px-5 py-3 text-sm font-semibold text-ink transition hover:bg-amber-deep disabled:opacity-50"
            >
              {joining ? <Spinner size={16} /> : <Monitor size={16} />}
              Create library & show QR
            </button>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-faint">
          Tip: on the PC, open the same site and choose
          {' '}<span className="text-dim">Broadcast from here</span>, then scan the QR with the phone.
        </p>
      </div>
    </main>
  )
}
