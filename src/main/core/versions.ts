import { httpJson, httpText, cached } from './net'
import type { ServerType } from '@shared/types'
import type { McVersion, BuildInfo } from '@shared/versions'

export interface ResolvedDownload {
  url: string
  fileName: string
  sha256?: string
  sha1?: string
  /** installer jars must be run with `--installServer` before use (Forge/NeoForge). */
  installer: boolean
  javaMajorMin?: number
}

export interface VersionProvider {
  listVersions(includeUnstable: boolean): Promise<McVersion[]>
  listBuilds(mc: string, includeUnstable: boolean): Promise<BuildInfo[]>
  resolve(mc: string, build?: string): Promise<ResolvedDownload>
}

/** Rough Java requirement per Minecraft version. */
export function mcJavaMajor(mc: string): number {
  const m = mc.match(/^1\.(\d+)(?:\.(\d+))?/)
  if (!m) return 17
  const minor = parseInt(m[1], 10)
  const patch = parseInt(m[2] ?? '0', 10)
  if (minor >= 21) return 21
  if (minor === 20 && patch >= 5) return 21
  if (minor >= 18) return 17
  if (minor === 17) return 16
  return 8
}

const isPre = (v: string): boolean => /-(rc|pre|snapshot|exp)/i.test(v)

// ---------------- Vanilla (Mojang) ----------------
interface MojangManifest {
  latest: { release: string; snapshot: string }
  versions: { id: string; type: string; url: string }[]
}
const MOJANG = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'

const vanilla: VersionProvider = {
  async listVersions(incl) {
    const m = await cached('vanilla-manifest', () => httpJson<MojangManifest>(MOJANG))
    return m.versions
      .filter((v) => incl || v.type === 'release')
      .map((v) => ({ id: v.id, stable: v.type === 'release' }))
  },
  async listBuilds() {
    return []
  },
  async resolve(mc) {
    const m = await cached('vanilla-manifest', () => httpJson<MojangManifest>(MOJANG))
    const entry = m.versions.find((v) => v.id === mc)
    if (!entry) throw new Error('unknown-version')
    const detail = await httpJson<{
      downloads?: { server?: { url: string; sha1: string } }
      javaVersion?: { majorVersion: number }
    }>(entry.url)
    const dl = detail.downloads?.server
    if (!dl) throw new Error('no-server-jar-for-version')
    return {
      url: dl.url,
      fileName: 'server.jar',
      sha1: dl.sha1,
      installer: false,
      javaMajorMin: detail.javaVersion?.majorVersion ?? mcJavaMajor(mc)
    }
  }
}

// ---------------- PaperMC family (paper / folia / velocity) via Fill v3 ----------------
function paperMc(project: string): VersionProvider {
  const BASE = `https://fill.papermc.io/v3/projects/${project}`
  return {
    async listVersions(incl) {
      const data = await cached(`${project}-project`, () =>
        httpJson<{ versions: Record<string, string[]> }>(BASE)
      )
      const all = Object.values(data.versions).flat()
      return all
        .filter((v) => incl || !isPre(v))
        .map((v) => ({ id: v, stable: !isPre(v) }))
    },
    async listBuilds(mc, incl) {
      const builds = await httpJson<{ id: number; channel: string }[]>(
        `${BASE}/versions/${mc}/builds`
      )
      return builds
        .filter((b) => incl || b.channel === 'STABLE')
        .map((b) => ({ id: String(b.id), stable: b.channel === 'STABLE', note: b.channel }))
    },
    async resolve(mc, build) {
      const builds = await httpJson<
        {
          id: number
          channel: string
          downloads: Record<string, { name: string; url: string; checksums?: { sha256?: string } }>
        }[]
      >(`${BASE}/versions/${mc}/builds`)
      const b = build
        ? builds.find((x) => String(x.id) === build)
        : builds.find((x) => x.channel === 'STABLE') ?? builds[0]
      if (!b) throw new Error('no-build')
      const d = b.downloads['server:default'] ?? Object.values(b.downloads)[0]
      if (!d) throw new Error('no-download')
      return {
        url: d.url,
        fileName: d.name,
        sha256: d.checksums?.sha256,
        installer: false,
        javaMajorMin: mcJavaMajor(mc)
      }
    }
  }
}

// ---------------- Purpur ----------------
const PURPUR = 'https://api.purpurmc.org/v2/purpur'
const purpur: VersionProvider = {
  async listVersions() {
    const d = await cached('purpur-root', () => httpJson<{ versions: string[] }>(PURPUR))
    return d.versions
      .slice()
      .reverse()
      .map((v) => ({ id: v, stable: true }))
  },
  async listBuilds(mc) {
    const d = await httpJson<{ builds: { all: string[] } }>(`${PURPUR}/${mc}`)
    return d.builds.all
      .slice()
      .reverse()
      .map((b) => ({ id: b, stable: true }))
  },
  async resolve(mc, build) {
    const d = await httpJson<{ builds: { latest: string } }>(`${PURPUR}/${mc}`)
    const b = build || d.builds.latest
    return {
      url: `${PURPUR}/${mc}/${b}/download`,
      fileName: `purpur-${mc}-${b}.jar`,
      installer: false,
      javaMajorMin: mcJavaMajor(mc)
    }
  }
}

// ---------------- Fabric ----------------
const FABRIC = 'https://meta.fabricmc.net/v2'
const fabric: VersionProvider = {
  async listVersions(incl) {
    const d = await cached('fabric-game', () =>
      httpJson<{ version: string; stable: boolean }[]>(`${FABRIC}/versions/game`)
    )
    return d.filter((v) => incl || v.stable).map((v) => ({ id: v.version, stable: v.stable }))
  },
  async listBuilds(_mc, incl) {
    const d = await cached('fabric-loader', () =>
      httpJson<{ version: string; stable: boolean }[]>(`${FABRIC}/versions/loader`)
    )
    return d
      .filter((l) => incl || l.stable)
      .map((l) => ({ id: l.version, stable: l.stable, note: 'loader' }))
  },
  async resolve(mc, build) {
    const loaders = await httpJson<{ version: string; stable: boolean }[]>(
      `${FABRIC}/versions/loader`
    )
    const loader = build || loaders.find((l) => l.stable)?.version || loaders[0].version
    const installers = await httpJson<{ version: string; stable: boolean }[]>(
      `${FABRIC}/versions/installer`
    )
    const installer = installers.find((i) => i.stable)?.version || installers[0].version
    return {
      url: `${FABRIC}/versions/loader/${mc}/${loader}/${installer}/server/jar`,
      fileName: 'fabric-server-launch.jar',
      installer: false,
      javaMajorMin: mcJavaMajor(mc)
    }
  }
}

// ---------------- Forge (installer) ----------------
function parseMavenVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
}
const FORGE_META = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
const forge: VersionProvider = {
  async listVersions() {
    const versions = await cached('forge-versions', async () =>
      parseMavenVersions(await httpText(FORGE_META))
    )
    const seen = new Set<string>()
    const out: McVersion[] = []
    for (const full of versions.slice().reverse()) {
      const mc = full.split('-')[0]
      if (!seen.has(mc)) {
        seen.add(mc)
        out.push({ id: mc, stable: true })
      }
    }
    return out
  },
  async listBuilds(mc) {
    const versions = await cached('forge-versions', async () =>
      parseMavenVersions(await httpText(FORGE_META))
    )
    return versions
      .filter((f) => f.split('-')[0] === mc)
      .reverse()
      .map((f) => ({ id: f.split('-').slice(1).join('-'), stable: true }))
  },
  async resolve(mc, build) {
    const versions = await cached('forge-versions', async () =>
      parseMavenVersions(await httpText(FORGE_META))
    )
    const matching = versions.filter((f) => f.split('-')[0] === mc)
    const full = build ? `${mc}-${build}` : matching[matching.length - 1]
    if (!full) throw new Error('no-forge-build')
    return {
      url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
      fileName: `forge-${full}-installer.jar`,
      installer: true,
      javaMajorMin: mcJavaMajor(mc)
    }
  }
}

// ---------------- NeoForge (installer) ----------------
const NEOFORGE_META =
  'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
function neoforgeMc(ver: string): string {
  const m = ver.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return 'unknown'
  return m[2] === '0' ? `1.${m[1]}` : `1.${m[1]}.${m[2]}`
}
const neoforge: VersionProvider = {
  async listVersions(incl) {
    const versions = await cached('neoforge-versions', async () =>
      parseMavenVersions(await httpText(NEOFORGE_META))
    )
    const seen = new Set<string>()
    const out: McVersion[] = []
    for (const ver of versions.slice().reverse()) {
      if (!incl && /-beta/i.test(ver)) continue
      const mc = neoforgeMc(ver)
      if (mc !== 'unknown' && !seen.has(mc)) {
        seen.add(mc)
        out.push({ id: mc, stable: true })
      }
    }
    return out
  },
  async listBuilds(mc, incl) {
    const versions = await cached('neoforge-versions', async () =>
      parseMavenVersions(await httpText(NEOFORGE_META))
    )
    return versions
      .filter((v) => neoforgeMc(v) === mc && (incl || !/-beta/i.test(v)))
      .reverse()
      .map((v) => ({ id: v, stable: !/-beta/i.test(v), note: /-beta/i.test(v) ? 'beta' : undefined }))
  },
  async resolve(mc, build) {
    const versions = await cached('neoforge-versions', async () =>
      parseMavenVersions(await httpText(NEOFORGE_META))
    )
    const matching = versions.filter((v) => neoforgeMc(v) === mc)
    const ver = build || matching[matching.length - 1]
    if (!ver) throw new Error('no-neoforge-build')
    return {
      url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`,
      fileName: `neoforge-${ver}-installer.jar`,
      installer: true,
      javaMajorMin: mcJavaMajor(mc)
    }
  }
}

// ---------------- Mohist ----------------
const MOHIST = 'https://mohistmc.com/api/v2/projects/mohist'
interface MohistBuild {
  number: number
  fileSha256?: string
  url: string
}
const mohist: VersionProvider = {
  async listVersions() {
    const d = await cached('mohist-projects', () =>
      httpJson<{ project: string; versions: string[] }[]>('https://mohistmc.com/api/v2/projects')
    )
    const mo = d.find((p) => p.project === 'mohist')
    return (mo?.versions ?? [])
      .slice()
      .reverse()
      .map((v) => ({ id: v, stable: true }))
  },
  async listBuilds(mc) {
    const d = await httpJson<{ builds: MohistBuild[] }>(`${MOHIST}/${mc}/builds`)
    return d.builds
      .slice()
      .reverse()
      .map((b) => ({ id: String(b.number), stable: true }))
  },
  async resolve(mc, build) {
    const d = await httpJson<{ builds: MohistBuild[] }>(`${MOHIST}/${mc}/builds`)
    const b = build
      ? d.builds.find((x) => String(x.number) === build)
      : d.builds[d.builds.length - 1]
    if (!b) throw new Error('no-mohist-build')
    return {
      url: b.url,
      fileName: `mohist-${mc}-${b.number}.jar`,
      sha256: b.fileSha256,
      installer: false,
      javaMajorMin: mcJavaMajor(mc)
    }
  }
}

const PROVIDERS: Partial<Record<ServerType, VersionProvider>> = {
  vanilla,
  paper: paperMc('paper'),
  folia: paperMc('folia'),
  velocity: paperMc('velocity'),
  purpur,
  fabric,
  forge,
  neoforge,
  mohist
}

export function getProvider(type: ServerType): VersionProvider {
  const p = PROVIDERS[type]
  if (!p) throw new Error(`no-provider-for-${type}`)
  return p
}

export function hasProvider(type: ServerType): boolean {
  return !!PROVIDERS[type]
}
