/**
 * A worker thread that turns one region file into encoded tiles (#160).
 *
 * Deliberately tiny, and deliberately importing only `regionParse` — anything
 * that reaches for Electron, the server registry or the app paths would drag
 * the main process's world in here, and there is no main process here.
 *
 * THE COLOUR TABLE. `blockColour` reads module-level state that the main
 * process fills at runtime from the operator's client jar, and a worker starts
 * with it empty. A worker that parsed without it would render the fallback
 * palette, and the caller would write those colours into the on-disk cache,
 * where they would outlive the process and keep serving a wrong map with a
 * cache version that still matched. So a job carries the table whenever the
 * pool believes this worker's copy is stale, and refuses to parse until it has
 * been given one at least once.
 */
import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { parentPort } from 'node:worker_threads'
import { setTextureColours } from '@shared/regionFormat'
import type { Rgb } from '@shared/regionFormat'
import { encodeRegionTiles } from '@shared/tileCache'
import { parseRegionBuffer } from './regionParse'
import type { ChunkTile } from './regionParse'

export interface TileJob {
  id: number
  path: string
  dim: string
  /** Present only when the pool thinks this worker's table is out of date. */
  colours?: Record<string, Rgb>
  colourEpoch: number
}

export interface TileJobResult {
  id: number
  /** gzipped `encodeRegionTiles` output, or null when there was nothing to read. */
  buf: Uint8Array | null
  mtimeMs: number
  chunks: number
  error?: string
}

/** -1 until the pool has sent one, which is what makes "never given" detectable. */
let epoch = -1

function run(job: TileJob): TileJobResult {
  if (job.colours) {
    setTextureColours(job.colours)
    epoch = job.colourEpoch
  }
  if (epoch !== job.colourEpoch) {
    // The pool got the bookkeeping wrong. Refusing is the only safe answer: a
    // parse now would look identical and be quietly the wrong colours.
    return { id: job.id, buf: null, mtimeMs: 0, chunks: 0, error: 'stale-colours' }
  }
  let mtimeMs = 0
  let file: Buffer
  try {
    mtimeMs = statSync(job.path).mtimeMs
    file = readFileSync(job.path)
  } catch {
    return { id: job.id, buf: null, mtimeMs: 0, chunks: 0, error: 'unreadable' }
  }
  const tiles = parseRegionBuffer(file, job.dim)
  const usable = new Map<number, ChunkTile>()
  for (const [slot, tile] of tiles) if (tile) usable.set(slot, tile)
  // Encoded and gzipped HERE, on this thread. The alternative is posting a Map
  // of 1024 objects across the thread boundary, where structured clone would
  // rebuild every one of them on the main thread — which is the work this is
  // supposed to be taking off it.
  const buf = gzipSync(encodeRegionTiles({ mtimeMs, tiles: usable }), { level: 6 })
  return { id: job.id, buf, mtimeMs, chunks: usable.size }
}

parentPort?.on('message', (job: TileJob) => {
  try {
    parentPort?.postMessage(run(job))
  } catch (err) {
    parentPort?.postMessage({
      id: job.id,
      buf: null,
      mtimeMs: 0,
      chunks: 0,
      error: String((err as Error)?.message ?? err)
    } satisfies TileJobResult)
  }
})
