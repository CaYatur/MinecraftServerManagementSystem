import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir } from '../paths'
import { log } from '../logger'
import { checkArea, publicChunkAreas, MAX_AREAS } from '@shared/chunkAreas'
import type { AreaInput, ChunkArea, PublicChunkArea } from '@shared/chunkAreas'

/**
 * Where chunk areas live (#144).
 *
 * Their own file, keyed by server, rather than a field on `ServerConfig`. Two
 * hundred areas of sixty-four rectangles is a lot of JSON to carry inside the
 * record that is read on every server list, every status poll and every start —
 * and areas change on a completely different schedule to the rest of it.
 *
 * All the rules live in `@shared/chunkAreas`; this file is the disk and the ids.
 */

type Store = Record<string, ChunkArea[]>

let store: Store = {}
let loaded = false

function storePath(): string {
  return join(dataDir(), 'chunk-areas.json')
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    store = existsSync(storePath()) ? (JSON.parse(readFileSync(storePath(), 'utf-8')) as Store) : {}
  } catch (e) {
    log.warn('chunkAreas: could not read chunk-areas.json:', e)
    store = {}
  }
}

function save(): void {
  const p = storePath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function listAreas(serverId: string): ChunkArea[] {
  load()
  return store[serverId] ? [...store[serverId]] : []
}

/** What the public site and the map page are allowed to send a visitor. */
export function listPublicAreas(serverId: string, dim?: string): PublicChunkArea[] {
  return publicChunkAreas(listAreas(serverId), dim)
}

export function createArea(serverId: string, input: AreaInput): ChunkArea {
  load()
  const check = checkArea(input)
  if (!check.ok) throw new Error(check.error)
  const list = store[serverId] ?? []
  // A cap, because this list is sent to a public page and tested per chunk. The
  // refusal is loud rather than silently dropping the newest one.
  if (list.length >= MAX_AREAS) throw new Error('too-many-areas')
  const now = Date.now()
  const area: ChunkArea = { id: randomUUID(), ...check.value, createdAt: now, updatedAt: now }
  store[serverId] = [...list, area]
  save()
  return area
}

/**
 * Replace an area's contents. `createdAt` is kept and `updatedAt` moves, which
 * is not bookkeeping: `updatedAt` is the tie-break when two areas of equal size
 * cover one chunk, so an edit has to be visible to `areaAt`.
 */
export function updateArea(serverId: string, id: string, input: AreaInput): ChunkArea {
  load()
  const list = store[serverId] ?? []
  const i = list.findIndex((a) => a.id === id)
  if (i < 0) throw new Error('area-not-found')
  const check = checkArea(input)
  if (!check.ok) throw new Error(check.error)
  const next: ChunkArea = {
    ...list[i],
    ...check.value,
    // `checkArea` only sets `hidden` when it is true, so spreading it cannot
    // clear the flag - an area unhidden through the API would stay hidden.
    hidden: !!input.hidden,
    updatedAt: Date.now()
  }
  if (!next.hidden) delete next.hidden
  const copy = [...list]
  copy[i] = next
  store[serverId] = copy
  save()
  return next
}

export function deleteArea(serverId: string, id: string): void {
  load()
  const list = store[serverId] ?? []
  if (!list.some((a) => a.id === id)) throw new Error('area-not-found')
  store[serverId] = list.filter((a) => a.id !== id)
  save()
}

/** Called when a server is forgotten, so its areas do not outlive it on disk. */
export function forgetServerAreas(serverId: string): void {
  load()
  if (!store[serverId]) return
  delete store[serverId]
  save()
}

/** Test seam: the smoke needs a clean slate without deleting the user's file. */
export function _reset(): void {
  store = {}
  loaded = true
}
