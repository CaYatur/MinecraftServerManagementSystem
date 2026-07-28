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

## Files

```
GET    /api/servers/:id/files?path=            files   (directory listing)
GET    /api/servers/:id/files?path=&as=file    files   (file contents)
POST   /api/servers/:id/files                  files   { path, content }
POST   /api/servers/:id/files/folder           files   { path, name }
POST   /api/servers/:id/files/rename           files   { path, newName }
DELETE /api/servers/:id/files?path=&confirm=true   files
```

**Reading needs `files`, not `view`.** `server.properties` holds the RCON
password, and whatever else an operator has pasted into a config.

One endpoint serves both a listing and a file (`as=file`) because a caller
walking a tree does not know which it has until it looks.

`core/serverFiles.ts` refuses to leave the server root — every entry point runs
the path through the same `safe()` check — so a traversal comes back as
`400 path-escape` rather than reading anything. What it does *not* do is stop a
caller reaching the files that decide what runs: replacing a jar is code
execution on the next start. That is not a reason to block it (an operator edits
these constantly), but it is why `files` is its own scope and why every write is
audited **with its path**.

Deleting requires `?confirm=true`: nothing inside MSMS can bring the file back.

## Server config

```
GET  /api/servers/:id/config              settings
POST /api/servers/:id/config/properties   settings  { updates } or { raw }
POST /api/servers/:id/config/java         settings  (partial JavaArgsConfig)
POST /api/servers/:id/config/favorite     settings  { favorite }
```

A property value containing a newline is refused with `400 newline-in-value`:
in a properties file, a newline smuggles in a second key. `updates` merges, so a
targeted write leaves the rest of the file alone; send `raw` to replace it
wholesale.

The Java patch **merges** — send `{ maxMemoryMB: 3072 }` and the preset,
flags and jar stay as they were.

### Three Java fields are desktop-only

`javaPath`, `customArgs` and `extraFlags` are refused over HTTP with
`403 local-only-field`, whatever scope the caller holds.

They decide **what program MSMS executes**: `javaPath` is spawned as the process
binary, `customArgs` *is* the whole command line when the preset is `custom`, and
`extraFlags` is appended to the real one. Accepting them from a remote caller
would make `settings` mean "run arbitrary programs as the MSMS process", which is
not a settings field.

Over IPC they are fine, and stay editable in the desktop app: there the caller is
the operator at the machine, who already has full filesystem access, so a text
box grants them nothing new.

A patch mixing a safe field with a forbidden one is refused **whole** — the safe
half is not applied, so a caller never has to guess which part of their request
landed.

## Plugins and mods

```
GET    /api/servers/:id/mods                       files
GET    /api/servers/:id/mods/search?q=             files
GET    /api/servers/:id/mods/detail?projectId=     files
GET    /api/servers/:id/mods/updates               files
POST   /api/servers/:id/mods/install               files  { projectId, versionId? }
POST   /api/servers/:id/mods/update                files  { rel, versionId }
POST   /api/servers/:id/mods/toggle                files  { rel, enable }
DELETE /api/servers/:id/mods?rel=&confirm=true     files
```

**`files`, not a new `mods` scope.** Installing a plugin writes a jar into the
server directory and deleting one removes a file from it — both things `files`
already permits outright. A separate scope would be a strict subset of one the
caller must already hold to do the same work by hand: it would look like a
boundary while being none.

`rel` is a path relative to the server root and must start with `plugins/` or
`mods/`; anything else is `400 invalid-mod-path`. Install and update name a
**project**, never a URL — the download link is resolved server-side from that
project's own version list, and the file's SHA-1 is checked, so a caller cannot
point the writer at an arbitrary file.

Search, detail and update-check reach out to Modrinth. A network failure there
is `409` with the underlying reason; `updates` alone answers `{ ok: false }`
instead, because a list of plugins is still worth returning when the version
check is what failed.

## Host-wide settings

```
GET  /api/java?refresh=true      owner session
POST /api/java/install           owner session   { major }
GET  /api/telemetry              owner session
POST /api/telemetry              owner session   partial TelemetryConfig
```

None of these belong to one server, so a per-server scope cannot express them.
They require an **owner session**, and that has a consequence worth stating
plainly: `principalForKey` always builds a principal with `role: 'user'` —
a key carries scopes, never a role — so **no API key can reach these routes,
however it is scoped.** A key holding every scope on every server still gets
`403`. If you need them automated, drive them from a panel session.

`major` is the only input to a Java install, and it selects from Adoptium's
release list; the caller never names a URL or a path. Out-of-range values are
`400 invalid-major` before anything is downloaded.

The telemetry patch is **validated, not cast**: `enabled` must be a boolean and
the three retention numbers integers within range, and an unknown key is refused
rather than dropped. This config is persisted, so a bad value does not fail the
request that set it — it fails every metrics prune afterwards, across restarts,
from a config file nobody suspects. `{ enabled: "false" }` is the sharp case:
truthy, so it reads as *on* while the operator believes they turned it off.

## Deregistering a server

```
DELETE /api/servers/:id?confirm=true    owner session
```

Removes the server from MSMS and **leaves every file on disk**. Refused with
`409 server-running` while it is up — dropping a running server from the registry
orphans the process, because every lookup that would reach for its config to stop
it then 404s.

```json
{ "ok": true, "filesKept": true, "historyDropped": true, "alertRulesRemoved": 2 }
```

`filesKept` on its own would be a half-truth, which is why the other two fields
are there. Deregistering also deletes **MSMS's own records** for that server: the
metrics folder, the event timeline, and every alert rule aimed at it. Nothing
brings those back — a rescan re-adds the folder under a **new id**, with no
history attached. The server's files are recoverable; its history is not.

`alertRulesRemoved` is a count, not a flag, because it is the one part of that a
caller can be surprised by: an integration that set up rules through the API
loses them here, silently, unless the response says how many.

### Creating a server, and deleting its files, are not exposed

`addServer(path)` takes a host filesystem path chosen by the caller, and
`removeServer(id, true)` is a recursive delete of a directory tree. Those are the
same class of thing `javaPath` was refused for above: an HTTP caller does not
name paths on the host, and does not erase directories.

Deregistering is exposed because its worst case is bounded: the folder is
untouched and a rescan finds it again. That is the line — the half whose worst
case is "re-add it and lose the graphs" is on the surface; the half whose worst
case is "the world is gone" is not.

## Not in this surface

- **Creating or importing a server**, and deleting a server's files — above.
- **World export/import** — both take a local filesystem path, and a zip upload
  or download is a different shape of endpoint than the rest of this surface.
- **Backup schedules** — the scheduler is cron-shaped state rather than an
  operation; tracked separately.
