import { app } from 'electron'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

let cachedBaseDir: string | null = null

/**
 * The "launch directory" — the portable app's root. Everything (config, per-server
 * data, backups metadata, logs, cache) lives under here, and servers are expected
 * to be sub-folders of it.
 *
 * IMPORTANT: for an electron-builder `portable` target the exe extracts itself into
 * a temp folder, so `app.getPath('exe')` and `__dirname` point at temp — NOT where
 * the user launched it. Only `PORTABLE_EXECUTABLE_DIR` is the real launch folder.
 */
export function resolveBaseDir(): string {
  if (cachedBaseDir) return cachedBaseDir
  let dir: string
  const override = process.env.MSMS_BASE_DIR?.trim()
  if (override) {
    dir = override
  } else if (process.env.PORTABLE_EXECUTABLE_DIR) {
    dir = process.env.PORTABLE_EXECUTABLE_DIR
  } else if (app.isPackaged) {
    dir = dirname(app.getPath('exe'))
  } else {
    // Dev: keep runtime data out of the repo root.
    dir = join(process.cwd(), 'dev-root')
  }
  mkdirSync(dir, { recursive: true })
  cachedBaseDir = dir
  return dir
}

function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

export const dataDir = (): string => ensure(join(resolveBaseDir(), 'msms-data'))
export const configPath = (): string => join(dataDir(), 'config.json')
export const backupsMetaPath = (): string => join(dataDir(), 'backups.json')
export const schedulesPath = (): string => join(dataDir(), 'schedules.json')
export const usersPath = (): string => join(dataDir(), 'users.json')
export const storePath = (): string => join(dataDir(), 'store.json')
export const playerAccountsPath = (): string => join(dataDir(), 'player-accounts.json')
export const siteConfigPath = (): string => join(dataDir(), 'site.json')
export const siteDir = (): string => ensure(join(dataDir(), 'site'))
export const uploadsDir = (): string => ensure(join(dataDir(), 'site', 'uploads'))
export const logsDir = (): string => ensure(join(dataDir(), 'logs'))
export const cacheDir = (): string => ensure(join(dataDir(), 'cache'))
export const backupsDir = (): string => ensure(join(dataDir(), 'backups'))
export const metricsDir = (): string => ensure(join(dataDir(), 'metrics'))
export const eventsDir = (): string => ensure(join(dataDir(), 'events'))
