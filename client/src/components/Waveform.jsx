/**
 * Deterministic per-song waveform: the placeholder cover art. Seeded from the
 * song id, so each song keeps its fingerprint across renders and devices.
 */
const BAR_COUNT = 21

function mulberry32(seed) {
  let a = seed | 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function Waveform({ songId, active = false }) {
  const bars = barsFor(songId)
  // accent a deterministic middle run — reads as "the part being played"
  const hiFrom = 5
  const hiTo = 10

  return (
    <svg width="48" height="28" viewBox="0 0 48 28" className="shrink-0" aria-hidden="true">
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 2.2}
          y={14 - h / 2}
          width="1.3"
          height={h}
          rx="0.65"
          fill={
            active
              ? 'var(--color-amber)'
              : i >= hiFrom && i <= hiTo
                ? 'color-mix(in srgb, var(--color-amber) 62%, var(--color-line))'
                : 'var(--color-line)'
          }
        />
      ))}
    </svg>
  )
}

function barsFor(id) {
  const rand = mulberry32(hashString(String(id)))
  return Array.from({ length: BAR_COUNT }, () => 3 + Math.floor(rand() * 21))
}
