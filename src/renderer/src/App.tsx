import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  TerminalSquare,
  SlidersHorizontal,
  FolderTree,
  Users,
  Puzzle,
  Archive,
  CalendarClock,
  Bug,
  Settings as SettingsIcon,
  Play,
  Square,
  RotateCw,
  Zap
} from 'lucide-react'
import { useStore, type ViewId } from './store'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { StatusDot } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ConsoleView } from './views/ConsoleView'
import { DashboardView } from './views/DashboardView'
import { SettingsView } from './views/SettingsView'
import { CreateView } from './views/CreateView'
import { PropertiesView } from './views/PropertiesView'
import { FilesView } from './views/FilesView'
import { PlayersView } from './views/PlayersView'
import { ModsView } from './views/ModsView'
import { BackupsView } from './views/BackupsView'
import { SchedulerView } from './views/SchedulerView'
import { CrashView } from './views/CrashView'
import { useState } from 'react'

const TABS: { id: ViewId; icon: JSX.Element; labelKey: string }[] = [
  { id: 'dashboard', icon: <LayoutDashboard size={15} />, labelKey: 'nav.dashboard' },
  { id: 'console', icon: <TerminalSquare size={15} />, labelKey: 'nav.console' },
  { id: 'properties', icon: <SlidersHorizontal size={15} />, labelKey: 'nav.properties' },
  { id: 'files', icon: <FolderTree size={15} />, labelKey: 'nav.files' },
  { id: 'players', icon: <Users size={15} />, labelKey: 'nav.players' },
  { id: 'plugins', icon: <Puzzle size={15} />, labelKey: 'nav.plugins' },
  { id: 'backups', icon: <Archive size={15} />, labelKey: 'nav.backups' },
  { id: 'scheduler', icon: <CalendarClock size={15} />, labelKey: 'nav.scheduler' },
  { id: 'crash', icon: <Bug size={15} />, labelKey: 'nav.crash' }
]

function ServerControls(): JSX.Element {
  const { t } = useTranslation()
  const server = useStore((s) => s.activeServer())
  const status = useStore((s) => s.activeStatus().status)
  const start = useStore((s) => s.start)
  const stop = useStore((s) => s.stop)
  const restart = useStore((s) => s.restart)
  const kill = useStore((s) => s.kill)
  const [confirmKill, setConfirmKill] = useState(false)

  if (!server) return <></>
  const running = status === 'running' || status === 'starting' || status === 'stopping'
  const busy = status === 'starting' || status === 'stopping'

  return (
    <div className="row">
      {!running ? (
        <button className="btn primary sm" onClick={() => start(server.id)}>
          <Play size={14} /> {t('controls.start')}
        </button>
      ) : (
        <button className="btn sm" disabled={busy} onClick={() => stop(server.id)}>
          <Square size={14} /> {t('controls.stop')}
        </button>
      )}
      <button className="btn sm" disabled={!running || busy} onClick={() => restart(server.id)}>
        <RotateCw size={14} /> {t('controls.restart')}
      </button>
      {running && (
        <button className="btn danger sm" onClick={() => setConfirmKill(true)}>
          <Zap size={14} /> {t('controls.kill')}
        </button>
      )}
      {confirmKill && (
        <div className="modal-backdrop" onClick={() => setConfirmKill(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('controls.confirmKillTitle')}</h3>
            <p>{t('controls.confirmKillBody')}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmKill(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  kill(server.id)
                  setConfirmKill(false)
                }}
              >
                {t('controls.kill')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MainArea(): JSX.Element {
  const { t } = useTranslation()
  const server = useStore((s) => s.activeServer())
  const status = useStore((s) => s.activeStatus().status)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)

  if (view === 'create') return <CreateView />
  if (view === 'settings') return <SettingsView />

  if (!server) {
    return (
      <div className="center-fill">
        <div>
          <h3>{t('sidebar.noServers')}</h3>
          <p className="dim">{t('sidebar.noServersHint')}</p>
        </div>
      </div>
    )
  }

  const renderView = (): JSX.Element => {
    switch (view) {
      case 'console':
        return <ConsoleView />
      case 'dashboard':
        return <DashboardView />
      case 'properties':
        return <PropertiesView />
      case 'files':
        return <FilesView />
      case 'players':
        return <PlayersView />
      case 'plugins':
        return <ModsView />
      case 'backups':
        return <BackupsView />
      case 'scheduler':
        return <SchedulerView />
      case 'crash':
        return <CrashView />
      default:
        return <DashboardView />
    }
  }

  return (
    <>
      <div className="topbar">
        <StatusDot status={status} />
        <div className="title">
          {server.name}
          <small>
            {t(`types.${server.type}`)} · {server.mcVersion} · {t(`status.${status}`)}
          </small>
        </div>
        <div className="spacer" />
        <ServerControls />
      </div>
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${view === tab.id ? 'active' : ''}`}
            onClick={() => setView(tab.id)}
          >
            {tab.icon}
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
      <div className={view === 'console' || view === 'files' ? 'content no-pad' : 'content'}>
        <ErrorBoundary key={view}>{renderView()}</ErrorBoundary>
      </div>
    </>
  )
}

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  if (!ready) {
    return <div className="center-fill">Loading…</div>
  }
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <MainArea />
      </div>
      <Toasts />
    </div>
  )
}
