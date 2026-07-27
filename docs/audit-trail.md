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

### Known gap: balance changes are not in the audit trail

An admin granting, removing or setting a player's balance is recorded in the
**economy ledger** (`LedgerEntry.by` — the web username, `desktop`, or
`purchase`) but **not** in the audit trail. The ledger answers "who changed this
balance" fully, and the desktop and panel both display and search it — but a
query over the audit trail alone will not show balance administration.

Purchases *are* audited (as `purchase`, from `public`), so the two economy
paths are currently inconsistent. Tracked in #68.

---

## Attribution: how `actor` is decided

Attribution is set at the **call site**, never inferred later:

- **Web panel / public site** — the authenticated session's username, and `ip` from the socket.
- **Desktop app** — `operator`. The desktop has no user accounts; the person at the machine already has full filesystem access, so inventing an identity for them would be theatre.
- **Purchases** — the buying player's Minecraft name.

The economy keeps its own attribution on each `LedgerEntry.by` (`purchase`, `desktop`, or the web username). Today this is the **only** record of who changed a balance — see the known gap above — and it is what both the desktop Store view and the web panel display and search.

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
