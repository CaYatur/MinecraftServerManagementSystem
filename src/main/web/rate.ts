/**
 * Per-key token buckets (#50), in their own module so both the request path and
 * the WebSocket upgrade path can spend from the same budget.
 *
 * They have to be the same buckets. A limiter that only counts HTTP requests is
 * one an integration can walk around by opening streams instead, and the
 * upgrade is the more expensive of the two — it leaves a socket behind.
 *
 * Deliberately not persisted: a restart clearing the buckets is correct for a
 * burst brake, and writing a file per request would cost more than the limit
 * saves.
 */
import { consumeToken, newBucket, DEFAULT_KEY_LIMIT, type Bucket } from '@shared/apikeys'

const keyBuckets = new Map<string, Bucket>()

export interface RateVerdict {
  allowed: boolean
  retryAfterSec: number
}

export function spendKeyToken(keyId: string, now = Date.now()): RateVerdict {
  const b = keyBuckets.get(keyId) ?? newBucket(DEFAULT_KEY_LIMIT, now)
  const r = consumeToken(b, DEFAULT_KEY_LIMIT, now)
  keyBuckets.set(keyId, r.bucket)
  return { allowed: r.allowed, retryAfterSec: r.retryAfterSec }
}

export function resetKeyBuckets(): void {
  keyBuckets.clear()
}
