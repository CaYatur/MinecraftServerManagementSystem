# MSMS Bridge — stdout protocol v1

The **MSMS Bridge** is an in-server plugin that reports telemetry the console cannot otherwise expose — true TPS/MSPT read straight off the tick loop, player positions, world events.

It reports by **printing one marked line per message to the server's standard output**.

## Why stdout

MSMS already reads the server process's stdout to render the console. Riding that pipe means the bridge needs **no extra port, no socket, no firewall hole, and no authentication** — the transport is a stream only the parent process can see, and it works identically for a LAN server, a remote box behind NAT, and a server with every port closed.

The cost is that the channel is one-way (plugin → app) and shares the console stream, which is why every message is marked and every parse failure is non-fatal.

---

## Line format

```
…anything… [MSMS-BRIDGE] {"v":1,"t":"tick","tps":19.98,"tps5":19.9,"tps15":19.87,"mspt":3.4}
```

A message is a **single line** that *contains* the marker `[MSMS-BRIDGE]`, followed by a compact JSON object.

### The marker is not anchored to column 0 — this is essential

Paper and Spigot route `System.out` through log4j2, so a line the plugin prints as

```
[MSMS-BRIDGE] {"v":1,...}
```

reaches the app as

```
[12:34:56 INFO]: [MSMS-BRIDGE] {"v":1,...}
```

…sometimes with a `[STDOUT]` tag in between, and never at column 0. A parser that anchored to the start of the line would work in a unit test and see nothing at all on a real server.

`parseBridgeLine` therefore locates the marker **wherever it sits** and parses the JSON after it. Lines carrying the marker are consumed and hidden from the console view; everything else passes through untouched.

### Rules for the plugin side

- **One message per line.** No pretty-printing — a newline inside the JSON splits the message.
- **No newlines inside string values.**
- Emit on the plugin's own scheduler; do not block the main thread to print.
- Every message carries `v` (protocol version). This document describes `v: 1`.

---

## Message types

### `hello` — sent once, on plugin enable

```json
{"v":1,"t":"hello","plugin":"MSMS-Bridge","pluginVersion":"1.0.0","server":"Paper","mc":"1.21.4","interval":5000}
```

`plugin`, `pluginVersion`, `server` and `mc` are **required** — a `hello` missing any of them is rejected. `interval` is the heartbeat cadence the plugin intends to use, in ms; when absent the app assumes `5000`.

### `tick` — the heartbeat

```json
{"v":1,"t":"tick","tps":19.98,"tps5":19.90,"tps15":19.87,"mspt":3.4}
```

`tps` is **required**; `tps5`, `tps15` and `mspt` may be `null` while the server is still warming up. Values are taken **as reported** — the protocol layer does no clamping or rounding, so a nonsense reading stays visible rather than being silently normalised into something plausible.

### `players` — roster and positions

```json
{"v":1,"t":"players","online":2,"list":[
  {"name":"Steve","uuid":"…","world":"world","dim":"overworld","x":112.5,"y":68,"z":-40.25}
]}
```

`online` is required. Every field of a list entry except `name` is optional, and an entry without a `name` is dropped rather than invalidating the whole message — a partially-readable roster beats no roster.

### `event` — world/game events

```json
{"v":1,"t":"event","kind":"world.explosion","text":"creeper at spawn","data":{"x":10,"y":64,"z":-2}}
```

`kind` is required; `text` and `data` are optional.

### `bye` — sent on plugin disable

```json
{"v":1,"t":"bye"}
```

---

## How the app treats bridge data

### Freshness beats liveness

Bridge telemetry is trusted **only while it is fresh**:

```
fresh  ⇔  connected  ∧  lastMessageTs > 0  ∧  (now − lastMessageTs) < interval × 2.5
```

The `2.5` factor is generous enough to survive a GC pause or one dropped heartbeat, and short enough that a **crashed plugin cannot pin a frozen TPS on screen indefinitely**.

### Reconciliation with RCON

`reconcileTps` decides what the dashboard shows:

- **Fresh bridge reading wins** over RCON — it is truer, and it carries MSPT, which RCON's `tps` command cannot provide.
- **Stale or absent bridge** → fall back to the RCON reading, or to the last known value if RCON has none, and report `bridge: false` so the UI stops claiming "Bridge active".

This is the guard that matters: without it, a dead plugin's last reading would look like a healthy server forever.

### Parse failures

`parseBridgeLine` returns `null` for a line with no marker **and** for a marked line whose payload is malformed or of an unknown type. Callers distinguish the two with `hasBridgeMarker`:

- **marked but unparsable** → a protocol error worth a warning (most likely a version mismatch)
- **unmarked** → an ordinary log line

A malformed bridge line never throws and never interrupts the console stream.

---

## Versioning

`v` is checked by the consumer, not by the parser. A future `v: 2` should keep the same marker and envelope so that a v1 app can recognise a v2 line as *a bridge message it does not understand* — a warning — rather than as console noise.

---

## Status

`shared/bridge.ts` (app side) is implemented and covered by `MSMS_SMOKE_BRIDGE=1`, which replays real log4j2-prefixed lines, malformed payloads, and the fresh/stale/fallback reconciliation.

**The Java plugin that emits these messages does not exist yet** — tracked in #19, #20 and #21. Until it ships, nothing on a real server produces these lines, and the app simply never sees a bridge.
