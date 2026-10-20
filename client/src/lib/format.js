/** Small human-friendly formatting helpers. */

/** seconds (float) → "3:42" or "1:02:17" */
export function clockTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** bytes → "4.1 MB" */
export function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 10 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

/** nice default device name from basic capability sniffing */
export function guessDeviceName() {
  const coarse = window.matchMedia('(pointer: coarse)').matches
  return coarse ? 'Phone' : 'Computer'
}
