/**
 * "Send music" panel — the phone's primary surface and PC's drag & drop target.
 * Two honest inputs: files, or a direct link. Progress is per file.
 */
import { useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { Upload, Link, Check, Spinner } from './Icons.jsx'
import { humanBytes } from '../lib/format.js'

const LINK_RE = /^https?:\/\/\S+\.\S+/i

export function UploadPanel() {
  const { room, uploads, joining, uploadFiles, importLink } = useStore()
  const [tab, setTab] = useState('files')
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef(null)

  const busy = importing || joining

  async function submitLink(e) {
    e.preventDefault()
    if (!LINK_RE.test(url)) return importError('Paste a full link, starting with https://')
    setImporting(true)
    await importLink(url.trim())
    setImporting(false)
    setUrl('')
  }

  function importError(msg) {
    // tiny inline nudge instead of a toast for this shape
    setLinkError(msg)
    window.setTimeout(() => setLinkError(null), 3500)
  }
  const [linkError, setLinkError] = useState(null)

  return (
    <section
      aria-label="Send music"
      className="rounded-2xl border border-line bg-surface p-4 sm:p-5"
      onDragOver={(e) => {
        if (tab === 'files') {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (tab !== 'files') return
        e.preventDefault()
        setDragging(false)
        const files = e.dataTransfer.files
        if (files?.length) uploadFiles(files)
      }}
    >
      <header className="flex items-center gap-3">
        <h2 className="text-[13px] font-semibold text-dim">Send music</h2>
        <div className="h-px flex-1 bg-line-soft" aria-hidden="true" />
        <div className="flex rounded-lg border border-line bg-raised p-0.5" role="tablist" aria-label="Input type">
          {[
            { id: 'files', label: 'Music files', icon: Upload },
            { id: 'link', label: 'Link', icon: Link },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === id ? 'bg-surface text-cream shadow-sm' : 'text-dim hover:text-cream'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div
        className={`mt-4 rounded-xl border-2 border-dashed p-4 text-center transition ${
          dragging ? 'border-amber/70 bg-amber/5' : 'border-line bg-ink/40'
        }`}
      >
        {tab === 'files' ? (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.m4b,.flac,.aac,.webm"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) uploadFiles(e.target.files)
                e.target.value = '' // allow re-choosing the same file
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className="mx-auto flex items-center gap-2 rounded-lg bg-amber px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-amber-deep active:scale-[0.98] disabled:opacity-50"
            >
              <Upload size={16} />
              Choose music files
            </button>
            <p className="mt-2.5 text-xs text-faint">
              MP3 · WAV · OGG · M4A · FLAC — drop them here or tap the button
            </p>
          </>
        ) : (
          <form onSubmit={submitLink} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              inputMode="url"
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/song.mp3"
              className="readout min-w-0 flex-1 rounded-lg border border-line bg-raised px-3.5 py-2.5 text-[13px] text-cream placeholder:text-faint"
            />
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="flex items-center justify-center gap-2 rounded-lg bg-amber px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-amber-deep active:scale-[0.98] disabled:opacity-40"
            >
              {importing ? <Spinner size={15} /> : <Link size={15} />}
              {importing ? 'Importing…' : 'Import'}
            </button>
            {linkError && <p className="text-xs text-danger">{linkError}</p>}
          </form>
        )}
      </div>

      {/* per-file progress */}
      {uploads.length > 0 && (
        <ul className="mt-3 space-y-2">
          {uploads.map((u) => (
            <li key={u.id} className="rounded-lg border border-line-soft bg-raised px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                {u.status === 'done' ? (
                  <Check size={14} className="text-online" />
                ) : u.status === 'error' ? (
                  <span className="text-danger">✕</span>
                ) : (
                  <Spinner size={14} className="text-amber" />
                )}
                <span className="min-w-0 flex-1 truncate text-dim">{u.name}</span>
                <span className="readout text-[11px] text-faint">{humanBytes(u.size)}</span>
              </div>
              {u.status === 'active' && (
                <div
                  className="mt-1.5 h-1 overflow-hidden rounded-full bg-line-soft"
                  role="progressbar"
                  aria-valueNow={Math.round(u.progress * 100)}
                >
                  <div
                    className="h-full rounded-full bg-amber transition-[width] duration-200"
                    style={{ width: `${Math.round(u.progress * 100)}%` }}
                  />
                </div>
              )}
              {u.status === 'error' && <p className="mt-1 text-[11px] text-danger">{u.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {!room && (
        <p className="mt-3 text-center text-[11px] text-faint">
          Nothing is paired yet — these items still upload to this device's library.
        </p>
      )}
    </section>
  )
}
