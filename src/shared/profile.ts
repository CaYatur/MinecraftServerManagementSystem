/**
 * What a visitor is allowed to see on a player's profile (#107).
 *
 * This table is the whole security of the feature, so it is pure and it is
 * enumerated in the smoke rather than reasoned about at the call sites. An
 * inventory is a list of what somebody owns; publishing it tells the server who
 * is worth robbing, and a live position tells them where to do it.
 *
 * The distinction that matters is not "public: on/off" but *who is asking*. A
 * player looking at their own inventory is reading something they can see in
 * game by pressing E; a stranger looking at it is reading something they could
 * otherwise only get by killing them. So the operator's toggles govern
 * strangers, and the owner sees their own either way.
 */

/** Fields a profile can carry, grouped by what publishing one would cost. */
export type ProfileField =
  /** Name, uuid, head. Public: it is what a profile IS. */
  | 'identity'
  /** Registered on the site, first and last seen on the server. */
  | 'dates'
  | 'playtime'
  | 'inventory'
  | 'enderChest'
  /** Health, food, xp level. */
  | 'stats'
  | 'location'

export interface ProfilePublishing {
  inventory: boolean
  enderChest: boolean
  stats: boolean
  location: boolean
}

/**
 * All off. Every one of these is a thing a player would be surprised to find
 * on the internet, and an operator who wants it there can say so.
 */
export const PROFILE_PUBLISHING_DEFAULTS: ProfilePublishing = {
  inventory: false,
  enderChest: false,
  stats: false,
  location: false
}

export type ProfileViewer =
  /** Signed in, and this is their own profile. */
  | 'owner'
  /** Signed in as somebody else. */
  | 'stranger'
  | 'anonymous'

/**
 * `stranger` and `anonymous` are the same rule today and are kept apart anyway:
 * they are different facts, and collapsing them would mean a future rule that
 * wants to tell them apart has to reintroduce the distinction everywhere.
 */
export function canSee(
  field: ProfileField,
  viewer: ProfileViewer,
  pub: ProfilePublishing
): boolean {
  if (field === 'identity' || field === 'dates' || field === 'playtime') return true
  if (viewer === 'owner') return true
  return !!pub[field]
}

/** Everything MSMS knows, before anything is decided about who may read it. */
export interface FullProfile {
  mcName: string
  uuid?: string
  registeredAt?: number
  firstSeen?: number
  lastSeen?: number
  playtimeHours?: number
  online?: boolean
  /**
   * When the player's `.dat` was last written — which is when everything below
   * was true. Minecraft writes it on a world save or a disconnect, so the
   * inventory can be minutes old and nothing else on the page would say so.
   */
  dataAt?: number
  inventory?: { slot: number; id: string; count: number }[]
  enderChest?: { slot: number; id: string; count: number }[]
  stats?: { health?: number; food?: number; xpLevel?: number }
  location?: { x: number; y: number; z: number; dimension?: string }
}

/** The shape that leaves the server. Absent means not permitted, not empty. */
export interface PublicProfile {
  mcName: string
  uuid?: string
  online?: boolean
  registeredAt?: number
  firstSeen?: number
  lastSeen?: number
  playtimeHours?: number
  /** When the underlying player file was written. See `FullProfile.dataAt`. */
  dataAt?: number
  inventory?: { slot: number; id: string; count: number }[]
  enderChest?: { slot: number; id: string; count: number }[]
  stats?: { health?: number; food?: number; xpLevel?: number }
  location?: { x: number; y: number; z: number; dimension?: string }
  /** Which fields were withheld, so a page can say "the owner has not published this". */
  hidden: ProfileField[]
}

/**
 * Build the payload by omitting, not by flagging.
 *
 * The field has to be absent from the response rather than hidden in the page:
 * a page can be read with the network tab open, and "we sent it but did not
 * draw it" is not a privacy setting.
 */
export function redactProfile(
  full: FullProfile,
  viewer: ProfileViewer,
  pub: ProfilePublishing
): PublicProfile {
  const hidden: ProfileField[] = []
  const allow = (f: ProfileField): boolean => {
    const ok = canSee(f, viewer, pub)
    if (!ok) hidden.push(f)
    return ok
  }
  const out: PublicProfile = { mcName: full.mcName, hidden }
  if (full.uuid) out.uuid = full.uuid
  if (typeof full.online === 'boolean') out.online = full.online
  if (allow('dates')) {
    if (full.registeredAt) out.registeredAt = full.registeredAt
    if (full.firstSeen) out.firstSeen = full.firstSeen
    if (full.lastSeen) out.lastSeen = full.lastSeen
  }
  if (allow('playtime') && typeof full.playtimeHours === 'number') {
    out.playtimeHours = full.playtimeHours
  }
  // Carried whenever anything read FROM that file is carried, so the page can
  // always say how old what it is showing is.
  if (full.dataAt && (canSee('inventory', viewer, pub) || canSee('stats', viewer, pub))) {
    out.dataAt = full.dataAt
  }
  if (allow('inventory') && full.inventory) out.inventory = full.inventory
  if (allow('enderChest') && full.enderChest) out.enderChest = full.enderChest
  if (allow('stats') && full.stats) out.stats = full.stats
  if (allow('location') && full.location) out.location = full.location
  return out
}

/**
 * The avatar service, one place.
 *
 * Named here so the live map's head markers and the profile head cannot end up
 * pointing at two different third parties, and so an operator changing it
 * changes both.
 *
 * By NAME, not by uuid. The uuid MSMS holds comes from `usercache.json`, and on
 * an offline-mode server that is the derived offline id (a v3 uuid over
 * `OfflinePlayer:<name>`) which no skin service has ever seen — so every head
 * rendered as a broken image on exactly the servers this app is most used on.
 * A name-keyed service does the Mojang lookup itself and falls back to Steve,
 * which is a face rather than a broken-image icon.
 */
export function avatarUrl(name: string, size = 32): string {
  const clean = /^[A-Za-z0-9_]{1,16}$/.test(name) ? name : 'Steve'
  return 'https://minotar.net/helm/' + clean + '/' + Math.max(8, Math.min(512, Math.round(size))) + '.png'
}

/**
 * A Minecraft item id, reduced to what can safely go in a URL path.
 *
 * The id comes out of a player's NBT, which is not a trusted source: a modded
 * or hand-edited item can carry anything. Returns '' for anything that is not
 * a plain namespaced id, and the caller draws the text tile instead.
 */
export function itemIconId(rawId: string): string {
  const id = String(rawId || '').replace(/^minecraft:/, '').trim().toLowerCase()
  return /^[a-z0-9_]{1,64}$/.test(id) ? id : ''
}

/**
 * Where an item's picture comes from.
 *
 * Externally hosted for now, and every use of it must fall back to the item's
 * name on error — the fallback is not politeness, it is the only thing standing
 * between an unreachable third party and a grid of broken-image icons. An
 * offline LAN server is a normal place to run this.
 *
 * The right long-term answer is to extract the textures from the client jar
 * Mojang already publishes, which needs no third party and works offline. That
 * is tracked with the block-colour work, which needs exactly the same textures.
 */
export function itemIconUrl(rawId: string): string {
  // Deliberately NOT calling `itemIconId`. Both pages embed this function by
  // stringifying it, and a stringified function that calls another one only
  // works for as long as the bundler does not rename the callee — the page
  // would then throw a ReferenceError that nothing in the build catches,
  // because the source it was compiled from is still perfectly valid.
  const id = String(rawId || '').replace(/^minecraft:/, '').trim().toLowerCase()
  if (!/^[a-z0-9_]{1,64}$/.test(id)) return ''
  return 'https://mc.nerothe.com/img/1.21.4/minecraft_' + id + '.png'
}

/** `netherite_ingot` -> `Netherite Ingot`. The fallback, and every tooltip. */
export function itemLabel(rawId: string): string {
  const id = String(rawId || '').replace(/^minecraft:/, '').trim()
  if (!id) return '?'
  return id
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
