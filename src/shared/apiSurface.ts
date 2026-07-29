/**
 * The route table for `/api/v1`, as data (#51).
 *
 * One table, three consumers: the OpenAPI document, the reference page the app
 * serves, and the smoke that checks the table against the router's own source.
 * A hand-written spec beside a hand-written router drifts, and the half that
 * drifts is always the spec — nobody notices a document that is quietly wrong.
 *
 * This is deliberately a *description*, not a schema library. Sixty invented
 * response schemas would be sixty more things to keep true; what an integrator
 * actually needs is the method, the path, the gate, and what the call does.
 *
 * Pure and constant — no server name, id or count appears here, which is why
 * the generated document can be served without a credential.
 */

/** What a caller must hold. `owner` and `session` are not scopes. */
export type ApiGate =
  | 'public'
  | 'any'
  | 'owner'
  | 'view'
  | 'console'
  | 'power'
  | 'players'
  | 'files'
  | 'backups'
  | 'settings'
  | 'store'
  | 'worlds'

export interface ApiParam {
  name: string
  in: 'path' | 'query'
  required?: boolean
  description: string
}

export interface ApiRoute {
  method: 'GET' | 'POST' | 'DELETE'
  /** OpenAPI-style path, relative to `/api/v1`. */
  path: string
  gate: ApiGate
  summary: string
  /** Named for the docs page, and the source scan that pairs routes to code. */
  group: string
  params?: ApiParam[]
  /** Body fields, as `name: description`. */
  body?: Record<string, string>
  /** Set when the call refuses without an explicit confirmation. */
  confirm?: boolean
  notes?: string
}

const serverId: ApiParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Server id, as returned by GET /servers.'
}

export const API_VERSION = 'v1'
export const API_PREFIX = '/api/v1'

export const API_ROUTES: ApiRoute[] = [
  // ---- meta ----
  { method: 'GET', path: '/', gate: 'public', group: 'meta', summary: 'Surface version and stream path.' },
  { method: 'GET', path: '/openapi.json', gate: 'public', group: 'meta', summary: 'This document.' },
  { method: 'GET', path: '/docs', gate: 'public', group: 'meta', summary: 'Human-readable reference page.' },

  // ---- session ----
  {
    method: 'POST',
    path: '/login',
    gate: 'public',
    group: 'session',
    summary: 'Exchange a panel username and password for a session token.',
    body: { username: 'Panel account name.', password: 'Panel account password.' },
    notes: 'Rate limited per address. Integrations should use an API key instead.'
  },
  { method: 'POST', path: '/logout', gate: 'any', group: 'session', summary: 'Invalidate the presented session token.' },
  { method: 'GET', path: '/me', gate: 'any', group: 'session', summary: 'Who the presented credential is.' },

  // ---- servers ----
  { method: 'GET', path: '/servers', gate: 'view', group: 'servers', summary: 'Every server the caller can see.' },
  { method: 'GET', path: '/servers/{id}', gate: 'view', group: 'servers', summary: 'One server: config, run state, live counters.', params: [serverId] },
  {
    method: 'DELETE',
    path: '/servers/{id}',
    gate: 'owner',
    group: 'servers',
    summary: 'Deregister a server. Files are kept; history and alert rules are not.',
    params: [serverId, { name: 'confirm', in: 'query', required: true, description: 'Must be `true`.' }],
    confirm: true,
    notes: '409 while the server is running. Creating a server, and deleting its files, are not exposed.'
  },
  { method: 'GET', path: '/servers/{id}/console', gate: 'view', group: 'servers', summary: 'The last 250 console lines and the run state.', params: [serverId] },
  {
    method: 'POST',
    path: '/servers/{id}/power',
    gate: 'power',
    group: 'servers',
    summary: 'Start, stop, restart or kill the server.',
    params: [serverId],
    body: { action: '`start` | `stop` | `restart` | `kill`.' }
  },
  {
    method: 'POST',
    path: '/servers/{id}/command',
    gate: 'console',
    group: 'servers',
    summary: 'Run a console command.',
    params: [serverId],
    body: { command: 'The command line, without a leading slash.' }
  },
  { method: 'GET', path: '/servers/{id}/metrics', gate: 'view', group: 'telemetry', summary: 'Performance history.', params: [serverId, { name: 'from', in: 'query', description: 'Epoch ms. Defaults to an hour ago.' }, { name: 'to', in: 'query', description: 'Epoch ms. Defaults to now.' }, { name: 'res', in: 'query', description: '`10s` | `1m` | `1h`. Chosen for you when omitted.' }, { name: 'limit', in: 'query', description: 'Rows, max 5000.' }] },
  { method: 'GET', path: '/servers/{id}/events', gate: 'view', group: 'telemetry', summary: 'Timeline events.', params: [serverId, { name: 'from', in: 'query', description: 'Epoch ms.' }, { name: 'to', in: 'query', description: 'Epoch ms.' }, { name: 'types', in: 'query', description: 'Comma-separated event types.' }, { name: 'limit', in: 'query', description: 'Rows, max 500.' }] },
  { method: 'GET', path: '/servers/{id}/uptime', gate: 'view', group: 'telemetry', summary: 'Uptime over a window, derived from the timeline.', params: [serverId, { name: 'from', in: 'query', description: 'Epoch ms.' }, { name: 'to', in: 'query', description: 'Epoch ms.' }] },
  { method: 'GET', path: '/servers/{id}/analysis', gate: 'view', group: 'telemetry', summary: 'Performance findings for a window.', params: [serverId, { name: 'hours', in: 'query', description: '1-720, default 24.' }] },
  { method: 'GET', path: '/servers/{id}/alerts', gate: 'view', group: 'alerts', summary: 'Alert rules for this server.', params: [serverId] },
  {
    method: 'POST',
    path: '/servers/{id}/alerts',
    gate: 'settings',
    group: 'alerts',
    summary: 'Create or update an alert rule.',
    params: [serverId],
    body: {
      id: 'Rule id to update; omit to create.',
      name: 'Label.',
      metric: '`tps` | `cpu` | `memory` | `players` | `offline`.',
      comparison: '`above` | `below`.',
      threshold: 'Number.',
      action: 'Optional reaction; needs the scope that action would need.'
    },
    notes: 'A rule whose action runs a command also needs `console`; one that restarts needs `power`.'
  },
  { method: 'DELETE', path: '/servers/{id}/alerts', gate: 'settings', group: 'alerts', summary: 'Delete an alert rule.', params: [serverId, { name: 'ruleId', in: 'query', required: true, description: 'Rule to delete.' }] },

  // ---- players ----
  { method: 'GET', path: '/servers/{id}/players', gate: 'view', group: 'players', summary: 'The roster: online, ops, whitelist, bans.', params: [serverId] },
  { method: 'GET', path: '/servers/{id}/players/{name}', gate: 'view', group: 'players', summary: 'One player: profile, stats, inventory, live position.', params: [serverId, { name: 'name', in: 'path', required: true, description: 'Minecraft username.' }] },
  {
    method: 'POST',
    path: '/servers/{id}/players/{action}',
    gate: 'players',
    group: 'players',
    summary: 'Moderate: op, deop, ban, pardon, kick, whitelist-add, whitelist-remove, gamemode.',
    params: [serverId, { name: 'action', in: 'path', required: true, description: 'One of the eight moderation actions.' }],
    body: { player: 'Minecraft username, `^[A-Za-z0-9_]{3,16}$`.', reason: 'Free text for ban/kick; control characters are stripped.', gamemode: '`survival` | `creative` | `adventure` | `spectator`.' },
    notes: 'Kick and gamemode need a running server (409 otherwise). The others edit the json files by uuid when stopped.'
  },
  { method: 'GET', path: '/servers/{id}/map', gate: 'view', group: 'players', summary: 'Live positions, bounds and a chunk heatmap for one dimension.', params: [serverId, { name: 'dim', in: 'query', description: '`overworld` | `nether` | `end`, or a modded key.' }, { name: 'cell', in: 'query', description: 'Heatmap cell size in blocks, 1-512.' }], notes: 'Needs the Bridge plugin; `bridge: false` means the data is stale or absent.' },

  // ---- worlds ----
  { method: 'GET', path: '/servers/{id}/worlds', gate: 'view', group: 'worlds', summary: 'Worlds, with their dimensions and sizes.', params: [serverId] },
  {
    method: 'POST',
    path: '/servers/{id}/worlds/{action}',
    gate: 'worlds',
    group: 'worlds',
    summary: 'Activate, rename, clone or reset a world.',
    params: [serverId, { name: 'action', in: 'path', required: true, description: '`activate` | `rename` | `clone` | `reset`.' }],
    body: { name: 'World name; a path component, validated untrimmed.', newName: 'For rename and clone.', dimension: 'For reset: `overworld` | `nether` | `end`.', confirm: 'Required for reset.' },
    confirm: true
  },
  { method: 'DELETE', path: '/servers/{id}/worlds', gate: 'worlds', group: 'worlds', summary: 'Delete a world.', params: [serverId, { name: 'name', in: 'query', required: true, description: 'World to delete.' }, { name: 'confirm', in: 'query', required: true, description: 'Must be `true`.' }], confirm: true },

  // ---- backups ----
  { method: 'GET', path: '/servers/{id}/backups', gate: 'view', group: 'backups', summary: 'Backups held for this server.', params: [serverId] },
  { method: 'POST', path: '/servers/{id}/backups', gate: 'backups', group: 'backups', summary: 'Create a backup.', params: [serverId], body: { kind: '`world` (default) or `full`.' }, notes: '`destDir` is not accepted: writing a zip to an arbitrary path is a different privilege.' },
  { method: 'POST', path: '/servers/{id}/backups/restore', gate: 'backups', group: 'backups', summary: 'Restore a backup over the live world.', params: [serverId], body: { backupId: 'Backup to restore.', confirm: 'Must be `true`.' }, confirm: true, notes: '409 while the server is running — extracting over open region files corrupts them.' },
  { method: 'DELETE', path: '/servers/{id}/backups', gate: 'backups', group: 'backups', summary: 'Delete a backup.', params: [serverId, { name: 'backupId', in: 'query', required: true, description: 'Backup to delete.' }, { name: 'confirm', in: 'query', required: true, description: 'Must be `true`.' }], confirm: true },

  // ---- files and config ----
  { method: 'GET', path: '/servers/{id}/files', gate: 'files', group: 'files', summary: 'List a directory, or read a file with `as=file`.', params: [serverId, { name: 'path', in: 'query', description: 'Relative to the server root.' }, { name: 'as', in: 'query', description: '`file` to read contents instead of listing.' }], notes: 'Reading needs `files`, not `view`: server.properties holds the RCON password.' },
  { method: 'POST', path: '/servers/{id}/files', gate: 'files', group: 'files', summary: 'Write a text file.', params: [serverId], body: { path: 'Relative path.', content: 'Full new contents.' } },
  { method: 'DELETE', path: '/servers/{id}/files', gate: 'files', group: 'files', summary: 'Delete a file or folder.', params: [serverId, { name: 'path', in: 'query', required: true, description: 'Relative path.' }, { name: 'confirm', in: 'query', required: true, description: 'Must be `true`.' }], confirm: true },
  { method: 'POST', path: '/servers/{id}/files/folder', gate: 'files', group: 'files', summary: 'Create a folder.', params: [serverId], body: { path: 'Parent, relative.', name: 'New folder name.' } },
  { method: 'POST', path: '/servers/{id}/files/rename', gate: 'files', group: 'files', summary: 'Rename an entry.', params: [serverId], body: { path: 'Relative path.', newName: 'New name.' } },
  { method: 'GET', path: '/servers/{id}/config', gate: 'settings', group: 'config', summary: 'Server config, Java args and server.properties.', params: [serverId] },
  { method: 'POST', path: '/servers/{id}/config/properties', gate: 'settings', group: 'config', summary: 'Merge into server.properties, or replace it.', params: [serverId], body: { updates: 'Key/value map, merged.', raw: 'Whole file, replacing it.' }, notes: 'A value containing a newline is refused: in a properties file that smuggles in a second key.' },
  { method: 'POST', path: '/servers/{id}/config/java', gate: 'settings', group: 'config', summary: 'Patch the Java launch config. Merges.', params: [serverId], body: { minMemoryMB: 'Heap floor.', maxMemoryMB: 'Heap ceiling.', preset: 'Flag preset.', nogui: 'Boolean.', jarFile: 'Jar to launch.' }, notes: '`javaPath`, `customArgs` and `extraFlags` are refused with 403 local-only-field — they decide what program runs.' },
  { method: 'POST', path: '/servers/{id}/config/favorite', gate: 'settings', group: 'config', summary: 'Pin or unpin the server.', params: [serverId], body: { favorite: 'Boolean.' } },

  // ---- plugins and mods ----
  { method: 'GET', path: '/servers/{id}/mods', gate: 'files', group: 'mods', summary: 'Installed plugins and mods.', params: [serverId] },
  { method: 'GET', path: '/servers/{id}/mods/search', gate: 'files', group: 'mods', summary: 'Search Modrinth, filtered to this server’s loaders.', params: [serverId, { name: 'q', in: 'query', required: true, description: 'Search text.' }] },
  { method: 'GET', path: '/servers/{id}/mods/detail', gate: 'files', group: 'mods', summary: 'Project detail and a compatibility verdict for this server.', params: [serverId, { name: 'projectId', in: 'query', required: true, description: 'Modrinth project id or slug.' }] },
  { method: 'GET', path: '/servers/{id}/mods/updates', gate: 'files', group: 'mods', summary: 'Which installed jars have a newer compatible file.', params: [serverId], notes: 'Answers `{ ok: false }` rather than failing when Modrinth is unreachable.' },
  { method: 'POST', path: '/servers/{id}/mods/install', gate: 'files', group: 'mods', summary: 'Install a Modrinth project.', params: [serverId], body: { projectId: 'Project to install.', versionId: 'Optional; the newest compatible version otherwise.' }, notes: 'The download URL is resolved server-side and the file hash checked. A caller names a project, never a URL.' },
  { method: 'POST', path: '/servers/{id}/mods/update', gate: 'files', group: 'mods', summary: 'Replace an installed jar with a specific version.', params: [serverId], body: { rel: 'Installed path, under plugins/ or mods/.', versionId: 'Version to install.' } },
  { method: 'POST', path: '/servers/{id}/mods/toggle', gate: 'files', group: 'mods', summary: 'Enable or disable an installed jar.', params: [serverId], body: { rel: 'Installed path.', enable: 'Boolean.' } },
  { method: 'DELETE', path: '/servers/{id}/mods', gate: 'files', group: 'mods', summary: 'Delete an installed jar.', params: [serverId, { name: 'rel', in: 'query', required: true, description: 'Installed path.' }, { name: 'confirm', in: 'query', required: true, description: 'Must be `true`.' }], confirm: true },

  // ---- store ----
  { method: 'GET', path: '/servers/{id}/store', gate: 'view', group: 'store', summary: 'The storefront as a player sees it.', params: [serverId] },
  { method: 'GET', path: '/servers/{id}/store/balance', gate: 'view', group: 'store', summary: 'The caller’s balance, if a Minecraft name is linked.', params: [serverId] },
  { method: 'GET', path: '/servers/{id}/store/txns', gate: 'view', group: 'store', summary: 'The caller’s transactions.', params: [serverId] },
  { method: 'GET', path: '/servers/{id}/map/perf', gate: 'settings', group: 'players', summary: 'What the live map is allowed to cost on this server.', params: [serverId] },
  { method: 'POST', path: '/servers/{id}/map/perf', gate: 'settings', group: 'players', summary: 'Change it. Values are clamped on the way in.', params: [serverId], body: { cache: 'Keep parsed tiles on disk (default on).', memoryRegions: 'Regions held in memory, 2-64.', parseGapMs: 'Minimum gap between region parses, 0-5000.', cacheLimitMB: 'On-disk ceiling, oldest evicted first.' } },
  { method: 'DELETE', path: '/servers/{id}/map/cache', gate: 'settings', group: 'players', summary: 'Drop this server\'s cached map tiles.', params: [serverId], notes: 'Only this server\'s: the cache filename carries the owner so one server\'s clear cannot take another\'s with it.' },
  { method: 'GET', path: '/servers/{id}/map/tiles', gate: 'view', group: 'players', summary: 'Rendered surface colours for the requested chunks.', params: [serverId], notes: 'Ask with `?c=cx,cz;cx,cz` (max 64) and `?dim=`. Answers only with regions already parsed and queues the rest — `pending` says how many are still coming, so a caller polls rather than blocking. A request never parses a region itself.' },
  { method: 'GET', path: '/servers/{id}/player-requests', gate: 'settings', group: 'players', summary: 'Account claims waiting for a human, on a server running in offline mode.', params: [serverId], notes: 'Empty unless `online-mode=false`: with Mojang authentication on, the in-game code proves ownership by itself.' },
  { method: 'POST', path: '/servers/{id}/player-requests/approve', gate: 'settings', group: 'players', summary: 'Vouch for a claim; the verification code is then whispered in game.', params: [serverId], body: { id: 'Request to approve.' }, notes: 'Gated on `settings` rather than `players`: this grants credentials to a website account with a balance, which is authority over an identity, not over a session.' },
  { method: 'POST', path: '/servers/{id}/player-requests/deny', gate: 'settings', group: 'players', summary: 'Drop a claim without issuing a code.', params: [serverId], body: { id: 'Request to deny.' } },
  { method: 'GET', path: '/servers/{id}/bridge', gate: 'files', group: 'mods', summary: 'Whether this server needs the MSMS Bridge plugin, and where one would come from.', params: [serverId], notes: 'Answers `state: unsupported` for a server type that cannot run it, and `offline: true` when the GitHub release check failed — the bundled jar still installs.' },
  { method: 'POST', path: '/servers/{id}/bridge/install', gate: 'files', group: 'mods', summary: 'Install the newest Bridge plugin jar, replacing any older one.', params: [serverId], notes: 'Takes no body. The version and the download URL are resolved by the app from this project\'s own GitHub releases, falling back to the jar shipped with it; a caller naming either would turn a `files` request into an arbitrary write.' },
  // No store/buy: removed in #102. It spent currency on a `view` gate, and the
  // panel that called it is the authoring surface, not a shop. Players buy on
  // the public site with their own session.
  { method: 'GET', path: '/servers/{id}/store/admin', gate: 'store', group: 'store', summary: 'Store config, balances and categories.', params: [serverId] },
  { method: 'GET', path: '/servers/{id}/store/admin/ledger', gate: 'store', group: 'store', summary: 'The currency ledger: every balance change, with actor and reason.', params: [serverId, { name: 'mcName', in: 'query', description: 'Limit to one player.' }] },
  { method: 'GET', path: '/servers/{id}/store/admin/pending', gate: 'store', group: 'store', summary: 'Rewards paid for and not yet handed over, with why each is waiting.', params: [serverId] },
  { method: 'POST', path: '/servers/{id}/store/admin/deliver', gate: 'store', group: 'store', summary: 'Hand a held reward over now, overriding the safety check.', params: [serverId], body: { queueId: 'Queue entry to release.' }, notes: 'The escape hatch that makes holding acceptable: on a cracked server with no bridge, nothing else would release them.' },
  { method: 'POST', path: '/servers/{id}/store/admin/currency', gate: 'store', group: 'store', summary: 'Set the currency name.', params: [serverId], body: { currency: 'Display name.' } },
  { method: 'POST', path: '/servers/{id}/store/admin/product', gate: 'store', group: 'store', summary: 'Create or update a product or crate.', params: [serverId], body: { id: 'Product id; omit to create.', name: 'Display name.', price: 'Number.', kind: '`item` or `crate`.' } },
  { method: 'POST', path: '/servers/{id}/store/admin/delete', gate: 'store', group: 'store', summary: 'Delete a product.', params: [serverId], body: { productId: 'Product to delete.' } },
  { method: 'POST', path: '/servers/{id}/store/admin/balance', gate: 'store', group: 'store', summary: 'Grant, remove or set a player balance.', params: [serverId], body: { mcName: 'Minecraft username.', amount: 'Number.', mode: '`add` (default) or `set`.', reason: 'Free text for the ledger.', category: 'Ledger category.' } },
  { method: 'POST', path: '/servers/{id}/store/admin/layout', gate: 'store', group: 'store', summary: 'Set the storefront layout.', params: [serverId], body: { layout: '`crates-first` | `items-first` | `mixed`.' } },
  { method: 'POST', path: '/servers/{id}/store/admin/upload', gate: 'store', group: 'store', summary: 'Upload a product image. Raster only, size capped.', params: [serverId] },
  { method: 'POST', path: '/servers/{id}/store/admin/crate-animation', gate: 'store', group: 'store', summary: 'Set the store-wide default crate animation.', params: [serverId], body: { animation: 'Animation key.' } },
  { method: 'POST', path: '/servers/{id}/store/admin/category', gate: 'store', group: 'store', summary: 'Create or update a category.', params: [serverId], body: { id: 'Category id; omit to create.', name: 'Display name.' } },
  { method: 'POST', path: '/servers/{id}/store/admin/category/delete', gate: 'store', group: 'store', summary: 'Delete a category.', params: [serverId], body: { id: 'Category to delete.' } },

  // ---- site ----
  { method: 'GET', path: '/site/posts', gate: 'settings', group: 'site', summary: 'News posts, including unpublished ones.' },
  { method: 'POST', path: '/site/posts', gate: 'settings', group: 'site', summary: 'Create or update a post.', body: { id: 'Post id; omit to create.', title: 'Title.', body: 'Markdown body.', published: 'Boolean.' } },
  { method: 'POST', path: '/site/posts/delete', gate: 'settings', group: 'site', summary: 'Delete a post.', body: { id: 'Post to delete.' } },
  { method: 'GET', path: '/site/uploads', gate: 'settings', group: 'site', summary: 'Images available to posts.' },
  { method: 'POST', path: '/site/upload', gate: 'settings', group: 'site', summary: 'Upload an image. Raster only, size capped.' },

  // ---- keys ----
  { method: 'GET', path: '/keys', gate: 'owner', group: 'keys', summary: 'Issued API keys. Secrets are never returned.' },
  { method: 'POST', path: '/keys', gate: 'owner', group: 'keys', summary: 'Issue a key. The secret is shown once and never again.', body: { label: 'What it is for.', scopes: 'Array of scopes.', servers: '`all` or an array of server ids.', expiresInDays: 'Optional lifetime.', canAudit: 'Whether it may read the audit log.' } },
  // The field is `keyId`, not `id`, on all three. This document said `id` until
  // #142, which is a worse failure than an undocumented route: revoke answered
  // 404 and delete answered 200 having deleted nothing, both to a caller who had
  // followed the instructions exactly.
  { method: 'POST', path: '/keys/revoke', gate: 'owner', group: 'keys', summary: 'Revoke a key, keeping the record.', body: { keyId: 'Key id.' } },
  { method: 'POST', path: '/keys/disabled', gate: 'owner', group: 'keys', summary: 'Switch a key off or back on. Unlike revoking, this is reversible.', body: { keyId: 'Key id.', disabled: 'true to switch off, false to switch back on.' }, notes: 'A revoked key cannot be switched back on; that answer is 409.' },
  { method: 'DELETE', path: '/keys', gate: 'owner', group: 'keys', summary: 'Delete a key record outright.', params: [{ name: 'keyId', in: 'query', required: true, description: 'Key id.' }] },

  // ---- audit ----
  { method: 'GET', path: '/audit', gate: 'owner', group: 'audit', summary: 'The audit trail, newest first.', params: [{ name: 'from', in: 'query', description: 'Epoch ms.' }, { name: 'to', in: 'query', description: 'Epoch ms.' }, { name: 'actions', in: 'query', description: 'Comma-separated action names.' }, { name: 'actor', in: 'query', description: 'Substring match.' }, { name: 'serverId', in: 'query', description: 'Filter to one server.' }, { name: 'limit', in: 'query', description: 'Rows.' }], notes: 'Owner, or an account (or key) explicitly granted audit access.' },

  // ---- host-wide ----
  { method: 'GET', path: '/java', gate: 'owner', group: 'host', summary: 'Java runtimes found on this host.', params: [{ name: 'refresh', in: 'query', description: '`true` to rescan rather than use the cache.' }], notes: 'Owner session only. No API key can reach this: a key carries scopes, never a role.' },
  { method: 'POST', path: '/java/install', gate: 'owner', group: 'host', summary: 'Download and unpack a JDK.', body: { major: 'Java major version, 8-64.' }, notes: 'Owner session only. The major version selects from a release list; the caller never names a URL.' },
  { method: 'GET', path: '/telemetry', gate: 'owner', group: 'host', summary: 'Metric retention settings.', notes: 'Owner session only.' },
  { method: 'POST', path: '/telemetry', gate: 'owner', group: 'host', summary: 'Patch metric retention. Merges.', body: { enabled: 'Boolean.', rawHours: '1-8760.', minuteDays: '1-3650.', hourDays: '1-3650.' }, notes: 'Validated, not cast: this is persisted, and a bad value fails every later prune rather than this request.' }
]

/** Every distinct group, in table order. */
export function apiGroups(): string[] {
  const seen: string[] = []
  for (const r of API_ROUTES) if (!seen.includes(r.group)) seen.push(r.group)
  return seen
}

/** `POST /servers/{id}/power` → `postServersIdPower`. Stable across edits. */
export function operationId(route: ApiRoute): string {
  const parts = route.path
    .split('/')
    .filter(Boolean)
    .map((p) => p.replace(/[{}]/g, ''))
    .map((p) => p.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : '')))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  return route.method.toLowerCase() + (parts.join('') || 'Root')
}
