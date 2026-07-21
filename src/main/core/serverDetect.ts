import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerType } from '@shared/types'

export interface DetectResult {
  isServer: boolean
  type: ServerType
  mcVersion: string
  jarFile: string
}

export function listJars(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar'))
  } catch {
    return []
  }
}

/** Pull a Minecraft version like 1.20.4 / 1.21 out of an arbitrary string. */
export function guessVersion(s: string): string {
  const m = s.match(/\b1\.(\d{1,2})(?:\.(\d{1,2}))?\b/)
  return m ? m[0] : 'unknown'
}

function readVersionHistory(dir: string): string {
  // Paper/Purpur/Folia write version_history.json: "... (MC: 1.20.4)"
  const p = join(dir, 'version_history.json')
  if (!existsSync(p)) return 'unknown'
  try {
    const j = JSON.parse(readFileSync(p, 'utf-8')) as { currentVersion?: string }
    const mc = j.currentVersion?.match(/MC:\s*([\d.]+)/)
    if (mc) return mc[1]
  } catch {
    /* ignore */
  }
  return 'unknown'
}

const TYPE_KEYWORDS: [ServerType, string[]][] = [
  ['purpur', ['purpur']],
  ['folia', ['folia']],
  ['paper', ['paper']],
  ['spigot', ['spigot']],
  ['mohist', ['mohist']],
  ['arclight', ['arclight']],
  ['neoforge', ['neoforge']],
  ['forge', ['forge']],
  ['quilt', ['quilt-server', 'quilt']],
  ['fabric', ['fabric-server', 'fabric']],
  ['velocity', ['velocity']],
  ['waterfall', ['waterfall']],
  ['bungeecord', ['bungeecord', 'bungee']]
]

export function detectServer(dir: string): DetectResult {
  const has = (p: string): boolean => existsSync(join(dir, p))
  const jars = listJars(dir)
  const lower = jars.map((j) => j.toLowerCase())

  const findJar = (kw: string): string | undefined => {
    const i = lower.findIndex((j) => j.includes(kw))
    return i >= 0 ? jars[i] : undefined
  }

  let type: ServerType = 'unknown'
  let jarFile = ''

  for (const [t, kws] of TYPE_KEYWORDS) {
    const jar = kws.map(findJar).find(Boolean)
    if (jar) {
      type = t
      jarFile = jar
      break
    }
  }

  // Filesystem markers when there's no obvious jar name (modern Forge/NeoForge
  // ship no runnable server-*.jar; they launch via @args files + run scripts).
  if (type === 'unknown') {
    if (has('libraries/net/neoforged')) type = 'neoforge'
    else if (has('libraries/net/minecraftforge')) type = 'forge'
    else if (has('fabric-server-launch.jar') || has('.fabric')) type = 'fabric'
    else if (has('libraries/com/mohistmc')) type = 'mohist'
  }

  // Plain server.jar => vanilla (unless a mod loader marker said otherwise).
  if (type === 'unknown') {
    const serverJar = findJar('server') || (jars.length === 1 ? jars[0] : undefined)
    if (serverJar) {
      type = 'vanilla'
      jarFile = serverJar
    }
  }

  if (!jarFile) {
    jarFile = findJar('server') || jars[0] || ''
  }

  // Version resolution.
  let mcVersion = readVersionHistory(dir)
  if (mcVersion === 'unknown' && jarFile) mcVersion = guessVersion(jarFile)
  if (mcVersion === 'unknown') {
    const anyJar = jars.map(guessVersion).find((v) => v !== 'unknown')
    if (anyJar) mcVersion = anyJar
  }

  const isServer =
    has('server.properties') ||
    has('eula.txt') ||
    has('libraries') ||
    jars.length > 0 ||
    type !== 'unknown'

  return { isServer, type, mcVersion, jarFile }
}
