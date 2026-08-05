/**
 * A small pool of threads that parse region files (#160).
 *
 * A region costs about 1.4 s after #157, and it was being spent on the thread
 * that answers every IPC call, serves the web panel and reads the console.
 * Slicing made that interruptible, not free: four cold regions still measured
 * six seconds, of which three quarters of a second was the politeness gap
 * between them — a gap that exists only because the parse was in the way.
 *
 * Off-thread there is nothing to be polite to, and the parses run at once.
 *
 * Small on purpose. This is a server manager, and the machine's cores belong to
 * the Minecraft server it is running, not to drawing its map.
 */
import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { textureColourEpoch, textureColours_ } from '@shared/regionFormat'
import { log } from '../logger'
import type { TileJob, TileJobResult } from './tileWorker'

/** Half the cores, at least one, never more than four. */
export function poolSize(): number {
  const n = Math.floor((cpus()?.length ?? 2) / 2)
  return Math.max(1, Math.min(4, n))
}

interface Slot {
  worker: Worker
  /** Which colour table this thread has been given. -1 = none yet. */
  epoch: number
  busy: boolean
}

interface Waiting {
  path: string
  dim: string
  resolve: (r: TileJobResult) => void
}

let slots: Slot[] = []
const queue: Waiting[] = []
const inFlight = new Map<number, (r: TileJobResult) => void>()
let nextId = 1
let broken = false

/**
 * Where the worker bundle is.
 *
 * electron-vite emits it beside the main bundle, so it is a sibling of
 * `__dirname` in both dev and a packaged build. Resolved rather than imported:
 * a static import would pull the worker's module graph into the main bundle,
 * which is the opposite of the point.
 */
function workerPath(): string {
  return join(__dirname, 'tileWorker.js')
}

function spawn(): Slot | null {
  try {
    const worker = new Worker(workerPath())
    const slot: Slot = { worker, epoch: -1, busy: false }
    worker.on('message', (r: TileJobResult) => {
      slot.busy = false
      const done = inFlight.get(r.id)
      inFlight.delete(r.id)
      done?.(r)
      pump()
    })
    worker.on('error', (err: Error) => {
      log.warn('Tile worker failed: ' + String(err?.message ?? err))
      slot.busy = false
      // A thread that died takes its job with it. Everything waiting on it is
      // answered as unreadable rather than left hanging — a map that draws
      // nothing is recoverable, a promise that never settles is not.
      for (const [id, done] of inFlight) {
        inFlight.delete(id)
        done({ id, buf: null, mtimeMs: 0, chunks: 0, error: 'worker-died' })
      }
      slots = slots.filter((s) => s !== slot)
      void worker.terminate()
      if (!slots.length) broken = true
      pump()
    })
    worker.unref()
    return slot
  } catch (err) {
    log.warn('Tile worker could not start: ' + String((err as Error)?.message ?? err))
    return null
  }
}

/**
 * Switched off, so the on-thread path can still be reached.
 *
 * An escape hatch for a machine where spawning threads is a problem, and the
 * only way the smoke can exercise the sliced parse now that the worker handles
 * it instead — a gate that cannot reach the code it asserts about is a gate
 * that has stopped asserting anything.
 */
let enabled = !process.env['MSMS_NO_TILE_WORKERS']

export function _setTileWorkersEnabled(on: boolean): void {
  enabled = on
}

/** Whether the pool can be used at all. False falls the caller back on-thread. */
export function poolReady(): boolean {
  if (!enabled || broken) return false
  if (!slots.length) {
    for (let i = 0; i < poolSize(); i++) {
      const s = spawn()
      if (s) slots.push(s)
    }
    if (!slots.length) {
      broken = true
      return false
    }
    log.info(`Tile workers: ${slots.length} thread(s) parsing regions off the main thread`)
  }
  return true
}

function pump(): void {
  for (const slot of slots) {
    if (slot.busy || !queue.length) continue
    const job = queue.shift()
    if (!job) return
    const id = nextId++
    inFlight.set(id, job.resolve)
    slot.busy = true
    const epoch = textureColourEpoch()
    const msg: TileJob = { id, path: job.path, dim: job.dim, colourEpoch: epoch }
    // Sent only when this thread's copy is out of date — the table is about a
    // thousand entries and re-cloning it for every region would cost more than
    // some of the parses do.
    if (slot.epoch !== epoch) {
      msg.colours = textureColours_()
      slot.epoch = epoch
    }
    slot.worker.postMessage(msg)
  }
}

/** Parse one region on a worker. Rejects nothing; failure comes back as `error`. */
export function parseOnWorker(path: string, dim: string): Promise<TileJobResult> {
  return new Promise((resolve) => {
    queue.push({ path, dim, resolve })
    pump()
  })
}

/** How many jobs are waiting or running. The warmer reads this to stay behind. */
export function poolBacklog(): number {
  return queue.length + inFlight.size
}

export async function stopTileWorkers(): Promise<void> {
  const all = slots
  slots = []
  queue.length = 0
  await Promise.all(all.map((s) => s.worker.terminate()))
}

// A packaged app that quits with threads alive can leave the process resident.
app?.on?.('before-quit', () => void stopTileWorkers())
