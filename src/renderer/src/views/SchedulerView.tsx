import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Play, Trash2, Clock, Bell } from 'lucide-react'
import { useStore } from '../store'
import { AlertRules } from './AlertRules'
import type { ScheduleAction, ScheduleTask } from '@shared/types'

const ACTIONS: ScheduleAction[] = ['restart', 'stop', 'start', 'backup', 'command', 'broadcast']

/**
 * Automation lives on one tab: cron tasks ("at 4 AM") and alert rules ("when
 * TPS drops"). Two sections rather than two tabs - the tab strip is already
 * full, and the two halves are the same idea triggered differently.
 */
export function SchedulerView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const toast = useStore((s) => s.toast)
  const [section, setSection] = useState<'schedules' | 'rules'>('schedules')
  const [tasks, setTasks] = useState<ScheduleTask[]>([])
  const [name, setName] = useState('')
  const [action, setAction] = useState<ScheduleAction>('restart')
  const [cron, setCron] = useState('0 4 * * *')
  const [payload, setPayload] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const all = await window.msms.listSchedules()
    setTasks(all.filter((x) => x.serverId === id))
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (): Promise<void> => {
    if (!name.trim() || !cron.trim()) return
    try {
      await window.msms.createSchedule({
        serverId: id,
        name: name.trim(),
        cron: cron.trim(),
        action,
        payload: payload.trim() || undefined
      })
      setName('')
      setPayload('')
      void load()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }

  const needsPayload = action === 'command' || action === 'broadcast'
  const fmt = (ts?: number): string => (ts ? new Date(ts).toLocaleString() : t('scheduler.never'))

  return (
    <div style={{ maxWidth: 920 }}>
      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        <button
          className={`btn sm ${section === 'schedules' ? 'primary' : 'ghost'}`}
          onClick={() => setSection('schedules')}
        >
          <Clock size={13} /> {t('scheduler.tabSchedules')}
        </button>
        <button
          className={`btn sm ${section === 'rules' ? 'primary' : 'ghost'}`}
          onClick={() => setSection('rules')}
        >
          <Bell size={13} /> {t('scheduler.tabRules')}
        </button>
      </div>

      {section === 'rules' ? (
        <AlertRules />
      ) : (
        <>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{t('scheduler.add')}</div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 8 }}>
            <label>{t('scheduler.name')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: 160, marginBottom: 8 }}>
            <label>{t('scheduler.action')}</label>
            <select className="select" value={action} onChange={(e) => setAction(e.target.value as ScheduleAction)}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`scheduler.act.${a}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 8 }}>
            <label>{t('scheduler.cron')}</label>
            <input className="input mono" value={cron} onChange={(e) => setCron(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 4, marginBottom: 8 }}>
            <button className="btn ghost sm" onClick={() => setCron('0 * * * *')}>{t('scheduler.hourly')}</button>
            <button className="btn ghost sm" onClick={() => setCron('0 */6 * * *')}>{t('scheduler.every6h')}</button>
            <button className="btn ghost sm" onClick={() => setCron('0 4 * * *')}>{t('scheduler.daily4am')}</button>
          </div>
        </div>
        {needsPayload && (
          <div className="field" style={{ marginBottom: 8 }}>
            <label>{t('scheduler.payload')}</label>
            <input className="input mono" value={payload} onChange={(e) => setPayload(e.target.value)} />
          </div>
        )}
        <p className="hint" style={{ marginTop: 0 }}>{t('scheduler.cronHint')}</p>
        <button className="btn primary" onClick={create}>
          <Plus size={14} /> {t('scheduler.create')}
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="panel">
          <p className="dim" style={{ margin: 0 }}>{t('scheduler.empty')}</p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {tasks.map((task) => (
            <div key={task.id} className="mod-row">
              <Clock size={16} className={task.enabled ? '' : 'dim'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mod-name">
                  {task.name} <span className="badge">{t(`scheduler.act.${task.action}`)}</span>
                </div>
                <div className="dim mono" style={{ fontSize: 11 }}>
                  {task.cron} · {t('scheduler.next')}: {fmt(task.nextRun)} · {t('scheduler.last')}: {fmt(task.lastRun)}
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={task.enabled}
                  onChange={async (e) => {
                    await window.msms.updateSchedule(task.id, { enabled: e.target.checked })
                    void load()
                  }}
                />
              </label>
              <button className="btn ghost sm" title={t('scheduler.run')} onClick={() => window.msms.runSchedule(task.id)}>
                <Play size={13} />
              </button>
              <button
                className="btn ghost sm danger"
                onClick={async () => {
                  await window.msms.deleteSchedule(task.id)
                  void load()
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  )
}
