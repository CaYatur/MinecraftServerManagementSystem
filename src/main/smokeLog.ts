/**
 * A smoke run's transcript, written somewhere it can be read afterwards (#166).
 *
 * The gates report by writing to the console and exiting with a code. That is
 * fine for `npx electron .`, and useless against the thing an operator actually
 * downloads: a packaged app is built for the Windows GUI subsystem, so it has
 * no console attached and every `console.log` goes nowhere. A packaged gate
 * could only ever say "1" — no assertion name, no context, nothing to act on.
 *
 * `MSMS_SMOKE_WORLDS` had been failing against the packaged build since at
 * least v0.2.5 and nobody could see why, because nobody could see anything.
 *
 * So the transcript goes to a file as well. Truncated per run, because the
 * question is always "what did THIS run say".
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logsDir } from './paths'
import { log } from './logger'

let installed = false

export function smokeLogPath(): string {
  return join(logsDir(), 'smoke.log')
}

/**
 * Mirror console output into `smoke.log`.
 *
 * Wraps rather than replaces: the dev run still prints to the terminal exactly
 * as it did, and the packaged run gains a readable record. `logger.ts` writes
 * through `console` too, so the file ends up holding the gate's own lines
 * interleaved with everything the app logged while it ran — which is the
 * context you want when a gate fails somewhere unexpected.
 */
export function teeSmokeOutput(): void {
  if (installed) return
  installed = true
  let path: string
  try {
    path = smokeLogPath()
    writeFileSync(path, `[${new Date().toISOString()}] smoke transcript\n`)
  } catch (err) {
    // No transcript is not a reason to stop the run — the exit code is still
    // the signal — but it must not be SILENT. A tee that quietly did nothing is
    // how a packaged gate stayed unreadable in the first place.
    log.warn('Smoke transcript could not be opened: ' + String((err as Error)?.message ?? err))
    return
  }
  const levels = ['log', 'info', 'warn', 'error'] as const
  for (const level of levels) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const original = (console as any)[level].bind(console)
    ;(console as any)[level] = (...args: unknown[]): void => {
      original(...args)
      try {
        appendFileSync(
          path,
          args.map((a) => (typeof a === 'string' ? a : safe(a))).join(' ') + '\n'
        )
      } catch {
        /* a transcript that cannot be written must not fail the run */
      }
    }
  }
}

function safe(v: unknown): string {
  try {
    if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ''}`
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
