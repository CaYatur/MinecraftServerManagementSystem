import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { JavaInfo } from '@shared/types'

const execFileAsync = promisify(execFile)

const JAVA_BIN = process.platform === 'win32' ? 'java.exe' : 'java'

/** Turn a java home OR a direct java path into an executable path. */
export function javaExecutable(base: string): string {
  if (!base) return 'java'
  if (base.endsWith('java') || base.endsWith('java.exe')) return base
  return join(base, 'bin', JAVA_BIN)
}

function parseVersion(text: string): { version: string; major: number } | null {
  // Matches: version "1.8.0_401"  |  version "17.0.9"  |  version "21"
  const m = text.match(/version\s+"([^"]+)"/i)
  if (!m) return null
  const raw = m[1]
  let major: number
  if (raw.startsWith('1.')) {
    major = parseInt(raw.split('.')[1], 10) // 1.8 => 8
  } else {
    major = parseInt(raw.split('.')[0], 10) // 21.0.1 => 21
  }
  return { version: raw, major: Number.isFinite(major) ? major : 0 }
}

export async function probeJava(candidate: string): Promise<JavaInfo | null> {
  try {
    // `java -version` prints to stderr on virtually every JDK.
    const { stdout, stderr } = await execFileAsync(candidate, ['-version'], {
      timeout: 8000
    })
    const parsed = parseVersion(stderr || stdout)
    if (!parsed) return null
    return { path: candidate, version: parsed.version, major: parsed.major }
  } catch {
    return null
  }
}

/**
 * Resolve the best Java executable:
 *   1. explicit override (config / server setting)
 *   2. JAVA_HOME
 *   3. `java` on PATH
 */
export async function detectJava(override?: string): Promise<JavaInfo | null> {
  const candidates: string[] = []
  if (override && override.trim()) candidates.push(javaExecutable(override.trim()))
  if (process.env.JAVA_HOME) {
    const jh = javaExecutable(process.env.JAVA_HOME)
    if (existsSync(jh)) candidates.push(jh)
  }
  candidates.push('java')

  for (const c of candidates) {
    const info = await probeJava(c)
    if (info) return info
  }
  return null
}
