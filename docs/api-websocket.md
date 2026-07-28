# Versioned surface and live streams

`/api/v1` and the WebSocket at `/api/v1/stream` (#27, part of epic #52).

## `/api/v1` is the published surface

Every route documented in [api-operations.md](api-operations.md) is reachable
under **both** prefixes:

```
GET /api/servers/:id/players        # what the panel's own page calls
GET /api/v1/servers/:id/players     # what an integration should call
```

They are the same router. `/api/v1/…` is rewritten to `/api/…` at the top of the
handler — one route table, not two, because two tables drift and the one that
drifts is always the documented one.

What the prefix adds is a promise: **this shape does not change under a caller.**
A breaking change would be a `v2` prefix, not an edit to `v1`. The unversioned
form carries no such promise; it exists because the panel bundle uses it.

`GET /api/v1` needs no credential and answers with the version and the stream
path. It is a description of the software, identical on every install — there is
no server name, id or count in it.

## The stream

```
GET /api/v1/stream        Upgrade: websocket
```

One socket, any number of servers, four streams each:

| Stream | Carries |
|---|---|
| `console` | every console line, as it is written |
| `status` | run-state changes (`starting`, `running`, `stopping`, `stopped`) |
| `stats` | the same sample the metric store records: TPS, CPU, RSS, players |
| `events` | timeline events (joins, backups, crashes, alerts…) |

All four are **reads**, gated on the `view` scope for that server — the same
scope the equivalent HTTP reads need. There is no operation on this socket: no
op starts a server, runs a command or changes anything. That is not a policy, it
is the shape of the protocol — a subscriber has nothing to send but
subscriptions.

### Authenticating

Two ways, because browsers only have one of them:

```
Authorization: Bearer msms_…          # or a session token
X-API-Key: msms_…
```

```js
new WebSocket('ws://127.0.0.1:8722/api/v1/stream', ['msms.v1', 'msms-key.msms_…'])
```

The browser WebSocket API cannot set headers, so the credential rides in
`Sec-WebSocket-Protocol` instead. Key secrets are `msms_<uuid>.<base64url>`, and
every character of that is a valid HTTP token character, so they need no
encoding. The server echoes back **`msms.v1`** and never the element carrying the
credential.

A query parameter is deliberately **not** accepted. The URL is the one part of a
request that lands in access logs, browser history and `Referer` headers, which
is a poor home for a long-lived credential.

### Origin

An upgrade carrying an `Origin` the operator has not allowed is refused with
`403`, using the same allowlist as the REST CORS check (`apiOrigins` in web
settings) — **plus** the request's own origin, which is always accepted. A page
served by this listener is exactly as trusted as the listener; the allowlist
exists for *cross*-origin callers, and applying it alone would refuse the admin
panel's own page until an operator thought to allowlist their own address. The
comparison is against the request's `Host`, which carries the port, so another
service on the same machine is still cross-origin.

This matters more here than on the REST side: **browsers do not apply CORS to
WebSocket.** Any page on any origin can open one to `127.0.0.1` and read
whatever comes back. The server-side origin check is the only thing standing
there, and it is why `server.on('upgrade')` cannot simply be wired to a socket —
it bypasses every guard the request handler applies.

### Talking

Client to server, one JSON object per message:

```json
{ "op": "subscribe",   "serverId": "…", "streams": ["console", "stats"] }
{ "op": "unsubscribe", "serverId": "…", "streams": ["console"] }
{ "op": "ping" }
```

Server to client:

```json
{ "type": "hello", "protocol": "msms.v1", "streams": [...], "user": "…" }
{ "type": "subscribed", "serverId": "…", "streams": [...] }
{ "type": "console", "serverId": "…", "ts": 1730000000000, "line": "…", "stream": "stdout" }
{ "type": "status",  "serverId": "…", "status": "running", "pid": 1234 }
{ "type": "stats",   "serverId": "…", "cpu": 12, "memoryMB": 2048, "tps": 19.8, "players": {…} }
{ "type": "events",  "serverId": "…", "event": { … } }
{ "type": "error",   "error": "forbidden", "need": "view", "serverId": "…" }
```

Scope is re-checked **at send time**, not only at subscribe time. Permissions
change while a socket is open, and a stream that keeps flowing after the scope
was revoked is a revocation that did not happen.

### Limits

| | |
|---|---|
| Message size | 64 KB, assembled — fragments are not a way around it (`1009`) |
| Connections | 64 per process, 8 per credential |
| Backpressure | 1 MB of unwritten data closes the socket with `1013` |
| Keepalive | server ping every 30s; no pong for 75s closes with `1001` |
| Rate limit | the upgrade spends from the **same** per-key token bucket as HTTP |

The backpressure rule is the one worth understanding. `socket.write()` returning
`false` does not stop anything — the data queues in memory. A subscriber to a
busy console that stops reading (a suspended laptop, a hung client) is therefore
an unbounded allocation on the server. Past 1 MB the connection is closed rather
than trimmed: a console feed with invisible holes in it is worse than one that
ends and says why.

Protocol violations — an unmasked frame, a fragmented control frame, a reserved
bit, invalid UTF-8 in a text frame — close the connection with the RFC 6455 code
and are not tolerated.

## No WebSocket dependency

The framing is implemented in `shared/wsframe.ts`, about 300 lines of pure
`Uint8Array` work, rather than by adding a package to a portable build for a
protocol whose entire framing fits on one page.

Being pure is also what makes it testable: the interesting failures — a frame
split across two reads, three frames in one read, an unmasked client frame, a
message assembled from fragments past the size cap — are exactly the ones a
live test over loopback never produces by accident. `MSMS_SMOKE_WEB` drives the
parser through all of them, then opens a real socket and checks the handshake,
both auth paths, the origin refusal, a live console line and a deliberate
protocol violation.
