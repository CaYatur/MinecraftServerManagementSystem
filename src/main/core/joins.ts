/**
 * Join / alt-account aggregation, main side: read `player.join` events back out
 * of the per-server event logs and fold them with the pure aggregator. No new
 * store — this is a derived view over data the event log already holds.
 */
import { getConfig } from '../config'
import * as events from './events'
import { aggregateJoins, type JoinAggregate, type JoinQuery, type JoinRecord } from '@shared/joins'

export type { JoinAggregate, JoinQuery } from '@shared/joins'

/** How far back to look when the caller doesn't say. */
const DEFAULT_WINDOW_MS = 30 * 86400_000
/** Cap on join events pulled per server (the event query caps here too). */
const PER_SERVER_LIMIT = 2000

/**
 * Collect join records across every registered server within the window and
 * aggregate them. IPs come straight from the stored event — nothing is recorded
 * here.
 */
export function joins(q: JoinQuery = {}, now: number = Date.now()): JoinAggregate {
  const to = q.to ?? now
  const from = q.from ?? to - DEFAULT_WINDOW_MS
  const records: JoinRecord[] = []
  for (const s of getConfig().servers) {
    const page = events.query(s.id, { from, to, types: ['player.join'], limit: PER_SERVER_LIMIT })
    for (const e of page.events) {
      const d = (e.data ?? {}) as Record<string, unknown>
      const player = typeof d.player === 'string' ? d.player : ''
      if (!player) continue
      records.push({
        player,
        ip: typeof d.ip === 'string' && d.ip ? d.ip : undefined,
        ts: e.ts,
        serverId: s.id
      })
    }
  }
  return aggregateJoins(records, { text: q.text, minAccountsPerIp: q.minAccountsPerIp })
}
