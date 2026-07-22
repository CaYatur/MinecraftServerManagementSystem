import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, RotateCcw, Trash2, FolderOpen, Loader2, Save } from 'lucide-react'
import { useStore } from '../store'
import { formatBytes } from '../components/ui'
import type { BackupRecord } from '@shared/types'

export function BackupsView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const toast = useStore((s) => s.toast)
  const [kind, setKind] = useState<'world' | 'full'>('world')
  const [destDir, setDestDir] = useState('')
  const [creating, setCreating] = useState(false)
  const [list, setList] = useState<BackupRecord[]>([])
  const [confirmRestore, setConfirmRestore] = useState<BackupRecord | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setList(await window.msms.listBackups(id))
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (): Promise<void> => {
    setCreating(true)
    try {
      await window.msms.createBackup(id, { kind, destDir: destDir.trim() || undefined })
      toast('success', 'backups.created')
      void load()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
    setCreating(false)
  }

  const browse = async (): Promise<void> => {
    const p = await window.msms.pickFolder()
    if (p) setDestDir(p)
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{t('backups.create')}</div>
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>{t('backups.kind')}</label>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'world' | 'full')}>
              <option value="world">{t('backups.world')}</option>
              <option value="full">{t('backups.full')}</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0, minWidth: 220 }}>
            <label>{t('backups.destDir')}</label>
            <div className="row">
              <input className="input" value={destDir} onChange={(e) => setDestDir(e.target.value)} placeholder="—" />
              <button className="btn" onClick={browse}>
                <FolderOpen size={14} /> {t('backups.choose')}
              </button>
            </div>
          </div>
          <button className="btn primary" disabled={creating} onClick={create}>
            {creating ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {creating ? t('backups.creating') : t('backups.create')}
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>{t('backups.restoreWarn')}</p>
      </div>

      {list.length === 0 ? (
        <div className="panel">
          <p className="dim" style={{ margin: 0 }}>{t('backups.empty')}</p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {list.map((b) => (
            <div key={b.id} className="mod-row">
              <Archive size={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mod-name">{b.fileName}</div>
                <div className="dim mono" style={{ fontSize: 11 }}>
                  {b.kind} · {formatBytes(b.size)} · {new Date(b.createdAt).toLocaleString()}
                </div>
              </div>
              <button className="btn sm" title={b.path} onClick={() => window.msms.openPath(b.path.replace(/[\\/][^\\/]+$/, ''))}>
                <FolderOpen size={13} />
              </button>
              <button className="btn sm" onClick={() => setConfirmRestore(b)}>
                <RotateCcw size={13} /> {t('backups.restore')}
              </button>
              <button
                className="btn danger sm"
                onClick={async () => {
                  await window.msms.deleteBackup(b.id)
                  void load()
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmRestore && (
        <div className="modal-backdrop" onClick={() => setConfirmRestore(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('backups.confirmRestore')}</h3>
            <p>{t('backups.restoreBody')}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmRestore(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await window.msms.restoreBackup(confirmRestore.id)
                    toast('success', 'common.saved')
                  } catch (e) {
                    toast('error', String((e as Error)?.message ?? e))
                  }
                  setConfirmRestore(null)
                }}
              >
                {t('backups.restore')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
