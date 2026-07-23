/**
 * Alert rules — the pure half.
 *
 * A rule is a small state machine: a condition has to hold *continuously* for
 * `forSeconds` before it fires, and once it fires it goes quiet for
 * `cooldownSeconds`. That is exactly the kind of logic that is impossible to
 * test against a live server, so - like `./uptime.ts` - everything here is a
 * pure function of (rule, previous state, sample, timestamp). No clock reads,
 * no I/O. The engine in main/core/alerts.ts owns the state map and the side
 * effects; a test can replay hours of samples in milliseconds.
 */
import type { ScheduleAction } from './types'

/** What a rule watches. `ram` is process RSS in MB, not JVM heap. */
export type AlertMetric = 'tps' | 'cpu' | 'ram' | 'players'
export type AlertComparison = 'below' | 'above'

export const ALERT_METRICS: AlertMetric[] = ['tps', 'cpu', 'ram', 'players']

export interface AlertRule {
  id: string
  serverId: string
  name: string
  enabled: boolean
  metric: AlertMetric
  comparison: AlertComparison
  threshold: number
  /** The condition must hold this long before the rule fires. 0 = instantly. */
  forSeconds: number
  /** Silence after a fire, so one bad hour is not a hundred alerts. */
  cooldownSeconds: number
  /**
   * Samples taken this soon after launch are ignored. World load pins the CPU
   * and drags TPS down for a while; without this every "TPS below X" rule
   * would fire on every start.
   */
  graceSeconds: number
  /** Optional reaction. Every fire is recorded either way. */
  action?: ScheduleAction
  /** Command / message for the `command` and `broadcast` actions. */
  payload?: string
  lastFired?: number
  fireCount?: number
}

/** One live reading, straight off the process manager's stats poll. */
export interface AlertSample {
  /** null when nothing has reported a TPS yet (no RCON, or not a Paper fork). */
  tps: number | null
  cpu: number
  rssMB: number
  players: number
  /** How long the server has been up at this sample. */
  uptimeMs: number
}

/** What the engine remembers between samples, per rule. */
export interface RuleState {
  /** When the condition started holding, or null when it is not holding. */
  since: number | null
  /** When the rule last fired - drives the cooldown. */
  lastFired: number | null
}

export const IDLE: RuleState = { since: null, lastFired: null }

export interface EvalResult {
  state: RuleState
  fired: boolean
  /** The reading that was judged; null when the metric had nothing to report. */
  value: number | null
  /** How long the condition had held at this sample. */
  heldMs: number
}

export function metricValue(metric: AlertMetric, s: AlertSample): number | null {
  switch (metric) {
    case 'tps':
      return s.tps
    case 'cpu':
      return s.cpu
    case 'ram':
      return s.rssMB
    case 'players':
      return s.players
  }
}

export function breaches(rule: Pick<AlertRule, 'comparison' | 'threshold'>, value: number): boolean {
  return rule.comparison === 'below' ? value < rule.threshold : value > rule.threshold
}

/** Keeps the cooldown clock but forgets the sustained window. */
function idle(state: RuleState, value: number | null): EvalResult {
  return { state: { since: null, lastFired: state.lastFired }, fired: false, value, heldMs: 0 }
}

/**
 * Judge one sample.
 *
 * A missing reading (`tps === null` while RCON reconnects) is deliberately
 * neither a breach nor a recovery: the window is held so a two-second hiccup
 * cannot reset a five-minute countdown, but nothing can fire without a real
 * value behind it.
 */
export function evaluateRule(
  rule: AlertRule,
  state: RuleState,
  sample: AlertSample,
  ts: number
): EvalResult {
  if (!rule.enabled) return idle(state, null)
  if (sample.uptimeMs < Math.max(0, rule.graceSeconds) * 1000) return idle(state, null)

  const value = metricValue(rule.metric, sample)
  if (value == null || !Number.isFinite(value)) {
    return { state, fired: false, value: null, heldMs: state.since == null ? 0 : ts - state.since }
  }
  if (!breaches(rule, value)) return idle(state, value)

  const since = state.since ?? ts
  const heldMs = Math.max(0, ts - since)
  const held: RuleState = { since, lastFired: state.lastFired }

  if (heldMs < Math.max(0, rule.forSeconds) * 1000) return { state: held, fired: false, value, heldMs }
  if (state.lastFired != null && ts - state.lastFired < Math.max(0, rule.cooldownSeconds) * 1000) {
    return { state: held, fired: false, value, heldMs }
  }
  // Note `since` survives the fire: while the condition keeps holding, the
  // cooldown alone decides when it may fire again.
  return { state: { since, lastFired: ts }, fired: true, value, heldMs }
}

// ------------------------------------------------------------------ defaults

export const MAX_SECONDS = 86_400
/** A cooldown of zero would alert on every poll; two seconds apart. */
export const MIN_COOLDOWN_SECONDS = 5

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)))

export type NewAlertRule = Pick<AlertRule, 'serverId' | 'name' | 'metric' | 'comparison' | 'threshold'> &
  Partial<Pick<AlertRule, 'forSeconds' | 'cooldownSeconds' | 'graceSeconds' | 'action' | 'payload' | 'enabled'>>

/**
 * Fill the gaps and pull every number into a sane range.
 *
 * The fire history is carried through, not rebuilt: it is how the cooldown
 * survives an app restart, and normalising a rule loaded from disk must not
 * quietly hand it a clean slate.
 */
export function normalizeRule(
  input: NewAlertRule & { id: string } & Partial<Pick<AlertRule, 'lastFired' | 'fireCount'>>
): AlertRule {
  return {
    id: input.id,
    serverId: input.serverId,
    name: input.name.trim().slice(0, 80) || 'Rule',
    enabled: input.enabled ?? true,
    metric: ALERT_METRICS.includes(input.metric) ? input.metric : 'tps',
    comparison: input.comparison === 'above' ? 'above' : 'below',
    threshold: Number.isFinite(input.threshold) ? input.threshold : 0,
    forSeconds: clamp(input.forSeconds ?? 60, 0, MAX_SECONDS),
    cooldownSeconds: clamp(input.cooldownSeconds ?? 900, MIN_COOLDOWN_SECONDS, MAX_SECONDS),
    graceSeconds: clamp(input.graceSeconds ?? 120, 0, MAX_SECONDS),
    ...(input.action ? { action: input.action } : {}),
    ...(input.payload ? { payload: input.payload.slice(0, 500) } : {}),
    ...(input.lastFired ? { lastFired: input.lastFired } : {}),
    ...(input.fireCount ? { fireCount: input.fireCount } : {})
  }
}

/** Sensible starting points offered in the UI. */
export interface AlertPreset {
  key: string
  rule: Omit<NewAlertRule, 'serverId' | 'name'>
}

export const ALERT_PRESETS: AlertPreset[] = [
  { key: 'lowTps', rule: { metric: 'tps', comparison: 'below', threshold: 15, forSeconds: 120, cooldownSeconds: 900 } },
  { key: 'highCpu', rule: { metric: 'cpu', comparison: 'above', threshold: 85, forSeconds: 300, cooldownSeconds: 1800 } },
  { key: 'highRam', rule: { metric: 'ram', comparison: 'above', threshold: 6144, forSeconds: 300, cooldownSeconds: 1800 } },
  {
    key: 'idleShutdown',
    rule: {
      metric: 'players',
      comparison: 'below',
      threshold: 1,
      forSeconds: 1800,
      cooldownSeconds: 3600,
      graceSeconds: 600,
      action: 'stop'
    }
  },
  { key: 'serverFull', rule: { metric: 'players', comparison: 'above', threshold: 18, forSeconds: 60, cooldownSeconds: 1800 } }
]
