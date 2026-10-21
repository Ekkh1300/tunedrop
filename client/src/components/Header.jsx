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
  const [about, setAbout] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const t = window.setTimeout(() => setConfirming(false), 2600)
    return () => window.clearTimeout(t)
  }, [confirming])

  return (
    <>
    <header
      className="sticky top-0 z-40 border-b border-line-soft bg-ink/80 backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setAbout(true)}
          title="About TuneDrop"
          className="flex items-center gap-2.5 rounded-lg px-1 py-0.5 transition hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber/60"
        >
          <Mark />
          <span className="text-[17px] font-semibold tracking-tight">TuneDrop</span>
        </button>
        <span className="hidden text-[10px] uppercase tracking-[0.18em] text-faint sm:inline">
          by Esi
        </span>
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

    {about && <AboutDialog onClose={() => setAbout(false)} />}
    </>
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

/* ------------------------------------------------------------------ about */

function AboutDialog({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-label="About TuneDrop"
        className="w-full max-w-xs rounded-2xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <Mark />
          <div>
            <p className="text-[15px] font-semibold tracking-tight">TuneDrop</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-faint">v1.0.0</p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-dim">
          Move music between the screens of one home — the phone feeds, the
          PC plays, everything stays on your own Wi-Fi.
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber/40 bg-ink/60 px-3 py-2.5">
          <span className="size-1.5 rounded-full bg-amber animate-breathe" aria-hidden="true" />
          <p className="text-[11px] text-faint">
            design &amp; code by <span className="text-[12px] font-semibold text-amber">Esi</span>
          </p>
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-faint">
          no cloud · no accounts · your files stay home
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <a
            href="https://github.com/Ekkh1300/tunedrop"
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate text-[11px] text-dim underline decoration-line underline-offset-2 transition hover:text-amber"
          >
            github · Ekkh1300/tunedrop
          </a>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] text-dim transition hover:text-cream"
          >
            close
          </button>
        </div>
      </section>
    </div>
  )
}
