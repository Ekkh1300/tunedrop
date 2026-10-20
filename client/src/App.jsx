/**
 * Shell + routing. Routes are driven by the hash fragment only:
 *   #/               → main app (library, sender, player)
 *   #/join?code&token→ QR handoff: auto-join, then 'location.replace('#/')'
 * No router dependency — two states don't need one.
 */
import { useEffect, useState } from 'react'
import { AppProvider, useStore } from './store.jsx'
import { Header } from './components/Header.jsx'
import { ReceiverPanel } from './components/ReceiverPanel.jsx'
import { UploadPanel } from './components/UploadPanel.jsx'
import { DevicesStrip } from './components/DevicesStrip.jsx'
import { SongGrid } from './components/SongGrid.jsx'
import { PlayerBar } from './components/PlayerBar.jsx'
import { EntryView } from './components/EntryView.jsx'
import { Toasts } from './components/Toasts.jsx'

function parseHash() {
  const h = location.hash // "#/join?code=123456&token=xyz"
  if (!h.startsWith('#/')) return { route: '/' }
  const [path, query = ''] = h.slice(2).split('?')
  return { route: `/${path}`, params: new URLSearchParams(query) }
}

function Library({ seedCode }) {
  const { room } = useStore()

  if (!room) {
    return <EntryView initialCode={seedCode} />
  }

  const wide = window.matchMedia('(min-width: 900px)').matches

  return (
    <main className="reveal mx-auto max-w-5xl px-4 pb-36 pt-6">
      <div className={wide ? 'grid grid-cols-[minmax(0,20rem)_1fr] items-start gap-6' : 'space-y-5'}>
        <div className={wide ? 'space-y-4 lg:sticky lg:top-[76px]' : 'space-y-5'}>
          <ReceiverPanel />
          <DevicesStrip />
        </div>

        <div className="space-y-5">
          <UploadPanel />
          <section aria-label="Music library">
            <header className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-cream">Library</h2>
              <Count />
            </header>
            <SongGrid />
          </section>
        </div>
      </div>
    </main>
  )
}

function Count() {
  const { songs } = useStore()
  if (songs.length === 0) return null
  const total = songs.reduce((acc, s) => acc + (s.size ?? 0), 0)
  return (
    <p className="readout text-[11px] text-faint">
      {songs.length} song{songs.length > 1 ? 's' : ''} · {(total / 1048576).toFixed(1)} MB
    </p>
  )
}

function Router() {
  const [route, setRoute] = useState(() => parseHash().route)
  const { seedCode } = useStore()

  useEffect(() => {
    const onHash = () => setRoute(parseHash().route)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return route === '/' ? <Library seedCode={seedCode} /> : <EntryView initialCode={seedCode} />
}

export default function App() {
  return (
    <AppProvider>
      <Header />
      <Router />
      <PlayerBar />
      <Toasts />
    </AppProvider>
  )
}
