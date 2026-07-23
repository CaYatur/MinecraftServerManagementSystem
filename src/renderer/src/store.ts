import { create } from 'zustand'
import { setI18nLanguage } from './i18n'
import type {
  AppConfig,
  Bootstrap,
  JavaInfo,
  Language,
  LogLine,
  ResolvedLanguage,
  ServerConfig,
  ServerRuntimeStatus,
  ServerStats,
  StopOptions,
  ThemeMode
} from '@shared/types'

export type ViewId =
  | 'dashboard'
  | 'console'
  | 'properties'
  | 'files'
  | 'players'
  | 'plugins'
  | 'backups'
  | 'scheduler'
  | 'history'
  | 'timeline'
  | 'crash'
  | 'store'
  | 'settings'
  | 'create'
  | 'web'
  | 'site'
  | 'audit'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'warning' | 'error'
  /** i18n key (or literal message if it has no dot). */
  message: string
  params?: Record<string, string | number>
}

const LOG_CAP = 1500

function resolveLang(lang: Language, systemLocale: string): ResolvedLanguage {
  if (lang === 'en' || lang === 'tr') return lang
  return systemLocale.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

function applyTheme(theme: ThemeMode): void {
  const dark = theme === 'system' ? prefersDark() : theme === 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

interface StoreState {
  ready: boolean
  baseDir: string
  appVersion: string
  platform: string
  systemLocale: string
  javaDetected: JavaInfo | null
  config: AppConfig
  servers: ServerConfig[]
  statuses: Record<string, ServerRuntimeStatus>
  stats: Record<string, ServerStats>
  logs: Record<string, LogLine[]>
  activeServerId?: string
  view: ViewId
  toasts: Toast[]

  init: (boot: Bootstrap) => Promise<void>
  setView: (v: ViewId) => void
  selectServer: (id: string) => Promise<void>
  refreshServers: () => Promise<void>
  scan: () => Promise<void>
  addExisting: () => Promise<void>
  removeServer: (id: string, deleteFiles: boolean) => Promise<void>
  updateServer: (id: string, patch: Partial<ServerConfig>) => Promise<void>
  start: (id: string) => Promise<void>
  stop: (id: string, opts?: StopOptions) => Promise<void>
  restart: (id: string, opts?: StopOptions) => Promise<void>
  kill: (id: string) => Promise<void>
  sendCommand: (id: string, cmd: string) => Promise<void>
  clearLogs: (id: string) => void
  setLanguage: (lang: Language) => Promise<void>
  setTheme: (theme: ThemeMode) => Promise<void>
  updateDefaults: (patch: Partial<AppConfig['defaults']>) => Promise<void>
  toast: (kind: Toast['kind'], message: string, params?: Toast['params']) => void
  dismissToast: (id: string) => void

  activeServer: () => ServerConfig | undefined
  activeStatus: () => ServerRuntimeStatus
}

// Buffer incoming log lines and flush on an interval to avoid render thrash.
const logBuffers = new Map<string, LogLine[]>()

export const useStore = create<StoreState>((set, get) => ({
  ready: false,
  baseDir: '',
  appVersion: '',
  platform: '',
  systemLocale: 'en',
  javaDetected: null,
  config: {} as AppConfig,
  servers: [],
  statuses: {},
  stats: {},
  logs: {},
  activeServerId: undefined,
  view: 'dashboard',
  toasts: [],

  init: async (boot) => {
    applyTheme(boot.config.theme)
    const active = boot.config.activeServerId ?? boot.config.servers[0]?.id
    set({
      ready: true,
      baseDir: boot.baseDir,
      appVersion: boot.appVersion,
      platform: boot.platform,
      systemLocale: boot.systemLocale,
      javaDetected: boot.javaDetected,
      config: boot.config,
      servers: boot.config.servers,
      activeServerId: active,
      view: active ? 'console' : 'create'
    })

    // Wire up main -> renderer events (once).
    window.msms.onServerLog(({ serverId, line }) => {
      const buf = logBuffers.get(serverId) ?? []
      buf.push(line)
      logBuffers.set(serverId, buf)
    })
    window.msms.onServerStatus((s) => {
      set((st) => ({ statuses: { ...st.statuses, [s.id]: s } }))
    })
    window.msms.onServerStats((s) => {
      set((st) => ({ stats: { ...st.stats, [s.id]: s } }))
    })
    window.msms.onToast((t) => get().toast(t.kind, t.message))

    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (get().config.theme === 'system') applyTheme('system')
    })

    setInterval(() => {
      if (logBuffers.size === 0) return
      set((st) => {
        const logs = { ...st.logs }
        for (const [id, buf] of logBuffers) {
          const existing = logs[id] ?? []
          const merged = existing.concat(buf)
          logs[id] = merged.length > LOG_CAP ? merged.slice(merged.length - LOG_CAP) : merged
        }
        return { logs }
      })
      logBuffers.clear()
    }, 120)

    // Hydrate statuses + active log history.
    const statuses = await window.msms.getAllStatus()
    set((st) => {
      const map = { ...st.statuses }
      statuses.forEach((s) => (map[s.id] = s))
      return { statuses: map }
    })
    if (active) await get().selectServer(active)
  },

  setView: (v) => set({ view: v }),

  selectServer: async (id) => {
    set({ activeServerId: id })
    window.msms.setActiveServer(id).catch(() => {})
    const [history, status] = await Promise.all([
      window.msms.getLogHistory(id),
      window.msms.getStatus(id)
    ])
    set((st) => ({
      logs: { ...st.logs, [id]: history },
      statuses: { ...st.statuses, [id]: status }
    }))
  },

  refreshServers: async () => {
    const servers = await window.msms.listServers()
    set({ servers })
  },

  scan: async () => {
    const before = get().servers.length
    const servers = await window.msms.scanServers()
    set({ servers })
    get().toast('success', 'toast.scanDone', { count: servers.length - before })
  },

  addExisting: async () => {
    const path = await window.msms.pickFolder(get().baseDir)
    if (!path) return
    const res = await window.msms.addServer(path)
    if (res.ok && res.server) {
      await get().refreshServers()
      get().toast('success', 'toast.added')
      await get().selectServer(res.server.id)
    } else {
      get().toast('error', 'toast.notAServer')
    }
  },

  removeServer: async (id, deleteFiles) => {
    await window.msms.removeServer(id, deleteFiles)
    await get().refreshServers()
    const first = get().servers[0]?.id
    set({ activeServerId: first, view: first ? get().view : 'create' })
  },

  updateServer: async (id, patch) => {
    const updated = await window.msms.updateServer(id, patch)
    set((st) => ({ servers: st.servers.map((s) => (s.id === id ? updated : s)) }))
  },

  start: async (id) => {
    try {
      await window.msms.startServer(id)
    } catch {
      get().toast('error', 'toast.startFailed')
    }
  },
  stop: async (id, opts) => {
    await window.msms.stopServer(id, opts)
  },
  restart: async (id, opts) => {
    await window.msms.restartServer(id, opts)
  },
  kill: async (id) => {
    await window.msms.killServer(id)
  },
  sendCommand: async (id, cmd) => {
    await window.msms.sendCommand(id, cmd).catch(() => {})
  },

  clearLogs: (id) => set((st) => ({ logs: { ...st.logs, [id]: [] } })),

  setLanguage: async (lang) => {
    const config = await window.msms.setLanguage(lang)
    setI18nLanguage(resolveLang(lang, get().systemLocale))
    set({ config })
  },
  setTheme: async (theme) => {
    const config = await window.msms.setTheme(theme)
    applyTheme(theme)
    set({ config })
  },
  updateDefaults: async (patch) => {
    const config = await window.msms.updateDefaults(patch)
    set({ config })
    get().toast('success', 'toast.saved')
  },

  toast: (kind, message, params) => {
    const id = Math.random().toString(36).slice(2)
    set((st) => ({ toasts: [...st.toasts, { id, kind, message, params }] }))
    setTimeout(() => get().dismissToast(id), 4200)
  },
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

  activeServer: () => get().servers.find((s) => s.id === get().activeServerId),
  activeStatus: () => {
    const id = get().activeServerId
    return (id && get().statuses[id]) || { id: id ?? '', status: 'stopped' }
  }
}))
