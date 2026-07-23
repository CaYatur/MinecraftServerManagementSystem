import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, MemoryStick, Gauge, Users, Clock, Package, Folder, Check, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { formatDuration } from '../components/ui'
import { ArgsEditor } from '../components/ArgsEditor'
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
  const updateServer = useStore((s) => s.updateServer)
  const removeServer = useStore((s) => s.removeServer)
  const toast = useStore((s) => s.toast)
  const [, force] = useState(0)
  const [rename, setRename] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [rconOn, setRconOn] = useState(false)
  const id = useStore((s) => s.activeServerId)
  const st0 = status?.status ?? 'stopped'
  const running0 = st0 === 'running' || st0 === 'starting'

  useEffect(() => {
    if (server) setRename(server.name)
  }, [server?.id])

  // Refresh uptime display every second while running.
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(i)
  }, [])

  // Poll RCON connection state (explains TPS availability).
  useEffect(() => {
    if (!id || !running0) {
      setRconOn(false)
      return
    }
    const tick = (): void => void window.msms.rconConnected(id).then(setRconOn).catch(() => {})
    tick()
    const iv = setInterval(tick, 3000)
    return () => clearInterval(iv)
  }, [id, running0])

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
          value={running && stats ? `${stats.memoryMB.toFixed(0)} / ${server.java.maxMemoryMB}` : '—'}
          sub={running && stats ? 'MB' : undefined}
        />
        <Stat
          icon={<Gauge size={13} />}
          label={t('dashboard.tps')}
          value={
            !tpsSupported ? 'N/A' : running && stats?.tps != null ? stats.tps.toFixed(1) : '—'
          }
          sub={
            running && stats?.bridge && stats.mspt != null
              ? `${stats.mspt.toFixed(1)} ${t('dashboard.mspt')}`
              : undefined
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
      {running && (
        <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`dot ${rconOn ? 'running' : 'starting'}`} />
          RCON: {rconOn ? t('dashboard.rconConnected') : t('dashboard.rconConnecting')}
        </p>
      )}
      {running && stats?.bridge && (
        <p className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="dot running" />
          {t('dashboard.bridgeActive')}
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

      <div className="section-title">{t('server.args')}</div>
      <ArgsEditor server={server} />

      <div className="section-title">{t('settings.baseDir')}</div>
      <div className="panel">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label>{t('server.rename')}</label>
            <input className="input" value={rename} onChange={(e) => setRename(e.target.value)} />
          </div>
          <button
            className="btn primary"
            onClick={async () => {
              if (rename.trim()) {
                await updateServer(server.id, { name: rename.trim() })
                toast('success', 'common.saved')
              }
            }}
          >
            <Check size={14} /> {t('common.save')}
          </button>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <span className="mono">{server.path}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => window.msms.openPath(server.path)}>
              <Folder size={14} /> {t('sidebar.openFolder')}
            </button>
            <button className="btn danger sm" onClick={() => setConfirmRemove(true)}>
              <Trash2 size={14} /> {t('server.remove')}
            </button>
          </div>
        </div>
      </div>

      {confirmRemove && (
        <div className="modal-backdrop" onClick={() => setConfirmRemove(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('server.removeTitle')}</h3>
            <p>{t('server.removeBody', { name: server.name })}</p>
            <label className="switch">
              <input
                type="checkbox"
                checked={deleteFiles}
                onChange={(e) => setDeleteFiles(e.target.checked)}
              />
              {t('server.removeWithFiles')}
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmRemove(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  await removeServer(server.id, deleteFiles)
                  setConfirmRemove(false)
                }}
              >
                {t('server.remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
