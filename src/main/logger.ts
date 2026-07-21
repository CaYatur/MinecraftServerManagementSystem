import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { logsDir } from './paths'

type Level = 'debug' | 'info' | 'warn' | 'error'

function write(level: Level, args: unknown[]): void {
  const ts = new Date().toISOString()
  const msg = args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ')
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](line)
  try {
    appendFileSync(join(logsDir(), 'msms.log'), line + '\n')
  } catch {
    /* logging must never throw */
  }
}

function safeStringify(v: unknown): string {
  try {
    if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack ?? ''}`
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export const log = {
  debug: (...a: unknown[]) => write('debug', a),
  info: (...a: unknown[]) => write('info', a),
  warn: (...a: unknown[]) => write('warn', a),
  error: (...a: unknown[]) => write('error', a)
}
