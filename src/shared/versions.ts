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
