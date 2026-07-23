/**
 * Alert engine — turns the telemetry the app already collects into reactions.
 *
 * The judging is pure and lives in `@shared/alerts`; this module owns the three
 * things that cannot be pure: the stored rules, the per-rule state between
 * samples, and the side effects when one fires.
 *
 * It listens to the process manager instead of being called by it, which keeps
 * the dependency one-way (alerts -> processManager) and means the engine sees
 * exactly the same readings the metric store does.
 *
 * Note on crashes: rules are threshold-based and a sample only exists while the
 * server is alive, so nothing here can react to a crash. Crash restarts stay
 * where they were, on `ServerConfig.autoRestartOnCrash` - there is no second
 * code path that could double-restart a server.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { alertsPath } from '../paths'
import { getConfig } from '../config'
import { log } from '../logger'
import { processManager } from './processManager'
import { runAction } from './actions'
import * as events from './events'
import { evaluateRule, normalizeRule, IDLE, type AlertRule, type AlertSample, type NewAlertRule, type RuleState } from '@shared/alerts'
import type { ServerRuntimeStatus, ServerStats } from '@shared/types'

export type { AlertRule, NewAlertRule }

let rules: AlertRule[] = []
/** ruleId -> state. Rebuilt from disk on load; never persisted wholesale. */
const state = new Map<string, RuleState>()

function load(): void {
  try {
    const raw = JSON.parse(readFileSync(alertsPath(), 'utf-8')) as AlertRule[]
    rules = Array.isArray(raw) ? raw.map((r) => normalizeRule({ ...r, id: r.id || randomUUID() })) : []
    // Restore the cooldown clock so a restart is not a free pass to re-alert.
    for (const r of rules) state.set(r.id, { since: null, lastFired: r.lastFired ?? null })
  } catch {
    rules = []
  }
}

function save(): void {
  try {
    writeFileSync(alertsPath(), JSON.stringify(rules, null, 2), 'utf-8')
  } catch (err) {
    log.warn('alert rules save failed:', err)
  }
}

function stateOf(id: string): RuleState {
  return state.get(id) ?? IDLE
}

// ------------------------------------------------------------------- firing

async function fire(rule: AlertRule, value: number, heldMs: number, ts: number): Promise<void> {
  rule.lastFired = ts
  rule.fireCount = (rule.fireCount ?? 0) + 1
  save()

  events.record(rule.serverId, 'alert.triggered', {
    ts,
    text: rule.name,
    data: {
      metric: rule.metric,
      comparison: rule.comparison,
      threshold: rule.threshold,
      value: Math.round(value * 10) / 10,
      heldSeconds: Math.round(heldMs / 1000),
      ...(rule.action ? { action: rule.action } : {})
    }
  })
  log.info(
    `Alert "${rule.name}": ${rule.metric} ${rule.comparison} ${rule.threshold} (${value}) for ${Math.round(heldMs / 1000)}s`
  )

  if (!rule.action) return
  try {
    await runAction(rule.serverId, rule.action, rule.payload)
  } catch (err) {
    log.warn(`Alert "${rule.name}" action failed:`, err)
    events.record(rule.serverId, 'alert.failed', {
      text: `${rule.name}: ${String((err as Error)?.message ?? err)}`,
      data: { action: rule.action }
    })
  }
}

/**
 * Judge one reading against every rule of that server.
 * Exported (with an explicit `ts`) so a test can replay hours in milliseconds.
 */
export function handleSample(serverId: string, sample: AlertSample, ts: number = Date.now()): AlertRule[] {
  const fired: AlertRule[] = []
  for (const rule of rules) {
    if (rule.serverId !== serverId) continue
    const res = evaluateRule(rule, stateOf(rule.id), sample, ts)
    state.set(rule.id, res.state)
    if (res.fired && res.value != null) {
      fired.push(rule)
      void fire(rule, res.value, res.heldMs, ts)
    }
  }
  return fired
}

/**
 * Forget the sustained windows for one server. Called when it stops: without
 * this a server that was breaching at shutdown would inherit the countdown on
 * its next launch and alert immediately. Cooldowns deliberately survive.
 */
export function resetServer(serverId: string): void {
  for (const rule of rules) {
    if (rule.serverId !== serverId) continue
    state.set(rule.id, { since: null, lastFired: stateOf(rule.id).lastFired })
  }
}

// ---------------------------------------------------------------------- CRUD

export function listRules(serverId?: string): AlertRule[] {
  return serverId ? rules.filter((r) => r.serverId === serverId) : rules
}

export function createRule(input: NewAlertRule): AlertRule {
  const rule = normalizeRule({ ...input, id: randomUUID() })
  rules.push(rule)
  state.set(rule.id, { ...IDLE })
  save()
  return rule
}

export function updateRule(id: string, patch: Partial<AlertRule>): AlertRule {
  const idx = rules.findIndex((r) => r.id === id)
  if (idx < 0) throw new Error('rule-not-found')
  const merged = normalizeRule({ ...rules[idx], ...patch, id })
  // Editing a threshold must not keep a window that was measured against the
  // old one, but the fire history belongs to the rule, not the window.
  rules[idx] = { ...merged, lastFired: rules[idx].lastFired, fireCount: rules[idx].fireCount }
  state.set(id, { since: null, lastFired: rules[idx].lastFired ?? null })
  save()
  return rules[idx]
}

export function deleteRule(id: string): void {
  rules = rules.filter((r) => r.id !== id)
  state.delete(id)
  save()
}

/** Drop every rule belonging to a server (called when it leaves MSMS). */
export function dropServer(serverId: string): void {
  for (const r of rules) if (r.serverId === serverId) state.delete(r.id)
  const before = rules.length
  rules = rules.filter((r) => r.serverId !== serverId)
  if (rules.length !== before) save()
}

/** Sweep rules whose server is gone (removed while MSMS was closed). */
export function pruneOrphans(): number {
  const known = new Set(getConfig().servers.map((s) => s.id))
  const before = rules.length
  for (const r of rules) if (!known.has(r.serverId)) state.delete(r.id)
  rules = rules.filter((r) => known.has(r.serverId))
  if (rules.length !== before) save()
  return before - rules.length
}

// ------------------------------------------------------------------ lifecycle

let wired = false

export function initAlerts(): void {
  load()
  const dropped = pruneOrphans()
  if (dropped) log.info(`Alerts: dropped ${dropped} rules for servers that no longer exist`)
  if (wired) return
  wired = true

  // Same reading the metric store gets, at the same moment.
  processManager.on('stats', (s: ServerStats) => {
    try {
      handleSample(s.id, {
        tps: s.tps,
        cpu: s.cpu,
        rssMB: s.memoryMB,
        players: s.players.online,
        uptimeMs: s.uptimeMs
      })
    } catch (err) {
      log.warn('alert evaluation failed:', err)
    }
  })

  processManager.on('status', (st: ServerRuntimeStatus) => {
    if (st.status === 'stopped' || st.status === 'crashed') resetServer(st.id)
  })
}

/** Test helper: forget the in-memory rules and windows. */
export function _reset(): void {
  rules = []
  state.clear()
}
