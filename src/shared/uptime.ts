/**
 * Uptime from the event timeline.
 *
 * "Up" means between `server.ready` and whatever ended that run. Pairing them
 * is the whole difficulty, because real history is messy:
 *
 *  - a run can crash before it ever became ready (failed start: 0 uptime, but
 *    it still counts as a crash),
 *  - the newest run may still be going (no terminal event yet),
 *  - a run can start before the window and/or end after it, so it has to be
 *    clipped to the window rather than dropped,
 *  - MSMS may have been closed while the server ran, leaving a run with no
 *    terminal event at all - the next `server.starting` implicitly ends it.
 *
 * Pure and shared so the same code can be unit-tested and used on both sides.
 */
import type { ServerEvent } from './types'

export interface UptimeSession {
  /** When the server became ready (clipped to the window). */
  from: number
  /** When it went down, or the window end if it is still up. */
  to: number
  open: boolean
  /**
   * How the session ended:
   *  - `terminal`: a stop/crash was recorded, so `to` is exact
   *  - `start`:    no terminal was ever written (MSMS died with it) and the
   *                next launch ended it — `to` is an upper bound
   *  - `open`:     still running
   */
  endedBy: 'terminal' | 'start' | 'open'
}

export interface UptimeReport {
  /** Window actually measured - starts when this server was first seen. */
  windowFrom: number
  windowTo: number
  windowMs: number
  upMs: number
  downMs: number
  /** 0..1 over the measured window, or null when nothing was ever recorded. */
  ratio: number | null
  sessions: UptimeSession[]
  starts: number
  crashes: number
  longestUpMs: number
  currentlyUp: boolean
}

const READY = 'server.ready'
const START = 'server.starting'
const TERMINAL = new Set(['server.stopped', 'server.crashed', 'server.error'])

/**
 * @param events  lifecycle events; may include history from before `from`
 *                (needed to catch a run that was already up).
 * @param now     clamps an open session; defaults to `to`.
 */
export function computeUptime(
  events: ServerEvent[],
  from: number,
  to: number,
  now: number = to
): UptimeReport {
  const rel = events
    .filter((e) => e.type === READY || e.type === START || TERMINAL.has(e.type))
    .sort((a, b) => a.ts - b.ts)

  const end = Math.min(to, Math.max(now, from))
  const sessions: UptimeSession[] = []
  let openedAt: number | null = null
  let starts = 0
  let crashes = 0

  const close = (at: number, endedBy: 'terminal' | 'start'): void => {
    if (openedAt == null) return
    const s = Math.max(openedAt, from)
    const e2 = Math.min(at, end)
    if (e2 > s) sessions.push({ from: s, to: e2, open: false, endedBy })
    openedAt = null
  }

  for (const ev of rel) {
    if (ev.ts > end) break
    if (ev.type === READY) {
      // Two readys without a terminal in between: treat the first as ended.
      close(ev.ts, 'start')
      openedAt = ev.ts
      starts++
    } else if (ev.type === START) {
      // A fresh launch means any run still marked open really ended earlier;
      // MSMS was probably killed with it. `to` is only an upper bound - the
      // caller can tighten it with recorded metrics (see events.uptime).
      close(ev.ts, 'start')
    } else if (TERMINAL.has(ev.type)) {
      if (ev.type !== 'server.stopped') crashes++
      close(ev.ts, 'terminal')
    }
  }
  if (openedAt != null) {
    const s = Math.max(openedAt, from)
    if (end > s) sessions.push({ from: s, to: end, open: true, endedBy: 'open' })
  }

  const first = rel.length ? rel[0].ts : null
  // Don't dilute the ratio with time before this server was ever tracked.
  const windowFrom = Math.max(from, Math.min(first ?? from, end))
  return totals(sessions, windowFrom, end, starts, crashes, first != null)
}

function totals(
  sessions: UptimeSession[],
  windowFrom: number,
  end: number,
  starts: number,
  crashes: number,
  tracked: boolean
): UptimeReport {
  const windowMs = Math.max(0, end - windowFrom)
  let upMs = 0
  let longestUpMs = 0
  for (const s of sessions) {
    const d = s.to - Math.max(s.from, windowFrom)
    if (d > 0) upMs += d
    if (s.to - s.from > longestUpMs) longestUpMs = s.to - s.from
  }
  upMs = Math.min(upMs, windowMs)
  return {
    windowFrom,
    windowTo: end,
    windowMs,
    upMs,
    downMs: Math.max(0, windowMs - upMs),
    ratio: windowMs > 0 && tracked ? upMs / windowMs : null,
    sessions,
    starts,
    crashes,
    longestUpMs,
    currentlyUp: sessions.length > 0 && sessions[sessions.length - 1].open
  }
}

/**
 * Tighten sessions whose end is only an upper bound (`endedBy: 'start'`).
 * `lastSeen` should return the last moment the server is known to have been
 * alive inside that session, or null when there is nothing better to go on.
 */
export function clipSessions(
  report: UptimeReport,
  lastSeen: (s: UptimeSession) => number | null
): UptimeReport {
  let changed = false
  const sessions = report.sessions.map((s) => {
    if (s.endedBy !== 'start') return s
    const seen = lastSeen(s)
    if (seen == null || seen >= s.to || seen < s.from) return s
    changed = true
    return { ...s, to: seen }
  })
  if (!changed) return report
  return totals(
    sessions,
    report.windowFrom,
    report.windowTo,
    report.starts,
    report.crashes,
    report.ratio != null
  )
}
