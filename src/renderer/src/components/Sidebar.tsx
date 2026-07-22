import { useTranslation } from 'react-i18next'
import { Plus, FolderPlus, RefreshCw, Settings as SettingsIcon, Server, FolderOpen, Globe, Globe2 } from 'lucide-react'
import { useStore } from '../store'
import { StatusDot } from './ui'
import { Logo } from './Logo'
import { BrandWordmark } from './BrandWordmark'

export function Sidebar(): JSX.Element {
  const { t } = useTranslation()
  const servers = useStore((s) => s.servers)
  const statuses = useStore((s) => s.statuses)
  const activeId = useStore((s) => s.activeServerId)
  const view = useStore((s) => s.view)
  const selectServer = useStore((s) => s.selectServer)
  const setView = useStore((s) => s.setView)
  const scan = useStore((s) => s.scan)
  const addExisting = useStore((s) => s.addExisting)
  const openPath = (p: string): void => void window.msms.openPath(p)

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <Logo size={34} />
          <div>
            <BrandWordmark height={15} />
            <small>{t('app.subtitle')}</small>
          </div>
        </div>
      </div>

      <div className="sidebar-actions">
        <button
          className="btn primary sm block"
          onClick={() => setView('create')}
          style={{ marginBottom: 4 }}
        >
          <Plus size={14} /> {t('sidebar.create')}
        </button>
        <button className="btn sm" style={{ flex: 1 }} onClick={addExisting}>
          <FolderPlus size={14} /> {t('sidebar.addExisting')}
        </button>
        <button className="btn sm" title={t('sidebar.scan')} onClick={scan}>
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="server-list">
        <div className="server-list-label">{t('sidebar.servers')}</div>
        {servers.length === 0 ? (
          <div className="empty-state">
            <Server size={28} strokeWidth={1.4} />
            <h4>{t('sidebar.noServers')}</h4>
            <p>{t('sidebar.noServersHint')}</p>
          </div>
        ) : (
          servers.map((s) => {
            const st = statuses[s.id]?.status ?? 'stopped'
            const active =
              s.id === activeId && !['settings', 'create', 'web', 'site'].includes(view)
            return (
              <div
                key={s.id}
                className={`server-item ${active ? 'active' : ''}`}
                onClick={() => {
                  selectServer(s.id)
                  if (['settings', 'create', 'web', 'site'].includes(view)) setView('console')
                }}
              >
                <StatusDot status={st} />
                <div className="meta">
                  <div className="name">{s.name}</div>
                  <div className="sub">
                    {t(`types.${s.type}`)} · {s.mcVersion}
                  </div>
                </div>
                <button
                  className="btn ghost sm"
                  title={t('sidebar.openFolder')}
                  onClick={(e) => {
                    e.stopPropagation()
                    openPath(s.path)
                  }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className="sidebar-foot">
        <button
          className={`btn ghost sm block ${view === 'site' ? 'active' : ''}`}
          onClick={() => setView('site')}
          style={{ marginBottom: 4 }}
        >
          <Globe2 size={15} /> {t('site.title')}
        </button>
        <button
          className={`btn ghost sm block ${view === 'web' ? 'active' : ''}`}
          onClick={() => setView('web')}
          style={{ marginBottom: 4 }}
        >
          <Globe size={15} /> {t('web.title')}
        </button>
        <button
          className={`btn ghost sm block ${view === 'settings' ? 'active' : ''}`}
          onClick={() => setView('settings')}
        >
          <SettingsIcon size={15} /> {t('sidebar.settings')}
        </button>
      </div>
    </div>
  )
}
