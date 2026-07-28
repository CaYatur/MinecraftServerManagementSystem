import type { ProductPublic, ProductType } from './web'

/**
 * Pure storefront rules: what an image source may be, which products are
 * buyable, and how a catalogue is filtered and ordered.
 *
 * All of it lives here rather than in the three places that render a store
 * (desktop app, web panel, public website) so those three cannot disagree about
 * what a visitor is allowed to see or click.
 */

// ---- image sources (#76, #77) ----

/**
 * Is this something we are willing to put in a `src="..."`?
 *
 * Product and reward images are attacker-controlled: any web user with the
 * `store` scope can set them, and they render for every visitor to the public
 * site. So this is an allowlist of two shapes and nothing else:
 *
 * - `http://` or `https://` — an ordinary remote image.
 * - `/uploads/<name>` — a file the operator uploaded, served back same-origin.
 *
 * Everything else is refused, and the refusals matter individually:
 *
 * - `javascript:` is script execution the moment anything makes it a link.
 * - `data:` can carry an SVG, and an inline SVG can carry a `<script>`.
 * - `//evil.example/x.png` (protocol-relative) reads like a path and is not one.
 * - A traversal in the uploads name (`/uploads/../../secrets`) would escape the
 *   directory. Only a plain filename is accepted after the prefix.
 *
 * An empty value is allowed, and means "no image" — a product without an icon
 * is normal, and rejecting it would make the field impossible to clear.
 */
export function isSafeImageSrc(src: unknown): boolean {
  if (typeof src !== 'string') return false
  const v = src.trim()
  if (!v) return true
  if (v.startsWith('/uploads/')) {
    const name = v.slice('/uploads/'.length)
    // A plain filename: no slashes, no backslashes, no dot-segments, no query.
    return !!name && !/[\\/?#]/.test(name) && !name.startsWith('.') && !name.includes('..')
  }
  // Case-insensitive because `JaVaScRiPt:` is the same scheme, and a scheme
  // check that can be defeated by the shift key is not a check.
  const lower = v.toLowerCase()
  return lower.startsWith('http://') || lower.startsWith('https://')
}

/** Drop anything that is not a usable image source, and cap the list. */
export function sanitizeImages(images: unknown, max = MAX_PRODUCT_IMAGES): string[] {
  if (!Array.isArray(images)) return []
  return images
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())
    .filter(isSafeImageSrc)
    .slice(0, max)
}

/**
 * Cap on gallery images per product. Not arbitrary: every one of these ships in
 * the public store payload to every visitor, and a storefront is not a photo
 * album.
 */
export const MAX_PRODUCT_IMAGES = 8

// ---- availability (#81) ----

export interface Availability {
  /** Never oversold: `stock` is decremented inside the same synchronous block as the balance. */
  stock?: number
  perPlayerLimit?: number
  hidden?: boolean
}

export type BuyBlock = 'hidden' | 'out-of-stock' | 'limit-reached' | null

/**
 * Pure: may this player buy this, ignoring their balance?
 *
 * Returns *why* rather than a boolean, because "you already have the maximum"
 * and "this sold out" are different things to say to someone, and a storefront
 * that says neither just looks broken.
 */
export function buyBlock(
  p: Availability,
  ownedByPlayer: number
): BuyBlock {
  if (p.hidden) return 'hidden'
  if (typeof p.stock === 'number' && p.stock <= 0) return 'out-of-stock'
  if (typeof p.perPlayerLimit === 'number' && p.perPlayerLimit > 0 && ownedByPlayer >= p.perPlayerLimit) {
    return 'limit-reached'
  }
  return null
}

// ---- catalogue layout (#80) ----

/** Crates above items, items above crates, or one mixed grid. */
export type StoreLayout = 'crates-first' | 'items-first' | 'mixed'

export const STORE_LAYOUTS: StoreLayout[] = ['crates-first', 'items-first', 'mixed']

export function normalizeLayout(v: unknown): StoreLayout {
  return typeof v === 'string' && (STORE_LAYOUTS as string[]).includes(v)
    ? (v as StoreLayout)
    : 'crates-first'
}

/**
 * Split a catalogue into the sections a storefront renders, in display order.
 *
 * `mixed` returns a single unnamed section so the caller does not need a
 * separate code path for it - the difference between one grid and two is data,
 * not branching.
 */
export function sections<T extends { type: ProductType }>(
  products: T[],
  layout: StoreLayout
): { type: ProductType | 'all'; items: T[] }[] {
  if (layout === 'mixed') return [{ type: 'all', items: products }]
  const crates = products.filter((p) => p.type === 'crate')
  const items = products.filter((p) => p.type !== 'crate')
  const order: { type: ProductType; items: T[] }[] =
    layout === 'items-first'
      ? [
          { type: 'item', items },
          { type: 'crate', items: crates }
        ]
      : [
          { type: 'crate', items: crates },
          { type: 'item', items }
        ]
  // An empty section is a heading with nothing under it, which reads as a bug.
  return order.filter((s) => s.items.length > 0)
}

// ---- search / sort / filter (#82) ----

export type ProductSort = 'featured' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc'

export const PRODUCT_SORTS: ProductSort[] = [
  'featured',
  'price-asc',
  'price-desc',
  'name-asc',
  'name-desc'
]

export interface ProductFilter {
  text?: string
  type?: ProductType | 'all'
  sort?: ProductSort
}

/**
 * Pure: search, filter and order a catalogue.
 *
 * `featured` is the operator's own ordering (`sort` ascending, then name), not
 * insertion order - an operator who wants the season pass at the top should not
 * have to delete and recreate everything below it.
 *
 * A product with no `sort` comes *after* every product that has one. Treating
 * unset as 0 would be the obvious choice and the wrong one: an operator who
 * numbers three products 1, 2, 3 and leaves the other twenty alone means "these
 * three first", and unset-as-zero would bury them under all twenty.
 *
 * Sorting by name uses `localeCompare`, so a Turkish store orders 'ç' after 'c'
 * instead of after 'z' where a codepoint comparison would put it.
 */
export function filterProducts<T extends ProductPublic & { sort?: number }>(
  products: T[],
  f: ProductFilter
): T[] {
  const q = (f.text ?? '').trim().toLowerCase()
  const out = products.filter((p) => {
    if (f.type && f.type !== 'all' && p.type !== f.type) return false
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q) ||
      // A crate is often searched for by what is inside it.
      (p.rewards ?? []).some((r) => r.name.toLowerCase().includes(q))
    )
  })
  const byName = (a: T, b: T): number => a.name.localeCompare(b.name)
  switch (f.sort) {
    case 'price-asc':
      return out.sort((a, b) => a.price - b.price || byName(a, b))
    case 'price-desc':
      return out.sort((a, b) => b.price - a.price || byName(a, b))
    case 'name-asc':
      return out.sort(byName)
    case 'name-desc':
      return out.sort((a, b) => byName(b, a))
    default:
      return out.sort(
        (a, b) => (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER) || byName(a, b)
      )
  }
}
