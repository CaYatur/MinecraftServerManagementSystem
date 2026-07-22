import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { storePath } from '../paths'
import { processManager } from '../core/processManager'
import * as rcon from '../core/rcon'
import { log } from '../logger'
import type {
  BuyResult,
  CrateReward,
  Product,
  ProductPublic,
  StoreConfig,
  StorePublic,
  Txn
} from '@shared/web'

interface StoreState {
  currency: string
  products: Product[]
  balances: Record<string, number>
  txns: Txn[]
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
    stores[serverId] = { currency: 'Coins', products: [], balances: {}, txns: [], queue: [] }
  }
  return stores[serverId]
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
      pool: p.rewards.map((x) => ({ name: x.name, icon: x.icon }))
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
  save() // persist deduction + txn immediately

  // Deliver asynchronously (queues if the player is offline).
  void deliver(serverId, mcName, commands)
  return { ok: true, balance: st.balances[mcName], reward }
}

// ---- public / read ----
function toPublic(p: Product): ProductPublic {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    description: p.description,
    price: p.price,
    icon: p.icon,
    rewardNames: p.type === 'crate' ? p.rewards.map((r) => r.name) : undefined
  }
}
export function publicStore(serverId: string): StorePublic {
  const st = getStore(serverId)
  return { currency: st.currency, products: st.products.map(toPublic) }
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
  return { currency: st.currency, products: st.products }
}
export function setCurrency(serverId: string, currency: string): void {
  getStore(serverId).currency = currency.trim() || 'Coins'
  save()
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
    rewards: Array.isArray(product.rewards) ? product.rewards : []
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
export function addBalance(serverId: string, mcName: string, amount: number): number {
  if (!MC_NAME.test(mcName)) throw new Error('invalid-mcname')
  const st = getStore(serverId)
  st.balances[mcName] = Math.max(0, (st.balances[mcName] ?? 0) + Math.floor(amount))
  save()
  return st.balances[mcName]
}
export function listBalances(serverId: string): Record<string, number> {
  return getStore(serverId).balances
}
