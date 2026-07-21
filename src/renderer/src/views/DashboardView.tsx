import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, MemoryStick, Gauge, Users, Clock, Package, Folder } from 'lucide-react'
import { useStore } from '../store'
import { formatDuration } from '../components/ui'
import { TPS_TYPES } from '@shared/types'

function Stat({
  icon,
  label,
  value,
  sub
}: {
  icon: JSX.Element
  label: string
  value: string
  sub?: string
}): JSX.Element {
  return (
    <div className="card">
      <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon} {label}
      </div>
      <div className="value">
        {value} {sub && <small>{sub}</small>}
      </div>
    </div>
  )
}

export function DashboardView(): JSX.Element {
  const { t } = useTranslation()
  const server = useStore((s) => s.activeServer())
  const status = useStore((s) => (s.activeServerId ? s.statuses[s.activeServerId] : undefined))
  const stats = useStore((s) => (s.activeServerId ? s.stats[s.activeServerId] : undefined))
  const [, force] = useState(0)

  // Refresh uptime display every second while running.
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(i)
  }, [])

  if (!server) return <></>
  const st = status?.status ?? 'stopped'
  const running = st === 'running' || st === 'starting'
  const uptime = status?.startedAt ? Date.now() - status.startedAt : 0
  const tpsSupported = TPS_TYPES.includes(server.type)

  return (
    <div>
      <div className="section-title">{t('dashboard.title')}</div>
      <div className="cards">
        <Stat
          icon={<Cpu size={13} />}
          label={t('dashboard.cpu')}
          value={running && stats ? `${stats.cpu.toFixed(0)}%` : '—'}
        />
        <Stat
          icon={<MemoryStick size={13} />}
          label={t('dashboard.ram')}
          value={running && stats ? `${stats.memoryMB.toFixed(0)}` : '—'}
          sub={running && stats ? 'MB' : undefined}
        />
        <Stat
          icon={<Gauge size={13} />}
          label={t('dashboard.tps')}
          value={
            !tpsSupported ? 'N/A' : running && stats?.tps != null ? stats.tps.toFixed(1) : '—'
          }
        />
        <Stat
          icon={<Users size={13} />}
          label={t('dashboard.players')}
          value={
            running && stats ? `${stats.players.online}` : '—'
          }
          sub={running && stats ? `/ ${stats.players.max}` : undefined}
        />
        <Stat
          icon={<Clock size={13} />}
          label={t('dashboard.uptime')}
          value={running ? formatDuration(uptime) : '—'}
        />
        <Stat icon={<Package size={13} />} label={t('dashboard.type')} value={t(`types.${server.type}`)} />
        <Stat icon={<Gauge size={13} />} label={t('dashboard.version')} value={server.mcVersion} />
      </div>

      {!tpsSupported && (
        <p className="hint">
          <Gauge size={12} /> {t('dashboard.tpsNA')}
        </p>
      )}

      {!running && (
        <div className="panel" style={{ marginTop: 22, textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 6px' }}>{t('dashboard.notRunning')}</h3>
          <p className="dim" style={{ margin: 0 }}>
            {t('dashboard.notRunningHint')}
          </p>
        </div>
      )}

      <div className="section-title">{t('settings.baseDir')}</div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="mono">{server.path}</span>
          <button className="btn sm" onClick={() => window.msms.openPath(server.path)}>
            <Folder size={14} /> {t('sidebar.openFolder')}
          </button>
        </div>
      </div>
    </div>
  )
}
