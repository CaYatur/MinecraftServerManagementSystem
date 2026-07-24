import type { ServerType, JavaPreset } from './types'

export interface McVersion {
  id: string
  stable: boolean
}

export interface BuildInfo {
  id: string
  stable: boolean
  note?: string
}

export interface CreateServerOptions {
  name: string
  folderName?: string
  type: ServerType
  mcVersion: string
  build?: string
  memoryMB: number
  preset: JavaPreset
  acceptEula: boolean
  onlineMode: boolean
  port: number
}

export type CreateStage =
  | 'resolving'
  | 'downloading'
  | 'installing'
  | 'configuring'
  | 'done'
  | 'error'

export interface CreateProgress {
  stage: CreateStage
  percent?: number
  message?: string
}

/**
 * Map a raw createServer error to an i18n key under `wizard.*`, or null when it
 * should be shown verbatim. Pure + centralised so both the wizard UI and the
 * smoke rely on the same table — the UI must never surface a bare code like
 * `no-mohist-build`. Codes originate in core/versions.ts, core/createServer.ts
 * and core/net.ts; keep this in sync when a new `throw new Error(...)` is added.
 */
export function createErrorKey(error: string): string | null {
  const e = error.trim()
  if (
    e === 'no-build' ||
    e === 'no-download' ||
    e === 'no-server-jar-for-version' ||
    e === 'unknown-version' ||
    /^no-[a-z]+-build$/.test(e) // no-forge-build, no-neoforge-build, no-mohist-build
  ) {
    return 'wizard.errNoBuild'
  }
  if (e.startsWith('empty-download')) return 'wizard.errEmptyDownload'
  if (e.startsWith('Checksum mismatch')) return 'wizard.errChecksum'
  if (e.startsWith('HTTP ')) return 'wizard.errNetwork'
  if (e.startsWith('installer exited')) return 'wizard.errInstaller'
  if (e === 'installer-args-not-found') return 'wizard.errNoLauncher'
  if (e === 'folder-exists') return 'wizard.errFolderExists'
  if (e.startsWith('no-provider-for-')) return 'wizard.errUnsupportedType'
  return null
}

/** Server types the creation wizard can produce. */
export const CREATABLE_TYPES: ServerType[] = [
  'vanilla',
  'paper',
  'folia',
  'purpur',
  'fabric',
  'forge',
  'neoforge',
  'mohist',
  'velocity'
]

/** Types that expose a build/loader selection step. */
export const HAS_BUILDS: ServerType[] = [
  'paper',
  'folia',
  'velocity',
  'purpur',
  'fabric',
  'forge',
  'neoforge',
  'mohist'
]
