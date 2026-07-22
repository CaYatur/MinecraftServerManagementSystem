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
  Save,
  X,
  Package,
  MapPin,
  Heart,
  Drumstick,
  Sparkles,
  Clock
} from 'lucide-react'
import { useStore } from '../store'
import { PlayerAvatar } from '../components/PlayerAvatar'
import type { PlayerInfo } from '@shared/types'

const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator']
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard']

function WorldControls({ id, running }: { id: string; running: boolean }): JSX.Element {
  const { t } = useTranslation()
  const send = (cmd: string): void => void window.msms.worldControl(id, cmd).catch(() => {})
  const B = ({ icon, label, cmd }: { icon: JSX.Element; label: string; cmd: string }): JSX.Element => (
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
        <span className="dim" style={{ marginLeft: 10 }}>{t('world.difficulty')}:</span>
        <select
          className="select sm-select"
          disabled={!running}
          defaultValue=""
          onChange={(e) => e.target.value && send(`difficulty ${e.target.value}`)}
        >
          <option value="" disabled>—</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d}</option>
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
  const [selected, setSelected] = useState<PlayerInfo | null>(null)
  const running = status === 'running' || status === 'starting'

  const load = useCallback(async (): Promise<PlayerInfo[]> => {
    try {
      const l = await window.msms.getPlayers(id)
      setList(l)
      return l
    } catch {
      setList([])
      return []
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

  const act = async (p: PlayerInfo, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      const fresh = await new Promise<PlayerInfo[]>((r) => setTimeout(() => load().then(r), 400))
      const updated = fresh.find((x) => (x.uuid || x.name) === (p.uuid || p.name))
      if (updated) setSelected(updated)
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
        <button className="btn sm" onClick={() => load()}>
          <RefreshCw size={13} /> {t('players.refresh')}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="panel">
          <p className="dim" style={{ margin: 0 }}>{t('players.empty')}</p>
        </div>
      ) : (
        <>
          <div className="player-grid">
            {list.map((p) => (
              <div
                key={p.uuid || p.name}
                className={`player-card ${p.online ? 'online' : ''}`}
                onClick={() => setSelected(p)}
              >
                <PlayerAvatar uuid={p.uuid} name={p.name} size={46} />
                <div className="pc-info">
                  <div className="pc-name">{p.name}</div>
                  <div className="pc-badges">
                    <span className={`dot ${p.online ? 'running' : 'stopped'}`} />
                    {p.op && <span className="badge op-badge">OP</span>}
                    {p.whitelisted && <span className="badge">WL</span>}
                    {p.banned && <span className="badge error-badge">BAN</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="hint">{t('players.clickHint')}</p>
        </>
      )}

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal pdetail" onClick={(e) => e.stopPropagation()}>
            <button className="pd-close btn ghost sm" onClick={() => setSelected(null)}>
              <X size={16} />
            </button>
            <div className="pd-head">
              <PlayerAvatar uuid={selected.uuid} name={selected.name} size={72} />
              <div>
                <h3 style={{ margin: 0 }}>{selected.name}</h3>
                <div className="mono dim" style={{ fontSize: 11 }}>{selected.uuid || '—'}</div>
                <div className="pc-badges" style={{ marginTop: 6 }}>
                  <span className="badge">
                    <span className={`dot ${selected.online ? 'running' : 'stopped'}`} />
                    {selected.online ? t('players.badge.online') : t('players.offline')}
                  </span>
                  {selected.op && <span className="badge op-badge">{t('players.badge.op')}</span>}
                  {selected.whitelisted && <span className="badge">{t('players.badge.wl')}</span>}
                  {selected.banned && <span className="badge error-badge">{t('players.badge.banned')}</span>}
                </div>
              </div>
            </div>

            <div className="pd-stats">
              <div className="pd-stat"><Heart size={14} /> {t('players.health')}<b>{selected.health ?? '—'}</b></div>
              <div className="pd-stat"><Drumstick size={14} /> {t('players.food')}<b>{selected.food ?? '—'}</b></div>
              <div className="pd-stat"><Sparkles size={14} /> {t('players.xp')}<b>{selected.xpLevel ?? '—'}</b></div>
              <div className="pd-stat"><MapPin size={14} /> {t('players.position')}<b className="mono" style={{ fontSize: 11 }}>{selected.position ? `${selected.position.x} ${selected.position.y} ${selected.position.z}` : '—'}</b></div>
              <div className="pd-stat"><Clock size={14} /> {t('players.col.playtime')}<b>{selected.playtimeHours != null ? `${selected.playtimeHours}h` : '—'}</b></div>
              <div className="pd-stat">IP<b className="mono" style={{ fontSize: 11 }}>{selected.ip || '—'}</b></div>
            </div>

            <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
              <button className="btn sm" onClick={() => act(selected, () => window.msms.setOp(id, selected, !selected.op))}>
                {selected.op ? <ShieldOff size={14} /> : <Shield size={14} />}
                {selected.op ? t('players.deop') : t('players.op')}
              </button>
              <button className="btn sm" onClick={() => act(selected, () => window.msms.setWhitelist(id, selected, !selected.whitelisted))}>
                {selected.whitelisted ? <UserX size={14} /> : <UserCheck size={14} />}
                {selected.whitelisted ? t('players.unwhitelist') : t('players.whitelist')}
              </button>
              {selected.online && (
                <button className="btn sm" onClick={() => act(selected, () => window.msms.kickPlayer(id, selected))}>
                  <UserMinus size={14} /> {t('players.kick')}
                </button>
              )}
              <button className={`btn sm ${selected.banned ? '' : 'danger'}`} onClick={() => act(selected, () => window.msms.setBan(id, selected, !selected.banned))}>
                <Ban size={14} /> {selected.banned ? t('players.pardon') : t('players.ban')}
              </button>
              {selected.online && (
                <select
                  className="select sm-select"
                  defaultValue=""
                  onChange={(e) => e.target.value && act(selected, () => window.msms.setGamemode(id, selected, e.target.value))}
                >
                  <option value="" disabled>{t('players.gamemode')}</option>
                  {GAMEMODES.map((g) => (
                    <option key={g} value={g}>{t(`gm.${g}`)}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="section-title" style={{ marginBottom: 8 }}>
              <Package size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              {t('players.inventory')}
            </div>
            <p className="hint" style={{ marginTop: 0 }}>{t('players.inventorySoon')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
