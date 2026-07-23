import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Play,
  CheckCircle2,
  Square,
  AlertTriangle,
  XCircle,
  LogIn,
  LogOut,
  Archive,
  ArchiveRestore,
  Trash2,
  CalendarClock,
  BellRing,
  BellOff,
  Globe2
} from 'lucide-react'
import { useStore } from '../store'
import type { EventSeverity, ServerEvent, ServerEventType } from '@shared/types'

type Range = '24h' | '7d' | '30d'
type Group = 'all' | 'server' | 'players' | 'backups' | 'schedule' | 'alerts'

const RANGE_MS: Record<Range, number> = {
  '24h': 86400_000,
  '7d': 7 * 86400_000,
  '30d': 30 * 86400_000
}

const GROUPS: Record<Exclude<Group, 'all'>, ServerEventType[]> = {
  server: ['server.starting', 'server.ready', 'server.stopped', 'server.crashed', 'server.error'],
  players: ['player.join', 'player.leave'],
  backups: ['backup.created', 'backup.failed', 'backup.restored', 'backup.deleted'],
  schedule: ['schedule.run', 'schedule.failed'],
  alerts: ['alert.triggered', 'alert.failed']
}

/** i18n key per event type — dots would be read as nesting by i18next. */
const LABEL: Record<ServerEventType, string> = {
  'server.starting': 'events.serverStarting',
  'server.ready': 'events.serverReady',
  'server.stopped': 'events.serverStopped',
  'server.crashed': 'events.serverCrashed',
  'server.error': 'events.serverError',
  'player.join': 'events.playerJoin',
  'player.leave': 'events.playerLeave',
  'backup.created': 'events.backupCreated',
  'backup.failed': 'events.backupFailed',
  'backup.restored': 'events.backupRestored',
  'backup.deleted': 'events.backupDeleted',
  'schedule.run': 'events.scheduleRun',
  'schedule.failed': 'events.scheduleFailed',
  'alert.triggered': 'events.alertTriggered',
  'alert.failed': 'events.alertFailed',
  'world.activated': 'events.worldActivated',
  'world.deleted': 'events.worldDeleted',
  'world.renamed': 'events.worldRenamed',
  'world.cloned': 'events.worldCloned',
  'world.reset': 'events.worldReset',
  'world.exported': 'events.worldExported',
  'world.imported': 'events.worldImported'
}

const ICON: Record<ServerEventType, JSX.Element> = {
  'server.starting': <Play size={14} />,
  'server.ready': <CheckCircle2 size={14} />,
  'server.stopped': <Square size={14} />,
  'server.crashed': <XCircle size={14} />,
  'server.error': <AlertTriangle size={14} />,
  'player.join': <LogIn size={14} />,
  'player.leave': <LogOut size={14} />,
  'backup.created': <Archive size={14} />,
  'backup.failed': <AlertTriangle size={14} />,
  'backup.restored': <ArchiveRestore size={14} />,
  'backup.deleted': <Trash2 size={14} />,
  'schedule.run': <CalendarClock size={14} />,
  'schedule.failed': <CalendarClock size={14} />,
  'alert.triggered': <BellRing size={14} />,
  'alert.failed': <BellOff size={14} />,
  'world.activated': <Globe2 size={14} />,
  'world.deleted': <Globe2 size={14} />,
  'world.renamed': <Globe2 size={14} />,
  'world.cloned': <Globe2 size={14} />,
  'world.reset': <Globe2 size={14} />,
  'world.exported': <Globe2 size={14} />,
  'world.imported': <Globe2 size={14} />
}

const SEV_CLASS: Record<EventSeverity, string> = {
  info: 'ev-info',
  success: 'ev-success',
  warn: 'ev-warn',
  error: 'ev-error'
}

export function TimelineView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const [range, setRange] = useState<Range>('24h')
  const [group, setGroup] = useState<Group>('all')
  const [events, setEvents] = useState<ServerEvent[]>([])
  const [total, setTotal] = useState(0)

  const load = useCallback(async (): Promise<void> => {
    const now = Date.now()
    const page = await window.msms.queryEvents(id, {
      from: now - RANGE_MS[range],
      to: now,
      limit: 500
    })
    setEvents(page.events)
    setTotal(page.total)
  }, [id, range])

  useEffect(() => {
    void load()
  }, [load])

  // Live: new events land at the top without a refetch.
  useEffect(
    () =>
      window.msms.onServerEvent((e) => {
        if (e.serverId !== id) return
        setEvents((prev) => [e, ...prev].slice(0, 500))
        setTotal((n) => n + 1)
      }),
    [id]
  )

  const shown = useMemo(
    () => (group === 'all' ? events : events.filter((e) => GROUPS[group].includes(e.type))),
    [events, group]
  )

  const stats = useMemo(() => {
    const c = { starts: 0, crashes: 0, backups: 0, players: 0 }
    for (const e of events) {
      if (e.type === 'server.ready') c.starts++
      else if (e.type === 'server.crashed' || e.type === 'server.error') c.crashes++
      else if (e.type === 'backup.created') c.backups++
      else if (e.type === 'player.join') c.players++
    }
    return c
  }, [events])

  const dur = (ms: number): string => {
    const s = Math.max(0, Math.round(ms / 1000))
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ${m % 60}m`
    return `${Math.floor(h / 24)}d ${h % 24}h`
  }

  const describe = (e: ServerEvent): string => {
    const d = (e.data ?? {}) as Record<string, string | number | boolean>
    return t(LABEL[e.type], {
      ...d,
      text: e.text ?? '',
      secs: typeof d.startupMs === 'number' ? Math.round(d.startupMs / 100) / 10 : '',
      uptime: typeof d.uptimeMs === 'number' ? dur(d.uptimeMs) : ''
    })
  }

  // Day separators make a long list scannable.
  const dayOf = (ts: number): string => new Date(ts).toDateString()
  let lastDay = ''

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 6 }}>
            {(['24h', '7d', '30d'] as Range[]).map((r) => (
              <button
                key={r}
                className={`btn sm ${range === r ? 'primary' : ''}`}
                onClick={() => setRange(r)}
              >
                {t(`timeline.range${r}`)}
              </button>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {(['all', 'server', 'players', 'backups', 'schedule', 'alerts'] as Group[]).map((g) => (
              <button
                key={g}
                className={`btn ghost sm ${group === g ? 'active' : ''}`}
                onClick={() => setGroup(g)}
              >
                {t(`timeline.group_${g}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 18, marginTop: 12 }}>
          <Stat label={t('timeline.starts')} value={stats.starts} />
          <Stat label={t('timeline.crashes')} value={stats.crashes} danger={stats.crashes > 0} />
          <Stat label={t('timeline.backupsMade')} value={stats.backups} />
          <Stat label={t('timeline.joins')} value={stats.players} />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="panel">
          <p className="dim" style={{ margin: 0 }}>{t('timeline.empty')}</p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {shown.map((e) => {
            const day = dayOf(e.ts)
            const newDay = day !== lastDay
            lastDay = day
            return (
              <div key={e.id}>
                {newDay && (
                  <div className="tl-day">{new Date(e.ts).toLocaleDateString(undefined, { dateStyle: 'full' })}</div>
                )}
                <div className={`tl-row ${SEV_CLASS[e.severity]}`}>
                  <span className="tl-icon">{ICON[e.type]}</span>
                  <span className="tl-text">{describe(e)}</span>
                  <span className="tl-time dim">
                    {new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="hint">{t('timeline.showing', { shown: shown.length, total })}</p>
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }): JSX.Element {
  return (
    <div>
      <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: danger ? 'var(--danger)' : undefined }}>{value}</div>
    </div>
  )
}
