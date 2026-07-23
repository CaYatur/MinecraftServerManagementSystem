import { randomUUID } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  copyFileSync,
  statSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { join, extname } from 'node:path'
import { siteConfigPath, uploadsDir } from '../paths'
import { getServer, listServers } from '../core/serverRegistry'
import { processManager } from '../core/processManager'
import { SITE_STRINGS_EN, SITE_STRINGS_TR } from './siteI18n'
import type { PublicSite, ServerCard, SiteConfig, SitePost } from '@shared/web'

const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MAX_IMG = 6 * 1024 * 1024

let site: SiteConfig | null = null

function defaults(): SiteConfig {
  return {
    serverIds: [],
    storeServerId: '',
    siteName: 'My Minecraft Server',
    tagline: 'Join the adventure',
    description: 'Welcome to our community. Connect and play with us!',
    discordUrl: '',
    showStore: true,
    theme: {
      accent: '#dc2727',
      bg: '#0b0b10',
      card: '#16151b',
      text: '#e7e9ee',
      layout: 'modern',
      heroStyle: 'gradient',
      radius: 16
    },
    i18n: {
      defaultLang: 'en',
      langs: { en: { ...SITE_STRINGS_EN }, tr: { ...SITE_STRINGS_TR } }
    },
    posts: []
  }
}

/** Merge stored config over defaults, migrating older shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(raw: any): SiteConfig {
  const base = defaults()
  if (!raw || typeof raw !== 'object') return base
  const out: SiteConfig = {
    ...base,
    ...raw,
    theme: { ...base.theme, ...(raw.theme ?? {}) },
    i18n: {
      defaultLang: raw.i18n?.defaultLang ?? base.i18n.defaultLang,
      langs: {
        ...base.i18n.langs,
        ...(raw.i18n?.langs ?? {}),
        // built-ins always keep every key (new keys appear automatically)
        en: { ...SITE_STRINGS_EN, ...(raw.i18n?.langs?.en ?? {}) },
        tr: { ...SITE_STRINGS_TR, ...(raw.i18n?.langs?.tr ?? {}) }
      }
    },
    posts: Array.isArray(raw.posts) ? raw.posts : []
  }
  // v1 -> v2: single serverId + flat accent + post.image
  if (typeof raw.serverId === 'string' && raw.serverId) {
    if (!Array.isArray(raw.serverIds) || raw.serverIds.length === 0) out.serverIds = [raw.serverId]
    if (!raw.storeServerId) out.storeServerId = raw.serverId
  }
  if (typeof raw.accent === 'string' && !raw.theme?.accent) out.theme.accent = raw.accent
  out.serverIds = Array.isArray(out.serverIds) ? out.serverIds : []
  out.posts = out.posts.map((p: SitePost & { image?: string }) => ({
    ...p,
    images: Array.isArray(p.images) ? p.images : [],
    cover: p.cover ?? p.image
  }))
  return out
}

function load(): SiteConfig {
  try {
    site = existsSync(siteConfigPath())
      ? migrate(JSON.parse(readFileSync(siteConfigPath(), 'utf-8')))
      : defaults()
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
  if (Array.isArray(patch.serverIds)) s.serverIds = patch.serverIds
  if (patch.storeServerId !== undefined) s.storeServerId = patch.storeServerId
  if (patch.siteName !== undefined) s.siteName = patch.siteName.slice(0, 80)
  if (patch.tagline !== undefined) s.tagline = patch.tagline.slice(0, 140)
  if (patch.description !== undefined) s.description = patch.description.slice(0, 4000)
  if (patch.discordUrl !== undefined) s.discordUrl = patch.discordUrl.slice(0, 300)
  if (patch.showStore !== undefined) s.showStore = !!patch.showStore
  if (patch.theme) {
    const t = patch.theme
    const hex = (v?: string): boolean => !!v && /^#[0-9a-fA-F]{6}$/.test(v)
    if (hex(t.accent)) s.theme.accent = t.accent
    if (hex(t.bg)) s.theme.bg = t.bg
    if (hex(t.card)) s.theme.card = t.card
    if (hex(t.text)) s.theme.text = t.text
    if (t.layout) s.theme.layout = t.layout
    if (t.heroStyle) s.theme.heroStyle = t.heroStyle
    if (t.heroImage !== undefined) s.theme.heroImage = t.heroImage
    if (t.logo !== undefined) s.theme.logo = t.logo
    if (typeof t.radius === 'number') s.theme.radius = Math.max(0, Math.min(28, t.radius))
  }
  if (patch.i18n) {
    if (patch.i18n.defaultLang) s.i18n.defaultLang = patch.i18n.defaultLang
    if (patch.i18n.langs) s.i18n.langs = patch.i18n.langs
  }
  save()
  return s
}

// ---- i18n ----
export function addLanguage(code: string, copyFrom = 'en'): SiteConfig {
  const s = get()
  const c = code.trim().toLowerCase().slice(0, 12)
  if (!/^[a-z][a-z0-9_-]{1,11}$/.test(c)) throw new Error('invalid-lang-code')
  if (!s.i18n.langs[c]) s.i18n.langs[c] = { ...(s.i18n.langs[copyFrom] ?? SITE_STRINGS_EN) }
  save()
  return s
}
export function removeLanguage(code: string): SiteConfig {
  const s = get()
  if (code === 'en' || code === 'tr') throw new Error('cannot-remove-builtin')
  delete s.i18n.langs[code]
  if (s.i18n.defaultLang === code) s.i18n.defaultLang = 'en'
  save()
  return s
}
export function setLangString(code: string, key: string, value: string): void {
  const s = get()
  if (!s.i18n.langs[code]) return
  s.i18n.langs[code][key] = value.slice(0, 400)
  save()
}

// ---- posts ----
export function upsertPost(post: Partial<SitePost>, author?: string): SitePost {
  const s = get()
  const existing = post.id ? s.posts.find((p) => p.id === post.id) : undefined
  const clean: SitePost = {
    id: existing?.id || randomUUID(),
    title: (post.title || 'Untitled').slice(0, 160),
    excerpt: (post.excerpt ?? '').slice(0, 400) || undefined,
    body: (post.body || '').slice(0, 40000),
    cover: post.cover,
    images: Array.isArray(post.images) ? post.images.slice(0, 20) : (existing?.images ?? []),
    author: author ?? post.author ?? existing?.author,
    at: existing?.at ?? post.at ?? Date.now(),
    updatedAt: existing ? Date.now() : undefined
  }
  if (existing) s.posts[s.posts.findIndex((p) => p.id === clean.id)] = clean
  else s.posts.unshift(clean)
  save()
  return clean
}
export function deletePost(id: string): void {
  const s = get()
  s.posts = s.posts.filter((p) => p.id !== id)
  save()
}
export function getPost(id: string): SitePost | undefined {
  return get().posts.find((p) => p.id === id)
}

// ---- uploads ----
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

// ---- public payload ----
function card(id: string): ServerCard | null {
  const s = getServer(id)
  if (!s) return null
  const rt = processManager.getRuntime(id)
  const st = processManager.getStatus(id)
  return {
    id: s.id,
    name: s.name,
    version: s.mcVersion,
    type: s.type,
    running: st.status === 'running',
    online: rt?.players.online ?? 0,
    max: rt?.players.max ?? 0
  }
}

export function publicSite(): PublicSite {
  const s = get()
  const ids = s.serverIds.length ? s.serverIds : listServers().slice(0, 1).map((x) => x.id)
  return {
    siteName: s.siteName,
    tagline: s.tagline,
    description: s.description,
    discordUrl: s.discordUrl,
    showStore: s.showStore && !!getServer(s.storeServerId),
    theme: s.theme,
    i18n: s.i18n,
    servers: ids.map(card).filter((c): c is ServerCard => !!c),
    posts: s.posts
  }
}

export function siteServerId(): string {
  return get().storeServerId
}
