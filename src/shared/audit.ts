/**
 * Audit trail — the "who did what, from where, and did it work" record.
 *
 * Distinct from the event log (see main/core/events.ts): events are per-server,
 * exhaustively-typed game/lifecycle facts; audit entries are actor-attributed
 * security/administrative actions that cross sources (a desktop console command,
 * a web-panel setting change, a public login) and often aren't tied to one
 * server at all. So audit is a single global store, keyed by nothing but time,
 * and it deliberately outlives the servers it audits.
 *
 * This module is pure — types plus the filter/paginate logic — so the whole
 * query surface is smoke-testable without touching disk.
 */

/** Where an action came from. */
export type AuditSource = 'console' | 'panel' | 'webpanel' | 'public' | 'system'

export const AUDIT_SOURCES: AuditSource[] = ['console', 'panel', 'webpanel', 'public', 'system']

export interface AuditEntry {
  id: string
  ts: number
  source: AuditSource
  /**
   * Namespaced free-string, e.g. `command.run`, `server.start`, `login`,
   * `balance.set`, `post.publish`. NOT an exhaustive union: a persisted log
   * must read entries written by older/newer builds, and actions are numerous
   * and cross-source. The UI keeps a known-action label map with a plain
   * fallback for the rest.
   */
  action: string
  /** Who did it: a web username, a player name, or the local operator. */
  actor: string
  /** Outcome. A trail that only kept successes would hide denied logins. */
  ok: boolean
  /** Source IP, when the action came over the network. */
  ip?: string
  /** The server it acted on, when it acted on one. */
  serverId?: string
  /** What was acted on (a player name, a setting key, a file path…). */
  target?: string
  /** Short human-readable detail. */
  detail?: string
  /** Structured extra for the UI. */
  data?: Record<string, unknown>
}

export interface AuditQuery {
  from?: number
  to?: number
  sources?: AuditSource[]
  actions?: string[]
  serverId?: string
  ok?: boolean
  /** Case-insensitive substring on the actor. */
  actor?: string
  /** Case-insensitive substring on the IP. */
  ip?: string
  /** Case-insensitive substring across action/actor/target/detail/ip/serverId. */
  text?: string
  limit?: number
  offset?: number
}

export interface AuditPage {
  entries: AuditEntry[]
  /** Matches across every filter (before pagination). */
  total: number
  /** How many entries fell in the time window, per source — for the filter UI. */
  bySource: Record<string, number>
}

function ci(hay: string | undefined, needle: string): boolean {
  return !!hay && hay.toLowerCase().includes(needle.toLowerCase())
}

/** Everything the entry is searched/filtered on, lowercased once. */
function haystack(e: AuditEntry): string {
  return [e.action, e.actor, e.target, e.detail, e.ip, e.serverId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Does one entry satisfy every clause of a query? (Time window included.) */
export function matchesAudit(e: AuditEntry, q: AuditQuery): boolean {
  if (q.from !== undefined && e.ts < q.from) return false
  if (q.to !== undefined && e.ts > q.to) return false
  if (q.sources?.length && !q.sources.includes(e.source)) return false
  if (q.actions?.length && !q.actions.includes(e.action)) return false
  if (q.serverId !== undefined && e.serverId !== q.serverId) return false
  if (q.ok !== undefined && e.ok !== q.ok) return false
  if (q.actor && !ci(e.actor, q.actor)) return false
  if (q.ip && !ci(e.ip, q.ip)) return false
  if (q.text && !haystack(e).includes(q.text.toLowerCase())) return false
  return true
}

/**
 * Filter, sort newest-first, and paginate. `bySource` is counted over the time
 * window only (before the other clauses) so the UI can show the distribution
 * and offer per-source filters without a second pass.
 */
export function filterAudit(entries: AuditEntry[], q: AuditQuery = {}): AuditPage {
  const from = q.from ?? 0
  const to = q.to ?? Number.MAX_SAFE_INTEGER
  const bySource: Record<string, number> = {}
  const matched: AuditEntry[] = []
  for (const e of entries) {
    if (e.ts < from || e.ts > to) continue
    bySource[e.source] = (bySource[e.source] ?? 0) + 1
    if (matchesAudit(e, q)) matched.push(e)
  }
  matched.sort((a, b) => b.ts - a.ts)
  const offset = Math.max(0, q.offset ?? 0)
  const limit = Math.min(2000, Math.max(1, q.limit ?? 200))
  return {
    entries: matched.slice(offset, offset + limit),
    total: matched.length,
    bySource
  }
}
