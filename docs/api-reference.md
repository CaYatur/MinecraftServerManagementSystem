# MSMS integration API

The surface a third-party application integrates with (#51, epic #52).

Three places describe it, and they are generated from **one** table
(`src/shared/apiSurface.ts`):

| | |
|---|---|
| [`docs/openapi.json`](openapi.json) | machine-readable OpenAPI 3.1 |
| `GET /api/v1/openapi.json` | the same document, served by the app |
| `GET /api/v1/docs` | a reference page, no internet required |

Plus the prose that explains *why* each rule is what it is:
[operations](api-operations.md) (moderation, worlds, backups, files, config,
mods, host settings) and [live streams](api-websocket.md) (the WebSocket).

A spec kept by hand beside a router drifts, and the half that drifts is always
the spec. `MSMS_SMOKE_WEB` reads the route literals out of `handlePanel`'s own
source and fails if the table does not document one of them — and fails the
other way too, if the table invents a route the router does not serve. It found
an undocumented store endpoint the first time it ran.

## Versioning

```
/api/v1/servers/:id/console     the published surface
/api/servers/:id/console        the same router; what the panel's page calls
```

`/api/v1/…` is rewritten to `/api/…` at the top of the handler — one route
table, not two. The prefix is a promise: **this shape does not change under a
caller.** A breaking change becomes `/api/v2`, not an edit to `v1`. The
unversioned form carries no such promise and exists because the panel bundle
uses it.

`GET /api/v1` needs no credential and answers with the version, the spec and
docs URLs, and the stream path. Neither it, the spec, nor the docs page contains
anything about the install — no server name, id or count — which is what makes
serving them unauthenticated a convenience rather than a disclosure. The smoke
asserts that.

## Authenticating

Issue a key in the panel under **API keys**. The secret is shown once.

```bash
curl -H "X-API-Key: msms_…"            http://127.0.0.1:8722/api/v1/servers
curl -H "Authorization: Bearer msms_…" http://127.0.0.1:8722/api/v1/servers
```

**A key is not a person.** It carries its own scopes and its own server
allowlist, inherits nothing from the account that issued it, and can never hold
a *role* — so the owner-only routes (`/java`, `/telemetry`, deregistering a
server) are reachable from a panel session and from nothing else, whatever
scopes the key is given. A key holding every scope on every server still gets
`403` there.

A session token from `POST /api/v1/login` works too, but an integration should
not use one: it expires, and the login endpoint is rate limited per address.

## Scopes

Per server. `view` `console` `power` `players` `worlds` `backups` `files`
`settings` `store`.

Two are not where you might expect:

- **Reading files needs `files`, not `view`** — `server.properties` holds the
  RCON password.
- **Installing a plugin needs `files`, not a `mods` scope** — it writes a jar
  into the server directory, which `files` already permits outright. A separate
  scope would be a strict subset of one the caller must already hold.

## Confirming destructive calls

`confirm` — in the body for `POST`, `?confirm=true` for `DELETE` — on top of the
scope, for: backup restore and delete, world delete and reset, file delete,
plugin delete, and deregistering a server.

Not a security boundary: a caller holding the scope can always pass the flag. It
is there because these are the calls an integration makes *by accident* — a
retry loop, a mis-set variable, an example copied without reading it. The
refusal is audited.

## Rate limits, CORS, TLS

Each key gets a token bucket: 120 of burst, refilling at 4/second. **WebSocket
upgrades spend from the same bucket**, so opening streams is not a way around
the request limit. Over budget is `429` with `Retry-After`.

Unauthenticated public storefront reads are limited per address instead (300
burst, 10/second), because there is no credential to attribute them to.

Cross-origin browser access is **default deny** — an origin must be listed in
the panel's web settings, and there is no wildcard branch. This surface is
authenticated with long-lived credentials, and `Access-Control-Allow-Origin: *`
beside a key a page can read is how a hostile site drives someone's server. A
page served by the panel itself is same-origin and always allowed.

The server is plain HTTP and binds to `127.0.0.1` unless the operator opts into
LAN. **TLS is your reverse proxy's job**, and exposing this beyond a LAN without
one exposes the keys.

## Audit

Every mutating call is recorded: `source` (`webpanel` or `api`), `actor` (the
username, or `key:<label>`), the target, and the outcome. **Refusals too** — an
invalid player name or a missing confirmation is worth being able to find,
because both mean somebody's integration is doing something it did not intend.

## Four flows

```bash
# what can this key see?
curl -H "X-API-Key: $KEY" http://127.0.0.1:8722/api/v1/servers

# start a server
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
     -d '{"action":"start"}' \
     http://127.0.0.1:8722/api/v1/servers/$ID/power

# run a console command
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
     -d '{"command":"say hello"}' \
     http://127.0.0.1:8722/api/v1/servers/$ID/command

# pay a player for voting
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
     -d '{"mcName":"Steve","amount":500,"reason":"vote reward"}' \
     http://127.0.0.1:8722/api/v1/servers/$ID/store/admin/balance
```

Subscribing to the console, from a browser:

```js
const ws = new WebSocket('ws://127.0.0.1:8722/api/v1/stream', [
  'msms.v1',
  'msms-key.' + KEY
])
ws.onopen = () =>
  ws.send(JSON.stringify({ op: 'subscribe', serverId: ID, streams: ['console', 'stats'] }))
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.type === 'console') console.log(m.line)
  if (m.type === 'stats') console.log(m.tps, 'TPS')
}
```

The credential rides in the subprotocol because the browser WebSocket API cannot
set headers, and **not** in the query string — a URL is the one part of a request
that lands in access logs, browser history and `Referer`.

## What is deliberately not here

- **Creating a server, or deleting one's files.** Both let a remote caller name
  a path on the host or erase a directory tree.
- **`javaPath`, `customArgs`, `extraFlags`.** They decide what program MSMS
  executes; accepting them would make `settings` mean "run arbitrary programs".
- **World export/import**, and **backup destination paths** — same reason: a
  filesystem path chosen by the caller.

Each is refused with a reason rather than left as a gap; see
[operations](api-operations.md).
