import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Globe2,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Flame,
  Sparkles,
  Copy,
  Pencil,
  RotateCcw
} from 'lucide-react'
import { useStore } from '../store'
import { formatBytes } from '../components/ui'
import type { WorldDimension, WorldInfo } from '@shared/types'

const GAME_MODE = ['survival', 'creative', 'adventure', 'spectator']

/** Rename and clone both ask for one new name. */
interface NameDialog {
  mode: 'rename' | 'clone'
  world: WorldInfo
  value: string
}

export function WorldsList(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const status = useStore((s) => s.activeStatus().status)
  const toast = useStore((s) => s.toast)
  const [list, setList] = useState<WorldInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<WorldInfo | null>(null)
  const [confirmReset, setConfirmReset] = useState<{ world: WorldInfo; dim: WorldDimension } | null>(null)
  const [dialog, setDialog] = useState<NameDialog | null>(null)

  const stopped = status === 'stopped' || status === 'crashed'

  /** Core errors arrive as codes; show them as sentences when we know them. */
  const explain = useCallback(
    (e: unknown): string => {
      const msg = String((e as Error)?.message ?? e)
      return t(`worlds.err.${msg}`, { defaultValue: msg })
    },
    [t]
  )

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setList(await window.msms.listWorlds(id))
    } catch (e) {
      toast('error', explain(e))
    }
    setBusy(false)
  }, [id, toast, explain])

  useEffect(() => {
    void load()
  }, [load])

  /** Every mutation is the same shape: run it, say what happened, reload. */
  const run = async (fn: () => Promise<void>, okKey: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      toast('success', okKey)
      void load()
    } catch (e) {
      toast('error', explain(e))
    }
    setBusy(false)
  }

  const submitDialog = async (): Promise<void> => {
    if (!dialog) return
    const name = dialog.value.trim()
    if (!name || name === dialog.world.name) {
      setDialog(null)
      return
    }
    const d = dialog
    setDialog(null)
    await run(
      () =>
        d.mode === 'rename'
          ? window.msms.renameWorld(id, d.world.name, name)
          : window.msms.cloneWorld(id, d.world.name, name),
      d.mode === 'rename' ? 'worlds.renamed' : 'worlds.cloned'
    )
  }

  const dimIcon = (d: WorldDimension): JSX.Element =>
    d === 'nether' ? <Flame size={11} /> : d === 'end' ? <Sparkles size={11} /> : <Globe2 size={11} />

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
                  {w.name} {w.active && <span className="badge">{t('worlds.active')}</span>}
                  {w.hardcore && <span className="badge">{t('worlds.hardcore')}</span>}
                </div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {formatBytes(w.sizeBytes)}
                  {w.version ? ` · ${w.version}` : ''}
                  {w.gameMode != null && GAME_MODE[w.gameMode]
                    ? ` · ${t(`worlds.mode.${GAME_MODE[w.gameMode]}`)}`
                    : ''}
                  {w.lastPlayed
                    ? ` · ${t('worlds.lastPlayed', { when: new Date(w.lastPlayed).toLocaleString() })}`
                    : ''}
                </div>
                <div className="world-dims dim">
                  {w.dimensions.map((d) => (
                    <span key={d} className="world-dim">
                      {dimIcon(d)} {t(`worlds.dim.${d}`)}
                      {d !== 'overworld' && (
                        <button
                          className="btn ghost xs"
                          disabled={!stopped || busy}
                          title={t('worlds.resetDim', { dim: t(`worlds.dim.${d}`) })}
                          onClick={() => setConfirmReset({ world: w, dim: d })}
                        >
                          <RotateCcw size={10} />
                        </button>
                      )}
                    </span>
                  ))}
                  {w.seed ? <span className="mono">{t('worlds.seed', { seed: w.seed })}</span> : null}
                </div>
              </div>
              {!w.active && (
                <button
                  className="btn sm"
                  disabled={!stopped || busy}
                  onClick={() => void run(() => window.msms.activateWorld(id, w.name), 'worlds.activated')}
                >
                  <CheckCircle2 size={13} /> {t('worlds.activate')}
                </button>
              )}
              <button
                className="btn ghost sm"
                disabled={!stopped || busy}
                title={t('worlds.clone')}
                onClick={() => setDialog({ mode: 'clone', world: w, value: `${w.name}_copy` })}
              >
                <Copy size={13} />
              </button>
              <button
                className="btn ghost sm"
                disabled={!stopped || busy}
                title={t('worlds.rename')}
                onClick={() => setDialog({ mode: 'rename', world: w, value: w.name })}
              >
                <Pencil size={13} />
              </button>
              <button
                className="btn danger sm"
                disabled={!stopped || w.active || busy}
                title={w.active ? t('worlds.cannotDeleteActive') : t('common.delete')}
                onClick={() => setConfirmDelete(w)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {t(dialog.mode === 'rename' ? 'worlds.renameTitle' : 'worlds.cloneTitle', {
                name: dialog.world.name
              })}
            </h3>
            <div className="field">
              <label>{t('worlds.newName')}</label>
              <input
                className="input"
                autoFocus
                value={dialog.value}
                onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitDialog()
                }}
              />
            </div>
            <p className="hint">
              {t(dialog.mode === 'rename' ? 'worlds.renameBody' : 'worlds.cloneBody')}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn primary" onClick={() => void submitDialog()}>
                {t(dialog.mode === 'rename' ? 'worlds.rename' : 'worlds.clone')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmReset && (
        <div className="modal-backdrop" onClick={() => setConfirmReset(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {t('worlds.resetTitle', {
                dim: t(`worlds.dim.${confirmReset.dim}`),
                name: confirmReset.world.name
              })}
            </h3>
            <p>{t('worlds.resetBody', { dim: t(`worlds.dim.${confirmReset.dim}`) })}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmReset(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  const r = confirmReset
                  setConfirmReset(null)
                  void run(
                    () => window.msms.resetDimension(id, r.world.name, r.dim),
                    'worlds.resetDone'
                  )
                }}
              >
                <RotateCcw size={13} /> {t('worlds.reset')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('worlds.confirmDelete', { name: confirmDelete.name })}</h3>
            <p>
              {t('worlds.deleteBody', {
                folders: confirmDelete.folders,
                size: formatBytes(confirmDelete.sizeBytes)
              })}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  const w = confirmDelete
                  setConfirmDelete(null)
                  void run(() => window.msms.deleteWorld(id, w.name), 'worlds.deleted')
                }}
              >
                <Trash2 size={13} /> {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
