import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { storePath } from '../paths'
import { processManager } from '../core/processManager'
import * as rcon from '../core/rcon'
import { log } from '../logger'
import { DEFAULT_CATEGORIES } from '@shared/economy'
import {
  DEFAULT_CRATE_ANIMATION,
  normalizeCrateAnimation,
  resolveCrateAnimation
} from '@shared/crate'
import type { CrateAnimation } from '@shared/crate'
import type {
  BuyResult,
  CrateReward,
  EconomyCategory,
  PublicReward,
  LedgerEntry,
  Product,
  ProductPublic,
  StoreConfig,
  StorePublic,
  Txn
} from '@shared/web'

interface StoreState {
  currency: string
  crateAnimation: CrateAnimation
  products: Product[]
  /** Economy categories - independent of `products` (#13). */
  categories: EconomyCategory[]
  balances: Record<string, number>
  txns: Txn[]
  ledger: LedgerEntry[]
  queue: { mcName: string; commands: string[]; at: number }[]
}

type AllStores = Record<string, StoreState>

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/
let stores: AllStores = {}

function load(): void {
  try {
    stores = existsSync(storePath()) ? (JSON.parse(readFileSync(storePath(), 'utf-8')) as AllStores) : {}
  } catch {
    stores = {}
  }
}
function save(): void {
  const p = storePath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(stores, null, 2), 'utf-8')
  renameSync(tmp, p)
}

function getStore(serverId: string): StoreState {
  if (!stores[serverId]) {
    stores[serverId] = {
      currency: 'Coins',
      crateAnimation: DEFAULT_CRATE_ANIMATION,
      products: [],
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      balances: {},
      txns: [],
      ledger: [],
      queue: []
    }
  }
  // migrate older files that predate the ledger
  if (!stores[serverId].ledger) stores[serverId].ledger = []
  // ...and files that predate economy categories. Seeded once; an operator who
  // deletes them all keeps an empty array rather than having them come back.
  if (!Array.isArray(stores[serverId].categories)) {
    stores[serverId].categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }))
  }
  // ...and files that predate configurable crate animations. Normalised on read
  // so a hand-edited json cannot leave the panel with an animation it cannot play.
  stores[serverId].crateAnimation = normalizeCrateAnimation(stores[serverId].crateAnimation)
  return stores[serverId]
}

function pushLedger(
  st: StoreState,
  entry: Omit<LedgerEntry, 'id' | 'at'>
): void {
  st.ledger.unshift({ ...entry, id: randomUUID(), at: Date.now() })
  if (st.ledger.length > 1000) st.ledger.length = 1000
}

export function initEconomy(): void {
  load()
  // Deliver queued rewards when a player joins.
  processManager.on('join', ({ id, name }: { id: string; name: string }) => {
    void deliverQueued(id, name)
  })
}

// ---- delivery (injection-safe: only {player} is interpolated, validated) ----
async function runCommands(serverId: string, mcName: string, commands: string[]): Promise<void> {
  for (const c of commands) {
    const cmd = c.replace(/\{player\}/g, mcName)
    if (rcon.isConnected(serverId)) await rcon.tryCommand(serverId, cmd)
    else if (processManager.isRunning(serverId)) processManager.sendCommand(serverId, cmd)
  }
}

async function deliver(serverId: string, mcName: string, commands: string[]): Promise<void> {
  const online = processManager.getRuntime(serverId)?.players.names.includes(mcName)
  if (processManager.isRunning(serverId) && online) {
    await runCommands(serverId, mcName, commands)
  } else {
    const st = getStore(serverId)
    st.queue.push({ mcName, commands, at: Date.now() })
    save()
    log.info(`Store: queued delivery for offline ${mcName}`)
  }
}

async function deliverQueued(serverId: string, mcName: string): Promise<void> {
  const st = stores[serverId]
  if (!st || st.queue.length === 0) return
  const mine = st.queue.filter((q) => q.mcName === mcName)
  if (mine.length === 0) return
  st.queue = st.queue.filter((q) => q.mcName !== mcName)
  save()
  // brief delay so the player is fully connected
  await new Promise((r) => setTimeout(r, 1500))
  for (const q of mine) await runCommands(serverId, mcName, q.commands)
  log.info(`Store: delivered ${mine.length} queued reward(s) to ${mcName}`)
}

function rollCrate(rewards: CrateReward[]): CrateReward {
  const total = rewards.reduce((s, r) => s + Math.max(0, r.weight), 0) || 1
  let roll = Math.random() * total
  for (const r of rewards) {
    roll -= Math.max(0, r.weight)
    if (roll <= 0) return r
  }
  return rewards[rewards.length - 1]
}

// ---- purchase (deduct BEFORE any await = atomic in single-threaded Node) ----
export function purchase(serverId: string, mcName: string, productId: string): BuyResult {
  if (!MC_NAME.test(mcName)) return { ok: false, error: 'invalid-mcname' }
  const st = getStore(serverId)
  const p = st.products.find((x) => x.id === productId)
  if (!p) return { ok: false, error: 'no-product' }
  const bal = st.balances[mcName] ?? 0
  if (bal < p.price) return { ok: false, error: 'insufficient', balance: bal }

  // Atomic deduct — no await before this completes + persists.
  st.balances[mcName] = bal - p.price

  let commands: string[]
  let reward: BuyResult['reward']
  if (p.type === 'crate') {
    const r = rollCrate(p.rewards)
    commands = r.commands
    reward = {
      name: r.name,
      icon: r.icon,
      crate: true,
      pool: p.rewards.map((x) => ({ name: x.name, icon: x.icon })),
      // Resolved here, not in the client: the buyer only ever receives the
      // reward, never the product it came from, so a per-crate animation has
      // no way to reach the code that plays it unless it rides along (#75).
      animation: resolveCrateAnimation(p, st.crateAnimation)
    }
  } else {
    commands = p.commands
    reward = { name: p.name, icon: p.icon, crate: false }
  }

  st.txns.unshift({
    id: randomUUID(),
    mcName,
    productId: p.id,
    productName: p.name,
    price: p.price,
    reward: reward.name,
    at: Date.now()
  })
  if (st.txns.length > 500) st.txns.length = 500
  pushLedger(st, {
    mcName,
    delta: -p.price,
    balanceAfter: st.balances[mcName],
    reason: p.name,
    by: 'purchase',
    kind: 'purchase'
  })
  save() // persist deduction + txn immediately

  // Deliver asynchronously (queues if the player is offline).
  void deliver(serverId, mcName, commands)
  return { ok: true, balance: st.balances[mcName], reward }
}

// ---- public / read ----
/**
 * Weights to percentages (#79).
 *
 * A weight only means something next to the other weights in the same pool, so
 * the normalisation happens here rather than being pushed onto every UI that
 * wants to display it. A pool whose weights are all zero would divide by zero,
 * and is treated as an even split - which is what `rollCrate` effectively does
 * with it anyway.
 */
function publicRewards(rewards: CrateReward[]): PublicReward[] {
  const total = rewards.reduce((s, r) => s + Math.max(0, r.weight), 0)
  return rewards.map((r) => ({
    name: r.name,
    ...(r.icon ? { icon: r.icon } : {}),
    chancePct:
      total > 0
        ? Math.round((Math.max(0, r.weight) / total) * 1000) / 10
        : Math.round((100 / rewards.length) * 10) / 10
  }))
}

/**
 * The buyer-facing shape. This function is the ONLY boundary between the store
 * config and anything a player can read, so the one rule it must never break is
 * that `CrateReward.commands` does not cross it - a reward's commands are
 * console commands, and publishing them tells every visitor exactly what to ask
 * a compromised account to run. Fields are listed explicitly rather than spread
 * for that reason: a new field on `Product` must be opted in, not leaked by
 * default.
 */
function toPublic(p: Product, storeDefault: CrateAnimation): ProductPublic {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    description: p.description,
    price: p.price,
    icon: p.icon,
    ...(p.type === 'crate'
      ? {
          rewards: publicRewards(p.rewards),
          crateAnimation: resolveCrateAnimation(p, storeDefault)
        }
      : {})
  }
}
export function publicStore(serverId: string): StorePublic {
  const st = getStore(serverId)
  return {
    currency: st.currency,
    products: st.products.map((p) => toPublic(p, st.crateAnimation)),
    crateAnimation: st.crateAnimation
  }
}
export function getBalance(serverId: string, mcName: string): number {
  return getStore(serverId).balances[mcName] ?? 0
}
export function getTxns(serverId: string, mcName: string): Txn[] {
  return getStore(serverId).txns.filter((t) => t.mcName === mcName).slice(0, 50)
}

// ---- admin (trusted: desktop, or web users with 'store' scope) ----
export function getStoreConfig(serverId: string): StoreConfig {
  const st = getStore(serverId)
  return { currency: st.currency, products: st.products, crateAnimation: st.crateAnimation }
}
export function setCurrency(serverId: string, currency: string): void {
  getStore(serverId).currency = currency.trim() || 'Coins'
  save()
}
export function setCrateAnimation(serverId: string, animation: unknown): CrateAnimation {
  const st = getStore(serverId)
  st.crateAnimation = normalizeCrateAnimation(animation)
  save()
  return st.crateAnimation
}
export function upsertProduct(serverId: string, product: Product): Product {
  const st = getStore(serverId)
  const clean: Product = {
    id: product.id || randomUUID(),
    type: product.type === 'crate' ? 'crate' : 'item',
    name: product.name || 'Product',
    description: product.description || '',
    price: Math.max(0, Math.floor(product.price) || 0),
    icon: product.icon,
    commands: Array.isArray(product.commands) ? product.commands : [],
    rewards: Array.isArray(product.rewards) ? product.rewards : [],
    // Only a crate carries one, and only when it was actually set. Storing an
    // explicit value for "inherit" would freeze this crate to whatever the
    // store default happens to be today, so changing the default later would
    // silently stop affecting it.
    ...(product.type === 'crate' && product.crateAnimation
      ? { crateAnimation: normalizeCrateAnimation(product.crateAnimation) }
      : {})
  }
  const i = st.products.findIndex((x) => x.id === clean.id)
  if (i >= 0) st.products[i] = clean
  else st.products.push(clean)
  save()
  return clean
}
export function deleteProduct(serverId: string, productId: string): void {
  const st = getStore(serverId)
  st.products = st.products.filter((p) => p.id !== productId)
  save()
}
/** Add (or, with a negative amount, remove) balance. Audited. */
export function addBalance(
  serverId: string,
  mcName: string,
  amount: number,
  by = 'desktop',
  reason = '',
  category?: string
): number {
  if (!MC_NAME.test(mcName)) throw new Error('invalid-mcname')
  const st = getStore(serverId)
  const before = st.balances[mcName] ?? 0
  const delta = Math.floor(amount)
  st.balances[mcName] = Math.max(0, before + delta)
  pushLedger(st, {
    mcName,
    delta: st.balances[mcName] - before,
    balanceAfter: st.balances[mcName],
    reason,
    by,
    kind: delta < 0 ? 'remove' : 'grant',
    ...cat(st, category)
  })
  save()
  return st.balances[mcName]
}

/** Set an absolute balance. Audited. */
export function setBalance(
  serverId: string,
  mcName: string,
  amount: number,
  by = 'desktop',
  reason = '',
  category?: string
): number {
  if (!MC_NAME.test(mcName)) throw new Error('invalid-mcname')
  const st = getStore(serverId)
  const before = st.balances[mcName] ?? 0
  st.balances[mcName] = Math.max(0, Math.floor(amount))
  pushLedger(st, {
    mcName,
    delta: st.balances[mcName] - before,
    balanceAfter: st.balances[mcName],
    reason,
    by,
    kind: 'set',
    ...cat(st, category)
  })
  save()
  return st.balances[mcName]
}

// ---- economy categories (#13) ----

/**
 * Only a category that actually exists is recorded. A ledger entry is an audit
 * record: storing a free-string category the renderer invented would let the
 * log claim a label nothing on the server defines.
 */
function cat(st: StoreState, category?: string): { category?: string } {
  if (!category) return {}
  return st.categories.some((c) => c.id === category) ? { category } : {}
}

export function listCategories(serverId: string): EconomyCategory[] {
  return getStore(serverId).categories
}

export function upsertCategory(serverId: string, input: EconomyCategory): EconomyCategory {
  const st = getStore(serverId)
  const clean: EconomyCategory = {
    id: input.id || randomUUID(),
    name: (input.name || '').trim() || 'Category',
    ...(input.color ? { color: input.color } : {})
  }
  const i = st.categories.findIndex((c) => c.id === clean.id)
  if (i >= 0) st.categories[i] = clean
  else st.categories.push(clean)
  save()
  return clean
}

/**
 * Deleting a category does NOT rewrite history. Past ledger entries keep the
 * id they were recorded with - editing an audit trail to tidy up a dropdown is
 * exactly what an audit trail must never do. The UI falls back to showing the
 * raw id for an entry whose category is gone.
 */
export function deleteCategory(serverId: string, categoryId: string): void {
  const st = getStore(serverId)
  st.categories = st.categories.filter((c) => c.id !== categoryId)
  save()
}

export function listBalances(serverId: string): Record<string, number> {
  return getStore(serverId).balances
}

export function getLedger(serverId: string, mcName?: string, limit = 200): LedgerEntry[] {
  const l = getStore(serverId).ledger
  return (mcName ? l.filter((e) => e.mcName.toLowerCase() === mcName.toLowerCase()) : l).slice(
    0,
    limit
  )
}
