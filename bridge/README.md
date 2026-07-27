# MSMS Bridge (Java plugin)

Reports what the console cannot: true TPS and **MSPT** read off the tick loop, player positions, and structured world events.

It prints one marked line per message to the server's **standard output** — a stream MSMS already reads. No port, no socket, no firewall rule, no credentials. See [`docs/bridge-protocol.md`](../docs/bridge-protocol.md) for the wire format.

## Build

```bash
node bridge/build.mjs
```

Produces `bridge/build/MSMS-Bridge-1.0.0.jar`. Requires **JDK 21+** and Node; compile dependencies are downloaded once into `bridge/.deps/` and cached.

There is no Maven or Gradle here on purpose. The plugin is three small source files with **no runtime dependencies**, and requiring a second build system to produce a 6 KB jar would put it out of reach of most people who want to change it.

## Install

Drop the jar into your server's `plugins/` folder and restart.

Requires a server that provides `getTPS()` and `getAverageTickTime()` — **Paper and its forks** (Purpur, Folia), and **Spigot**. Everything else the plugin calls is plain Bukkit API: it deliberately avoids Paper-only conveniences like `getPluginMeta()` and `getMinecraftVersion()`, which would throw `NoSuchMethodError` on Spigot.

`config.yml`:

```yaml
# How often the bridge reports TPS, MSPT and player positions.
interval-seconds: 5
```

MSMS picks the bridge up automatically — the Dashboard starts showing **ms/tick** and "Bridge active" once the first `hello` arrives, and falls back to RCON within ~2.5 intervals if the plugin stops reporting.

## Verify the wire format without a server

```bash
node bridge/build.mjs --selftest
```

Prints one of every message shape — built with the **same** `Json` helpers the plugin uses — including a player name carrying a quote, a backslash, a newline and a control character, and a line wrapped in a log4j2 prefix. Pipe it through the app's `parseBridgeLine` to confirm end-to-end conformance.

## Layout

| | |
|---|---|
| `MsmsBridge.java` | the plugin: hello / tick / players / event / bye |
| `Json.java` | dependency-free JSON writing, split out so it is testable |
| `SelfTest.java` | prints every message shape; **not** shipped in the jar |
| `build.mjs` | fetch deps, compile, package |

## Status and limits

- **Not run against a live Minecraft server in development.** The jar compiles against the Paper 1.21.4 API and its output is verified byte-for-byte against the app's parser, but no one has watched it start inside a real server here. Treat the first run as a test.
- `getAverageTickTime()` and `getTPS()` are Paper/Spigot extensions. A server that lacks them will not load the plugin. Everything else is plain Bukkit API, so Spigot is supported.
- The heartbeat runs on the **main thread** — reading the player list and their locations is main-thread state. It is a handful of field reads every few seconds, but it is not free.
- Events are currently only `player.death`. Joins and leaves are deliberately left to the console parser, which already handles them, so the two do not double-count.
