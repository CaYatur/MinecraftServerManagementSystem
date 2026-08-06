/**
 * Run every smoke gate, against the dev build or against a packaged binary.
 *
 * The packaged half is the point (#166). Gates had only ever been run with
 * `npx electron .`, so nothing looked at the thing an operator downloads —
 * and `MSMS_SMOKE_WORLDS` had been failing against every packaged build since
 * at least v0.2.5 without anyone knowing, because a packaged app is built for
 * the Windows GUI subsystem and its console output goes nowhere.
 *
 *   node scripts/gates.mjs                     the dev build
 *   node scripts/gates.mjs --packaged          the newest portable exe in release/
 *   node scripts/gates.mjs --packaged <path>   a specific binary
 *
 * The verdict is the exit code, per this project's doctrine. The transcript of
 * a failing gate is printed from `msms-data/logs/smoke.log`, which is where a
 * packaged run writes it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const GATES = [
  'MSMS_SMOKE',
  'MSMS_SMOKE_WORLDS',
  'MSMS_SMOKE_WEB',
  'MSMS_SMOKE_MODUPDATE',
  'MSMS_SMOKE_ANALYSIS',
  'MSMS_SMOKE_AUDIT',
  'MSMS_SMOKE_ALERTS',
  'MSMS_SMOKE_BRIDGE',
  'MSMS_SMOKE_EVENTS',
  'MSMS_SMOKE_METRICS',
  'MSMS_SMOKE_JAVA'
]

const root = process.cwd()
const args = process.argv.slice(2)
const packaged = args.includes('--packaged')

function newestPortable() {
  const dir = join(root, 'release')
  if (!existsSync(dir)) return null
  const hits = readdirSync(dir)
    .filter((n) => n.endsWith('-portable.exe'))
    .map((n) => join(dir, n))
  if (!hits.length) return null
  // Newest by name, which sorts by version for this project's naming.
  return hits.sort()[hits.length - 1]
}

const explicit = args.find((a) => a !== '--packaged')
const exe = packaged ? (explicit ? resolve(explicit) : newestPortable()) : null
if (packaged && !exe) {
  console.error('No packaged binary found. Build one with `npm run dist:portable` first.')
  process.exit(2)
}
if (packaged && !existsSync(exe)) {
  console.error('No such binary: ' + exe)
  process.exit(2)
}

// The gates want the pre-seeded fixture, the same one the dev run uses.
const baseDir = join(root, 'dev-root')
const transcript = join(baseDir, 'msms-data', 'logs', 'smoke.log')

console.log(packaged ? 'Gates against ' + exe : 'Gates against the dev build')
console.log('')

let failed = 0
for (const gate of GATES) {
  try {
    rmSync(transcript, { force: true })
  } catch {
    /* no transcript yet */
  }
  const env = { ...process.env, [gate]: '1', MSMS_BASE_DIR: baseDir }
  const r = packaged
    ? spawnSync(exe, [], { env, stdio: 'ignore' })
    : spawnSync('npx', ['electron', '.'], { env, stdio: 'ignore', shell: true })
  const code = r.status ?? 1
  const ok = code === 0
  if (!ok) failed++
  console.log((ok ? 'PASS  ' : 'FAIL  ') + gate + (ok ? '' : '  (exit ' + code + ')'))
  if (!ok && existsSync(transcript)) {
    // The reason, from the file — a packaged run has no console to have printed it.
    const lines = readFileSync(transcript, 'utf-8').split('\n').filter((l) => l.includes('FAIL'))
    for (const l of lines.slice(-3)) console.log('        ' + l.trim())
  }
}

console.log('')
console.log(failed ? failed + ' gate(s) failed' : 'all ' + GATES.length + ' gates passed')
process.exit(failed ? 1 : 0)
