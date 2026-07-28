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
 * Make the server write its console in UTF-8 (#83).
 *
 * Without this, `System.out` uses the platform console code page. Measured on a
 * Turkish Windows with Temurin 21, `Çağan` came out as the cp1254 bytes
 * `C7 61 F0 61 6E` and `✅` was replaced by a literal `?` before it ever left
 * the JVM. MSMS then decodes those bytes as UTF-8 and shows mojibake - and the
 * `?` is gone for good, no decoder can bring it back.
 *
 * Four properties for two settings: `stdout.encoding`/`stderr.encoding` are the
 * names JDK 19+ documents, `sun.*` the ones JDK 18 and earlier read. Both pairs
 * are honoured on 21, and an unrecognised `-D` is just a system property nobody
 * looks at, so setting all four is safe across every JDK a server might run on.
 *
 * Deliberately NOT `-Dfile.encoding=UTF-8`: that changes the *default charset*,
 * so on JDK 17 it would also change how plugins read their own config files.
 * Fixing the console must not quietly re-encode somebody's data.
 *
 * Prepended, so a user's own `-Dstdout.encoding=...` in extra flags still wins -
 * the JVM takes the last definition on the command line.
 */
const CONSOLE_UTF8 = [
  '-Dstdout.encoding=UTF-8',
  '-Dstderr.encoding=UTF-8',
  '-Dsun.stdout.encoding=UTF-8',
  '-Dsun.stderr.encoding=UTF-8'
]

/** JVM flags only (memory + preset + extra) — no `-jar`, no program args. */
export function buildJvmFlags(cfg: JavaArgsConfig, type: ServerType): string[] {
  const max = clampMem(cfg.maxMemoryMB)
  const jvm: string[] = [...CONSOLE_UTF8]
  switch (cfg.preset) {
    case 'aikars':
    case 'aikars-large': {
      const large = cfg.preset === 'aikars-large' || max >= 12288
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
  return jvm
}

/**
 * Build the full argument list that follows the `java` executable, i.e. JVM flags
 * + (`-jar <jar>` | `@argsFile`) + program args. For the `custom` preset the user's
 * string is the complete definition and is used verbatim.
 */
export function buildLaunchArgs(cfg: JavaArgsConfig, type: ServerType): string[] {
  if (cfg.preset === 'custom') {
    // Even here, where the user's string is the whole definition. These go in
    // front of it, and the JVM takes the last definition of a property, so
    // anything they write still wins — but a custom command line should not be
    // the one place the console silently mangles Turkish.
    return [...CONSOLE_UTF8, ...tokenize(cfg.customArgs), ...tokenize(cfg.extraFlags)]
  }

  const isProxy = PROXY_TYPES.includes(type)
  const jvm = buildJvmFlags(cfg, type)
  const program: string[] = []
  if (cfg.nogui && !isProxy) program.push('nogui')

  // Forge/NeoForge 1.17+ launch via an @args file (classpath + main class inside).
  if (cfg.argsFile) {
    return [...jvm, `@${cfg.argsFile}`, ...program]
  }

  jvm.push('-jar', cfg.jarFile || 'server.jar')
  return [...jvm, ...program]
}

export const PRESET_LABELS: Record<JavaPreset, string> = {
  basic: 'Basic (Xms/Xmx only)',
  aikars: "Aikar's Flags (recommended)",
  'aikars-large': "Aikar's Flags — large heap (>12GB)",
  proxy: 'Proxy (Velocity/BungeeCord)',
  custom: 'Custom'
}
