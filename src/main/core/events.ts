/**
 * Event log — the "what happened to this server, and when" record behind the
 * timeline.
 *
 * Same shape as the metric store (see ./metrics.ts): one append-only file per
 * server under `msms-data/events/<serverId>.jsonl`, explicit timestamps so
 * history can be replayed in a test, pruned on boot and hourly, and dropped
 * with the server it belongs to.
 *
 * Events are discrete, so there is no downsampling here - retention is by
 * count and age.
 */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { eventsDir } from '../paths'
import { getConfig } from '../config'
import { log } from '../logger'
import { computeUptime, clipSessions, type UptimeReport } from '@shared/uptime'
import * as metrics from './metrics'
import type { EventPage, EventQuery, EventSeverity, ServerEvent, ServerEventType } from '@shared/types'

export type { EventPage, EventQuery, ServerEvent, ServerEventType, UptimeReport }

/** Kept per server. Old rows go once either limit is passed. */
export const MAX_EVENTS = 4000
export const MAX_AGE_DAYS = 90

/** Live feed for the renderer; see ipc/register.ts. */
export const eventBus = new EventEmitter()

const SEVERITY: Record<ServerEventType, EventSeverity> = {
  'server.starting': 'info',
  'server.ready': 'success',
  'server.stopped': 'info',
  'server.crashed': 'error',
  'server.error': 'error',
  'player.join': 'info',
  'player.leave': 'info',
  'backup.created': 'success',
  'backup.failed': 'error',
  'backup.restored': 'warn',
  'backup.deleted': 'info',
  'schedule.run': 'info',
  'schedule.failed': 'warn',
  'alert.triggered': 'warn',
  'alert.failed': 'error',
  'world.activated': 'info',
  'world.deleted': 'warn'
}

function safeId(serverId: string): string {
  const s = serverId.replace(/[^A-Za-z0-9._-]/g, '_')
  return s.slice(0, 80) || 'unknown'
}

export function eventFile(serverId: string): string {
  mkdirSync(eventsDir(), { recursive: true })
  return join(eventsDir(), `${safeId(serverId)}.jsonl`)
}

function readAll(serverId: string): ServerEvent[] {
  const file = eventFile(serverId)
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return []
  }
  const out: ServerEvent[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as ServerEvent
      if (e && typeof e.ts === 'number' && e.type) out.push(e)
    } catch {
      /* a torn last line after a hard kill - skip it */
    }
  }
  return out
}

function writeAll(serverId: string, events: ServerEvent[]): void {
  const file = eventFile(serverId)
  const tmp = file + '.tmp'
  try {
    writeFileSync(tmp, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''), 'utf-8')
    renameSync(tmp, file)
  } catch (err) {
    log.warn('event rewrite failed:', err)
  }
}

/** Appends since the last prune, per server - cheap trigger for compaction. */
const sincePrune = new Map<string, number>()

/**
 * Record one event. `ts` is explicit so a test can lay down history instantly.
 * Returns the stored event (also emitted on `eventBus`).
 */
export function record(
  serverId: string,
  type: ServerEventType,
  opts: { data?: ServerEvent['data']; text?: string; ts?: number } = {}
): ServerEvent {
  const e: ServerEvent = {
    id: randomUUID(),
    serverId,
    ts: opts.ts ?? Date.now(),
    type,
    severity: SEVERITY[type] ?? 'info',
    ...(opts.data ? { data: opts.data } : {}),
    ...(opts.text ? { text: opts.text.slice(0, 500) } : {})
  }
  try {
    appendFileSync(eventFile(serverId), JSON.stringify(e) + '\n', 'utf-8')
  } catch (err) {
    log.warn('event append failed:', err)
  }
  const n = (sincePrune.get(serverId) ?? 0) + 1
  sincePrune.set(serverId, n)
  if (n >= 200) prune(serverId)
  eventBus.emit('event', e)
  return e
}

export function query(serverId: string, q: EventQuery = {}): EventPage {
  const from = q.from ?? 0
  const to = q.to ?? Number.MAX_SAFE_INTEGER
  const types = q.types?.length ? new Set<string>(q.types) : null
  const sev = q.severities?.length ? new Set<string>(q.severities) : null
  const all = readAll(serverId)
  const counts: Record<string, number> = {}
  const matched: ServerEvent[] = []
  for (const e of all) {
    if (e.ts < from || e.ts > to) continue
    counts[e.type] = (counts[e.type] ?? 0) + 1
    if (types && !types.has(e.type)) continue
    if (sev && !sev.has(e.severity)) continue
    matched.push(e)
  }
  matched.sort((a, b) => b.ts - a.ts) // newest first
  const limit = Math.min(2000, Math.max(1, q.limit ?? 200))
  return {
    serverId,
    events: matched.slice(0, limit),
    total: matched.length,
    counts
  }
}

/** Lifecycle events reach back before the window so an open run is seen. */
const UPTIME_LOOKBACK_MS = 30 * 86400_000
const LIFECYCLE: ServerEventType[] = [
  'server.starting',
  'server.ready',
  'server.stopped',
  'server.crashed',
  'server.error'
]

export function uptime(
  serverId: string,
  from: number,
  to: number,
  now: number = Date.now()
): UptimeReport {
  const page = query(serverId, {
    from: from - UPTIME_LOOKBACK_MS,
    to,
    types: LIFECYCLE,
    limit: 2000
  })
  const report = computeUptime(page.events, from, to, now)
  // A run with no recorded stop (power cut, MSMS killed) would otherwise count
  // as up until the next launch. Metrics are sampled every few seconds while
  // the process lives, so the last sample is a far better estimate.
  return clipSessions(report, (s) => {
    // Let the store pick the tier: 10s rows only survive 24h, so an older run
    // has to be bounded with the coarser 1m/1h rows instead of not at all.
    for (const res of ['10s', '1m', '1h'] as const) {
      const series = metrics.query(serverId, { from: s.from, to: s.to, resolution: res, limit: 5000 })
      const last = series.points[series.points.length - 1]
      if (last) return last.ts + metrics.BUCKET_MS[res]
    }
    return null
  })
}

/** Drop events past the age/count limits. Returns how many were removed. */
export function prune(serverId: string, now: number = Date.now()): number {
  const all = readAll(serverId)
  const cutoff = now - MAX_AGE_DAYS * 86400_000
  let kept = all.filter((e) => e.ts >= cutoff)
  kept.sort((a, b) => a.ts - b.ts)
  if (kept.length > MAX_EVENTS) kept = kept.slice(kept.length - MAX_EVENTS)
  sincePrune.set(serverId, 0)
  if (kept.length === all.length) return 0
  writeAll(serverId, kept)
  return all.length - kept.length
}

export function pruneAll(now: number = Date.now()): number {
  let removed = 0
  for (const s of getConfig().servers) removed += prune(s.id, now)
  return removed
}

/** Forget a server's history (called when it is removed from MSMS). */
export function dropServer(serverId: string): void {
  sincePrune.delete(serverId)
  try {
    rmSync(eventFile(serverId), { force: true })
  } catch (err) {
    log.warn('event cleanup failed:', err)
  }
}

/** Delete logs belonging to servers that are no longer registered. */
export function pruneOrphans(): number {
  const known = new Set(getConfig().servers.map((s) => `${safeId(s.id)}.jsonl`))
  let dropped = 0
  let entries: string[]
  try {
    entries = readdirSync(eventsDir())
  } catch {
    return 0
  }
  for (const name of entries) {
    if (known.has(name) || !name.endsWith('.jsonl')) continue
    try {
      rmSync(join(eventsDir(), name), { force: true })
      dropped++
    } catch {
      /* next pass */
    }
  }
  return dropped
}

let pruneTimer: NodeJS.Timeout | null = null

/** Prune on boot, then hourly. Safe to call more than once. */
export function initEvents(): void {
  try {
    const removed = pruneAll()
    const orphans = pruneOrphans()
    if (removed || orphans) {
      log.info(`Events: pruned ${removed} old entries, ${orphans} orphaned logs`)
    }
  } catch (err) {
    log.warn('event prune failed:', err)
  }
  if (!pruneTimer) {
    pruneTimer = setInterval(() => {
      try {
        pruneAll()
      } catch {
        /* keep the timer alive */
      }
    }, 3600_000)
    pruneTimer.unref?.()
  }
}
