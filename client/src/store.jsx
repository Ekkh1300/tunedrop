/**
 * AppStore — pairing lifecycle, library state, realtime wire-up, upload queue,
 * toasts. One context for the shell; the player keeps its own state in
 * PlayerBar (with only nowPlayingId/isPlaying mirrored here for the UI).
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { api } from './api.js'
import { storage } from './lib/storage.js'
import { guessDeviceName } from './lib/format.js'
import { socket } from './socket.js'

const StoreCtx = createContext(null)
export const useStore = () => useContext(StoreCtx)

let toastSeq = 0
let uploadSeq = 0

export function AppProvider({ children }) {
  const [room, setRoom] = useState(() => storage.room)
  const [songs, setSongs] = useState([])
  const [presence, setPresence] = useState([])
  const [connection, setConnection] = useState('idle') // idle | connecting | offline | live
  const [qr, setQr] = useState(null)
  const [toasts, setToasts] = useState([])
  const [uploads, setUploads] = useState([])
  const [joining, setJoining] = useState(false)
  const [seedCode, setSeedCode] = useState('')
  const [flashIds, setFlashIds] = useState([]) // recent arrivals, for the highlight pulse
  const [nowPlaying, setNowPlaying] = useState(null) // song id
  const [isPlaying, setIsPlaying] = useState(false)

  const roomRef = useRef(room)
  roomRef.current = room
  const songsRef = useRef(songs)
  songsRef.current = songs

  const toast = useCallback((kind, text, ms = 4500) => {
    const id = ++toastSeq
    setToasts((prev) => [...prev.slice(-4), { id, kind, text }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ms)
  }, [])

  const clearFlash = useCallback((id) => {
    setFlashIds((prev) => prev.filter((x) => x !== id))
  }, [])

  /* ---------------------------------------------------- library + realtime */

  const refreshSongs = useCallback(async () => {
    try {
      const { songs: fresh } = await api.listSongs()
      setSongs(fresh)
      return true
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        // invalid pairing (server restarted clean, or room gone): recover gracefully
        handleInvalidCredentials()
        return false
      }
      throw err // surfaced through connection state instead
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchQr = useCallback(async (iface) => {
    const r = roomRef.current
    if (!r) return
    try {
      setQr(await api.qr(r.code, iface))
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) console.error('qr fetch failed', err)
      // 401s are handled by the library refresh path
    }
  }, [])

  const handleInvalidCredentials = useCallback(() => {
    socket.disconnect()
    storage.clearRoom()
    setRoom(null)
    setSongs([])
    setPresence([])
    setQr(null)
    setConnection('idle')
    toast('error', 'Pairing with this library was lost. Pair the devices again.')
  }, [toast])

  const joinSocketRoom = useCallback(() => {
    const r = roomRef.current
    if (!r) return
    setConnection((c) => (c === 'live' ? c : 'connecting'))
    socket.emit('room:join', {
      code: r.code,
      secret: r.secret,
      deviceId: storage.deviceId,
      name: storage.deviceName || guessDeviceName(),
    }, (ack) => {
      if (ack?.ok) {
        setConnection('live')
        refreshSongs().catch(() => {})
      } else {
        setConnection('offline')
        console.warn('room:join rejected')
      }
    })
  }, [refreshSongs, toast])

  /* socket lifecycle */
  useEffect(() => {
    const onConnect = () => joinSocketRoom()
    const onDisconnect = (reason) => {
      setConnection('offline')
      if (reason !== 'io client disconnect' && roomRef.current) {
        toast('info', 'Connection lost — reconnecting…', 2500)
      }
    }
    const onPresence = ({ devices }) => setPresence(devices ?? [])
    const onSongAdded = (song) => {
      setSongs((prev) => (prev.some((s) => s.id === song.id) ? prev : [song, ...prev]))
      if (song.uploaderDevice !== storage.deviceId) {
        setFlashIds((prev) => [...prev, song.id])
        window.setTimeout(() => setFlashIds((prev) => prev.filter((x) => x !== song.id)), 2200)
        toast('success', `New song arrived: ${song.title}`)
      }
    }
    const onSongRemoved = ({ id }) => {
      setSongs((prev) => prev.filter((s) => s.id !== id))
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('presence', onPresence)
    socket.on('song:added', onSongAdded)
    socket.on('song:removed', onSongRemoved)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('presence', onPresence)
      socket.off('song:added', onSongAdded)
      socket.off('song:removed', onSongRemoved)
    }
  }, [joinSocketRoom, toast])

  /* socket renders the store unstable otherwise: connect once, on stage change */
  useEffect(() => {
    if (room) {
      socket.connect()
    }
    return () => {
      if (!roomRef.current) socket.disconnect()
    }
  }, [room])

  /* ------------------------------------------------------------- pairing */

  const pair = useCallback(({ code, secret }) => {
    storage.setRoom({ code, secret })
    setRoom({ code, secret })
    roomRef.current = { code, secret }
  }, [])

  const createRoom = useCallback(async () => {
    setJoining(true)
    try {
      const data = await api.createRoom()
      pair({ code: data.code, secret: data.secret })
      fetchQr() // host panel needs the QR immediately
      return data
    } catch (err) {
      toast('error', err.message)
      throw err
    } finally {
      setJoining(false)
    }
  }, [pair, fetchQr, toast])

  const joinByCode = useCallback(async (code, token) => {
    setJoining(true)
    try {
      const data = await api.joinRoom(code.toUpperCase?.() ?? code, token)
      pair(data)
      return true
    } catch (err) {
      // human messages come straight from the server contract
      toast('error', err.message || 'Could not join.', 6000)
      return false
    } finally {
      setJoining(false)
    }
  }, [pair, toast])

  const unpair = useCallback(() => {
    socket.disconnect()
    storage.clearRoom()
    setRoom(null)
    setSongs([])
    setPresence([])
    setQr(null)
    setConnection('idle')
    setNowPlaying(null)
    setIsPlaying(false)
  }, [])

  /* boot: absorb a QR handoff (#/join?code&token) or verify persisted pairing */
  useEffect(() => {
    const h = location.hash
    if (h.startsWith('#/join')) {
      history.replaceState(null, '', '#/')
      const q = new URLSearchParams(h.split('?')[1] ?? '')
      const code = (q.get('code') ?? '').replace(/\D/g, '').slice(0, 6)
      const token = q.get('token') ?? undefined
      if (code) {
        setSeedCode(code)
        joinByCode(code, token)
        return
      }
    }
    const r = storage.room
    if (r) setRoom(r) // pinch of trust: socket join validates, refresh confirms
    joinSocketRoom()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* auto-refresh QR 30s before expiry */
  useEffect(() => {
    if (!room) return
    fetchQr()
    let timer
    const tick = () => {
      if (!qr?.joinTokenExpiresAt) return
      const remaining = qr.joinTokenExpiresAt - Date.now()
      timer = window.setTimeout(tick, Math.max(1000, remaining - 30_000))
      if (remaining <= 35_000) fetchQr()
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [room, qr, fetchQr])

  /* -------------------------------------------------------------- actions */

  const uploadFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList ?? [])
    for (const file of files) {
      const id = `u${++uploadSeq}`
      const item = { id, name: file.name, size: file.size, progress: 0, status: 'active', error: null }
      setUploads((prev) => [...prev, item])
      try {
        if (file.size > 0 && file.size / (1024 * 1024) > 150) {
          throw Object.assign(new Error('File is too large. The limit is 150 MB.'), { extra: true })
        }
        const song = await api.uploadFile(file, {
          onProgress: (p) => setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, progress: p } : u))),
        })
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'done', progress: 1 } : u)))
        setSongs((prev) => (prev.some((s) => s.id === song.id) ? prev : [song, ...prev]))
      } catch (err) {
        if (err?.code === 'ABORTED') {
          setUploads((prev) => prev.filter((u) => u.id !== id))
          continue
        }
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'error', error: err.message } : u)))
        toast('error', err.message)
      }
      window.setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.id !== id || u.status === 'active'))
      }, 4000)
    }
  }, [toast])

  const importLink = useCallback(async (url) => {
    try {
      const { song } = await api.importUrl(url)
      toast('success', `Imported ${song.title}`)
      setSongs((prev) => (prev.some((s) => s.id === song.id) ? prev : [song, ...prev]))
      return true
    } catch (err) {
      toast('error', err.message || 'Could not import that link.', 6000)
      return false
    }
  }, [toast])

  const deleteSong = useCallback(async (id) => {
    try {
      await api.deleteSong(id)
      setSongs((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      toast('error', err.message || 'Could not delete the song.')
    }
  }, [toast])

  const value = useMemo(() => ({
    room, songs, presence, connection, qr, toasts, uploads, joining, flashIds,
    nowPlaying, isPlaying, seedCode,
    setNowPlaying, setIsPlaying,
    createRoom, joinByCode, unpair, fetchQr,
    refreshSongs, uploadFiles, importLink, deleteSong, toast,
  }), [
    room, songs, presence, connection, qr, toasts, uploads, joining, flashIds,
    nowPlaying, isPlaying, seedCode,
    createRoom, joinByCode, unpair, fetchQr,
    refreshSongs, uploadFiles, importLink, deleteSong, toast,
  ])

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}
