import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Cpu, MemoryStick, Users, Timer, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { Chart, type ChartMarker, type ChartPoint } from '../components/Chart'
import { Analysis } from '../components/Analysis'
import { analyze } from '@shared/analysis'
import type { MetricSeries, ServerEvent } from '@shared/types'
import type { UptimeReport } from '@shared/uptime'

type Range = '1h' | '6h' | '24h' | '7d' | '30d'
const RANGE_MS: Record<Range, number> = {
  '1h': 3600_000,
  '6h': 6 * 3600_000,
  '24h': 86400_000,
  '7d': 7 * 86400_000,
  '30d': 30 * 86400_000
}

const dur = (ms: number): string => {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function HistoryView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const server = useStore((s) => s.activeServer())
  const [range, setRange] = useState<Range>('24h')
  const [series, setSeries] = useState<MetricSeries | null>(null)
  const [up, setUp] = useState<UptimeReport | null>(null)
  const [marks, setMarks] = useState<ServerEvent[]>([])
  const [span, setSpan] = useState<{ from: number; to: number }>({
    from: Date.now() - 86400_000,
    to: Date.now()
  })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    const to = Date.now()
    const from = to - RANGE_MS[range]
    setSpan({ from, to })
    const [s, u, ev] = await Promise.all([
      window.msms.queryMetrics(id, { from, to, limit: 1200 }),
      window.msms.getUptime(id, from, to),
      window.msms.queryEvents(id, {
        from,
        to,
        types: ['server.crashed', 'server.error', 'server.ready', 'backup.created'],
        limit: 200
      })
    ])
    setSeries(s)
    setUp(u)
    setMarks(ev.events)
    setBusy(false)
  }, [id, range])

  useEffect(() => {
    void load()
  }, [load])

  const pts = series?.points ?? []
  const chart = (pick: (p: (typeof pts)[number]) => number | null): ChartPoint[] =>
    pts.map((p) => ({ ts: p.ts, v: pick(p) }))

  // Restarts, crashes and backups drawn on the same time axis as the metrics.
  const markers: ChartMarker[] = useMemo(
    () =>
      marks.map((e) => ({
          ts: e.ts,
          color:
            e.type === 'server.crashed' || e.type === 'server.error'
              ? 'var(--danger)'
              : e.type === 'backup.created'
                ? 'var(--info)'
                : 'var(--online)',
          label: `${new Date(e.ts).toLocaleString()} · ${e.type}`
        })),
    [marks]
  )

  const fmtTime = (ts: number): string =>
    RANGE_MS[range] > 86400_000
      ? new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
      : new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  const sum = series?.summary
  const ratio = up?.ratio

  // Same numbers the charts draw, read back as plain advice.
  const findings = useMemo(
    () =>
      series && server
        ? analyze({
            series,
            uptime: up,
            events: marks,
            server: { type: server.type, java: server.java },
            from: span.from,
            to: span.to
          })
        : [],
    [series, up, marks, server, span]
  )

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 6 }}>
            {(Object.keys(RANGE_MS) as Range[]).map((r) => (
              <button
                key={r}
                className={`btn sm ${range === r ? 'primary' : ''}`}
                onClick={() => setRange(r)}
              >
                {t(`history.range_${r}`)}
              </button>
            ))}
          </div>
          <button className="btn ghost sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={13} className={busy ? 'spin' : ''} /> {t('common.refresh')}
          </button>
        </div>

        <div className="row wrap" style={{ gap: 22, marginTop: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 190, flex: 1 }}>
            <div className="chart-head">
              <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                <Timer size={12} style={{ verticalAlign: -2 }} /> {t('history.uptime')}
              </span>
              <b style={{ fontSize: 15 }}>{ratio == null ? '—' : `${(ratio * 100).toFixed(1)}%`}</b>
            </div>
            <div className="uptime-bar">
              <span style={{ width: `${(ratio ?? 0) * 100}%` }} />
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 5 }}>
              {up
                ? t('history.uptimeDetail', {
                    up: dur(up.upMs),
                    down: dur(up.downMs),
                    window: dur(up.windowMs)
                  })
                : '—'}
            </div>
          </div>
          <Stat label={t('history.starts')} value={up ? String(up.starts) : '—'} />
          <Stat label={t('history.crashes')} value={up ? String(up.crashes) : '—'} danger={!!up?.crashes} />
          <Stat label={t('history.longest')} value={up ? dur(up.longestUpMs) : '—'} />
          <Stat label={t('history.samples')} value={sum ? String(sum.samples) : '—'} />
        </div>
      </div>

      {findings.length > 0 && <Analysis findings={findings} />}

      <div className="panel" style={{ marginBottom: 14 }}>
        <ChartBlock
          icon={<Activity size={13} />}
          title={t('history.tps')}
          sub={sum?.tpsAvg != null ? t('history.avgMin', { avg: sum.tpsAvg, min: sum.tpsMin ?? '—' }) : ''}
        >
          <Chart
            points={chart((p) => p.tps)}
            from={span.from}
            to={span.to}
            color="var(--online)"
            max={20}
            height={140}
            markers={markers}
            formatTime={fmtTime}
            emptyLabel={t('history.noData')}
          />
        </ChartBlock>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <ChartBlock
          icon={<Cpu size={13} />}
          title={t('history.cpu')}
          sub={sum ? t('history.avgMax', { avg: sum.cpuAvg, max: sum.cpuMax }) : ''}
        >
          <Chart
            points={chart((p) => p.cpu)}
            from={span.from}
            to={span.to}
            color="var(--accent)"
            max={100}
            height={130}
            formatTime={fmtTime}
            format={(v) => `${Math.round(v)}%`}
            emptyLabel={t('history.noData')}
          />
        </ChartBlock>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <ChartBlock
          icon={<MemoryStick size={13} />}
          title={t('history.ram')}
          sub={sum ? t('history.avgMax', { avg: sum.rssAvg, max: sum.rssMax }) : ''}
        >
          <Chart
            points={chart((p) => p.rss)}
            from={span.from}
            to={span.to}
            color="var(--info)"
            height={130}
            formatTime={fmtTime}
            format={(v) => `${Math.round(v)}MB`}
            emptyLabel={t('history.noData')}
          />
        </ChartBlock>
      </div>

      <div className="panel">
        <ChartBlock
          icon={<Users size={13} />}
          title={t('history.players')}
          sub={sum ? t('history.avgMax', { avg: sum.playersAvg, max: sum.playersMax }) : ''}
        >
          <Chart
            points={chart((p) => p.players)}
            from={span.from}
            to={span.to}
            color="var(--warning)"
            height={120}
            formatTime={fmtTime}
            format={(v) => String(Math.round(v))}
            emptyLabel={t('history.noData')}
          />
        </ChartBlock>
        <p className="hint" style={{ marginBottom: 0 }}>
          {series ? t('history.resolution', { res: series.resolution, points: pts.length }) : ''}
        </p>
      </div>
    </div>
  )
}

function ChartBlock({
  icon,
  title,
  sub,
  children
}: {
  icon: JSX.Element
  title: string
  sub?: string
  children: JSX.Element
}): JSX.Element {
  return (
    <div>
      <div className="chart-head">
        <span className="chart-title">
          {icon} {title}
        </span>
        {sub ? <span className="chart-sub">{sub}</span> : null}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }): JSX.Element {
  return (
    <div>
      <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: danger ? 'var(--danger)' : undefined }}>{value}</div>
    </div>
  )
}
