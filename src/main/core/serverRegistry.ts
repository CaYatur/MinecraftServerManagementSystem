import { randomUUID } from 'node:crypto'
import { readdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { getConfig, updateConfig } from '../config'
import { resolveBaseDir, dataDir } from '../paths'
import { detectServer } from './serverDetect'
import { log } from '../logger'
import { PROXY_TYPES } from '@shared/types'
import type { ServerConfig, ServerType, JavaArgsConfig } from '@shared/types'
import type { AddServerResult } from '@shared/ipc'

function defaultJava(jarFile: string, type: ServerType): JavaArgsConfig {
  const d = getConfig().defaults
  return {
    javaPath: d.javaPath,
    minMemoryMB: d.minMemoryMB,
    maxMemoryMB: d.maxMemoryMB,
    preset: PROXY_TYPES.includes(type) ? 'proxy' : d.javaPreset,
    customArgs: '',
    extraFlags: '',
    jarFile: jarFile || 'server.jar',
    nogui: true
  }
}

/** Build a ServerConfig from a folder, or null if it isn't a server. */
export function makeServerConfig(path: string, name?: string): ServerConfig | null {
  const abs = resolve(path)
  const det = detectServer(abs)
  if (!det.isServer) return null
  return {
    id: randomUUID(),
    name: name || basename(abs),
    path: abs,
    type: det.type,
    mcVersion: det.mcVersion,
    createdAt: Date.now(),
    lastUsedAt: 0,
    java: defaultJava(det.jarFile, det.type),
    autoRestart: false,
    autoRestartOnCrash: false
  }
}

export function listServers(): ServerConfig[] {
  return getConfig().servers
}

const samePath = (a: string, b: string): boolean =>
  resolve(a).toLowerCase() === resolve(b).toLowerCase()

/** Scan the launch directory for server folders not yet registered. */
export function scanServers(): ServerConfig[] {
  const base = resolveBaseDir()
  const dataFolder = resolve(dataDir()).toLowerCase()
  updateConfig((cfg) => {
    const known = new Set(cfg.servers.map((s) => resolve(s.path).toLowerCase()))
    let entries: string[] = []
    try {
      entries = readdirSync(base)
    } catch (err) {
      log.warn('scanServers readdir failed:', err)
    }
    for (const entry of entries) {
      const full = join(base, entry)
      const key = full.toLowerCase()
      if (key === dataFolder) continue
      if (known.has(key)) continue
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (!isDir) continue
      const det = detectServer(full)
      if (det.isServer) {
        const sc = makeServerConfig(full)
        if (sc) {
          cfg.servers.push(sc)
          known.add(key)
          log.info(`Discovered server "${sc.name}" (${sc.type} ${sc.mcVersion})`)
        }
      }
    }
  })
  return getConfig().servers
}

export function addServer(path: string): AddServerResult {
  const abs = resolve(path)
  if (!existsSync(abs)) return { ok: false, error: 'path-not-found' }
  const existing = getConfig().servers.find((s) => samePath(s.path, abs))
  if (existing) return { ok: true, server: existing }
  const sc = makeServerConfig(abs)
  if (!sc) return { ok: false, error: 'not-a-server' }
  updateConfig((cfg) => {
    cfg.servers.push(sc)
  })
  return { ok: true, server: sc }
}

/** Register an already-created server (used by the creation wizard). */
export function registerServer(sc: ServerConfig): ServerConfig {
  updateConfig((cfg) => {
    cfg.servers.push(sc)
    cfg.activeServerId = sc.id
  })
  return sc
}

export function removeServer(id: string, deleteFiles: boolean): void {
  const target = getConfig().servers.find((s) => s.id === id)
  updateConfig((cfg) => {
    cfg.servers = cfg.servers.filter((s) => s.id !== id)
    if (cfg.activeServerId === id) cfg.activeServerId = cfg.servers[0]?.id
  })
  if (deleteFiles && target && existsSync(target.path)) {
    try {
      rmSync(target.path, { recursive: true, force: true })
      log.info(`Deleted server files at ${target.path}`)
    } catch (err) {
      log.error('Failed to delete server files:', err)
    }
  }
}

export function updateServer(id: string, patch: Partial<ServerConfig>): ServerConfig {
  let updated: ServerConfig | undefined
  updateConfig((cfg) => {
    const s = cfg.servers.find((x) => x.id === id)
    if (!s) return
    Object.assign(s, patch, { id: s.id })
    if (patch.java) s.java = { ...s.java, ...patch.java }
    updated = s
  })
  if (!updated) throw new Error(`Server not found: ${id}`)
  return updated
}

export function getServer(id: string): ServerConfig | undefined {
  return getConfig().servers.find((s) => s.id === id)
}

export function touchServer(id: string): void {
  updateConfig((cfg) => {
    const s = cfg.servers.find((x) => x.id === id)
    if (s) s.lastUsedAt = Date.now()
  })
}
