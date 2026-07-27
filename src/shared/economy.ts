import type { EconomyCategory, LedgerEntry } from './web'

/**
 * Seeded on first use so the feature is usable without configuration. These are
 * economy reasons, NOT store products (#13) - a payout for winning an event has
 * no product behind it, and inventing one just to label the payout is what this
 * separation exists to avoid. Fully editable afterwards.
 */
export const DEFAULT_CATEGORIES: EconomyCategory[] = [
  { id: 'reward', name: 'Reward', color: '#4ade80' },
  { id: 'event', name: 'Event payout', color: '#60a5fa' },
  { id: 'refund', name: 'Refund', color: '#fbbf24' },
  { id: 'penalty', name: 'Penalty', color: '#f87171' },
  { id: 'correction', name: 'Correction', color: '#a78bfa' }
]

/** Category name for display, falling back to the raw id for a deleted one. */
export function categoryName(categories: EconomyCategory[], id?: string): string | undefined {
  if (!id) return undefined
  return categories.find((c) => c.id === id)?.name ?? id
}

/**
 * Pure economy helpers shared by the desktop Store view and the web panel, so
 * the two surfaces cannot disagree about what a filter means.
 */

export type LedgerKind = LedgerEntry['kind']

export interface LedgerFilter {
  /** Free text matched against player, reason and the actor who did it. */
  text?: string
  /** `undefined` / 'all' = every kind. */
  kind?: LedgerKind | 'all'
  /** `undefined` / 'all' = every category; 'none' = entries with no category. */
  category?: string
}

/**
 * Filter the balance ledger. Text matches the player name, the reason, and
 * `by` - the actor - because "what did this admin change" is exactly the
 * question the ledger exists to answer (#15), and it is useless if you can
 * only search by player.
 *
 * Order is preserved: the ledger is stored newest-first and callers rely on it.
 */
export function filterLedger(entries: LedgerEntry[], f: LedgerFilter = {}): LedgerEntry[] {
  const q = (f.text ?? '').trim().toLowerCase()
  const kind = f.kind && f.kind !== 'all' ? f.kind : undefined
  const cat = f.category && f.category !== 'all' ? f.category : undefined
  return entries.filter((e) => {
    if (kind && e.kind !== kind) return false
    // 'none' is a real choice: purchases and pre-category entries carry no
    // category, and "show me what was never labelled" is how you find them.
    if (cat === 'none' ? e.category != null : cat != null && e.category !== cat) return false
    if (!q) return true
    return (
      e.mcName.toLowerCase().includes(q) ||
      (e.reason ?? '').toLowerCase().includes(q) ||
      (e.by ?? '').toLowerCase().includes(q)
    )
  })
}

export interface LedgerSummary {
  count: number
  /** Total handed out (positive deltas from grants/sets). */
  granted: number
  /** Total taken away, as a POSITIVE number. */
  removed: number
  /** Total spent in the store, as a POSITIVE number. */
  spent: number
}

/**
 * Totals for the collapsed ledger header, so the section says something useful
 * before it is expanded.
 *
 * `removed` and `spent` are reported positive - a header reading "-450 spent"
 * next to a minus sign reads as a double negative. A purchase is counted as
 * spend only, never as a removal, so the two never double-count the same entry.
 */
export function ledgerSummary(entries: LedgerEntry[]): LedgerSummary {
  let granted = 0
  let removed = 0
  let spent = 0
  for (const e of entries) {
    if (e.kind === 'purchase') spent += Math.abs(e.delta)
    else if (e.delta >= 0) granted += e.delta
    else removed += -e.delta
  }
  return { count: entries.length, granted, removed, spent }
}
