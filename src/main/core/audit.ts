/**
 * Audit trail store — a single global append-only log of actor-attributed
 * actions. Mirrors the events store's on-disk shape (JSONL, explicit
 * timestamps, prune by count + age), but it is NOT per-server and is NOT
 * dropped when a server is removed: a security trail should outlive the thing
 * it audited. See @shared/audit for the record shape and the pure filter.
 */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { auditDir } from '../paths'
import { log } from '../logger'
import { filterAudit, type AuditEntry, type AuditPage, type AuditQuery } from '@shared/audit'

export type { AuditEntry, AuditPage, AuditQuery }

/** Old rows go once either limit is passed. Global, so a larger cap than events. */
export const MAX_AUDIT = 20000
export const MAX_AGE_DAYS = 180

/** Live feed for the renderer; wired in ipc/register.ts. */
export const auditBus = new EventEmitter()

function auditFile(): string {
  return join(auditDir(), 'audit.jsonl')
}

function readAll(): AuditEntry[] {
  const file = auditFile()
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return []
  }
  const out: AuditEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as AuditEntry
      if (e && typeof e.ts === 'number' && e.action && e.source) out.push(e)
    } catch {
      /* a torn last line after a hard kill - skip it */
    }
  }
  return out
}

function writeAll(entries: AuditEntry[]): void {
  const file = auditFile()
  const tmp = file + '.tmp'
  try {
    writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''), 'utf-8')
    renameSync(tmp, file)
  } catch (err) {
    log.warn('audit rewrite failed:', err)
  }
}

let sincePrune = 0

/** What a caller supplies; id + ts + ok default are filled in here. */
export interface AuditInput {
  source: AuditEntry['source']
  action: string
  actor: string
  ok?: boolean
  ip?: string
  serverId?: string
  target?: string
  detail?: string
  data?: AuditEntry['data']
  ts?: number
}

/**
 * Record one audited action. Cheap and fire-and-forget — never throws, so a
 * logging failure can't break the action it was recording. Returns the stored
 * entry (also emitted on `auditBus`).
 */
export function record(input: AuditInput): AuditEntry {
  const e: AuditEntry = {
    id: randomUUID(),
    ts: input.ts ?? Date.now(),
    source: input.source,
    action: input.action.slice(0, 80),
    actor: (input.actor || 'unknown').slice(0, 80),
    ok: input.ok !== false,
    ...(input.ip ? { ip: input.ip.slice(0, 60) } : {}),
    ...(input.serverId ? { serverId: input.serverId } : {}),
    ...(input.target ? { target: input.target.slice(0, 200) } : {}),
    ...(input.detail ? { detail: input.detail.slice(0, 500) } : {}),
    ...(input.data ? { data: input.data } : {})
  }
  try {
    appendFileSync(auditFile(), JSON.stringify(e) + '\n', 'utf-8')
  } catch (err) {
    log.warn('audit append failed:', err)
  }
  if (++sincePrune >= 300) prune()
  auditBus.emit('audit', e)
  return e
}

export function query(q: AuditQuery = {}): AuditPage {
  return filterAudit(readAll(), q)
}

/** Drop entries past the age/count limits. Returns how many were removed. */
export function prune(now: number = Date.now()): number {
  const all = readAll()
  const cutoff = now - MAX_AGE_DAYS * 86400_000
  let kept = all.filter((e) => e.ts >= cutoff)
  kept.sort((a, b) => a.ts - b.ts)
  if (kept.length > MAX_AUDIT) kept = kept.slice(kept.length - MAX_AUDIT)
  sincePrune = 0
  if (kept.length === all.length) return 0
  writeAll(kept)
  return all.length - kept.length
}

let pruneTimer: NodeJS.Timeout | null = null

/** Prune on boot, then hourly. Safe to call more than once. */
export function initAudit(): void {
  try {
    const removed = prune()
    if (removed) log.info(`Audit: pruned ${removed} old entries`)
  } catch (err) {
    log.warn('audit prune failed:', err)
  }
  if (!pruneTimer) {
    pruneTimer = setInterval(() => {
      try {
        prune()
      } catch {
        /* keep the timer alive */
      }
    }, 3600_000)
    pruneTimer.unref?.()
  }
}

/** Test seam: forget the in-memory prune counter. */
export function _reset(): void {
  sincePrune = 0
}
