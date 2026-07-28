/**
 * The reference page served at `/api/v1/docs` (#51).
 *
 * Rendered from `apiSurface.ts`, the same table the OpenAPI document is
 * generated from, so the page and the spec cannot disagree about what exists.
 *
 * Self-contained: no CDN, no Swagger bundle, no fonts. The panel's CSP does not
 * allow external assets, and a documentation page that only works with an
 * internet connection is a poor way to document a program that manages a server
 * on a LAN.
 */
import { API_ROUTES, API_PREFIX, apiGroups, type ApiRoute } from '@shared/apiSurface'
import { WS_PATH, WS_STREAMS } from './wsHub'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `code` spans and **bold** in the table's prose, and nothing else. */
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br/>')
}

const GATE_CLASS: Record<string, string> = {
  public: 'g-public',
  any: 'g-any',
  owner: 'g-owner'
}

function row(r: ApiRoute): string {
  const params = (r.params ?? []).filter((p) => p.in === 'query')
  const query = params.length
    ? '<div class="q">' +
      params
        .map((p) => '<code>' + esc(p.name) + '</code>' + (p.required ? '<sup>*</sup>' : ''))
        .join(' ') +
      '</div>'
    : ''
  const body = r.body
    ? '<div class="q">' +
      Object.keys(r.body)
        .map((k) => '<code>' + esc(k) + '</code>')
        .join(' ') +
      '</div>'
    : ''
  return (
    '<tr>' +
    '<td><span class="m m-' + r.method.toLowerCase() + '">' + r.method + '</span></td>' +
    '<td class="p"><code>' + esc(API_PREFIX + (r.path === '/' ? '' : r.path)) + '</code>' + query + body + '</td>' +
    '<td><span class="gate ' + (GATE_CLASS[r.gate] ?? 'g-scope') + '">' + esc(r.gate) + '</span></td>' +
    '<td>' + inline(r.summary) + (r.confirm ? ' <span class="warn">confirm</span>' : '') +
    (r.notes ? '<div class="note">' + inline(r.notes) + '</div>' : '') +
    '</td></tr>'
  )
}

export function getApiDocsHtml(): string {
  const groups = apiGroups()
    .map(
      (g) =>
        '<h3 id="g-' + esc(g) + '">' + esc(g) + '</h3><table><thead><tr>' +
        '<th>Method</th><th>Path</th><th>Needs</th><th>What it does</th></tr></thead><tbody>' +
        API_ROUTES.filter((r) => r.group === g).map(row).join('') +
        '</tbody></table>'
    )
    .join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MSMS API ${esc(API_PREFIX)}</title>
<style>
:root{color-scheme:dark;--bg:#0d0d11;--panel:#15151b;--line:rgba(255,255,255,.12);--text:#e8e8ee;--muted:#9a9aa8;--accent:#dc2727}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:34px 20px 80px}
h1{font-size:27px;letter-spacing:-.6px;margin:0 0 6px}
h2{font-size:19px;letter-spacing:-.3px;margin:34px 0 10px;padding-top:14px;border-top:1px solid var(--line)}
h3{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:26px 0 8px}
p,li{color:#cfcfd8}
code{background:rgba(255,255,255,.07);border-radius:5px;padding:1px 5px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
pre{background:#08080c;border:1px solid var(--line);border-radius:10px;padding:13px 15px;overflow:auto}
pre code{background:none;padding:0;font-size:12.5px;line-height:1.55}
table{width:100%;border-collapse:collapse;margin:0 0 10px;font-size:13px}
th{text-align:left;color:var(--muted);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;
  border-bottom:1px solid var(--line);padding:6px 8px}
td{border-bottom:1px solid rgba(255,255,255,.06);padding:8px;vertical-align:top}
td.p{white-space:nowrap}
.m{font-weight:800;font-size:11px;padding:2px 7px;border-radius:999px;letter-spacing:.04em}
.m-get{background:rgba(56,139,253,.18);color:#79b8ff}
.m-post{background:rgba(63,185,80,.18);color:#7ee787}
.m-delete{background:rgba(248,81,73,.18);color:#ff9492}
.gate{font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.g-owner{border-color:var(--accent);color:#ff9b9b}
.g-public{color:#7ee787;border-color:rgba(63,185,80,.5)}
.g-any{color:var(--muted)}
.warn{font-size:10.5px;font-weight:800;color:#ffcc66;border:1px solid rgba(255,204,102,.4);border-radius:999px;padding:1px 6px}
.note{color:var(--muted);font-size:12px;margin-top:4px}
.q{margin-top:4px}
.q code{font-size:11.5px;background:rgba(255,255,255,.04)}
sup{color:var(--accent)}
.lede{color:var(--muted);font-size:15px;margin:0 0 20px}
.cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin:14px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:12px 14px}
.card b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px}
a{color:#79b8ff}
</style></head><body><div class="wrap">

<h1>MSMS integration API</h1>
<p class="lede">Everything a third-party application can read and drive, over HTTP and one WebSocket.
<a href="${esc(API_PREFIX)}/openapi.json">OpenAPI document</a>.</p>

<h2>Authenticating</h2>
<p>Issue a key in the panel under <b>API keys</b>. The secret is shown once. Send it either way:</p>
<pre><code>curl -H "X-API-Key: msms_…" http://127.0.0.1:8722${esc(API_PREFIX)}/servers
curl -H "Authorization: Bearer msms_…" http://127.0.0.1:8722${esc(API_PREFIX)}/servers</code></pre>
<p><b>A key is not a person.</b> It carries its own scopes and its own server
allowlist, inherits nothing from an account, and can never hold a <i>role</i> —
so the owner-only routes below are reachable from a panel session and from
nothing else, whatever scopes a key is given.</p>

<h2>Scopes</h2>
<div class="cards">
<div class="card"><b>view</b>status, console history, roster, worlds, backups, metrics, map</div>
<div class="card"><b>console</b>run a console command</div>
<div class="card"><b>power</b>start / stop / restart / kill</div>
<div class="card"><b>players</b>op, ban, kick, whitelist, gamemode</div>
<div class="card"><b>worlds</b>activate, rename, clone, reset, delete a world</div>
<div class="card"><b>backups</b>create, restore, delete a backup</div>
<div class="card"><b>files</b>read and write server files, install plugins</div>
<div class="card"><b>settings</b>server.properties, Java args, site content</div>
<div class="card"><b>store</b>products, balances, categories</div>
</div>
<p>Scopes are <b>per server</b>. Reading files needs <code>files</code> rather than
<code>view</code>, because <code>server.properties</code> holds the RCON password.</p>

<h2>Confirming destructive calls</h2>
<p>Restoring or deleting a backup, deleting or resetting a world, deleting a file
or a plugin, and deregistering a server all need <code>confirm</code> —
in the body for <code>POST</code>, as <code>?confirm=true</code> for
<code>DELETE</code> — on top of the scope.</p>
<p>This is not a security boundary: a caller holding the scope can always pass
the flag. It is there because these are the calls an integration makes
<i>by accident</i> — a retry loop, a mis-set variable, an example copied without
reading it. The refusal is audited too.</p>

<h2>Versioning</h2>
<p><code>${esc(API_PREFIX)}</code> is the published surface. The same routes also answer
under <code>/api/…</code>, which is what the panel's own page calls and carries
no stability promise. A breaking change becomes <code>/api/v2</code>; it will not
be an edit to <code>v1</code>.</p>

<h2>Rate limits and CORS</h2>
<p>Each key gets a token bucket — 120 requests of burst, refilling at 4/second —
shared with WebSocket upgrades, so opening streams is not a way around it. Over
budget is <code>429</code> with <code>Retry-After</code>.</p>
<p>Cross-origin browser access is <b>default deny</b>: an origin must be listed in
the panel's web settings. There is no wildcard branch, deliberately — this
surface is authenticated with long-lived credentials, and
<code>Access-Control-Allow-Origin: *</code> beside a key a page can read is how a
hostile site drives someone's server.</p>

<h2>Live streams</h2>
<p><code>${esc(WS_PATH)}</code> pushes ${WS_STREAMS.map((s) => '<code>' + esc(s) + '</code>').join(', ')}
per server, gated on <code>view</code>. Browsers cannot set headers on a
WebSocket, so the credential rides in the subprotocol:</p>
<pre><code>const ws = new WebSocket('ws://127.0.0.1:8722${esc(WS_PATH)}', ['msms.v1', 'msms-key.msms_…'])
ws.onopen = () => ws.send(JSON.stringify({ op: 'subscribe', serverId: id, streams: ['console'] }))
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.type === 'console') console.log(m.line)
}</code></pre>
<p>There is no operation on the socket: a subscriber has nothing to send but
subscriptions. Full protocol in <code>docs/api-websocket.md</code>.</p>

<h2>Common flows</h2>
<pre><code># what can I see?
curl -H "X-API-Key: $KEY" http://127.0.0.1:8722${esc(API_PREFIX)}/servers

# start it
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \\
     -d '{"action":"start"}' http://127.0.0.1:8722${esc(API_PREFIX)}/servers/$ID/power

# say something
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \\
     -d '{"command":"say hello"}' http://127.0.0.1:8722${esc(API_PREFIX)}/servers/$ID/command

# grant a player 500 coins
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \\
     -d '{"mcName":"Steve","amount":500,"reason":"vote reward"}' \\
     http://127.0.0.1:8722${esc(API_PREFIX)}/servers/$ID/store/admin/balance</code></pre>

<h2>Every route</h2>
<p>A <sup>*</sup> marks a required query parameter. Everything mutating is audited,
successes and refusals alike.</p>
${groups}

</div></body></html>`
}
