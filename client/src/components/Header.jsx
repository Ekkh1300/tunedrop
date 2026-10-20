/**
 * Header: identity + live status. The pair chip is the room's face; the pill
 * is the connection's weather; unpair is a two-step guard against fat thumbs.
 */
import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { Spinner, Unpair, WifiOff } from './Icons.jsx'

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <rect width="26" height="26" rx="7" fill="var(--color-amber)" />
      <path d="M9.6 6.5v13l10-6.5z" fill="var(--color-ink)" />
    </svg>
  )
}

export function Header() {
  const { room, connection, unpair, presence } = useStore()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const t = window.setTimeout(() => setConfirming(false), 2600)
    return () => window.clearTimeout(t)
  }, [confirming])

  return (
    <header
      className="sticky top-0 z-40 border-b border-line-soft bg-ink/80 backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="text-[17px] font-semibold tracking-tight">TuneDrop</span>
        </div>
        <span className="flex-1" />

        {room && (
          <>
            <button
              type="button"
              title={`Library code ${room.code} — click to reset pairing`}
              onClick={() => (confirming ? unpair() : setConfirming(true))}
              className="readout hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-dim transition hover:border-danger/50 hover:text-danger sm:flex"
            >
              {confirming ? (
                <span className="flex items-center gap-1.5 text-danger">
                  <Unpair size={13} /> unpair?
                </span>
              ) : (
                <>
                  <span className="tracking-[0.2em]">{room.code}</span>
                  <span className="h-3 w-px bg-line" aria-hidden="true" />
                  {presence.length} online
                </>
              )}
            </button>

            <ConnPill />
          </>
        )}
      </div>
    </header>
  )
}

function ConnPill() {
  const { connection } = useStore()
  const map = {
    live: { dot: 'bg-online', text: 'text-online', label: 'Live' },
    connecting: { dot: 'bg-amber', text: 'text-amber', label: 'Syncing…' },
    offline: { dot: 'bg-danger', text: 'text-danger', label: 'Offline' },
  }[connection] ?? { dot: 'bg-faint', text: 'text-faint', label: 'Idle' }

  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] font-medium ${map.text}`}
      title={connection === 'live' ? 'Realtime sync active' : 'Connection to the library'}
    >
      {connection === 'connecting' ? (
        <Spinner size={11} />
      ) : (
        <span className={`size-1.5 rounded-full ${map.dot} ${connection === 'live' ? 'animate-breathe' : ''}`} aria-hidden="true" />
      )}
      {map.label}
    </span>
  )
}
