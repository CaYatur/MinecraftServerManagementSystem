import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getServer } from './serverRegistry'
import type { CrashFinding, CrashReport } from '@shared/types'

interface Pattern {
  re: RegExp
  title: string
  suggestion: string
  severity: 'error' | 'warning' | 'info'
}

const PATTERNS: Pattern[] = [
  {
    re: /java\.lang\.OutOfMemoryError|insufficient memory|GC overhead limit exceeded/i,
    title: 'Out of memory',
    suggestion:
      'Increase max memory in Start Arguments, or lower view-distance / simulation-distance and reduce heavy plugins.',
    severity: 'error'
  },
  {
    re: /Failed to bind to port|Address already in use|Perhaps a server is already running/i,
    title: 'Port already in use',
    suggestion:
      'Another process is using this port. Change server-port in Server Properties, or stop the other server.',
    severity: 'error'
  },
  {
    re: /has been compiled by a more recent version of the Java Runtime|class file version \d+/i,
    title: 'Java too old for this server',
    suggestion: 'This build needs a newer Java. Point to a newer JDK in Settings → Java.',
    severity: 'error'
  },
  {
    re: /UnsupportedClassVersionError/i,
    title: 'Wrong Java version',
    suggestion: 'Install and select the Java version this build requires (Settings → Java).',
    severity: 'error'
  },
  {
    re: /You need to agree to the EULA/i,
    title: 'EULA not accepted',
    suggestion: 'Set eula=true (the server folder’s eula.txt) before starting.',
    severity: 'error'
  },
  {
    re: /Missing or unsupported mandatory dependencies|requires .*which is missing|Incompatible mod set|Mod .* requires/i,
    title: 'Missing / incompatible mod dependency',
    suggestion: 'Add the required dependency mod, or remove the incompatible one in Plugins / Mods.',
    severity: 'error'
  },
  {
    re: /failed to load .*region|Chunk .* is corrupt|Exception .*\.mca|Negative chunk/i,
    title: 'Possible world corruption',
    suggestion: 'Restore a recent backup, or delete the corrupted region file and let it regenerate.',
    severity: 'warning'
  },
  {
    re: /A single server tick took|Watchdog|server thread dump/i,
    title: 'Server watchdog / severe lag',
    suggestion: 'A tick took too long. Reduce entities/plugins or increase max-tick-time.',
    severity: 'warning'
  }
]

function readTail(file: string, maxBytes = 200_000): string {
  try {
    const buf = readFileSync(file)
    return buf.length > maxBytes
      ? buf.subarray(buf.length - maxBytes).toString('utf-8')
      : buf.toString('utf-8')
  } catch {
    return ''
  }
}

export function analyzeCrash(id: string): CrashReport {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')

  let source = ''
  let text = ''
  const crDir = join(server.path, 'crash-reports')
  if (existsSync(crDir)) {
    const files = readdirSync(crDir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({ f, m: statSync(join(crDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    if (files[0]) {
      source = `crash-reports/${files[0].f}`
      text = readTail(join(crDir, files[0].f))
    }
  }

  const latest = join(server.path, 'logs', 'latest.log')
  const latestText = existsSync(latest) ? readTail(latest) : ''
  if (!text) {
    source = existsSync(latest) ? 'logs/latest.log' : 'none'
    text = latestText
  }
  const haystack = text + '\n' + latestText

  const findings: CrashFinding[] = []
  for (const p of PATTERNS) {
    const m = haystack.match(p.re)
    if (m) {
      findings.push({
        severity: p.severity,
        title: p.title,
        detail: `Matched: "${m[0].slice(0, 140)}"`,
        suggestion: p.suggestion
      })
    }
  }

  if (findings.length === 0) {
    const exc = haystack.match(/^.*(?:Exception|Error|Caused by:)[^\n]*$/gm)
    if (exc?.length) {
      findings.push({
        severity: 'info',
        title: 'Unclassified error',
        detail: exc[exc.length - 1].slice(0, 220),
        suggestion: 'Review the log tail below for the full stack trace.'
      })
    }
  }

  const logTail = (text || latestText).split(/\r?\n/).slice(-140).join('\n')
  return { findings, logTail, source: source || 'none' }
}
