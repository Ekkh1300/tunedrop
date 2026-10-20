/** Thin strip of connected device chips (presence from socket events). */
import { useStore } from '../store.jsx'
import { Monitor, Phone } from './Icons.jsx'

function nameKind(name) {
  return /phone|mobile|android|ios|tablet/i.test(name) ? Phone : Monitor
}

export function DevicesStrip() {
  const { presence, room } = useStore()
  if (!room) return null

  const devices = presence.length
    ? presence
    : [{ deviceId: 'self', name: 'This device', connections: 1 }]

  return (
    <section aria-label="Connected devices" className="flex items-center gap-2 overflow-x-auto pb-0.5">
      {devices.map((d, i) => {
        const Icon = nameKind(d.name) === Phone ? Phone : Monitor
        const online = (d.connections ?? 0) > 0
        return (
          <span
            key={d.deviceId}
            className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-dim"
            title={online ? 'Online' : 'Last seen recently'}
          >
            <Icon size={13} className={online ? 'text-amber' : 'text-faint'} />
            {d.name}
            <span
              className={`size-1.5 rounded-full ${online ? 'bg-online' : 'bg-faint'}`}
              aria-hidden="true"
            />
          </span>
        )
      })}
      {presence.length <= 1 && (
        <span className="shrink-0 text-[11px] text-faint">— pair another device from the QR panel</span>
      )}
    </section>
  )
}
