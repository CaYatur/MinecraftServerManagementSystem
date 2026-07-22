import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, statSync, readdirSync, rmSync } from 'node:fs'
import { join, extname } from 'node:path'
import { siteConfigPath, uploadsDir } from '../paths'
import { getServer } from '../core/serverRegistry'
import { processManager } from '../core/processManager'
import { log } from '../logger'
import type { PublicSite, SiteConfig, SitePost } from '@shared/web'

const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MAX_IMG = 4 * 1024 * 1024

let site: SiteConfig | null = null

function defaults(): SiteConfig {
  return {
    serverId: '',
    siteName: 'My Minecraft Server',
    tagline: 'Join the adventure',
    description: 'Welcome to our community. Connect and play with us!',
    accent: '#dc2727',
    discordUrl: '',
    showStore: true,
    posts: []
  }
}

function load(): SiteConfig {
  try {
    if (existsSync(siteConfigPath())) {
      site = { ...defaults(), ...(JSON.parse(readFileSync(siteConfigPath(), 'utf-8')) as Partial<SiteConfig>) }
    } else {
      site = defaults()
    }
  } catch {
    site = defaults()
  }
  return site
}
function save(): void {
  if (!site) return
  const p = siteConfigPath()
  writeFileSync(p + '.tmp', JSON.stringify(site, null, 2), 'utf-8')
  renameSync(p + '.tmp', p)
}
export function initSite(): void {
  load()
}
function get(): SiteConfig {
  return site ?? load()
}

export function getSiteConfig(): SiteConfig {
  return get()
}

export function setSiteConfig(patch: Partial<SiteConfig>): SiteConfig {
  const s = get()
  if (patch.serverId !== undefined) s.serverId = patch.serverId
  if (patch.siteName !== undefined) s.siteName = patch.siteName.slice(0, 80)
  if (patch.tagline !== undefined) s.tagline = patch.tagline.slice(0, 120)
  if (patch.description !== undefined) s.description = patch.description.slice(0, 2000)
  if (patch.accent !== undefined && /^#[0-9a-fA-F]{6}$/.test(patch.accent)) s.accent = patch.accent
  if (patch.discordUrl !== undefined) s.discordUrl = patch.discordUrl.slice(0, 200)
  if (patch.showStore !== undefined) s.showStore = !!patch.showStore
  save()
  return s
}

export function upsertPost(post: Partial<SitePost>): SitePost {
  const s = get()
  const clean: SitePost = {
    id: post.id || randomUUID(),
    title: (post.title || 'Untitled').slice(0, 140),
    body: (post.body || '').slice(0, 8000),
    image: post.image,
    at: post.at || Date.now()
  }
  const i = s.posts.findIndex((p) => p.id === clean.id)
  if (i >= 0) s.posts[i] = clean
  else s.posts.unshift(clean)
  save()
  return clean
}
export function deletePost(id: string): void {
  const s = get()
  s.posts = s.posts.filter((p) => p.id !== id)
  save()
}

/** Copy an image from disk into uploads (raster only, size-capped). Returns filename. */
export function saveImage(sourcePath: string): string {
  const ext = extname(sourcePath).toLowerCase()
  if (!RASTER.has(ext)) throw new Error('unsupported-image-type')
  if (statSync(sourcePath).size > MAX_IMG) throw new Error('image-too-large')
  const name = randomUUID() + ext
  copyFileSync(sourcePath, join(uploadsDir(), name))
  return name
}
export function listUploads(): string[] {
  try {
    return readdirSync(uploadsDir()).filter((f) => RASTER.has(extname(f).toLowerCase()))
  } catch {
    return []
  }
}
export function deleteUpload(name: string): void {
  if (/[\\/]/.test(name)) return
  try {
    rmSync(join(uploadsDir(), name), { force: true })
  } catch {
    /* ignore */
  }
}

export function publicSite(): PublicSite {
  const s = get()
  const server = s.serverId ? getServer(s.serverId) : undefined
  const rt = s.serverId ? processManager.getRuntime(s.serverId) : undefined
  const st = s.serverId ? processManager.getStatus(s.serverId) : undefined
  return {
    siteName: s.siteName,
    tagline: s.tagline,
    description: s.description,
    accent: s.accent,
    discordUrl: s.discordUrl,
    showStore: s.showStore && !!server,
    status: {
      running: st?.status === 'running',
      online: rt?.players.online ?? 0,
      max: rt?.players.max ?? 0,
      serverName: server?.name ?? '',
      version: server?.mcVersion ?? ''
    },
    posts: s.posts
  }
}

export function siteServerId(): string {
  return get().serverId
}
