import type { Scope } from './web'

/**
 * Machine credentials for the integration API (#48).
 *
 * A panel session is username/password → a token that expires in 12 hours. That
 * is the wrong shape for a third-party integration: there is no way to scope it,
 * no way to revoke it without disturbing a human account, and it dies overnight.
 * An API key is scoped, revocable, and belongs to no person.
 */

/** `'all'` means every server, including ones added later. */
export type KeyServers = string[] | 'all'

export interface ApiKeyView {
  id: string
  label: string
  scopes: Scope[]
  servers: KeyServers
  createdAt: number
  lastUsedAt?: number
  /** Epoch ms; absent = never expires. */
  expiresAt?: number
  revoked?: boolean
  /**
   * Switched off, reversibly.
   *
   * Distinct from `revoked` on purpose. Revoking is permanent and is what you
   * do to a key you believe has leaked; this is what you do to an integration
   * you are debugging or pausing, and it can be undone. Collapsing the two
   * would mean the only way to silence a key for an hour is to destroy it and
   * re-issue — so the safe action and the routine one would share a button.
   */
  disabled?: boolean
  /** Account-level: read the global audit log. Mirrors the user flag. */
  canAudit?: boolean
}

export const KEY_PREFIX = 'msms_'

/** Pure: is this key usable right now? */
export function isKeyUsable(
  key: Pick<ApiKeyView, 'revoked' | 'expiresAt' | 'disabled'>,
  now: number
): boolean {
  if (key.revoked) return false
  // Checked here rather than at the call sites: this function is the single
  // answer to "may this key be used", and a switch honoured in some places and
  // not others is worse than no switch.
  if (key.disabled) return false
  if (key.expiresAt !== undefined && key.expiresAt <= now) return false
  return true
}

/**
 * Pure: may this key touch this server?
 *
 * `'all'` deliberately covers servers created *after* the key was issued - an
 * integration that manages "my servers" should not silently stop seeing new
 * ones. A key that must not do that gets an explicit list.
 */
export function keyCoversServer(servers: KeyServers, serverId: string): boolean {
  return servers === 'all' || servers.includes(serverId)
}

// ---- rate limiting (#50) ----

export interface Bucket {
  /** Tokens remaining, fractional. */
  tokens: number
  /** When `tokens` was last computed. */
  updatedAt: number
}

export interface BucketLimit {
  /** Burst size, and the ceiling tokens refill to. */
  capacity: number
  /** Sustained rate. */
  refillPerSec: number
}

export interface BucketResult {
  allowed: boolean
  /** Whole seconds the caller should wait; only meaningful when refused. */
  retryAfterSec: number
  bucket: Bucket
}

export function newBucket(limit: BucketLimit, now: number): Bucket {
  return { tokens: limit.capacity, updatedAt: now }
}

/**
 * Default per-key budget: 120 requests of burst, refilling at 4/s.
 *
 * Sized for polling, which is what integrations actually do - a dashboard
 * refreshing six endpoints every two seconds sits at 3/s and never notices this
 * exists. It is a runaway-loop brake, not a quota.
 */
export const DEFAULT_KEY_LIMIT: BucketLimit = { capacity: 120, refillPerSec: 4 }

/**
 * Pure token bucket: refill by elapsed time, then try to spend one.
 *
 * Time-based rather than a counter reset on a fixed window, because a fixed
 * window lets a caller spend the whole budget in the last instant of one window
 * and again in the first instant of the next - twice the intended burst, at the
 * exact moment a runaway client is hammering hardest.
 *
 * A clock that goes backwards must not hand out free tokens, so elapsed time is
 * floored at zero.
 */
export function consumeToken(bucket: Bucket, limit: BucketLimit, now: number): BucketResult {
  const elapsedSec = Math.max(0, (now - bucket.updatedAt) / 1000)
  const tokens = Math.min(limit.capacity, bucket.tokens + elapsedSec * limit.refillPerSec)
  if (tokens >= 1) {
    return { allowed: true, retryAfterSec: 0, bucket: { tokens: tokens - 1, updatedAt: now } }
  }
  const need = 1 - tokens
  return {
    // Always at least 1: `Retry-After: 0` invites an immediate retry, which is
    // the opposite of what a rate limit is for.
    retryAfterSec: Math.max(1, Math.ceil(need / limit.refillPerSec)),
    allowed: false,
    bucket: { tokens, updatedAt: now }
  }
}

// ---- CORS (#50) ----

/**
 * Pure: is this Origin allowed?
 *
 * Default deny, and **never** a wildcard. This API is authenticated with
 * long-lived credentials, and `Access-Control-Allow-Origin: *` combined with a
 * key that a page can read is how a hostile site drives someone's server.
 * An empty allowlist means browsers get nothing, which is the safe default for
 * a surface whose main consumers are servers, not pages.
 */
export function isOriginAllowed(origin: string | undefined, allowlist: string[]): boolean {
  if (!origin) return false
  return allowlist.some((a) => a.trim().toLowerCase() === origin.trim().toLowerCase())
}
