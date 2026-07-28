# Operations API

Moderation, worlds and backups over HTTP (#53, part of epic #52).

Everything here is on the **admin panel listener** (`web.port`, default 8722),
authenticates the same three ways as the rest of `/api/*`, and is subject to the
same per-server scope checks:

- `Authorization: Bearer <session token>` — a panel login
- `Authorization: Bearer msms_…` or `X-API-Key: msms_…` — an API key (#48)

A key is not a person: it carries its own scopes and its own server allowlist,
and cannot inherit anything from an account. See [api-keys](#) in the panel UI
for issuing one.

> The server is plain HTTP, bound to `127.0.0.1` unless the operator opts into
> LAN. Nothing here widens that. Exposing it beyond the LAN belongs behind your
> own reverse proxy and TLS.

## Scopes

| Scope | Grants |
|---|---|
| `view` | read the player roster, the world list, the backup list |
| `players` | op/deop, ban/pardon, kick, whitelist, gamemode |
| `worlds` | activate / rename / clone / reset / delete a world |
| `backups` | create / restore / delete a backup |

`worlds` is new in this change and is **not** part of `players` or `settings`.
Deleting or resetting a world destroys data that no backup outside MSMS knows
about, and an integration that only needs to *read* the world list should not
have to be trusted with erasing one. Of the built-in roles, only **Operator**
carries it.

## Confirmation on destructive calls

Four operations require `confirm: true` (in the body for `POST`, as
`?confirm=true` for `DELETE`) **in addition to** the scope:

- `backup.restore` — silently replaces a live world
- `backup.delete` — unrecoverable
- `world.delete` — unrecoverable
- `world.reset` — unrecoverable for that dimension

This is not a security boundary: a caller holding the scope can always pass the
flag. It exists because these are the calls an integration makes *by accident* —
a retry loop, a mis-set variable, an example copied without reading it. Without
the flag the response is `400 confirm-required`, and the refusal is audited.

## Moderation

```
GET  /api/servers/:id/players                   view
POST /api/servers/:id/players/op                players   { player }
POST /api/servers/:id/players/deop              players   { player }
POST /api/servers/:id/players/ban               players   { player, reason? }
POST /api/servers/:id/players/pardon            players   { player }
POST /api/servers/:id/players/kick              players   { player, reason? }
POST /api/servers/:id/players/whitelist-add     players   { player }
POST /api/servers/:id/players/whitelist-remove  players   { player }
POST /api/servers/:id/players/gamemode          players   { player, gamemode }
```

`gamemode` is one of `survival`, `creative`, `adventure`, `spectator`. Numeric
ids are not accepted.

### Why the names are validated so strictly

`player` must match `^[A-Za-z0-9_]{3,16}$` and a `reason` is stripped of every
control character.

When the server is running, these operations are console commands, and
`sendCommand` writes the string **plus a newline** to the server's stdin. A name
of `Steve\nstop` would therefore be two commands, the second one running as the
server operator. The desktop app and the web panel are safe by accident — they
pass names from a roster the server itself reported — but an HTTP caller passes
whatever it likes.

So the validator is an allowlist, in `shared/ops.ts`, applied before anything
runs. A denylist of "characters that break a command" has to be right about all
of them and only has to be wrong once.

### Running vs stopped

| | Running server | Stopped server |
|---|---|---|
| op / whitelist / ban | console command by name | edits `ops.json` / `whitelist.json` / `banned-players.json` **by uuid** |
| kick / gamemode | console command | `409 requires-running` |

Editing the json files needs a uuid, which only the roster has. A player who has
never joined therefore gets `409 uuid-unknown` on a stopped server, and works
fine on a running one. Both are reported as `409` — a conflict with the current
state, not a malformed request.

## Worlds

```
GET    /api/servers/:id/worlds                  view
POST   /api/servers/:id/worlds/activate         worlds   { name }
POST   /api/servers/:id/worlds/rename           worlds   { name, newName }
POST   /api/servers/:id/worlds/clone            worlds   { name, newName }
POST   /api/servers/:id/worlds/reset            worlds   { name, dimension, confirm }
DELETE /api/servers/:id/worlds?name=&confirm=true   worlds
```

`dimension` is `overworld`, `nether` or `end`.

A world name is a **path component** — worlds are directories under the server
root — so it is validated as one: no separators, no `.`/`..`, no drive letters,
no Windows reserved device names (`con`, `nul`, `lpt1`, …), 64 characters max.

It is checked **untrimmed**, on purpose. Windows silently drops a trailing dot or
space, so `world ` and `world` name the same directory while looking like
different worlds; trimming inside the validator would have accepted one string
and used another, and would have made the trailing-space rule unable to fire at
all.

Refusals from the world layer — a running server, the active world, a name
already taken — come back as `409` with the underlying reason.

Export and import are **not** exposed. Both take a local filesystem path, and a
zip upload or download is a different shape of endpoint than the rest of this
surface. Tracked separately rather than half-done here.

## Backups

```
GET    /api/servers/:id/backups                          view
POST   /api/servers/:id/backups                          backups  { kind? }
POST   /api/servers/:id/backups/restore                  backups  { backupId, confirm }
DELETE /api/servers/:id/backups?backupId=&confirm=true   backups
```

`kind` is `world` (default) or `full`.

`destDir` is **not** accepted from the body, although `BackupOptions` supports
it. It is an arbitrary filesystem path, and a `backups`-scoped API caller able to
write a zip anywhere on the host is a different privilege from being able to back
up a world.

`backupId` is looked up within **this server's** backups. A backup id belonging
to another server is `404` here, not restorable by someone scoped to this one.

Restoring is refused with `409 server-running` while the server is up. Extracting
over a live world corrupts it: the server holds region files open and writes its
in-memory state back on its own schedule, so a restore part-way through leaves a
mix of old and new chunks and is then overwritten. Until this change that was
only a warning in the desktop dialog, which an API caller never reads.

## Audit

Every call writes an audit entry, successes and refusals alike:

| Action | Written when |
|---|---|
| `player.op`, `player.ban`, `player.kick`, … | any moderation call |
| `world.activate`, `world.clone`, `world.delete`, … | any world call |
| `backup.create`, `backup.restore`, `backup.delete` | any backup call |

`source` is `webpanel` for a session and `api` for a key; `actor` is the username
or `key:<label>`; `target` is the player or world name; `detail` carries the
reason, the new name, the dimension, or the failure.

A refused call is recorded with `ok: false` — an invalid player name or a missing
confirmation is worth being able to find, because both mean somebody's
integration is doing something it did not intend.

Mutating key calls **also** leave the generic `api.post` / `api.delete` entry
from #48. That is deliberate redundancy: it is the net for any route that forgets
to audit itself.

## Not in this surface

Still IPC-only, tracked in #53: files, server config and `server.properties`,
plugins/mods, Java install, metrics config, and creating or removing a server.
World export/import as noted above.
