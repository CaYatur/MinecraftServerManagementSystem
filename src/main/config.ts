import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { configPath, resolveBaseDir } from './paths'
import { log } from './logger'
import type { AppConfig } from '@shared/types'

const CONFIG_VERSION = 1

function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    language: 'auto',
    theme: 'dark',
    servers: [],
    defaults: {
      javaPath: '',
      maxMemoryMB: 4096,
      minMemoryMB: 2048,
      javaPreset: 'aikars',
      stopCountdownSeconds: 10,
      autoEnableRcon: true
    },
    baseDir: resolveBaseDir()
  }
}

let cache: AppConfig | null = null

/** Deep-merge loaded config over defaults so new fields always exist. */
function migrate(raw: Partial<AppConfig>): AppConfig {
  const base = defaultConfig()
  return {
    ...base,
    ...raw,
    version: CONFIG_VERSION,
    defaults: { ...base.defaults, ...(raw.defaults ?? {}) },
    servers: Array.isArray(raw.servers) ? raw.servers : [],
    baseDir: resolveBaseDir()
  }
}

export function loadConfig(): AppConfig {
  const p = configPath()
  if (!existsSync(p)) {
    cache = defaultConfig()
    saveConfig(cache)
    return cache
  }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<AppConfig>
    cache = migrate(raw)
    return cache
  } catch (err) {
    log.error('Failed to parse config, using defaults:', err)
    cache = defaultConfig()
    return cache
  }
}

export function getConfig(): AppConfig {
  return cache ?? loadConfig()
}

export function saveConfig(cfg: AppConfig): void {
  cache = cfg
  const p = configPath()
  const tmp = p + '.tmp'
  try {
    writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf-8')
    renameSync(tmp, p)
  } catch (err) {
    log.error('Failed to save config:', err)
  }
}

/** Mutate the config atomically and persist. */
export function updateConfig(mutator: (cfg: AppConfig) => void): AppConfig {
  const cfg = getConfig()
  mutator(cfg)
  saveConfig(cfg)
  return cfg
}
