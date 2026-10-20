/** Toast notifications — human announcements, tech detail stays in the console. */
import { Check, Warn, Spinner, Music } from './Icons.jsx'
import { useStore } from '../store.jsx'

const KIND_CLASS = {
  error: 'border-danger/60 text-danger',
  success: 'border-online/50 text-online',
  info: 'border-line text-dim',
  busy: 'border-amber/60 text-amber',
}

const KIND_ICON = {
  error: Warn,
  success: Check,
  info: Music,
  busy: Spinner,
}

export function Toasts() {
  const { toasts } = useStore()
  return (
    <div
      aria-live="polite"
      className="fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3"
    >
      {toasts.map((t) => {
        const Icon = KIND_ICON[t.kind] ?? Music
        return (
          <div
            key={t.id}
            role="status"
            className={`reveal pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-lg border bg-surface/95 py-2.5 pl-3 pr-4 text-sm text-cream shadow-xl shadow-black/40 backdrop-blur ${KIND_CLASS[t.kind] ?? KIND_CLASS.info}`}
          >
            <Icon size={16} />
            <span className="min-w-0 flex-1">{t.text}</span>
          </div>
        )
      })}
    </div>
  )
}
