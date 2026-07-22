export interface ModEntry {
  name: string
  fileName: string
  path: string // relative to server root
  enabled: boolean
  size: number
  folder: 'plugins' | 'mods'
}

export interface ModrinthHit {
  projectId: string
  slug: string
  title: string
  description: string
  downloads: number
  iconUrl?: string
}
