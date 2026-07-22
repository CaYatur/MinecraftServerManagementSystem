import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import pidusage from 'pidusage'
import { getConfig } from '../config'
import { getServer, touchServer } from './serverRegistry'
import { detectJava, javaExecutable } from './java'
import { buildLaunchArgs } from './javaArgs'
import { mt } from '../i18n'
import { log } from '../logger'
import { TPS_TYPES } from '@shared/types'
import type {
  LogLine,
  LogStream,
  ServerConfig,
  ServerRuntimeStatus,
  ServerStatus,
  StopOptions
} from '@shared/types'

const HISTORY_CAP = 3000
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface ManagedProcess {
  id: string
  child: ChildProcess
  status: ServerStatus
  startedAt: number
  pid?: number
  stopRequested: boolean
  restartAfterStop: boolean
  restartOpts?: StopOptions
  history: LogLine[]
  stdoutBuf: string
  stderrBuf: string
  exitCode: number | null
  exitResolvers: Array<() => void>
  players: { online: number; max: number; names: string[] }
  tps: number | null
}

let lineCounter = 0

export class ProcessManager extends EventEmitter {
  private procs = new Map<string, ManagedProcess>()

  constructor() {
    super()
    this.setMaxListeners(50)
    // Poll CPU/RAM for running servers and emit stats.
    setInterval(() => void this.pollStats(), 2000)
  }

  private statsErrLogged = false
  private async pollStats(): Promise<void> {
    for (const mp of this.procs.values()) {
      if (mp.status !== 'running' && mp.status !== 'starting') continue
      const pid = mp.child?.pid
      if (!pid) continue
      try {
        const u = await pidusage(pid)
        this.emit('stats', {
          id: mp.id,
          cpu: Math.round(u.cpu),
          memoryMB: Math.round(u.memory / (1024 * 1024)),
          players: mp.players,
          tps: mp.tps,
          uptimeMs: Date.now() - mp.startedAt
        })
      } catch (err) {
        if (!this.statsErrLogged) {
          this.statsErrLogged = true
          log.warn('pidusage failed:', err)
        }
      }
    }
  }

  isRunning(id: string): boolean {
    const mp = this.procs.get(id)
    return !!mp && (mp.status === 'running' || mp.status === 'starting' || mp.status === 'stopping')
  }

  getStatus(id: string): ServerRuntimeStatus {
    const mp = this.procs.get(id)
    if (!mp) return { id, status: 'stopped' }
    return {
      id,
      status: mp.status,
      pid: mp.pid,
      startedAt: mp.startedAt,
      exitCode: mp.exitCode
    }
  }

  getAllStatus(): ServerRuntimeStatus[] {
    return [...this.procs.keys()].map((id) => this.getStatus(id))
  }

  getLogHistory(id: string): LogLine[] {
    return this.procs.get(id)?.history ?? []
  }

  getRuntime(id: string): ManagedProcess | undefined {
    return this.procs.get(id)
  }

  private emitStatus(mp: ManagedProcess): void {
    this.emit('status', this.getStatus(mp.id))
  }

  private pushLog(mp: ManagedProcess, text: string, stream: LogStream): void {
    const line: LogLine = {
      id: `${Date.now()}-${lineCounter++}`,
      ts: Date.now(),
      line: text,
      stream
    }
    mp.history.push(line)
    if (mp.history.length > HISTORY_CAP) mp.history.splice(0, mp.history.length - HISTORY_CAP)
    this.emit('log', { serverId: mp.id, line })
  }

  private systemLine(mp: ManagedProcess, text: string): void {
    this.pushLog(mp, text, 'system')
  }

  private consumeStream(mp: ManagedProcess, chunk: Buffer, stream: 'stdout' | 'stderr'): void {
    const key = stream === 'stdout' ? 'stdoutBuf' : 'stderrBuf'
    mp[key] += chunk.toString('utf-8')
    let idx: number
    while ((idx = mp[key].indexOf('\n')) >= 0) {
      const raw = mp[key].slice(0, idx).replace(/\r$/, '')
      mp[key] = mp[key].slice(idx + 1)
      this.pushLog(mp, raw, stream)
      this.inspectLine(mp, raw)
    }
  }

  /** Light log inspection for readiness + live player counts. */
  private inspectLine(mp: ManagedProcess, raw: string): void {
    if (mp.status === 'starting' && /Done \(|For help, type "help"|Listening on/.test(raw)) {
      mp.status = 'running'
      this.emitStatus(mp)
    }
    const join = raw.match(/\]: (\w{2,16}) joined the game/)
    if (join) {
      if (!mp.players.names.includes(join[1])) mp.players.names.push(join[1])
      mp.players.online = mp.players.names.length
    }
    const left = raw.match(/\]: (\w{2,16}) left the game/)
    if (left) {
      mp.players.names = mp.players.names.filter((n) => n !== left[1])
      mp.players.online = mp.players.names.length
    }
    const maxMatch = raw.match(/max(?:imum)? players.*?(\d+)/i)
    if (maxMatch) mp.players.max = parseInt(maxMatch[1], 10)
  }

  async start(id: string): Promise<void> {
    if (this.isRunning(id)) return
    const server = getServer(id)
    if (!server) throw new Error(`Server not found: ${id}`)

    const javaInfo = await detectJava(server.java.javaPath || getConfig().defaults.javaPath)
    const javaBin = javaInfo?.path ?? javaExecutable(server.java.javaPath)
    const args = buildLaunchArgs(server.java, server.type)

    // Sanity: for jar-based launch make sure the jar exists.
    if (server.java.preset !== 'custom' && !server.java.argsFile) {
      const jarPath = join(server.path, server.java.jarFile || 'server.jar')
      if (!existsSync(jarPath)) {
        const mp = this.ensureShell(id)
        this.systemLine(mp, `[MSMS] ERROR: jar not found: ${server.java.jarFile}`)
        mp.status = 'crashed'
        this.emitStatus(mp)
        throw new Error('jar-not-found')
      }
    }

    const child = spawn(javaBin, args, {
      cwd: server.path,
      windowsHide: true
    })

    const mp: ManagedProcess = {
      id,
      child,
      status: 'starting',
      startedAt: Date.now(),
      pid: child.pid,
      stopRequested: false,
      restartAfterStop: false,
      history: this.procs.get(id)?.history ?? [],
      stdoutBuf: '',
      stderrBuf: '',
      exitCode: null,
      exitResolvers: [],
      players: { online: 0, max: 0, names: [] },
      tps: null
    }
    this.procs.set(id, mp)
    touchServer(id)

    this.systemLine(mp, `[MSMS] Starting ${server.name} (${server.type} ${server.mcVersion})`)
    this.systemLine(mp, `[MSMS] Java: ${javaBin}${javaInfo ? ` (v${javaInfo.version})` : ''}`)
    this.systemLine(mp, `[MSMS] Command: java ${args.join(' ')}`)
    if (!javaInfo) this.systemLine(mp, `[MSMS] WARNING: could not verify Java — is it installed & on PATH?`)
    this.emitStatus(mp)

    child.stdout?.on('data', (c: Buffer) => this.consumeStream(mp, c, 'stdout'))
    child.stderr?.on('data', (c: Buffer) => this.consumeStream(mp, c, 'stderr'))

    child.on('error', (err) => {
      this.systemLine(mp, `[MSMS] Process error: ${err.message}`)
      mp.status = 'crashed'
      mp.exitCode = -1
      this.emitStatus(mp)
      this.resolveExit(mp)
    })

    child.on('exit', (code, signal) => {
      mp.exitCode = code
      const crashed = !mp.stopRequested && code !== 0 && code !== null
      mp.status = crashed ? 'crashed' : 'stopped'
      this.systemLine(
        mp,
        `[MSMS] Process exited (code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''})`
      )
      this.emitStatus(mp)
      this.resolveExit(mp)
      this.handlePostExit(mp, server, crashed)
    })
  }

  private ensureShell(id: string): ManagedProcess {
    let mp = this.procs.get(id)
    if (!mp) {
      mp = {
        id,
        child: null as unknown as ChildProcess,
        status: 'stopped',
        startedAt: 0,
        stopRequested: false,
        restartAfterStop: false,
        history: [],
        stdoutBuf: '',
        stderrBuf: '',
        exitCode: null,
        exitResolvers: [],
        players: { online: 0, max: 0, names: [] },
        tps: null
      }
      this.procs.set(id, mp)
    }
    return mp
  }

  private resolveExit(mp: ManagedProcess): void {
    const rs = mp.exitResolvers.splice(0)
    rs.forEach((r) => r())
  }

  private async handlePostExit(
    mp: ManagedProcess,
    server: ServerConfig,
    crashed: boolean
  ): Promise<void> {
    const doRestart =
      mp.restartAfterStop || (crashed && getServer(server.id)?.autoRestartOnCrash)
    mp.players = { online: 0, max: mp.players.max, names: [] }
    if (doRestart) {
      this.systemLine(mp, `[MSMS] Auto-restarting…`)
      await wait(2500)
      try {
        await this.start(server.id)
      } catch (err) {
        log.error('Auto-restart failed:', err)
      }
    }
  }

  sendCommand(id: string, command: string): void {
    const mp = this.procs.get(id)
    if (!mp || !mp.child?.stdin || mp.status === 'stopped' || mp.status === 'crashed') {
      throw new Error('server-not-running')
    }
    mp.child.stdin.write(command.endsWith('\n') ? command : command + '\n')
    this.systemLine(mp, `> ${command}`)
  }

  /** Fire-and-forget console command used internally (no system echo). */
  private write(mp: ManagedProcess, command: string): void {
    try {
      mp.child?.stdin?.write(command + '\n')
    } catch {
      /* ignore */
    }
  }

  async stop(id: string, opts: StopOptions = {}): Promise<void> {
    const mp = this.procs.get(id)
    if (!mp || !this.isRunning(id)) return
    const server = getServer(id)
    mp.stopRequested = true
    mp.restartAfterStop = !!opts.restart
    const isRestart = !!opts.restart
    const seconds = opts.immediate
      ? 0
      : opts.countdownSeconds ?? getConfig().defaults.stopCountdownSeconds

    // Localized countdown broadcast to players.
    if (seconds > 0 && mp.status === 'running') {
      const announceAt = new Set(
        [seconds, 30, 15, 10, 5, 4, 3, 2, 1].filter((s) => s <= seconds && s > 0)
      )
      let remaining = seconds
      while (remaining > 0 && this.isRunning(id)) {
        if (announceAt.has(remaining)) {
          this.write(
            mp,
            `say ${mt(isRestart ? 'broadcast.restarting' : 'broadcast.stopping', { sec: remaining })}`
          )
        }
        await wait(1000)
        remaining--
      }
    }

    if (this.isRunning(id)) {
      this.write(mp, `say ${mt(isRestart ? 'broadcast.restarting.now' : 'broadcast.stopping.now')}`)
      this.write(mp, `say ${mt('broadcast.saving')}`)
      this.write(mp, 'save-all')
      await wait(1500)
      mp.status = 'stopping'
      this.emitStatus(mp)
      this.write(mp, 'stop')
    }

    await this.waitForExit(mp, 30000)
    void server
  }

  async restart(id: string, opts: StopOptions = {}): Promise<void> {
    await this.stop(id, { ...opts, restart: true })
  }

  private waitForExit(mp: ManagedProcess, timeoutMs: number): Promise<void> {
    if (!mp.child || mp.exitCode !== null || mp.status === 'stopped' || mp.status === 'crashed') {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const to = setTimeout(() => {
        this.systemLine(mp, `[MSMS] Stop timed out — force killing.`)
        this.killTree(mp)
        resolve()
      }, timeoutMs)
      mp.exitResolvers.push(() => {
        clearTimeout(to)
        resolve()
      })
    })
  }

  private killTree(mp: ManagedProcess): void {
    const pid = mp.child?.pid
    if (!pid) return
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
    } else {
      try {
        mp.child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }
  }

  async kill(id: string): Promise<void> {
    const mp = this.procs.get(id)
    if (!mp || !this.isRunning(id)) return
    mp.stopRequested = true
    mp.restartAfterStop = false
    this.systemLine(mp, `[MSMS] Force killing server.`)
    this.killTree(mp)
    await this.waitForExit(mp, 8000)
  }

  /** Gracefully stop every running server — awaited on app quit. */
  async stopAll(): Promise<void> {
    const running = [...this.procs.keys()].filter((id) => this.isRunning(id))
    await Promise.all(
      running.map(async (id) => {
        const mp = this.procs.get(id)
        if (mp) mp.restartAfterStop = false
        await this.stop(id, { immediate: true }).catch(() => this.kill(id))
      })
    )
  }
}

export const processManager = new ProcessManager()
