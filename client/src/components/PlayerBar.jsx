/**
 * Fixed-bottom player. Desktop: roomy transport + seek + volume.
 * Mobile: same bar, tighter spacing. MediaSession gives lockscreen controls.
 * Errors map to human toasts; autoplay policy failures tell you to tap.
 */
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { api } from '../api.js'
import { Play, Pause, Prev, Next, Volume, Muted } from './Icons.jsx'
import { clockTime } from '../lib/format.js'

export function PlayerBar() {
  const { songs, nowPlaying, setNowPlaying, isPlaying, setIsPlaying, toast } = useStore()
  const audioRef = useRef(null)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('tunedrop.volume') ?? 1))
  const [muted, setMuted] = useState(false)

  const song = songs.find((s) => s.id === nowPlaying) ?? null
  const queueEmpty = songs.length === 0

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    a.volume = Math.min(1, Math.max(0, volume))
    a.muted = muted
    localStorage.setItem('tunedrop.volume', String(volume))
  }, [volume, muted])

  /* track switch: load new src; keep playing if it was playing */
  const wantsPlayRef = useRef(false)
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    setElapsed(0)
    setDuration(song?.duration ?? 0)
    if (!song) {
      a.removeAttribute('src')
      a.load()
      wantsPlayRef.current = false
      return
    }
    a.src = api.streamUrl(song.id)
    a.load()
    if (wantsPlayRef.current) {
      a.play().catch((err) => onPlayBlocked(err))
    }
  }, [nowPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  function onPlayBlocked(err) {
    setIsPlaying(false)
    if (err?.name === 'NotAllowedError') {
      toast('info', 'Tap play once — the browser blocked auto-start.', 3500)
    } else {
      console.warn('[audio]', err)
      toast('error', 'This format cannot be played in this browser.', 4000)
    }
  }

  /* media element events (bound once) */
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setElapsed(a.currentTime)
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : duration)
    const onEnded = () => {
      const idx = songs.findIndex((s) => s.id === nowPlaying)
      const nextSong = songs[(idx + 1) % songs.length]
      if (nextSong && songs.length > 1) {
        setNowPlaying(nextSong.id)
        wantsPlayRef.current = true
      } else {
        setIsPlaying(false)
        wantsPlayRef.current = false
      }
    }
    const onErr = () => {
      if (!a.src) return
      console.warn('audio error for', a.src)
      toast('error', 'This format cannot be played in this browser.', 4000)
    }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('durationchange', onMeta)
    a.addEventListener('ended', onEnded)
    a.addEventListener('error', onErr)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('durationchange', onMeta)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('error', onErr)
    }
  }, [songs, nowPlaying, duration, toast, setNowPlaying, setIsPlaying])

  /* MediaSession — lockscreen / bluetooth controls on phones */
  useEffect(() => {
    if (!('mediaSession' in navigator) || !song) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist ?? 'TuneDrop library',
      album: song.album ?? '',
      artwork: song.hasCover
        ? [{ src: api.coverUrl(song.id), sizes: '512x512', type: 'image/jpeg' }]
        : [],
    })
    navigator.mediaSession.setActionHandler('play', togglePlay)
    navigator.mediaSession.setActionHandler('pause', togglePlay)
    navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1))
    navigator.mediaSession.setActionHandler('nexttrack', () => skip(1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song])

  async function togglePlay() {
    const a = audioRef.current
    if (!song || !a) return
    if (a.paused) {
      try {
        await a.play()
        setIsPlaying(true)
        wantsPlayRef.current = true
      } catch (err) {
        onPlayBlocked(err)
      }
    } else {
      a.pause()
      setIsPlaying(false)
      wantsPlayRef.current = false
    }
  }

  function skip(dir) {
    if (songs.length === 0) return
    const idx = nowPlaying ? songs.findIndex((s) => s.id === nowPlaying) : -1
    const target = songs[(idx + dir + songs.length) % songs.length]
    if (!target) return
    setNowPlaying(target.id)
    wantsPlayRef.current = true
    setIsPlaying(true)
  }

  function seek(e) {
    const a = audioRef.current
    if (!a) return
    const sec = Number(e.target.value)
    a.currentTime = sec
    setElapsed(sec)
  }

  function nudge(delta) {
    const a = audioRef.current
    if (!a) return
    const max = Number.isFinite(a.duration) ? a.duration : (duration || 0)
    const t = Math.min(Math.max(0, a.currentTime + delta), Math.max(0, max - 0.25))
    a.currentTime = t
    setElapsed(t)
  }

  /* keyboard: space toggles when not typing */
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t?.matches?.('input, textarea, select, [contenteditable]')) return
      if (e.code === 'Space' && song) {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [song]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!song) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line-soft bg-surface/70 backdrop-blur" data-testid="playerbar-empty" />
    )
  }

  const pct = duration > 0 ? (elapsed / duration) * 100 : 0

  return (
    <>
      <audio ref={audioRef} preload="metadata" />
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        data-testid="playerbar"
      >
        {/* amber progress hairline across the top edge */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-line" aria-hidden="true">
          <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
        </div>

        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
          {/* transport */}
          <button
            type="button"
            onClick={() => skip(-1)}
            disabled={queueEmpty}
            className="grid size-9 place-items-center rounded-full text-dim transition hover:bg-raised hover:text-cream disabled:opacity-30"
            title="Previous"
          >
            <Prev size={17} />
          </button>
          <button
            type="button"
            onClick={() => nudge(-10)}
            className="readout grid h-9 min-w-9 place-items-center rounded-full px-1.5 text-[10px] text-dim transition hover:bg-raised hover:text-cream"
            title="Back 10 s"
          >
            −10
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="grid size-11 place-items-center rounded-full bg-amber text-ink shadow-lg shadow-amber/20 transition hover:bg-amber-deep active:scale-95"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <button
            type="button"
            onClick={() => nudge(10)}
            className="readout grid h-9 min-w-9 place-items-center rounded-full px-1.5 text-[10px] text-dim transition hover:bg-raised hover:text-cream"
            title="Forward 10 s"
          >
            +10
          </button>
          <button
            type="button"
            onClick={() => skip(1)}
            disabled={queueEmpty}
            className="grid size-9 place-items-center rounded-full text-dim transition hover:bg-raised hover:text-cream disabled:opacity-30"
            title="Next"
          >
            <Next size={17} />
          </button>

          {/* title */}
          <div className="ml-1 hidden min-w-0 flex-1 sm:block">
            <p className="truncate text-[13px] font-medium text-cream">{song.title}</p>
            <p className="truncate text-[11px] text-faint">{song.artist ?? song.originalName}</p>
          </div>
          <div className="min-w-0 flex-1 sm:hidden">
            <p className="truncate text-xs font-medium text-cream">{song.title}</p>
          </div>

          {/* times + seek */}
          <div className="hidden items-center gap-2 md:flex">
            <span className="readout w-10 text-right text-[11px] text-dim">{clockTime(elapsed)}</span>
            <input
              type="range"
              className="track w-56"
              min={0}
              max={Math.max(duration, 1)}
              step={0.1}
              value={elapsed}
              onChange={seek}
              disabled={!duration}
              style={{ '--fill': `${pct}%` }}
              aria-label="Seek"
            />
            <span className="readout w-10 text-[11px] text-faint">{clockTime(duration)}</span>
          </div>

          {/* volume */}
          <div className="hidden items-center gap-1.5 md:flex">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="grid size-8 place-items-center rounded-full text-dim transition hover:text-cream"
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <Muted size={16} /> : <Volume size={16} />}
            </button>
            <input
              type="range"
              className="track w-24"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value))
                setMuted(false)
              }}
              style={{ '--fill': `${(muted ? 0 : volume) * 100}%` }}
              aria-label="Volume"
            />
          </div>

          {/* mobile mute, tucked next to the title */}
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="ml-auto grid size-9 place-items-center rounded-full text-dim transition hover:bg-raised hover:text-cream md:hidden"
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <Muted size={16} /> : <Volume size={16} />}
          </button>
        </div>

        {/* mobile seek row — full width, thumb-friendly */}
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 pb-2 md:hidden">
          <span className="readout w-9 text-right text-[10px] text-dim">{clockTime(elapsed)}</span>
          <input
            type="range"
            className="track h-8 min-w-0 flex-1"
            min={0}
            max={Math.max(duration, 1)}
            step={0.1}
            value={elapsed}
            onChange={seek}
            disabled={!duration}
            style={{ '--fill': `${pct}%` }}
            aria-label="Seek"
          />
          <span className="readout w-9 text-[10px] text-faint">{clockTime(duration)}</span>
        </div>
      </div>
    </>
  )
}
