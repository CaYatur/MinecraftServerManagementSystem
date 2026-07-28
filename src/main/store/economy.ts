import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { storePath } from '../paths'
import { getConfig } from '../config'
import { processManager } from '../core/processManager'
import * as rcon from '../core/rcon'
import * as files from '../core/serverFiles'
import { bridgePlayers } from '@shared/bridge'
import {
  clampGrace,
  deliveryDecision,
  queueReason,
  type DeliveryInputs,
  type HoldReason
} from '@shared/delivery'
import { log } from '../logger'
import * as audit from '../core/audit'
import type { AuditSource } from '@shared/audit'
import { DEFAULT_CATEGORIES } from '@shared/economy'
import {
  DEFAULT_CRATE_ANIMATION,
  normalizeCrateAnimation,
  resolveCrateAnimation
} from '@shared/crate'
import type { CrateAnimation } from '@shared/crate'
import {
  buyBlock,
  isSafeImageSrc,
  normalizeLayout,
  sanitizeImages,
  MAX_PRODUCT_IMAGES
} from '@shared/storefront'
import type { StoreLayout } from '@shared/storefront'
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
  /** Section order on the storefront (#80). */
  layout: StoreLayout
  products: Product[]
  /** Economy categories - independent of `products` (#13). */
  categories: EconomyCategory[]
  balances: Record<string, number>
  txns: Txn[]
  /**
   * How many of each product each player has bought, ever: productId -> mcName
   * -> count (#81).
   *
   * Deliberately NOT derived from `txns`, which is trimmed to the newest 500.
   * Counting a per-player limit from a trimmed history means the limit quietly
   * stops working once a store is busy enough for old rows to fall off - which
   * is exactly the store busy enough to need it.
   */
  purchases: Record<string, Record<string, number>>
  ledger: LedgerEntry[]
  queue: QueueEntry[]
}

/**
 * A reward that has been paid for and not yet handed over (#106).
 *
 * `id` exists so a retry can remove exactly the entry it delivered: the old
 * queue was filtered by player name *before* the commands ran, so anything that
 * went wrong after that point lost the reward with no record of it.
 */
export interface QueueEntry {
  id: string
  mcName: string
  commands: string[]
  /** What to tell the player they received. */
  rewardName: string
  at: number
  /** Why it is still here. Drives the panel's pending list. */
  reason?: HoldReason
  attempts?: number
  lastTryAt?: number
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
      layout: 'crates-first',
      products: [],
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      balances: {},
      txns: [],
      purchases: {},
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
  // ...and files that predate the section layout.
  stores[serverId].layout = normalizeLayout(stores[serverId].layout)
  // ...and files that predate per-product purchase counters. Seeded from the
  // transaction history, which is the best that can be reconstructed - it is
  // trimmed, so an old store may under-count, but under-counting once at
  // migration beats a limit that keeps drifting forever.
  if (!stores[serverId].purchases) {
    const seeded: Record<string, Record<string, number>> = {}
    for (const t of stores[serverId].txns ?? []) {
      seeded[t.productId] = seeded[t.productId] ?? {}
      seeded[t.productId][t.mcName] = (seeded[t.productId][t.mcName] ?? 0) + 1
    }
    stores[serverId].purchases = seeded
  }
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
  // Deliver queued rewards when a player joins — after the grace, and only when
  // something says they are really in the world. See shared/delivery.ts.
  processManager.on('join', ({ id, name }: { id: string; name: string }) => {
    joinedAt.set(id + '|' + name, Date.now())
    void deliverQueued(id, name)
  })
}

// ---- delivery (injection-safe: only {player} is interpolated, validated) ----

/**
 * Run the reward's commands. Returns whether they were actually carried.
 *
 * The old version returned void and did nothing when neither channel was
 * available — while the caller had already removed the entry from the queue. A
 * reward could therefore be paid for, dequeued, and never given, with nothing
 * anywhere recording that it had been tried.
 */
async function runCommands(serverId: string, mcName: string, commands: string[]): Promise<boolean> {
  if (!rcon.isConnected(serverId) && !processManager.isRunning(serverId)) return false
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i].replace(/\{player\}/g, mcName)
    // `tryCommand` swallows its failure and answers null — it is the "try"
    // variant, which is right for a fire-and-forget console command and wrong
    // here. Taking a connected socket as proof the command landed reintroduces
    // exactly the bug this function was rewritten to close, one layer down: the
    // caller would dequeue a reward that RCON dropped.
    const sent = rcon.isConnected(serverId) ? (await rcon.tryCommand(serverId, cmd)) !== null : false
    if (sent) continue
    // RCON is the preferred channel, not the only one. A dropped connection to
    // a process that is still up is a reason to use stdin, not to give up.
    if (processManager.isRunning(serverId)) {
      processManager.sendCommand(serverId, cmd)
      continue
    }
    log.warn(`Store: command ${i + 1}/${commands.length} for ${mcName} could not be sent`)
    return false
  }
  return true
}

/** Tell the player what arrived. A silent `give` looks like nothing happened. */
async function announce(serverId: string, mcName: string, rewardName: string): Promise<void> {
  if (!rewardName) return
  // tellraw takes JSON, and JSON.stringify is what makes an arbitrary reward
  // name safe to put inside it. The player name is already validated.
  const json = JSON.stringify([
    { text: '[CaYaDev] ', color: 'red' },
    { text: 'Delivered: ', color: 'gray' },
    { text: rewardName, color: 'gold', bold: true }
  ])
  await runCommands(serverId, mcName, [`tellraw ${mcName} ${json}`])
}

function deliveryInputs(serverId: string, mcName: string): DeliveryInputs {
  const rt = processManager.getRuntime(serverId)
  const now = Date.now()
  const bridge = rt ? bridgePlayers(rt.bridge, now) : []
  return {
    serverRunning: processManager.isRunning(serverId),
    canSend: rcon.isConnected(serverId) || processManager.isRunning(serverId),
    playerOnline: !!rt?.players.names.includes(mcName),
    bridgeInWorld: bridge.some(
      (p) => p.name === mcName && Number.isFinite(p.x) && Number.isFinite(p.z)
    ),
    onlineMode: isOnlineMode(serverId),
    joinedAgoMs: joinedAt.get(serverId + '|' + mcName)
      ? now - (joinedAt.get(serverId + '|' + mcName) as number)
      : undefined,
    graceMs: clampGrace(getConfig().store?.deliveryGraceMs),
    holdWhenUnverified: getConfig().store?.holdUnverifiedDeliveries !== false
  }
}

/** When each player's join line was seen, so the grace can be measured. */
const joinedAt = new Map<string, number>()

/**
 * `online-mode` from server.properties, cached per server for a minute.
 *
 * Read rather than assumed: on a cracked server anyone can connect as anyone,
 * so "this name is online" proves nothing about who is holding the keyboard —
 * which is the difference between delivering and holding.
 */
const onlineModeCache = new Map<string, { value: boolean; at: number }>()

function isOnlineMode(serverId: string): boolean {
  const hit = onlineModeCache.get(serverId)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  let value = true
  try {
    const entry = files.readProperties(serverId).entries.find((e) => e.key === 'online-mode')
    // Absent means the server has not written its properties yet. Vanilla
    // defaults to true, and treating an unknown as the SAFE value here would be
    // backwards: `true` is the permissive branch.
    value = entry ? entry.value.trim().toLowerCase() !== 'false' : true
  } catch {
    value = true
  }
  onlineModeCache.set(serverId, { value, at: Date.now() })
  return value
}

export function _resetOnlineModeCache(): void {
  onlineModeCache.clear()
  joinedAt.clear()
  scheduled.clear()
}

/**
 * Deliver, or keep. Never drops.
 *
 * `queueId` is set when this is a retry of an already-queued entry, so a
 * successful run removes exactly that one and a failed run leaves it where it
 * was — the ordering the old code had backwards.
 */
async function attemptDelivery(
  serverId: string,
  entry: QueueEntry,
  source: 'purchase' | 'join' | 'manual'
): Promise<boolean> {
  const key = serverId + '|' + entry.id
  // A retry timer owns this entry until it fires. Without the guard, persisting
  // a waiting reward (below) would make it visible to `deliverQueued`, and a
  // join arriving mid-grace would run the same commands a second time.
  if (scheduled.has(key)) return false
  const decision = deliveryDecision(deliveryInputs(serverId, entry.mcName))
  // Persist BEFORE anything else, for every decision that is not a hand-over.
  // A reward that exists only inside a setTimeout closure is lost if the app
  // quits during the grace — a window the grace deliberately makes as long as a
  // login plugin needs.
  const pending = queueReason(decision)
  if (pending) holdInQueue(serverId, entry, pending)
  if (decision.action === 'wait') {
    scheduled.add(key)
    setTimeout(() => {
      scheduled.delete(key)
      void attemptDelivery(serverId, entry, source)
    }, decision.ms)
    return false
  }
  if (decision.action === 'hold') return false
  const ran = await runCommands(serverId, entry.mcName, entry.commands)
  if (!ran) {
    // The channel closed between the decision and the send.
    holdInQueue(serverId, entry, 'server-down')
    return false
  }
  removeFromQueue(serverId, entry.id)
  await announce(serverId, entry.mcName, entry.rewardName)
  audit.record({
    source: 'system',
    action: 'store.deliver',
    actor: entry.mcName,
    ok: true,
    serverId,
    target: entry.rewardName || entry.id,
    detail: source
  })
  log.info(`Store: delivered "${entry.rewardName}" to ${entry.mcName} (${source})`)
  return true
}

/**
 * Entries with a retry timer pending. In memory only, and deliberately so: it
 * is the *timer* that is not durable, and after a restart there is no timer, so
 * a persisted `just-joined` entry must be free for the next join to pick up.
 */
const scheduled = new Set<string>()

function holdInQueue(serverId: string, entry: QueueEntry, reason: HoldReason): void {
  const st = getStore(serverId)
  const existing = st.queue.find((q) => q.id === entry.id)
  if (existing) {
    existing.reason = reason
    existing.attempts = (existing.attempts ?? 0) + 1
    existing.lastTryAt = Date.now()
  } else {
    st.queue.push({ ...entry, reason, attempts: 1, lastTryAt: Date.now() })
  }
  save()
  const verb = reason === 'just-joined' ? 'waiting to deliver' : 'holding'
  log.info(`Store: ${verb} "${entry.rewardName}" for ${entry.mcName} (${reason})`)
}

function removeFromQueue(serverId: string, id: string): void {
  const st = getStore(serverId)
  const before = st.queue.length
  st.queue = st.queue.filter((q) => q.id !== id)
  if (st.queue.length !== before) save()
}

async function deliverQueued(serverId: string, mcName: string): Promise<void> {
  const st = stores[serverId]
  if (!st?.queue.length) return
  // A copy: `attemptDelivery` mutates the queue as it goes.
  for (const entry of st.queue.filter((q) => q.mcName === mcName)) {
    await attemptDelivery(serverId, entry, 'join')
  }
}

/** Rewards waiting for this server, newest first. Drives the panel's list. */
export function pendingDeliveries(serverId: string): QueueEntry[] {
  return [...getStore(serverId).queue].sort((a, b) => b.at - a.at)
}

/**
 * Operator override: hand it over now, whatever the decision function thinks.
 *
 * The escape hatch that makes holding acceptable. Without it, a cracked server
 * with no bridge would accumulate rewards nobody could release.
 */
export async function releaseDelivery(
  serverId: string,
  queueId: string,
  by: string
): Promise<{ ok: boolean; error?: string }> {
  const entry = getStore(serverId).queue.find((q) => q.id === queueId)
  if (!entry) return { ok: false, error: 'not-found' }
  const ran = await runCommands(serverId, entry.mcName, entry.commands)
  if (!ran) return { ok: false, error: 'server-down' }
  removeFromQueue(serverId, queueId)
  await announce(serverId, entry.mcName, entry.rewardName)
  audit.record({
    source: 'panel',
    action: 'store.deliver',
    actor: by,
    ok: true,
    serverId,
    target: entry.rewardName || queueId,
    detail: 'released manually for ' + entry.mcName
  })
  return { ok: true }
}

function rollCrate(rewards: CrateReward[]): CrateReward {
  const total = rewards.reduce((s, r) => s + Math.max(0, r.weight), 0)
  // An all-zero pool used to fall through the loop every time and land on the
  // last reward - 10000 out of 10000 rolls - while `publicRewards` published it
  // as an even split. Publishing odds the roll does not honour is worse than
  // publishing none, so the degenerate case is now an even split for real. It
  // is also what an operator who has not filled the weights in yet expects.
  if (total <= 0) return rewards[Math.floor(Math.random() * rewards.length)]
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
  // Availability before money (#81). A hidden product is not "sold out" and not
  // "too expensive" - as far as a buyer is concerned it does not exist, which
  // is also why it is checked server-side rather than hidden in CSS.
  const block = buyBlock(p, ownedCount(st, mcName, p.id))
  if (block) return { ok: false, error: block === 'hidden' ? 'no-product' : block }
  const bal = st.balances[mcName] ?? 0
  if (bal < p.price) return { ok: false, error: 'insufficient', balance: bal }

  // Atomic deduct — no await before this completes + persists. Stock goes in
  // the same synchronous block for the same reason: two requests arriving
  // together must not both see the last one in stock.
  st.balances[mcName] = bal - p.price
  if (typeof p.stock === 'number') p.stock = Math.max(0, p.stock - 1)
  st.purchases[p.id] = st.purchases[p.id] ?? {}
  st.purchases[p.id][mcName] = (st.purchases[p.id][mcName] ?? 0) + 1

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

  // Deliver asynchronously. The entry is built first and kept until it is
  // actually handed over: the money has already left the balance, so from here
  // on the only acceptable outcomes are "delivered" and "still owed".
  void attemptDelivery(
    serverId,
    { id: randomUUID(), mcName, commands, rewardName: reward.name, at: Date.now() },
    'purchase'
  )
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
function toPublic(p: Product, storeDefault: CrateAnimation, owned?: number): ProductPublic {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    description: p.description,
    price: p.price,
    icon: p.icon,
    ...(p.images?.length ? { images: p.images } : {}),
    ...(typeof p.stock === 'number' ? { stock: p.stock } : {}),
    ...(typeof p.perPlayerLimit === 'number' ? { perPlayerLimit: p.perPlayerLimit } : {}),
    ...(owned !== undefined ? { owned } : {}),
    ...(typeof p.sort === 'number' ? { sort: p.sort } : {}),
    ...(p.type === 'crate'
      ? {
          rewards: publicRewards(p.rewards),
          crateAnimation: resolveCrateAnimation(p, storeDefault)
        }
      : {})
  }
}
/**
 * @param mcName the signed-in buyer, when there is one. Only used to fill in
 * how many of each product they already own, so the storefront can grey out a
 * per-player limit that has been reached instead of failing the purchase.
 */
export function publicStore(serverId: string, mcName?: string): StorePublic {
  const st = getStore(serverId)
  return {
    currency: st.currency,
    layout: st.layout,
    // Hidden products are dropped here, at the boundary. Filtering them in the
    // UI would still ship the name, price and reward list of something the
    // operator has not launched yet - and leave the id buyable.
    products: st.products
      .filter((p) => !p.hidden)
      .map((p) => toPublic(p, st.crateAnimation, mcName ? ownedCount(st, mcName, p.id) : undefined)),
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
  return {
    currency: st.currency,
    products: st.products,
    crateAnimation: st.crateAnimation,
    layout: st.layout
  }
}
export function setStoreLayout(serverId: string, layout: unknown): StoreLayout {
  const st = getStore(serverId)
  st.layout = normalizeLayout(layout)
  save()
  return st.layout
}

/** How many of this product `mcName` has already bought, ever (#81). */
function ownedCount(st: StoreState, mcName: string, productId: string): number {
  return st.purchases[productId]?.[mcName] ?? 0
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
    // Any store-scoped web user can set these, and they render for every
    // visitor. One chokepoint for both admin UIs; a refused source is dropped
    // rather than rejecting the whole save, so a bad icon does not cost the
    // operator the rest of their edit.
    icon: isSafeImageSrc(product.icon) ? product.icon : '',
    commands: Array.isArray(product.commands) ? product.commands : [],
    rewards: Array.isArray(product.rewards) ? product.rewards : [],
    // Only a crate carries one, and only when it was actually set. Storing an
    // explicit value for "inherit" would freeze this crate to whatever the
    // store default happens to be today, so changing the default later would
    // silently stop affecting it.
    ...(product.type === 'crate' && product.crateAnimation
      ? { crateAnimation: normalizeCrateAnimation(product.crateAnimation) }
      : {}),
    ...(product.images?.length ? { images: sanitizeImages(product.images, MAX_PRODUCT_IMAGES) } : {}),
    ...(product.hidden ? { hidden: true } : {}),
    // `undefined` is "unlimited" and 0 is "sold out" - two different things, so
    // this cannot collapse to a truthiness check.
    ...(product.stock === undefined || product.stock === null
      ? {}
      : { stock: Math.max(0, Math.floor(Number(product.stock)) || 0) }),
    ...(product.perPlayerLimit === undefined || product.perPlayerLimit === null
      ? {}
      : { perPlayerLimit: Math.max(0, Math.floor(Number(product.perPlayerLimit)) || 0) }),
    ...(typeof product.sort === 'number' && Number.isFinite(product.sort)
      ? { sort: Math.floor(product.sort) }
      : {})
  }
  clean.rewards = clean.rewards.map((r) => ({
    ...r,
    icon: isSafeImageSrc(r.icon) ? r.icon : ''
  }))
  const i = st.products.findIndex((x) => x.id === clean.id)
  if (i >= 0) st.products[i] = clean
  else st.products.push(clean)
  save()
  return clean
}
export function deleteProduct(serverId: string, productId: string): void {
  const st = getStore(serverId)
  st.products = st.products.filter((p) => p.id !== productId)
  // The counters go with it. A new product would never reuse the id, so keeping
  // them is dead weight that grows forever. The ledger and txn history still
  // record that the purchase happened - this is a cache of "how many", not the
  // record of "what happened".
  delete st.purchases[productId]
  save()
}
/**
 * Write the audit entry for a balance change (#68).
 *
 * Recorded here rather than at the two call sites, because this is the only
 * place that knows what actually happened: `addBalance` clamps at zero, so an
 * admin asking to remove 500 from a balance of 300 removes 300, and an audit
 * entry claiming 500 would be wrong.
 *
 * The ledger keeps its own copy and is NOT replaced. The two answer different
 * questions - the ledger is per-server balance history that renders without a
 * join, the audit trail is the global record of privileged actions - and #68 is
 * a discoverability gap, not an attribution one.
 */
function auditBalance(
  serverId: string,
  source: AuditSource,
  actor: string,
  mcName: string,
  kind: 'grant' | 'remove' | 'set',
  delta: number,
  balanceAfter: number,
  reason: string
): void {
  audit.record({
    source,
    action: 'balance.' + kind,
    actor,
    target: mcName,
    serverId,
    ok: true,
    detail:
      (delta >= 0 ? '+' : '') + delta + ' -> ' + balanceAfter + (reason ? ' (' + reason + ')' : '')
  })
}

/**
 * A refused change is worth recording too: an admin action aimed at a name that
 * is not a valid Minecraft username is either a typo or someone probing.
 */
function auditBalanceRefused(
  serverId: string,
  source: AuditSource,
  actor: string,
  mcName: string,
  kind: 'grant' | 'remove' | 'set',
  why: string
): void {
  audit.record({
    source,
    action: 'balance.' + kind,
    actor,
    target: mcName,
    serverId,
    ok: false,
    detail: why
  })
}

/**
 * Who is changing a balance, and from where.
 *
 * An options object rather than four trailing positionals so that `by` and
 * `source` are both **required and named**. They are the two fields an audit
 * entry cannot be reconstructed without, and a silently wrong audit entry is
 * worse than a missing one - a default for `source` would let any future caller
 * that forgets be recorded as the desktop operator.
 */
export interface BalanceChange {
  /** Actor as the ledger records it: 'desktop', a web username, or 'key:<label>'. */
  by: string
  /** Which surface the change came from. */
  source: AuditSource
  reason?: string
  category?: string
}

/** Add (or, with a negative amount, remove) balance. Audited. */
export function addBalance(
  serverId: string,
  mcName: string,
  amount: number,
  who: BalanceChange
): number {
  const { by, source, reason = '', category } = who
  const kind = Math.floor(amount) < 0 ? 'remove' : 'grant'
  if (!MC_NAME.test(mcName)) {
    auditBalanceRefused(serverId, source, by, mcName, kind, 'invalid-mcname')
    throw new Error('invalid-mcname')
  }
  const st = getStore(serverId)
  const before = st.balances[mcName] ?? 0
  const delta = Math.floor(amount)
  st.balances[mcName] = Math.max(0, before + delta)
  const applied = st.balances[mcName] - before
  pushLedger(st, {
    mcName,
    delta: applied,
    balanceAfter: st.balances[mcName],
    reason,
    by,
    kind,
    ...cat(st, category)
  })
  save()
  auditBalance(serverId, source, by, mcName, kind, applied, st.balances[mcName], reason)
  return st.balances[mcName]
}

/** Set an absolute balance. Audited. */
export function setBalance(
  serverId: string,
  mcName: string,
  amount: number,
  who: BalanceChange
): number {
  const { by, source, reason = '', category } = who
  if (!MC_NAME.test(mcName)) {
    auditBalanceRefused(serverId, source, by, mcName, 'set', 'invalid-mcname')
    throw new Error('invalid-mcname')
  }
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
  auditBalance(serverId, source, by, mcName, 'set', st.balances[mcName] - before, st.balances[mcName], reason)
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
