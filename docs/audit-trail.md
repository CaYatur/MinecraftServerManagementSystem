# The audit trail

The audit trail is the **"who did what, from where, and did it work"** record.

It is deliberately separate from the two other history surfaces:

| | What it records | Scope | Store |
|---|---|---|---|
| **Audit trail** | actor-attributed administrative and security actions | **global** — survives server deletion | `msms-data/audit/audit.jsonl` |
| **Event log** | exhaustively-typed game and lifecycle facts | per-server | per-server JSONL |
| **Metrics** | CPU / RAM / TPS / player samples | per-server | CSV tiers |

The split matters: a login attempt, a permission grant or a balance change is not a *server* fact, and several of them are not tied to any server at all. Deleting a server must not erase the record of who deleted it.

---

## What an entry looks like

```jsonc
{
  "id": "b1e0…",
  "ts": 1753632000000,
  "source": "webpanel",
  "action": "server.stop",
  "actor": "moderator_kaan",
  "ok": true,
  "ip": "192.168.1.44",
  "serverId": "srv_7ab3",
  "target": "TestServer",
  "detail": "graceful"
}
```

| Field | Meaning |
|---|---|
| `ts` | epoch ms — the only key the store is ordered by |
| `source` | where the action came from (see below) |
| `action` | namespaced free string, e.g. `server.start`, `login`, `purchase` |
| `actor` | web username, player name, or `operator` for the local desktop user |
| `ok` | **outcome** — `false` entries are kept deliberately |
| `ip` | present when the action arrived over the network |
| `serverId` | present when the action targeted a server |
| `target` / `detail` / `data` | what was acted on, and context |

### Why `action` is not a fixed union

A persisted log has to remain readable when written by an older or newer build, and actions are numerous and cross-source. `action` is therefore a namespaced free string. The UI keeps a label map for known actions and falls back to showing the raw string for anything else — a new action type never renders as a blank row.

### Why failures are stored

`ok: false` is the point, not an edge case. A trail that only kept successes would hide exactly the thing you audit for: **denied logins**, refused permission changes, rejected purchases. A failed login records *who tried* and from which IP.

---

## Sources

| `source` | Comes from |
|---|---|
| `console` | a command typed into the desktop server console |
| `panel` | desktop app administration (start/stop/restart/kill, create/remove server, Java install) |
| `webpanel` | an authenticated web-panel user |
| `public` | the public site (registration, purchases, public login attempts) |
| `system` | MSMS itself, with no human actor |

## Actions currently recorded

This list is read off the actual `audit.record` call sites, not aspirational:

| Action | Sources |
|---|---|
| `login` | `webpanel`, `public` — **success and failure**, with the attempted username |
| `account.register` | `public` |
| `user.audit-grant` | `panel` — both grant and revoke |
| `server.start` / `.stop` / `.restart` / `.kill` | `panel`, `webpanel` |
| `server.create` / `server.remove` | `panel` |
| `command.run` | **`console`** (desktop console), `webpanel` — success and failure; the command text is the `target` |
| `purchase` | `public` |
| `java.install` | `panel` |
| `balance.grant` / `balance.remove` / `balance.set` | `panel` (desktop), `webpanel`, `api` — success and refusal |
| `apikey.create` / `apikey.revoke` / `apikey.delete` | `panel` (desktop), `webpanel` |
| `api.post` / `api.delete` | `api` — any mutating call made with an API key |

### Balance administration

A player *spending* currency is audited as `purchase`. An admin *creating*
currency out of nothing used to be recorded only in the economy ledger, which
made the higher-privilege action of the two the one missing from the global
trail (#68, fixed).

Both are audited now:

- `detail` carries the **applied** delta and the resulting balance, e.g.
  `-300 -> 0 (correction)`. Applied, not requested: `addBalance` clamps at zero,
  so an admin asking to remove 500 from a balance of 300 removes 300, and an
  entry claiming 500 would be a false record.
- The entry is written inside `addBalance`/`setBalance` rather than at each call
  site, so the desktop, the web panel and an API key cannot drift apart.
- A refused change (`invalid-mcname`) is recorded with `ok: false`. An admin
  action aimed at a name that is not a valid Minecraft username is either a typo
  or somebody probing, and both are worth seeing.

The ledger keeps its own copy and was **not** replaced. The two answer different
questions: the ledger is per-server balance history that renders without a join,
the audit trail is the global record of privileged actions.

---

## Attribution: how `actor` is decided

Attribution is set at the **call site**, never inferred later:

- **Web panel / public site** — the authenticated session's username, and `ip` from the socket.
- **Desktop app** — `operator`. The desktop has no user accounts; the person at the machine already has full filesystem access, so inventing an identity for them would be theatre.
- **Purchases** — the buying player's Minecraft name.

The economy keeps its own attribution on each `LedgerEntry.by` (`purchase`, `desktop`, or the web username), which is what both the desktop Store view and the web panel display and search. Since #68 the same change is *also* in the audit trail, so a global query for privileged activity finds it without going per-server.

---

## Retention

Pruned by **age and volume only**:

- `MAX_AGE_DAYS = 180`
- `MAX_AUDIT = 20000` entries (oldest dropped first)

Pruning runs periodically and after every ~300 writes. Nothing else deletes entries — in particular **deleting a server does not remove its audit history**, which is the whole reason the store is global.

---

## Reading it

### Desktop

The **Audit** view (global, in the sidebar — not under a server) has two modes:

- **Log** — filter by source, outcome (all / success / failed), and free text across action, actor, target, detail, IP and server.
- **Joins & alts** — accounts grouped by name and by IP, so shared IPs surface as possible alt-account clusters. This is **computed from existing `player.join` events**, not a second store; no IP is recorded twice for it.

### Web panel

`GET /api/audit` mirrors the desktop query. It is gated on **owner OR the account-level `canAudit` flag** — never on a per-server scope, because the audit log is global and contains IP addresses, which are personal data.

`canAudit` is granted from the **desktop app only**. It is deliberately not a web route: a user with the `settings` scope could otherwise grant it to themselves, which is privilege escalation. Both granting and revoking are themselves audited as `user.audit-grant`.

---

## Verifying it

`MSMS_SMOKE_AUDIT=1` covers the pure filter combinations, the store round-trip and age pruning. `MSMS_SMOKE_WEB=1` covers login attribution end-to-end and the gating on `/api/audit`. Both report their verdict as the **process exit code**.
