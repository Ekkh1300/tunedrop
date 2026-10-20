/**
 * Sliding-window in-memory rate limiter (per key + bucket).
 * Good enough for a LAN-first app; swap for a shared store when we go WAN.
 */
const buckets = new Map() // key -> number[] timestamps

/** @returns {boolean} true if allowed */
export function allow(key, limit, windowMs) {
  const now = Date.now()
  let hits = buckets.get(key)
  if (!hits) buckets.set(key, (hits = []))
  // drop timestamps outside the window
  while (hits.length && hits[0] <= now - windowMs) hits.shift()
  if (hits.length >= limit) return false
  hits.push(now)
  // opportunistic cleanup so idle memory doesn't grow without bound
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.length || v[v.length - 1] < now - windowMs) buckets.delete(k)
    }
  }
  return true
}

/** Remaining ms until `key` may try again (0 if fine now). */
export function retryAfterMs(key) {
  const hits = buckets.get(key)
  if (!hits || !hits.length) return 0
  const now = Date.now()
  return Math.max(0, hits[0] + 60_000 - now)
}
