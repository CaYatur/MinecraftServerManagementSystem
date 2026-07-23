import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe2, CheckCircle2, Trash2, RefreshCw, Flame, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { formatBytes } from '../components/ui'
import type { WorldInfo } from '@shared/types'

const GAME_MODE = ['survival', 'creative', 'adventure', 'spectator']

export function WorldsList(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const status = useStore((s) => s.activeStatus().status)
  const toast = useStore((s) => s.toast)
  const [list, setList] = useState<WorldInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<WorldInfo | null>(null)

  const stopped = status === 'stopped' || status === 'crashed'

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setList(await window.msms.listWorlds(id))
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
    setBusy(false)
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  const activate = async (w: WorldInfo): Promise<void> => {
    try {
      await window.msms.activateWorld(id, w.name)
      toast('success', 'worlds.activated')
      void load()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }

  const remove = async (w: WorldInfo): Promise<void> => {
    try {
      await window.msms.deleteWorld(id, w.name)
      toast('success', 'worlds.deleted')
      void load()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
    setConfirmDelete(null)
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
          <div className="section-title" style={{ margin: 0 }}>
            {t('worlds.title')}
          </div>
          <button className="btn ghost sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={13} className={busy ? 'spin' : ''} /> {t('common.refresh')}
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          {stopped ? t('worlds.hint') : t('worlds.runningHint')}
        </p>
      </div>

      {list.length === 0 ? (
        <div className="panel">
          <p className="dim" style={{ margin: 0 }}>
            {busy ? t('common.loading') : t('worlds.empty')}
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {list.map((w) => (
            <div key={w.name} className="mod-row world-row">
              <Globe2 size={16} className={w.active ? 'accent' : 'dim'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mod-name">
                  {w.name}{' '}
                  {w.active && <span className="badge">{t('worlds.active')}</span>}
                  {w.hardcore && <span className="badge">{t('worlds.hardcore')}</span>}
                </div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {formatBytes(w.sizeBytes)}
                  {w.version ? ` · ${w.version}` : ''}
                  {w.gameMode != null && GAME_MODE[w.gameMode]
                    ? ` · ${t(`worlds.mode.${GAME_MODE[w.gameMode]}`)}`
                    : ''}
                  {w.lastPlayed ? ` · ${t('worlds.lastPlayed', { when: new Date(w.lastPlayed).toLocaleString() })}` : ''}
                </div>
                <div className="dim" style={{ fontSize: 11, display: 'flex', gap: 10, marginTop: 2 }}>
                  <span title={t('worlds.dim.overworld')}>
                    <Globe2 size={11} style={{ verticalAlign: -1 }} /> {t('worlds.dim.overworld')}
                  </span>
                  {w.dimensions.includes('nether') && (
                    <span title={t('worlds.dim.nether')}>
                      <Flame size={11} style={{ verticalAlign: -1 }} /> {t('worlds.dim.nether')}
                    </span>
                  )}
                  {w.dimensions.includes('end') && (
                    <span title={t('worlds.dim.end')}>
                      <Sparkles size={11} style={{ verticalAlign: -1 }} /> {t('worlds.dim.end')}
                    </span>
                  )}
                  {w.seed ? <span className="mono">{t('worlds.seed', { seed: w.seed })}</span> : null}
                </div>
              </div>
              {!w.active && (
                <button className="btn sm" disabled={!stopped} onClick={() => void activate(w)}>
                  <CheckCircle2 size={13} /> {t('worlds.activate')}
                </button>
              )}
              <button
                className="btn danger sm"
                disabled={!stopped || w.active}
                title={w.active ? t('worlds.cannotDeleteActive') : t('common.delete')}
                onClick={() => setConfirmDelete(w)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('worlds.confirmDelete', { name: confirmDelete.name })}</h3>
            <p>
              {t('worlds.deleteBody', {
                folders: confirmDelete.dimensions.length,
                size: formatBytes(confirmDelete.sizeBytes)
              })}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn danger" onClick={() => void remove(confirmDelete)}>
                <Trash2 size={13} /> {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
