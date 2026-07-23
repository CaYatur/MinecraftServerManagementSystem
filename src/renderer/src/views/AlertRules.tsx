import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, BellRing } from 'lucide-react'
import { useStore } from '../store'
import {
  ALERT_METRICS,
  ALERT_PRESETS,
  type AlertComparison,
  type AlertMetric,
  type AlertRule
} from '@shared/alerts'
import type { ScheduleAction } from '@shared/types'

const ACTIONS: ScheduleAction[] = ['restart', 'stop', 'start', 'backup', 'command', 'broadcast']

/** Unit shown next to the threshold, so "6144" is obviously megabytes. */
const UNIT: Record<AlertMetric, string> = { tps: '', cpu: '%', ram: 'MB', players: '' }

interface Draft {
  name: string
  metric: AlertMetric
  comparison: AlertComparison
  threshold: number
  forSeconds: number
  cooldownSeconds: number
  graceSeconds: number
  action: ScheduleAction | ''
  payload: string
}

const EMPTY: Draft = {
  name: '',
  metric: 'tps',
  comparison: 'below',
  threshold: 15,
  forSeconds: 120,
  cooldownSeconds: 900,
  graceSeconds: 120,
  action: '',
  payload: ''
}

export function AlertRules(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const toast = useStore((s) => s.toast)
  const [rules, setRules] = useState<AlertRule[]>([])
  const [d, setD] = useState<Draft>(EMPTY)

  const load = useCallback(async (): Promise<void> => {
    setRules(await window.msms.listAlerts(id))
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setD((p) => ({ ...p, [k]: v }))

  const applyPreset = (key: string): void => {
    const p = ALERT_PRESETS.find((x) => x.key === key)
    if (!p) return
    setD({
      ...EMPTY,
      ...p.rule,
      name: t(`alerts.preset.${key}`),
      forSeconds: p.rule.forSeconds ?? EMPTY.forSeconds,
      cooldownSeconds: p.rule.cooldownSeconds ?? EMPTY.cooldownSeconds,
      graceSeconds: p.rule.graceSeconds ?? EMPTY.graceSeconds,
      action: p.rule.action ?? '',
      payload: ''
    })
  }

  const create = async (): Promise<void> => {
    if (!d.name.trim()) return
    try {
      await window.msms.createAlert({
        serverId: id,
        name: d.name.trim(),
        metric: d.metric,
        comparison: d.comparison,
        threshold: Number(d.threshold),
        forSeconds: Number(d.forSeconds),
        cooldownSeconds: Number(d.cooldownSeconds),
        graceSeconds: Number(d.graceSeconds),
        ...(d.action ? { action: d.action } : {}),
        ...(d.payload.trim() ? { payload: d.payload.trim() } : {})
      })
      setD(EMPTY)
      void load()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }

  const mins = (s: number): string =>
    s < 60 ? t('alerts.secs', { n: s }) : t('alerts.mins', { n: Math.round(s / 60) })

  const needsPayload = d.action === 'command' || d.action === 'broadcast'

  const summary = (r: AlertRule): string =>
    `${t(`alerts.metric.${r.metric}`)} ${t(`alerts.cmp.${r.comparison}`)} ${r.threshold}${UNIT[r.metric]} · ${t('alerts.for', { time: mins(r.forSeconds) })} · ${t('alerts.cooldown', { time: mins(r.cooldownSeconds) })}`

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          {t('alerts.add')}
        </div>

        <div className="row wrap" style={{ gap: 4, marginBottom: 10 }}>
          {ALERT_PRESETS.map((p) => (
            <button key={p.key} className="btn ghost sm" onClick={() => applyPreset(p.key)}>
              {t(`alerts.preset.${p.key}`)}
            </button>
          ))}
        </div>

        <div className="row wrap" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 8 }}>
            <label>{t('alerts.name')}</label>
            <input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: 130, marginBottom: 8 }}>
            <label>{t('alerts.watch')}</label>
            <select
              className="select"
              value={d.metric}
              onChange={(e) => set('metric', e.target.value as AlertMetric)}
            >
              {ALERT_METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`alerts.metric.${m}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: 110, marginBottom: 8 }}>
            <label>{t('alerts.when')}</label>
            <select
              className="select"
              value={d.comparison}
              onChange={(e) => set('comparison', e.target.value as AlertComparison)}
            >
              <option value="below">{t('alerts.cmp.below')}</option>
              <option value="above">{t('alerts.cmp.above')}</option>
            </select>
          </div>
          <div className="field" style={{ width: 110, marginBottom: 8 }}>
            <label>
              {t('alerts.threshold')} {UNIT[d.metric] && <span className="dim">({UNIT[d.metric]})</span>}
            </label>
            <input
              className="input"
              type="number"
              value={d.threshold}
              onChange={(e) => set('threshold', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="row wrap" style={{ gap: 10 }}>
          <div className="field" style={{ width: 130, marginBottom: 8 }}>
            <label>{t('alerts.forSeconds')}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={d.forSeconds}
              onChange={(e) => set('forSeconds', Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ width: 130, marginBottom: 8 }}>
            <label>{t('alerts.cooldownSeconds')}</label>
            <input
              className="input"
              type="number"
              min={5}
              value={d.cooldownSeconds}
              onChange={(e) => set('cooldownSeconds', Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ width: 130, marginBottom: 8 }}>
            <label>{t('alerts.graceSeconds')}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={d.graceSeconds}
              onChange={(e) => set('graceSeconds', Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ minWidth: 170, marginBottom: 8 }}>
            <label>{t('alerts.action')}</label>
            <select
              className="select"
              value={d.action}
              onChange={(e) => set('action', e.target.value as ScheduleAction | '')}
            >
              <option value="">{t('alerts.actionNone')}</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`scheduler.act.${a}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {needsPayload && (
          <div className="field" style={{ marginBottom: 8 }}>
            <label>{t('scheduler.payload')}</label>
            <input
              className="input mono"
              value={d.payload}
              onChange={(e) => set('payload', e.target.value)}
            />
          </div>
        )}

        <p className="hint" style={{ marginTop: 0 }}>
          {t('alerts.hint')}
        </p>
        <button className="btn primary" onClick={create}>
          <Plus size={14} /> {t('alerts.create')}
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="panel">
          <p className="dim" style={{ margin: 0 }}>
            {t('alerts.empty')}
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {rules.map((r) => (
            <div key={r.id} className="mod-row">
              <BellRing size={16} className={r.enabled ? '' : 'dim'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mod-name">
                  {r.name}{' '}
                  {r.action && <span className="badge">{t(`scheduler.act.${r.action}`)}</span>}
                </div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {summary(r)}
                </div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {r.fireCount
                    ? t('alerts.firedTimes', {
                        n: r.fireCount,
                        when: r.lastFired ? new Date(r.lastFired).toLocaleString() : '—'
                      })
                    : t('alerts.neverFired')}
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={async (e) => {
                    await window.msms.updateAlert(r.id, { enabled: e.target.checked })
                    void load()
                  }}
                />
              </label>
              <button
                className="btn ghost sm danger"
                onClick={async () => {
                  await window.msms.deleteAlert(r.id)
                  void load()
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
