import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RefreshCw,
  Plus,
  Trash2,
  Power,
  PowerOff,
  Download,
  Search,
  Package,
  ArrowUpCircle,
  CheckCircle2,
  Loader2
} from 'lucide-react'
import { useStore } from '../store'
import { formatBytes } from '../components/ui'
import type { ModEntry, ModrinthHit, ModUpdate } from '@shared/mods'

export function ModsView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const toast = useStore((s) => s.toast)
  const [tab, setTab] = useState<'installed' | 'browse'>('installed')
  const [list, setList] = useState<ModEntry[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ModrinthHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, ModUpdate>>({})
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'ok' | 'failed'>('idle')
  const [applying, setApplying] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setList(await window.msms.listMods(id))
    } catch {
      setList([])
    }
  }, [id])

  useEffect(() => {
    void load()
    // A different server's update results must not linger.
    setUpdates({})
    setCheckState('idle')
  }, [id, load])

  const checkUpdates = async (): Promise<void> => {
    setCheckState('checking')
    try {
      const report = await window.msms.checkModUpdates(id)
      if (!report.ok) {
        setCheckState('failed')
        return
      }
      const byPath: Record<string, ModUpdate> = {}
      for (const u of report.updates) byPath[u.path] = u
      setUpdates(byPath)
      setCheckState('ok')
    } catch {
      setCheckState('failed')
    }
  }

  const apply = async (m: ModEntry): Promise<void> => {
    const u = updates[m.path]
    if (!u || u.state !== 'update' || !u.versionId) return
    setApplying(m.path)
    try {
      await window.msms.applyModUpdate(id, m.path, u.versionId)
      toast('success', 'mods.updatedOk', { name: u.latestVersion ?? '' })
      // The old row is gone; drop its stale update and reload.
      setUpdates((prev) => {
        const next = { ...prev }
        delete next[m.path]
        return next
      })
      await load()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
    setApplying(null)
  }

  const updatable = Object.values(updates).filter((u) => u.state === 'update').length

  const addJar = async (): Promise<void> => {
    const folder = list.find((m) => m.folder === 'mods') ? 'mods' : 'plugins'
    const name = await window.msms.addMod(id, folder)
    if (name) {
      toast('success', 'mods.installedOk', { name })
      void load()
    }
  }

  const search = async (): Promise<void> => {
    if (!query.trim()) return
    setSearching(true)
    setResults(null)
    try {
      setResults(await window.msms.searchMods(id, query.trim()))
    } catch {
      setResults([])
    }
    setSearching(false)
  }

  const install = async (hit: ModrinthHit): Promise<void> => {
    setInstalling(hit.projectId)
    try {
      const name = await window.msms.installMod(id, hit.projectId)
      toast('success', 'mods.installedOk', { name })
      void load()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
    setInstalling(null)
  }

  return (
    <div>
      <div className="tabs" style={{ border: 'none', padding: 0, marginBottom: 14 }}>
        <button className={`tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
          {t('mods.installed')} ({list.length})
        </button>
        <button className={`tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>
          {t('mods.browse')}
        </button>
      </div>

      {tab === 'installed' ? (
        <>
          <div className="row wrap" style={{ marginBottom: 12, gap: 8, alignItems: 'center' }}>
            <button className="btn primary sm" onClick={addJar}>
              <Plus size={14} /> {t('mods.add')}
            </button>
            <button className="btn sm" onClick={load}>
              <RefreshCw size={13} /> {t('common.refresh')}
            </button>
            <button className="btn sm" onClick={checkUpdates} disabled={checkState === 'checking' || !list.length}>
              {checkState === 'checking' ? <Loader2 size={13} className="spin" /> : <ArrowUpCircle size={13} />}
              {checkState === 'checking' ? t('mods.checking') : t('mods.checkUpdates')}
            </button>
            {checkState === 'ok' && (
              <span className="dim" style={{ fontSize: 12 }}>
                {updatable > 0 ? t('mods.updatesFound', { n: updatable }) : t('mods.allCurrent')}
              </span>
            )}
            {checkState === 'failed' && (
              <span className="dim" style={{ fontSize: 12, color: 'var(--warning)' }}>
                {t('mods.checkFailed')}
              </span>
            )}
          </div>
          {list.length === 0 ? (
            <div className="panel">
              <p className="dim" style={{ margin: 0 }}>{t('mods.empty')}</p>
            </div>
          ) : (
            <div className="panel" style={{ padding: 0 }}>
              {list.map((m) => {
                const u = updates[m.path]
                return (
                <div key={m.path} className="mod-row">
                  <Package size={16} className={m.enabled ? '' : 'dim'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mod-name">
                      {m.name} {!m.enabled && <span className="badge">{t('mods.disabled')}</span>}
                      {u?.state === 'update' && (
                        <span className="badge badge-accent">
                          {u.latestVersion ? t('mods.updateTo', { version: u.latestVersion }) : t('mods.updateAvailable')}
                        </span>
                      )}
                      {u?.state === 'current' && (
                        <span className="dim" title={t('mods.upToDate')} style={{ marginLeft: 6 }}>
                          <CheckCircle2 size={12} style={{ verticalAlign: -2, color: 'var(--online)' }} />
                        </span>
                      )}
                    </div>
                    <div className="dim mono" style={{ fontSize: 11 }}>
                      {m.folder}/ · {formatBytes(m.size)}
                    </div>
                  </div>
                  {u?.state === 'update' && (
                    <button
                      className="btn primary sm"
                      disabled={applying === m.path}
                      onClick={() => void apply(m)}
                    >
                      {applying === m.path ? <Loader2 size={13} className="spin" /> : <ArrowUpCircle size={13} />}
                      {applying === m.path ? t('mods.updating') : t('mods.update')}
                    </button>
                  )}
                  <button
                    className="btn ghost sm"
                    title={m.enabled ? t('mods.disable') : t('mods.enable')}
                    onClick={async () => {
                      await window.msms.toggleMod(id, m.path, !m.enabled)
                      void load()
                    }}
                  >
                    {m.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                  </button>
                  <button
                    className="btn ghost sm danger"
                    title={t('mods.delete')}
                    onClick={async () => {
                      await window.msms.deleteMod(id, m.path)
                      void load()
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 14, gap: 8 }}>
            <input
              className="input"
              placeholder={t('mods.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            <button className="btn primary" onClick={search}>
              <Search size={14} /> {t('mods.search')}
            </button>
          </div>
          {searching ? (
            <p className="dim">{t('mods.searching')}</p>
          ) : results === null ? null : results.length === 0 ? (
            <p className="dim">{t('mods.noResults')}</p>
          ) : (
            <div className="cards" style={{ gridTemplateColumns: '1fr' }}>
              {results.map((h) => (
                <div key={h.projectId} className="panel" style={{ padding: 12 }}>
                  <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                    {h.iconUrl ? (
                      <img src={h.iconUrl} width={40} height={40} style={{ borderRadius: 8 }} alt="" />
                    ) : (
                      <Package size={40} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mod-name">{h.title}</div>
                      <div className="dim" style={{ fontSize: 12 }}>
                        {h.description}
                      </div>
                      <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>
                        {h.downloads.toLocaleString()} {t('mods.downloads')}
                      </div>
                    </div>
                    <button
                      className="btn primary sm"
                      disabled={installing === h.projectId}
                      onClick={() => install(h)}
                    >
                      <Download size={13} />
                      {installing === h.projectId ? t('mods.installing') : t('mods.install')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
