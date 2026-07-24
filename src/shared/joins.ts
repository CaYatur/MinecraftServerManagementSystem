/**
 * Join / alt-account aggregation — "who joined, from which names and IPs, and
 * how many accounts share an address".
 *
 * This is deliberately a *derived* view, not a new store: the source of truth is
 * the existing `player.join` event (see main/core/events.ts), which already
 * carries the player name and, when known, the connecting IP. We never re-record
 * that data — the main side reads join events back out and this pure module folds
 * them into two cross-referenced tables (by account, by IP) so the desktop Audit
 * view can surface alt-account clusters (one IP, several names) at a glance.
 *
 * Pure — a list of records in, one aggregate out, no clock and no I/O — so the
 * whole thing is smoke-testable off a hand-laid history.
 */

/** One join, projected out of a `player.join` event. */
export interface JoinRecord {
  player: string
  /** The connecting address, when the server line exposed it. */
  ip?: string
  ts: number
  /** Which MSMS-managed server it joined. */
  serverId?: string
}

/** Everything one account (player name) did, across servers. */
export interface AccountActivity {
  player: string
  /** Distinct IPs it connected from, most-recently-seen first. */
  ips: string[]
  joins: number
  firstTs: number
  lastTs: number
  /** Distinct servers it joined. */
  servers: string[]
}

/** Everything seen from one address — several accounts here means alts. */
export interface IpActivity {
  ip: string
  /** Distinct account names from this IP, most-recently-seen first. */
  accounts: string[]
  joins: number
  firstTs: number
  lastTs: number
}

export interface JoinQuery {
  from?: number
  to?: number
  /** Case-insensitive substring on a player name or an IP. */
  text?: string
  /** Only surface IPs shared by at least this many distinct accounts. */
  minAccountsPerIp?: number
}

export interface JoinAggregate {
  /** By account, most-recently-active first. */
  accounts: AccountActivity[]
  /** By IP, most-recently-active first. */
  ips: IpActivity[]
  /** Distinct accounts overall. */
  accountCount: number
  /** Total joins folded in. */
  totalJoins: number
  /** Joins that carried an IP (the rest can't be attributed to an address). */
  knownIpJoins: number
  /** IPs used by more than one account — the alt-cluster count. */
  altGroups: number
}

function ci(hay: string | undefined, needle: string): boolean {
  return !!hay && hay.toLowerCase().includes(needle)
}

/**
 * Distinct keys of a "key -> last-seen-ts" map, most recent first. Used to turn
 * the running last-seen tables into stable, recency-ordered display lists.
 */
function byRecency(seen: Map<string, number>): string[] {
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

interface AccAcc {
  player: string
  ipSeen: Map<string, number>
  serverSeen: Map<string, number>
  joins: number
  firstTs: number
  lastTs: number
}
interface IpAcc {
  ip: string
  accSeen: Map<string, number>
  joins: number
  firstTs: number
  lastTs: number
}

/**
 * Fold join records into the by-account and by-IP tables. Records with no player
 * name are skipped; records with no IP still count toward the account totals but
 * can't be attributed to an address.
 */
export function aggregateJoins(records: JoinRecord[], q: JoinQuery = {}): JoinAggregate {
  const from = q.from ?? 0
  const to = q.to ?? Number.MAX_SAFE_INTEGER
  const needle = q.text?.trim().toLowerCase() ?? ''
  const minAcc = Math.max(1, q.minAccountsPerIp ?? 1)

  const accMap = new Map<string, AccAcc>()
  const ipMap = new Map<string, IpAcc>()
  let totalJoins = 0
  let knownIpJoins = 0

  for (const r of records) {
    if (!r.player || typeof r.ts !== 'number') continue
    if (r.ts < from || r.ts > to) continue
    totalJoins++

    let a = accMap.get(r.player)
    if (!a) {
      a = { player: r.player, ipSeen: new Map(), serverSeen: new Map(), joins: 0, firstTs: r.ts, lastTs: r.ts }
      accMap.set(r.player, a)
    }
    a.joins++
    a.firstTs = Math.min(a.firstTs, r.ts)
    a.lastTs = Math.max(a.lastTs, r.ts)
    if (r.serverId) a.serverSeen.set(r.serverId, Math.max(a.serverSeen.get(r.serverId) ?? 0, r.ts))

    if (r.ip) {
      knownIpJoins++
      a.ipSeen.set(r.ip, Math.max(a.ipSeen.get(r.ip) ?? 0, r.ts))
      let ip = ipMap.get(r.ip)
      if (!ip) {
        ip = { ip: r.ip, accSeen: new Map(), joins: 0, firstTs: r.ts, lastTs: r.ts }
        ipMap.set(r.ip, ip)
      }
      ip.joins++
      ip.firstTs = Math.min(ip.firstTs, r.ts)
      ip.lastTs = Math.max(ip.lastTs, r.ts)
      ip.accSeen.set(r.player, Math.max(ip.accSeen.get(r.player) ?? 0, r.ts))
    }
  }

  // altGroups is a property of the whole dataset, counted before the display
  // filters below narrow things down.
  let altGroups = 0
  for (const ip of ipMap.values()) if (ip.accSeen.size > 1) altGroups++

  const matchesAccount = (a: AccAcc): boolean => {
    if (needle && !(ci(a.player, needle) || [...a.ipSeen.keys()].some((ip) => ci(ip, needle)))) return false
    return true
  }
  const matchesIp = (ip: IpAcc): boolean => {
    if (ip.accSeen.size < minAcc) return false
    if (needle && !(ci(ip.ip, needle) || [...ip.accSeen.keys()].some((n) => ci(n, needle)))) return false
    return true
  }

  const accounts: AccountActivity[] = [...accMap.values()].filter(matchesAccount).map((a) => ({
    player: a.player,
    ips: byRecency(a.ipSeen),
    joins: a.joins,
    firstTs: a.firstTs,
    lastTs: a.lastTs,
    servers: byRecency(a.serverSeen)
  }))
  const ips: IpActivity[] = [...ipMap.values()].filter(matchesIp).map((ip) => ({
    ip: ip.ip,
    accounts: byRecency(ip.accSeen),
    joins: ip.joins,
    firstTs: ip.firstTs,
    lastTs: ip.lastTs
  }))

  accounts.sort((x, y) => y.lastTs - x.lastTs)
  // Alt clusters (more shared accounts) are the point of this view, so break
  // ties on account-count before recency.
  ips.sort((x, y) => y.accounts.length - x.accounts.length || y.lastTs - x.lastTs)

  return {
    accounts,
    ips,
    accountCount: accMap.size,
    totalJoins,
    knownIpJoins,
    altGroups
  }
}
