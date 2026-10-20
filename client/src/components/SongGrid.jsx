/**
 * Library grid. Cards are quiet until hovered; the active card breathes with
 * a tiny equalizer; arrivals flash amber once (the socket's announcement).
 */
import { useState } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Play, Trash, Pause, Download } from './Icons.jsx'
import { Waveform } from './Waveform.jsx'
import { clockTime, humanBytes } from '../lib/format.js'

function fmtMeta(song) {
  const bits = [
    song.artist ?? null,
    song.ext?.toUpperCase(),
    humanBytes(song.size),
  ].filter(Boolean)
  return bits.join(' · ')
}

export function SongGrid() {
  const { songs, flashIds } = useStore()

  if (songs.length === 0) return <EmptyLibrary />

  return (
    <ul
      role="list"
      className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {songs.map((song) => (
        <SongCard key={song.id} song={song} flashed={flashIds.includes(song.id)} />
      ))}
    </ul>
  )
}

function SongCard({ song, flashed }) {
  const { nowPlaying, isPlaying, setNowPlaying, deleteSong } = useStore()
  const active = nowPlaying === song.id
  const [armed, setArmed] = useState(false)

  function remove(e) {
    e.stopPropagation()
    if (!armed) {
      setArmed(true)
      window.setTimeout(() => setArmed(false), 2500)
      return
    }
    deleteSong(song.id)
  }

  return (
    <li
      className={`card-hover group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-line-soft bg-surface px-3 py-3 ${
        flashed ? 'animate-flash' : ''
      } ${active ? 'border-amber/40' : ''}`}
      onClick={() => setNowPlaying(song.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setNowPlaying(song.id)
        }
      }}
      aria-label={`${active && isPlaying ? 'Pause' : 'Play'} ${song.title}`}
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg border border-line-soft bg-raised">
        {song.hasCover ? (
          <img
            src={api.coverUrl(song.id)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="grid size-full place-items-center bg-raised">
            <Waveform songId={song.id} active={active} />
          </div>
        )}
        <div
          className={`absolute inset-0 grid place-items-center bg-ink/55 transition ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {active && isPlaying ? <Pause size={17} /> : <Play size={17} className="text-amber" />}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13px] font-medium ${active ? 'text-amber' : 'text-cream'}`}>
          {song.title}
        </p>
        <p className="readout mt-0.5 truncate text-[11px] text-faint">{fmtMeta(song)}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {active && isPlaying && <Equalizer />}
        <span className={`readout text-[11px] ${active ? 'text-amber' : 'text-dim'}`}>
          {clockTime(song.duration)}
        </span>
        <a
          href={api.streamUrl(song.id)}
          download={song.originalName}
          onClick={(e) => e.stopPropagation()}
          title="Save this file"
          className="grid size-7 place-items-center rounded-md text-faint transition hover:text-cream"
        >
          <Download size={14} />
        </a>
        <button
          type="button"
          onClick={remove}
          title={armed ? 'Click again to confirm' : 'Remove song'}
          className={`grid size-7 place-items-center rounded-md transition ${
            armed
              ? 'bg-danger/15 text-danger'
              : 'text-faint opacity-0 hover:text-danger group-hover:opacity-100'
          }`}
        >
          <Trash size={14} />
        </button>
      </div>
    </li>
  )
}

function Equalizer() {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-amber"
          style={{
            animation: `eq-heart ${0.9 + i * 0.22}s ease-in-out ${i * 0.13}s infinite alternate`,
            height: `${5 + i * 2}px`,
          }}
        />
      ))}
      <style>{`@keyframes eq-heart { from { transform: scaleY(0.5) } to { transform: scaleY(1) } }`}</style>
    </span>
  )
}

function EmptyLibrary() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/40 px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-xl border border-line bg-surface">
        <Waveform songId="empty" />
      </div>
      <p className="text-sm font-medium text-dim">Nothing here yet</p>
      <p className="max-w-xs text-[13px] leading-relaxed text-faint">
        Send a song from the phone — it will appear here the moment it lands,
        no refresh needed.
      </p>
    </div>
  )
}
