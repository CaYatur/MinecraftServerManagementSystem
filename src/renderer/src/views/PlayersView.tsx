import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RefreshCw,
  Shield,
  ShieldOff,
  UserCheck,
  UserX,
  Ban,
  UserMinus,
  Sun,
  Moon,
  CloudRain,
  CloudLightning,
  Save
} from 'lucide-react'
import { useStore } from '../store'
import { formatDuration } from '../components/ui'
import type { PlayerInfo } from '@shared/types'

const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator']
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard']

function WorldControls({ id, running }: { id: string; running: boolean }): JSX.Element {
  const { t } = useTranslation()
  const send = (cmd: string): void => void window.msms.worldControl(id, cmd).catch(() => {})
  const B = ({
    icon,
    label,
    cmd
  }: {
    icon: JSX.Element
    label: string
    cmd: string
  }): JSX.Element => (
    <button className="btn sm" disabled={!running} onClick={() => send(cmd)}>
      {icon} {label}
    </button>
  )
  return (
    <div className="panel" style={{ maxWidth: '100%', marginBottom: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        {t('world.title')}
      </div>
      {!running && <p className="hint" style={{ marginTop: 0 }}>{t('world.needRunning')}</p>}
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="dim">{t('world.time')}:</span>
        <B icon={<Sun size={13} />} label={t('world.day')} cmd="time set day" />
        <B icon={<Moon size={13} />} label={t('world.night')} cmd="time set night" />
        <span className="dim" style={{ marginLeft: 10 }}>{t('world.weather')}:</span>
        <B icon={<Sun size={13} />} label={t('world.clear')} cmd="weather clear" />
        <B icon={<CloudRain size={13} />} label={t('world.rain')} cmd="weather rain" />
        <B icon={<CloudLightning size={13} />} label={t('world.thunder')} cmd="weather thunder" />
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        <span className="dim">{t('world.difficulty')}:</span>
        <select
          className="select"
          style={{ width: 130 }}
          disabled={!running}
          defaultValue=""
          onChange={(e) => e.target.value && send(`difficulty ${e.target.value}`)}
        >
          <option value="" disabled>
            —
          </option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button className="btn sm" disabled={!running} onClick={() => send('save-all')}>
          <Save size={13} /> {t('world.save')}
        </button>
      </div>
    </div>
  )
}

export function PlayersView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const status = useStore((s) => s.activeStatus().status)
  const toast = useStore((s) => s.toast)
  const [list, setList] = useState<PlayerInfo[]>([])
  const running = status === 'running' || status === 'starting'

  const load = useCallback(async (): Promise<void> => {
    try {
      setList(await window.msms.getPlayers(id))
    } catch {
      setList([])
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!running) return
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [running, load])

  const act = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      setTimeout(load, 400)
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }

  const online = list.filter((p) => p.online).length

  return (
    <div>
      <WorldControls id={id} running={running} />

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>
          {t('players.title')} <span className="dim">· {online} online</span>
        </div>
        <button className="btn sm" onClick={load}>
          <RefreshCw size={13} /> {t('players.refresh')}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="panel">
          <p className="dim" style={{ margin: 0 }}>{t('players.empty')}</p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="ptable">
            <thead>
              <tr>
                <th>{t('players.col.player')}</th>
                <th>{t('players.col.status')}</th>
                <th>{t('players.col.stats')}</th>
                <th>{t('players.col.pos')}</th>
                <th>{t('players.col.playtime')}</th>
                <th>{t('players.col.ip')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.uuid || p.name}>
                  <td>
                    <div className="pname">{p.name}</div>
                    <div className="puuid mono">{p.uuid || '—'}</div>
                    <div className="pbadges">
                      {p.online && <span className="badge">{t('players.badge.online')}</span>}
                      {p.op && <span className="badge op-badge">{t('players.badge.op')}</span>}
                      {p.whitelisted && <span className="badge">{t('players.badge.wl')}</span>}
                      {p.banned && <span className="badge error-badge">{t('players.badge.banned')}</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`dot ${p.online ? 'running' : 'stopped'}`} />{' '}
                    {p.online ? t('players.badge.online') : '—'}
                  </td>
                  <td className="mono">
                    {p.health != null ? `❤ ${p.health}` : '—'} {p.food != null ? `· 🍖 ${p.food}` : ''}{' '}
                    {p.xpLevel != null ? `· XP ${p.xpLevel}` : ''}
                  </td>
                  <td className="mono">
                    {p.position
                      ? `${p.position.x} ${p.position.y} ${p.position.z}`
                      : '—'}
                  </td>
                  <td>{p.playtimeHours != null ? `${p.playtimeHours}h` : '—'}</td>
                  <td className="mono">{p.ip || '—'}</td>
                  <td>
                    <div className="prow-actions">
                      <button
                        className="btn ghost sm"
                        title={p.op ? t('players.deop') : t('players.op')}
                        onClick={() => act(() => window.msms.setOp(id, p, !p.op))}
                      >
                        {p.op ? <ShieldOff size={13} /> : <Shield size={13} />}
                      </button>
                      <button
                        className="btn ghost sm"
                        title={p.whitelisted ? t('players.unwhitelist') : t('players.whitelist')}
                        onClick={() => act(() => window.msms.setWhitelist(id, p, !p.whitelisted))}
                      >
                        {p.whitelisted ? <UserX size={13} /> : <UserCheck size={13} />}
                      </button>
                      {p.online && (
                        <>
                          <button
                            className="btn ghost sm"
                            title={t('players.kick')}
                            onClick={() => act(() => window.msms.kickPlayer(id, p))}
                          >
                            <UserMinus size={13} />
                          </button>
                          <select
                            className="select sm-select"
                            title={t('players.gamemode')}
                            defaultValue=""
                            onChange={(e) =>
                              e.target.value && act(() => window.msms.setGamemode(id, p, e.target.value))
                            }
                          >
                            <option value="" disabled>
                              GM
                            </option>
                            {GAMEMODES.map((g) => (
                              <option key={g} value={g}>
                                {t(`gm.${g}`)}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <button
                        className={`btn ghost sm ${p.banned ? '' : 'danger'}`}
                        title={p.banned ? t('players.pardon') : t('players.ban')}
                        onClick={() => act(() => window.msms.setBan(id, p, !p.banned))}
                      >
                        <Ban size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">{t('players.needRunning')}</p>
    </div>
  )
}
