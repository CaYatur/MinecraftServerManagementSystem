import type { JavaArgsConfig, JavaPreset, ServerType } from '@shared/types'
import { PROXY_TYPES } from '@shared/types'

/**
 * Aikar's flags — the community-standard G1GC tuning for Minecraft servers.
 * https://docs.papermc.io/paper/aikars-flags
 */
export const AIKARS_BASE = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
  '-Dusing.aikars.flags=https://mcflags.emc.gs',
  '-Daikars.new.flags=true'
]

/** Heap-region sizing differs for large (>12GB) heaps per Aikar's guidance. */
function aikarsSizing(large: boolean): string[] {
  return large
    ? [
        '-XX:G1NewSizePercent=40',
        '-XX:G1MaxNewSizePercent=50',
        '-XX:G1HeapRegionSize=16M',
        '-XX:G1ReservePercent=15',
        '-XX:InitiatingHeapOccupancyPercent=20'
      ]
    : [
        '-XX:G1NewSizePercent=30',
        '-XX:G1MaxNewSizePercent=40',
        '-XX:G1HeapRegionSize=8M',
        '-XX:G1ReservePercent=20',
        '-XX:InitiatingHeapOccupancyPercent=15'
      ]
}

const clampMem = (mb: number): number => Math.max(512, Math.floor(mb) || 512)

/** Split a command-ish string into tokens, honouring double/single quotes. */
export function tokenize(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3])
  }
  return out
}

/**
 * Build the full argument list that follows the `java` executable, i.e. JVM flags
 * + `-jar <jar>` + program args. For the `custom` preset the user's string is the
 * complete definition and is used verbatim.
 */
export function buildLaunchArgs(cfg: JavaArgsConfig, type: ServerType): string[] {
  if (cfg.preset === 'custom') {
    return [...tokenize(cfg.customArgs), ...tokenize(cfg.extraFlags)]
  }

  const max = clampMem(cfg.maxMemoryMB)
  const isProxy = PROXY_TYPES.includes(type)
  const jvm: string[] = []

  switch (cfg.preset) {
    case 'aikars':
    case 'aikars-large': {
      const large = cfg.preset === 'aikars-large' || max >= 12288
      // Aikar recommends Xms == Xmx.
      jvm.push(`-Xms${max}M`, `-Xmx${max}M`, ...AIKARS_BASE, ...aikarsSizing(large))
      break
    }
    case 'proxy': {
      const min = clampMem(cfg.minMemoryMB || 512)
      jvm.push(
        `-Xms${min}M`,
        `-Xmx${max}M`,
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=100'
      )
      break
    }
    case 'basic':
    default: {
      const min = clampMem(cfg.minMemoryMB || max)
      jvm.push(`-Xms${min}M`, `-Xmx${max}M`)
      break
    }
  }

  if (cfg.extraFlags.trim()) jvm.push(...tokenize(cfg.extraFlags))

  jvm.push('-jar', cfg.jarFile || 'server.jar')

  const program: string[] = []
  if (cfg.nogui && !isProxy) program.push('nogui')
  return [...jvm, ...program]
}

export const PRESET_LABELS: Record<JavaPreset, string> = {
  basic: 'Basic (Xms/Xmx only)',
  aikars: "Aikar's Flags (recommended)",
  'aikars-large': "Aikar's Flags — large heap (>12GB)",
  proxy: 'Proxy (Velocity/BungeeCord)',
  custom: 'Custom'
}
