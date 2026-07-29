/**
 * A two-window budget for expensive, user-triggered refreshes (#117).
 *
 * An inventory refresh asks the server to flush the world to disk. That is not
 * free on a big world, so it gets a short-term brake (a handful a minute) and a
 * long-term cap (a hundred an hour) — one without the other is no limit at all:
 * a per-minute cap alone allows three every minute all day, and an hourly cap
 * alone allows a hundred in the first ten seconds.
 */

export interface RefreshBudget {
  perMinute: number
  perHour: number
}

/** What the report asked for, and a sensible shape for the work involved. */
export const INVENTORY_REFRESH: RefreshBudget = { perMinute: 3, perHour: 100 }

export interface RefreshState {
  /** Timestamps of recent grants, newest last. */
  hits: number[]
}

export interface RefreshVerdict {
  allowed: boolean
  /** Whole seconds until the next one would be granted; 0 when allowed. */
  retryAfterSec: number
  /** Which window refused, for a message worth reading. */
  window?: 'minute' | 'hour'
  state: RefreshState
}

export function newRefreshState(): RefreshState {
  return { hits: [] }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * Spend one, if both windows allow.
 *
 * A refusal costs NOTHING. That is the opposite of the two-bucket rule in the
 * account-verification limiter, and deliberately: there the two buckets are
 * different dimensions (a name and an address) and spending both stops one
 * budget shielding the other. Here both windows govern the same person, so
 * charging the hourly budget for a request the per-minute window already
 * refused would let someone clicking a disabled-looking button burn their whole
 * hour without a single refresh happening.
 *
 * Timestamps rather than token buckets because the windows are exact and the
 * numbers are small: "three in the last minute" is what an operator was
 * promised, and a refilling bucket answers a slightly different question.
 */
export function tryRefresh(
  state: RefreshState,
  budget: RefreshBudget,
  now: number
): RefreshVerdict {
  // Anything older than the longest window can never matter again.
  const hits = state.hits.filter((t) => now - t < HOUR).sort((a, b) => a - b)

  const inMinute = hits.filter((t) => now - t < MINUTE)
  if (inMinute.length >= budget.perMinute) {
    const oldest = inMinute[inMinute.length - budget.perMinute]
    return {
      allowed: false,
      window: 'minute',
      retryAfterSec: Math.max(1, Math.ceil((MINUTE - (now - oldest)) / 1000)),
      state: { hits }
    }
  }
  if (hits.length >= budget.perHour) {
    const oldest = hits[hits.length - budget.perHour]
    return {
      allowed: false,
      window: 'hour',
      retryAfterSec: Math.max(1, Math.ceil((HOUR - (now - oldest)) / 1000)),
      state: { hits }
    }
  }
  return { allowed: true, retryAfterSec: 0, state: { hits: [...hits, now] } }
}

/**
 * How long a world flush is reused before another is asked for.
 *
 * The flush is per-WORLD, not per-player, so two people refreshing at once
 * should cost one. Without this the per-player budget multiplies: ten players
 * with three a minute each is thirty flushes a minute on one world.
 */
export const FLUSH_REUSE_MS = 5_000
