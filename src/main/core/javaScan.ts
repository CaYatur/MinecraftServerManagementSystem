/**
 * Find every Java installed on this machine.
 *
 * `detectJava` (./java.ts) answers "which java do I launch with"; this answers
 * "which ones exist", so the user can pick one per server instead of typing a
 * path. Nothing is installed or downloaded - only what is already there is
 * reported.
 *
 * Every candidate is probed by actually running `java -version`: registry
 * entries and stale folders lie, a process that prints its version does not.
 */
import { existsSync, readdirSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { javaExecutable, probeJava } from './java'
import { resolveBaseDir } from '../paths'
import { log } from '../logger'
import type { JavaInstall } from '@shared/types'

/** Folders that hold one JDK each, e.g. `C:\Program Files\Java\jdk-21`. */
function vendorRoots(): string[] {
  const roots: string[] = []
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local')
    for (const base of [pf, pf86]) {
      roots.push(
        join(base, 'Java'),
        join(base, 'Eclipse Adoptium'),
        join(base, 'Eclipse Foundation'),
        join(base, 'AdoptOpenJDK'),
        join(base, 'Amazon Corretto'),
        join(base, 'Microsoft'),
        join(base, 'Zulu'),
        join(base, 'BellSoft'),
        join(base, 'RedHat'),
        join(base, 'SapMachine'),
        join(base, 'Semeru')
      )
    }
    roots.push(join(local, 'Programs', 'Eclipse Adoptium'))
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines', join(homedir(), 'Library/Java/JavaVirtualMachines'))
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', '/opt/java', '/opt/jdk', join(homedir(), '.sdkman/candidates/java'))
  }
  // A JDK shipped beside the portable app, so a USB stick can be self-contained.
  roots.push(join(resolveBaseDir(), 'runtime'), join(resolveBaseDir(), 'java'))
  return roots
}

/** On macOS the executable lives under `Contents/Home`. */
function homesUnder(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => join(root, d.name))
  } catch {
    return []
  }
  if (process.platform !== 'darwin') return entries
  return entries.map((e) => (existsSync(join(e, 'Contents', 'Home')) ? join(e, 'Contents', 'Home') : e))
}

function sameFile(a: string, b: string): boolean {
  const norm = (p: string): string => {
    let r = p
    try {
      r = realpathSync(p)
    } catch {
      /* keep the literal path */
    }
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(a) === norm(b)
}

/**
 * Probe every candidate, keeping the first working path for each real
 * executable. `source` records why a Java was offered, which is what makes
 * the list understandable rather than a wall of paths.
 */
export async function scanJavaInstalls(): Promise<JavaInstall[]> {
  const candidates: Array<{ path: string; source: JavaInstall['source'] }> = []
  const push = (p: string, source: JavaInstall['source']): void => {
    if (p && existsSync(p)) candidates.push({ path: p, source })
  }

  if (process.env.JAVA_HOME) push(javaExecutable(process.env.JAVA_HOME), 'JAVA_HOME')
  for (const root of vendorRoots()) {
    for (const home of homesUnder(root)) push(javaExecutable(home), 'installed')
  }

  const found: JavaInstall[] = []
  for (const c of candidates) {
    if (found.some((f) => sameFile(f.path, c.path))) continue
    const info = await probeJava(c.path)
    if (info) found.push({ ...info, source: c.source })
  }

  // Whatever `java` resolves to on PATH, but only if it is not already listed.
  try {
    const onPath = await probeJava('java')
    if (onPath && !found.some((f) => f.major === onPath.major && f.version === onPath.version)) {
      found.push({ ...onPath, source: 'PATH' })
    }
  } catch {
    /* no java on PATH is a normal state */
  }

  found.sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))
  log.info(`Java scan: ${found.length} installation(s) found`)
  return found
}

let cache: JavaInstall[] | null = null

/** Cached because the scan spawns a process per candidate. */
export async function listJavaInstalls(refresh = false): Promise<JavaInstall[]> {
  if (!cache || refresh) cache = await scanJavaInstalls()
  return cache
}

/** Test helper: drop the cache. */
export function _resetJavaCache(): void {
  cache = null
}
