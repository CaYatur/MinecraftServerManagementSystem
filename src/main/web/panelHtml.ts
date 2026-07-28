// Self-contained, responsive (mobile-friendly) web panel served by the embedded
// HTTP server. Vanilla JS; authenticates with a bearer token in localStorage.
import { CRATE_CSS, CRATE_JS, CRATE_MODAL_HTML } from '@shared/crateUi'
import { STORE_CSS, STORE_JS, STORE_MODAL_HTML, CRATE_ICON_SVG } from '@shared/storeUi'
import { MAP_CSS, MAP_HTML, MAP_JS } from '@shared/mapUi'
export function getPanelHtml(): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="theme-color" content="#0b0b10"/>
<title>CaYaDev Panel</title>
<style>
:root{--bg:#0b0b10;--panel:#16151b;--elev:#1b1a22;--hover:#232231;--border:#2a2a36;--text:#e7e9ee;--dim:#9aa0ad;
 --accent:#dc2727;--accent2:#a81d1d;--online:#4ade80;--warn:#fbbf24;--info:#60a5fa;
 --glow:rgba(220,39,39,.45);--radius:14px}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text);font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;font-size:15px;-webkit-font-smoothing:antialiased}
/* ambient backdrop, same language as the public site */
body::before{content:'';position:fixed;inset:-20% -10%;z-index:-2;pointer-events:none;
 background:radial-gradient(50% 40% at 18% 0%,rgba(220,39,39,.20),transparent 70%),
            radial-gradient(45% 35% at 86% 10%,rgba(220,39,39,.12),transparent 70%);
 animation:drift 26s ease-in-out infinite alternate}
body::after{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.45;
 background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);
 background-size:60px 60px;
 -webkit-mask-image:radial-gradient(70% 55% at 50% 0%,#000,transparent 78%);
 mask-image:radial-gradient(70% 55% at 50% 0%,#000,transparent 78%)}
@keyframes drift{to{transform:translate3d(0,30px,0) scale(1.05)}}
a{color:var(--accent)}
.topbar{position:sticky;top:0;z-index:30;backdrop-filter:blur(14px) saturate(140%);background:rgba(11,11,16,.72);border-bottom:1px solid var(--border)}
.topbar .wrap{display:flex;align-items:center;gap:10px;padding:12px 16px}
.wrap{max-width:1040px;margin:0 auto;padding:16px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:.4px}
.logo{width:32px;height:32px;filter:drop-shadow(0 4px 12px var(--glow))}
.card{position:relative;background:linear-gradient(165deg,rgba(30,29,38,.92),rgba(16,15,22,.92));
 border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin:14px 0}
.card.tight{padding:0;overflow:hidden}
input,button,select,textarea{font-family:inherit;font-size:15px}
input,select,textarea{width:100%;padding:11px 13px;background:#101019;border:1px solid var(--border);border-radius:10px;color:var(--text);margin:6px 0}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(220,39,39,.14)}
.btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 15px;border-radius:10px;
 border:1px solid var(--border);background:var(--elev);color:var(--text);font-weight:650;cursor:pointer;transition:.16s;overflow:hidden}
.btn::after{content:'';position:absolute;top:0;bottom:0;left:-60%;width:40%;transform:skewX(-20deg);
 background:linear-gradient(90deg,transparent,rgba(255,255,255,.16),transparent);transition:left .5s ease}
.btn:hover::after{left:130%}
.btn:hover{background:var(--hover);border-color:rgba(220,39,39,.5);transform:translateY(-1px)}
.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#fff;box-shadow:0 8px 22px -12px var(--glow)}
.btn.primary:hover{filter:brightness(1.08)}
.btn.danger{border-color:rgba(248,113,113,.5);color:#f87171}
.btn.block{width:100%}
.btn.sm{padding:8px 11px;font-size:13px;border-radius:9px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.spacer{flex:1}
.dim{color:var(--dim)}
.badge{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;background:var(--hover);border:1px solid var(--border);color:var(--dim)}
.dot{width:8px;height:8px;border-radius:50%;background:#6b7280;flex:none}
.dot.running{background:var(--online);box-shadow:0 0 10px var(--online);animation:beat 2s ease-in-out infinite}
.dot.crashed{background:var(--accent);box-shadow:0 0 10px var(--accent)}
.dot.starting,.dot.stopping{background:var(--warn)}
@keyframes beat{50%{box-shadow:0 0 16px 3px var(--online)}}
/* server list */
.srv{display:flex;align-items:center;gap:13px;padding:16px;border:1px solid var(--border);border-radius:var(--radius);
 background:linear-gradient(165deg,rgba(30,29,38,.9),rgba(16,15,22,.9));margin:11px 0;cursor:pointer;transition:.18s}
.srv:hover{border-color:rgba(220,39,39,.45);transform:translateY(-2px);box-shadow:0 18px 36px -26px var(--glow)}
.srv .meta{flex:1;min-width:0}
.srv .name{font-weight:750;font-size:16px}
.srv .chev{color:var(--dim);font-size:20px}
/* stats row */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:12px 0}
.stat{border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:rgba(16,15,22,.7)}
.stat b{display:block;font-size:20px;font-weight:850;letter-spacing:-.4px;line-height:1.25}
.stat span{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--dim);font-weight:700}
.stat.bad b{color:#f87171}
/* charts */
.spark{width:100%;height:46px;display:block}
.spark path.line{fill:none;stroke-width:1.8;vector-effect:non-scaling-stroke}
.spark path.area{opacity:.16}
.chartcard{border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:rgba(16,15,22,.7)}
.chartcard .hd{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;margin-bottom:4px}
.chartcard .hd b{font-weight:750}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
/* console */
.console{background:#08080c;border:1px solid var(--border);border-radius:12px;padding:13px;font-family:ui-monospace,Consolas,monospace;
 font-size:12.5px;line-height:1.55;height:52vh;overflow:auto;white-space:pre-wrap;word-break:break-word}
.console .warn{color:var(--warn)}.console .err{color:#f87171}.console .sys{color:var(--info)}
.hidden{display:none!important}
.err-msg{color:#f87171;font-size:13px;margin-top:8px}
/* timeline */
.ev{display:flex;gap:10px;align-items:center;padding:9px 13px;border-bottom:1px solid var(--border);font-size:13.5px;border-left:3px solid transparent}
.ev:last-child{border-bottom:none}
.ev .when{margin-left:auto;color:var(--dim);font-family:ui-monospace,Consolas,monospace;font-size:11.5px;white-space:nowrap}
.ev.success{border-left-color:var(--online)}
.ev.warn{border-left-color:var(--warn)}
.ev.error{border-left-color:var(--accent);background:rgba(248,113,113,.06)}
.ev .ic{width:18px;text-align:center}
/* store */
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px}
.pcard{position:relative;background:linear-gradient(165deg,rgba(30,29,38,.92),rgba(16,15,22,.92));border:1px solid var(--border);
 border-radius:12px;padding:15px;display:flex;flex-direction:column;gap:8px;transition:.18s}
.pcard:hover{border-color:rgba(220,39,39,.45);transform:translateY(-2px)}
.pcard img{width:46px;height:46px;border-radius:9px;image-rendering:pixelated;background:#101019;border:1px solid var(--border)}
.pcard .pname{font-weight:750}
.pcard .pdesc{font-size:12px;color:var(--dim);flex:1}
.price{color:var(--accent);font-weight:800}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.tab{padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--elev);color:var(--dim);font-weight:650;font-size:13.5px;cursor:pointer;transition:.16s}
.tab:hover{color:var(--text)}
.tab.on{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#fff;box-shadow:0 8px 20px -12px var(--glow)}
.audit-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.audit-tbl th{text-align:left;padding:7px 10px;color:var(--dim);border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--elev)}
.audit-tbl td{padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
.audit-tbl tr:last-child td{border-bottom:none}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{padding:5px 9px;font-size:11.5px;border-radius:8px;border:1px solid var(--border);background:var(--elev);color:var(--dim);cursor:pointer}
.chip.on{border-color:transparent;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2))}
.np-preview{margin-top:12px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--elev)}
.np-preview h3{margin:0 0 4px;font-size:19px}
.np-preview .pv-cover{width:100%;max-height:240px;object-fit:cover;border-radius:10px;margin:8px 0}
.np-preview .pv-excerpt{color:var(--dim);font-style:italic;margin:0 0 8px}
.np-preview .pv-body{white-space:pre-wrap;line-height:1.6;font-size:14px}
.np-preview .pv-gal{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.np-preview .pv-gal img{width:96px;height:72px;object-fit:cover;border-radius:8px}
/* crate + storefront — one implementation, shared with the public site */
${CRATE_CSS}
${STORE_CSS}
${MAP_CSS}
.findings{display:flex;flex-direction:column;gap:8px;margin:10px 0}
.finding{border:1px solid var(--border);border-left-width:3px;border-radius:9px;padding:9px 11px;background:var(--elev)}
.finding.info{border-left-color:#60a5fa}
.finding.warn{border-left-color:#fbbf24}
.finding.error{border-left-color:#f87171}
.finding .fw{font-weight:700;font-size:13px}
.finding .ff{font-size:12px;opacity:.78;margin-top:3px}

/* store admin */
.mrow{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)}
.mrow:last-child{border-bottom:none}
.mrow .ic{width:20px;text-align:center;flex:none;display:inline-flex;align-items:center;justify-content:center}
.mrow .ic svg{width:15px;height:15px;color:var(--accent)}
.pm-modal{position:fixed;inset:0;background:rgba(0,0,0,.72);display:grid;place-items:center;z-index:50;padding:16px}
.pm-box{background:linear-gradient(160deg,#17151b,#0c0c11);border:1px solid var(--border);border-radius:16px;padding:20px;width:min(560px,95vw);max-height:88vh;overflow:auto;box-shadow:0 30px 70px rgba(0,0,0,.65)}
.pm-box label{display:block;font-size:12px;color:var(--dim);margin-top:8px}
.rw-card{border:1px solid var(--border);border-radius:10px;padding:10px;margin:8px 0;background:var(--elev)}
.pm-thumb{width:38px;height:38px;flex:none;border-radius:8px;border:1px solid var(--border);background:var(--elev);display:grid;place-items:center;overflow:hidden}
.pm-thumb img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
.title{font-weight:800;font-size:18px;margin:2px 0 12px;display:flex;align-items:center;gap:9px}
.title::before{content:'';width:4px;height:17px;border-radius:3px;background:var(--accent);box-shadow:0 0 12px var(--glow)}
h2{margin:8px 0;font-weight:800;letter-spacing:-.4px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media(max-width:560px){.wrap{padding:12px}.console{height:44vh}.topbar .wrap{padding:10px 12px}.brand{font-size:17px}}
</style></head>
<body>
<div class="topbar"><div class="wrap">
  <div class="brand">
    <svg class="logo" viewBox="0 0 512 512"><defs><linearGradient id="c" x1=".15" y1=".05" x2=".85" y2=".95"><stop offset="0" stop-color="#f04444"/><stop offset="1" stop-color="#a81d1d"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="120" fill="#17151b" stroke="#dc2727" stroke-opacity=".4" stroke-width="3"/><path fill="url(#c)" d="M 330 106 L 150 106 L 106 150 L 106 362 L 150 406 L 330 406 L 330 332 L 180 332 L 180 180 L 330 180 Z"/><rect x="356" y="232" width="48" height="48" rx="9" fill="url(#c)" transform="rotate(45 380 256)"/></svg>
    <svg height="21" viewBox="0 0 287.34 36.78" style="margin-left:2px"><path fill="#fff" d="M246.93,0l21.5,22.56,13.19-21.51L287.34,0l-17.23,36.69h-3.35L241.21,0h5.72Z"/><polygon fill="#dc2727" points="47.33 0 34.18 8.71 8.62 8.71 8.62 29.55 34.07 29.55 47.33 36.7 0 36.7 0 0 47.33 0"/><polygon fill="#dc2727" points="133.16 .05 115.25 21.85 112.95 36.78 107.85 36.78 104.27 21.85 83.58 .05 90.78 .05 109.93 16.85 125.95 .05 133.16 .05"/><path fill="#fff" d="M184.93,32.42l15.99-15.72-22.52-12.42L177.15,0l33.84,15.45v2.51l-24.77,18.74-1.3-4.28Z"/><path fill="#dc2727" d="M84.34,18.89l-1.61-4.21L77.14,0h-19.22l-3.9,15.61-1.11,4.43-4.17,16.65h4.94l6.86-13.08,6.16,2.88h4.22l6.17-3.5,9.1,13.7h4.94l-6.79-17.81ZM68.81,20.5l-5.65-1.87,4.87-9.3,5.97,8.99-5.19,2.17Z"/><path fill="#dc2727" d="M165.49,18.89l-1.61-4.21L158.29,0h-19.22l-3.9,15.61-1.11,4.43-4.17,16.65h4.94l6.86-13.08,6.16,2.88h4.22l6.17-3.5,9.1,13.7h4.94l-6.79-17.81ZM149.96,20.5l-5.65-1.87,4.87-9.3,5.97,8.99-5.19,2.17Z"/><polygon fill="#fff" points="174.93 0 166.64 0 178.65 36.78 184.39 36.7 174.93 0"/><polygon fill="#fff" points="243.91 36.7 227.66 36.7 221.91 36.78 209.91 0 218.19 0 218.19 .01 239.17 0 237.85 3.22 219.83 6.36 222.09 15.13 237.15 15.13 237.38 19.11 223.73 21.48 226.04 30.41 241.59 33.12 243.91 36.7"/></svg>
  </div>
  <div class="spacer"></div>
  <span id="who" class="badge hidden"></span>
  <button id="logout" class="btn sm hidden" onclick="logout()">Log out</button>
</div></div>

<div class="wrap">
  <div id="login" class="card" style="max-width:390px;margin:9vh auto">
    <div class="title">Sign in</div>
    <input id="u" placeholder="Username" autocomplete="username"/>
    <input id="p" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()"/>
    <button class="btn primary block" style="margin-top:6px" onclick="doLogin()">Sign in</button>
    <div id="loginErr" class="err-msg"></div>
  </div>

  <div id="app" class="hidden">
    <div class="tabs">
      <button class="tab on" id="tabServersBtn" onclick="showSection('servers')">Servers</button>
      <button class="tab" id="tabNewsBtn" onclick="showSection('news')">News</button>
      <button class="tab hidden" id="tabAuditBtn" onclick="showSection('audit')">Audit</button>
      <button class="tab hidden" id="tabKeysBtn" onclick="showSection('keys')">API keys</button>
    </div>
    <div id="list"></div>
    <div id="newsSection" class="hidden">
      <div class="card">
        <div class="title" id="newsFormTitle">New post</div>
        <input id="npTitle" placeholder="Title"/>
        <input id="npExcerpt" placeholder="Short summary (optional)"/>
        <textarea id="npBody" rows="7" placeholder="Write your post…"></textarea>
        <div class="dim" style="font-size:12px;margin:6px 0 2px">Cover image</div>
        <div class="row" style="margin:2px 0">
          <select id="npCover" style="flex:1"></select>
          <button class="btn sm" onclick="loadUploads()" title="Refresh images">↻</button>
        </div>
        <div class="row" style="margin:6px 0">
          <input type="file" id="npFile" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" onchange="uploadImage()"/>
          <button class="btn sm" id="npUpBtn" onclick="document.getElementById('npFile').click()">Upload image…</button>
          <span class="dim" id="npUpHint" style="font-size:12px"></span>
        </div>
        <div class="dim" style="font-size:12px;margin:4px 0 2px">Gallery images (click to include)</div>
        <div id="npGallery" class="chips"></div>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" onclick="savePost()">Publish</button>
          <button class="btn" onclick="previewPost()">Preview</button>
          <button class="btn sm" onclick="resetPostForm()">Clear</button>
          <span class="dim" id="npHint" style="font-size:12px"></span>
        </div>
        <div id="npPreview" class="np-preview hidden"></div>
      </div>
      <div id="newsList"></div>
    </div>
    <div id="auditSection" class="hidden">
      <div class="card">
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
          <input id="auditText" placeholder="Search actor, IP, action, target…" style="flex:1;min-width:180px" oninput="auditDebounce()"/>
          <select id="auditSource" onchange="loadAudit()">
            <option value="">All sources</option>
            <option value="console">Console</option>
            <option value="panel">Panel</option>
            <option value="webpanel">Web panel</option>
            <option value="public">Public site</option>
            <option value="api">API key</option>
            <option value="system">System</option>
          </select>
          <select id="auditOk" onchange="loadAudit()">
            <option value="">All</option>
            <option value="true">Success</option>
            <option value="false">Failed</option>
          </select>
          <button class="btn sm" onclick="loadAudit()" title="Refresh">↻</button>
        </div>
        <div class="dim" id="auditMeta" style="font-size:12px;margin-top:8px"></div>
      </div>
      <div id="auditList"></div>
    </div>
    <div id="keysSection" class="hidden">
      <div class="card">
        <div class="title">Issue an API key</div>
        <div class="dim" style="font-size:12px;margin-bottom:8px">A key belongs to no account. It carries its own permissions, works only on the servers you tick, and can be revoked on its own. Send it as <code>Authorization: Bearer &lt;key&gt;</code> or <code>X-API-Key: &lt;key&gt;</code>.</div>
        <div class="row" style="align-items:flex-end">
          <div style="flex:1;min-width:150px"><div class="dim" style="font-size:12px">Label</div><input id="kLabel" placeholder="Discord bot"/></div>
          <div style="width:150px"><div class="dim" style="font-size:12px">Expires in (days)</div><input id="kDays" type="number" min="0" value="0"/></div>
          <button class="btn primary" onclick="createKey()">Issue key</button>
        </div>
        <div class="dim" style="font-size:12px;margin:8px 0 4px">Permissions</div>
        <div id="kScopes" class="chips"></div>
        <div class="dim" style="font-size:12px;margin:10px 0 4px">Servers</div>
        <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="kAll" checked onchange="renderKeyServers()" style="width:auto"/> All servers</label>
        <div id="kServers" class="chips" style="margin-top:6px"></div>
      </div>
      <div id="keySecret" class="card hidden"></div>
      <div id="keysList"></div>
    </div>
  </div>

  <div id="detail" class="hidden">
    <div class="row"><button class="btn sm" onclick="showList()">← All servers</button><div class="spacer"></div><span id="dStatus" class="badge"></span></div>
    <h2 id="dName"></h2>
    <div id="dControls" class="row" style="margin-bottom:12px"></div>
    <div class="tabs">
      <button class="tab on" id="tabConsole" onclick="showTab('console')">Console</button>
      <button class="tab" id="tabStats" onclick="showTab('stats')">Performance</button>
      <button class="tab" id="tabTimeline" onclick="showTab('timeline')">Timeline</button>
      <button class="tab" id="tabMap" onclick="showTab('map')">Map</button>
      <button class="tab" id="tabStore" onclick="showTab('store')">Store</button>
      <button class="tab hidden" id="tabAlertsBtn" onclick="showTab('alerts')">Alerts</button>
      <button class="tab hidden" id="tabManageBtn" onclick="showTab('manage')">Manage</button>
    </div>
    <div id="panelConsole">
      <div id="dConsole" class="console"></div>
      <div id="dCmdRow" class="row" style="margin-top:8px">
        <input id="dCmd" placeholder="Command…" style="flex:1" onkeydown="if(event.key==='Enter')sendCmd()"/>
        <button class="btn primary" onclick="sendCmd()">Send</button>
      </div>
    </div>
    <div id="panelAlerts" class="hidden">
      <div class="card">
        <div class="row"><b>New alert rule</b><div class="spacer"></div><button class="btn sm" onclick="loadAlerts()" title="Refresh">RELOAD</button></div>
        <input type="hidden" id="arId"/>
        <div class="row" style="margin-top:8px">
          <input id="arName" placeholder="Rule name" style="flex:1;min-width:120px"/>
          <select id="arMetric"><option value="tps">TPS</option><option value="cpu">CPU %</option><option value="ram">RAM MB</option><option value="players">Players</option></select>
          <select id="arCmp"><option value="below">below</option><option value="above">above</option></select>
          <input id="arThreshold" type="number" value="15" style="width:90px"/>
        </div>
        <div class="row" style="margin-top:8px">
          <div><div class="dim" style="font-size:12px">Hold for (s)</div><input id="arFor" type="number" value="60" style="width:100px"/></div>
          <div><div class="dim" style="font-size:12px">Cooldown (s)</div><input id="arCool" type="number" value="900" style="width:100px"/></div>
          <div><div class="dim" style="font-size:12px">Grace (s)</div><input id="arGrace" type="number" value="120" style="width:100px"/></div>
          <div style="flex:1;min-width:120px"><div class="dim" style="font-size:12px">Action when it fires</div>
            <select id="arAction" onchange="arActionChanged()" style="width:100%">
              <option value="">Record only</option>
              <option value="restart">Restart server</option>
              <option value="stop">Stop server</option>
              <option value="start">Start server</option>
              <option value="backup">Take a backup</option>
              <option value="command">Run a command</option>
              <option value="broadcast">Broadcast a message</option>
            </select>
          </div>
        </div>
        <div class="row" style="margin-top:8px"><input id="arPayload" placeholder="Command or message" style="flex:1"/></div>
        <div class="dim" id="arScopeHint" style="font-size:12px;margin-top:6px"></div>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" onclick="saveAlert()">Save rule</button>
          <button class="btn sm" onclick="resetAlertForm()">Clear</button>
          <span class="dim" id="arHint" style="font-size:12px"></span>
        </div>
      </div>
      <div id="alertList"></div>
    </div>
    <div id="panelStats" class="hidden">
      <div class="row" style="margin-bottom:4px">
        <button class="btn sm" onclick="setRange(3600000,this)">1 h</button>
        <button class="btn sm primary" onclick="setRange(86400000,this)">24 h</button>
        <button class="btn sm" onclick="setRange(604800000,this)">7 d</button>
      </div>
      <div id="dStats" class="stats"></div>
      <div id="dFindings" class="findings"></div>
      <div id="dCharts" class="charts"></div>
    </div>
    <div id="panelTimeline" class="hidden"><div class="card tight" id="dEvents"></div></div>
    <div id="panelMap" class="hidden"><div class="card">${MAP_HTML}</div></div>
    <div id="panelStore" class="hidden">
      <div class="row" style="margin-bottom:10px"><b>Store</b><div class="spacer"></div>
        <span id="sfNewRow" class="row hidden" style="gap:6px">
          <button class="btn sm" onclick="pmNew('item')">＋ Item</button>
          <button class="btn sm primary" onclick="pmNew('crate')">＋ Crate</button>
        </span>
      </div>
      <div id="sfBox"></div>
    </div>
    <div id="panelManage" class="hidden">
      <div class="card">
        <div class="title">Store settings</div>
        <div class="row" style="align-items:flex-end">
          <div style="flex:1;min-width:160px"><div class="dim" style="font-size:12px">Currency</div><input id="mCur" placeholder="Coins"/></div>
          <button class="btn primary" onclick="saveCurrency()">Save</button>
        </div>
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div style="flex:1;min-width:180px"><div class="dim" style="font-size:12px">Default crate animation</div><select id="mAnim" onchange="saveStoreAnimation()"></select></div>
          <button class="btn sm" onclick="previewStoreAnimation()">&#9654; Preview</button>
        </div>
        <div class="dim" style="font-size:12px;margin-top:6px">Used by every crate that does not choose its own.</div>
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div style="flex:1;min-width:180px"><div class="dim" style="font-size:12px">Storefront sections</div><select id="mLayout" onchange="saveLayout()"></select></div>
        </div>
      </div>
      <div class="card">
        <div class="title">Player credits</div>
        <div class="row" style="align-items:flex-end">
          <div style="flex:1;min-width:120px"><div class="dim" style="font-size:12px">Player</div><input id="mBalName" placeholder="Steve"/></div>
          <div style="width:120px"><div class="dim" style="font-size:12px">Amount</div><input id="mBalAmt" type="number" value="100"/></div>
          <div style="flex:1;min-width:120px"><div class="dim" style="font-size:12px">Reason</div><input id="mBalReason" placeholder="(optional)"/></div>
          <div style="min-width:140px"><div class="dim" style="font-size:12px">Category</div><select id="mBalCat"></select></div>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" onclick="adjustBalance('add')">＋ Give</button>
          <button class="btn" onclick="adjustBalance('remove')">－ Remove</button>
          <button class="btn" onclick="adjustBalance('set')">= Set</button>
        </div>
        <div id="mBalances" style="margin-top:10px;max-height:240px;overflow:auto"></div>
      </div>
      <div class="card">
        <div class="row"><button class="btn sm" onclick="toggleLedger()"><span id="mLedgerCaret">▸</span></button><b>Balance ledger</b><span class="dim" id="mLedgerSum" style="font-size:12px"></span><div class="spacer"></div><button class="btn sm" onclick="loadLedger()" title="Refresh">↻</button></div>
        <div id="mLedgerBody" style="display:none">
          <div class="row" style="margin-top:8px">
            <input id="mLedgerQ" placeholder="Search player, reason or admin…" oninput="renderLedger()" style="flex:1;min-width:140px"/>
            <select id="mLedgerKind" onchange="renderLedger()">
              <option value="all">All kinds</option>
              <option value="grant">Grants</option>
              <option value="remove">Removals</option>
              <option value="set">Set to value</option>
              <option value="purchase">Purchases</option>
            </select>
            <select id="mLedgerCat" onchange="renderLedger()"><option value="all">All categories</option></select>
          </div>
          <div id="mLedger" style="margin-top:10px;max-height:340px;overflow:auto"></div>
        </div>
      </div>
      <div class="card">
        <div class="row"><b>Products</b><div class="spacer"></div>
          <button class="btn sm" onclick="pmNew('item')">＋ Item</button>
          <button class="btn sm" onclick="pmNew('crate')">🎁 Crate</button>
        </div>
        <div id="mProducts" style="margin-top:10px"></div>
      </div>
    </div>
  </div>
</div>

<input type="file" id="pmFile" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none"/>
<div id="pmModal" class="pm-modal hidden" onclick="pmBackdrop(event)"><div class="pm-box" id="pmBox"></div></div>

${CRATE_MODAL_HTML}
${STORE_MODAL_HTML}

<script>
var token=localStorage.getItem('msms_token')||'';
var current=null, pollTimer=null, statsRange=86400000, activeTab='console', myRole='', myCanAudit=false;
function applyRole(){var b=document.getElementById('tabAuditBtn');if(b)b.classList.toggle('hidden',myRole!=='owner'&&!myCanAudit);
 /* Keys are owner-only on the server too; hiding the tab just stops a
    co-admin from clicking into a section that would only 403 at them. */
 var k=document.getElementById('tabKeysBtn');if(k)k.classList.toggle('hidden',myRole!=='owner')}
function api(path,opts){opts=opts||{};opts.headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});if(token)opts.headers['Authorization']='Bearer '+token;return fetch(path,opts).then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j}})})}
function show(id){['login','app','detail'].forEach(function(x){document.getElementById(x).classList.add('hidden')});document.getElementById(id).classList.remove('hidden');
 document.getElementById('logout').classList.toggle('hidden',id==='login');
 document.getElementById('who').classList.toggle('hidden',id==='login')}
function doLogin(){var u=document.getElementById('u').value,p=document.getElementById('p').value;
 api('/api/login',{method:'POST',body:JSON.stringify({username:u,password:p})}).then(function(r){
  if(!r.ok){document.getElementById('loginErr').textContent=r.body.error==='too-many-attempts'?'Too many attempts, wait a bit.':'Invalid credentials';return}
  token=r.body.token;localStorage.setItem('msms_token',token);
  if(r.body.user){document.getElementById('who').textContent=r.body.user.username+' · '+r.body.user.role;myRole=r.body.user.role||'';myCanAudit=!!r.body.user.canAudit;applyRole()}
  renderList(r.body.servers)})}
function logout(){api('/api/logout',{method:'POST'});token='';localStorage.removeItem('msms_token');stopPoll();show('login')}
function loadServers(){api('/api/servers').then(function(r){if(r.status===401){logout();return}renderList(r.body.servers)})}
function statusDot(s){return '<span class="dot '+s+'"></span>'}
function renderList(servers){show('app');var el=document.getElementById('list');
 if(!servers||!servers.length){el.innerHTML='<div class="card dim">No servers you can access.</div>';return}
 el.innerHTML=servers.map(function(s){
  var players=(s.players?(s.players.online+' / '+s.players.max+' players'):'');
  return '<div class="srv" onclick="openServer(\\''+s.id+'\\')">'+statusDot(s.status)+
   '<div class="meta"><div class="name">'+esc(s.name)+'</div><div class="dim" style="font-size:13px">'+
   esc(s.type)+' · '+esc(s.mcVersion)+' · '+esc(s.status)+(players?' · '+players:'')+'</div></div><span class="chev">›</span></div>'}).join('');
 if(!document.getElementById('who').textContent){
  api('/api/me').then(function(r){if(r.ok){document.getElementById('who').textContent=r.body.username+' · '+r.body.role;myRole=r.body.role||'';myCanAudit=!!r.body.canAudit;applyRole()}})}}
function esc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
function openServer(id){api('/api/servers/'+id).then(function(r){if(!r.ok){alert('No access');return}current=r.body;renderDetail();startPoll()})}
function renderDetail(){show('detail');var s=current;document.getElementById('dName').textContent=s.name;
 document.getElementById('dStatus').innerHTML=statusDot(s.status)+' '+s.status;
 var has=function(sc){return s.scopes.indexOf(sc)>=0};
 var c=document.getElementById('dControls');c.innerHTML='';
 if(has('power')){c.innerHTML=[['start','▶ Start'],['stop','■ Stop'],['restart','↻ Restart'],['kill','⚡ Kill']].map(function(a){
   return '<button class="btn sm'+(a[0]==='start'?' primary':a[0]==='kill'?' danger':'')+'" onclick="power(\\''+a[0]+'\\')">'+a[1]+'</button>'}).join('')}
 document.getElementById('dCmdRow').style.display=has('console')?'flex':'none';
 document.getElementById('tabManageBtn').classList.toggle('hidden',!has('store'));
 document.getElementById('tabAlertsBtn').classList.toggle('hidden',!has('settings'));showTab('console')}
function showTab(tab){activeTab=tab;
 [['console','panelConsole','tabConsole'],['stats','panelStats','tabStats'],['timeline','panelTimeline','tabTimeline'],['map','panelMap','tabMap'],['store','panelStore','tabStore'],['alerts','panelAlerts','tabAlertsBtn'],['manage','panelManage','tabManageBtn']]
  .forEach(function(t){document.getElementById(t[1]).classList.toggle('hidden',tab!==t[0]);
   document.getElementById(t[2]).classList.toggle('on',tab===t[0])});
 if(tab==='store')loadStore();
 /* Only poll while the tab is visible: the feed is every two seconds, and a
    background tab quietly hammering it is the kind of cost nobody attributes
    to the page they left open. */
 if(tab==='map')mapStart();else mapStop();
 if(tab==='manage')loadManage();
 if(tab==='stats')loadStats();
 if(tab==='timeline')loadEvents();
 if(tab==='alerts')loadAlerts()}

/* ---- alert rules (#24) ---- */
// Mirrors extraScopesForAction() in shared/alerts.ts. This is a HINT only - the
// server enforces it. A rule that acts when it fires needs that action's own
// scope on top of 'settings', or 'settings' would quietly become "run any
// console command, unattended, forever".
var ACTION_SCOPE={command:'console',broadcast:'console',start:'power',stop:'power',restart:'power',backup:'backups'};
var ALERT_UNIT={tps:'TPS',cpu:'% CPU',ram:'MB RAM',players:'players'};
var alertCache={};
function arActionChanged(){var a=document.getElementById('arAction').value;
 var need=ACTION_SCOPE[a];var hint=document.getElementById('arScopeHint');
 document.getElementById('arPayload').style.display=(a==='command'||a==='broadcast')?'':'none';
 if(!need){hint.textContent='';return}
 hint.textContent=has(need)?('This action also uses your "'+need+'" permission.')
  :('You do not have the "'+need+'" permission, so this action will be refused.')}
function resetAlertForm(){document.getElementById('arId').value='';document.getElementById('arName').value='';
 document.getElementById('arThreshold').value='15';document.getElementById('arFor').value='60';
 document.getElementById('arCool').value='900';document.getElementById('arGrace').value='120';
 document.getElementById('arAction').value='';document.getElementById('arPayload').value='';
 document.getElementById('arMetric').value='tps';document.getElementById('arCmp').value='below';
 document.getElementById('arHint').textContent='';arActionChanged()}
function loadAlerts(){api('/api/servers/'+current.id+'/alerts').then(function(r){
 if(!r.ok){document.getElementById('alertList').innerHTML='<div class="card dim">No access to alert rules.</div>';return}
 renderAlerts((r.body&&r.body.rules)||[])})}
function renderAlerts(rules){var el=document.getElementById('alertList');
 alertCache={};rules.forEach(function(x){alertCache[x.id]=x});
 if(!rules.length){el.innerHTML='<div class="card dim">No alert rules yet.</div>';return}
 el.innerHTML='<div class="card">'+rules.map(function(x){
  var unit=ALERT_UNIT[x.metric]||x.metric;
  var when=esc(x.metric)+' '+esc(x.comparison)+' '+x.threshold+' '+esc(unit)+' for '+x.forSeconds+'s';
  var act=x.action?('-> '+esc(x.action)+(x.payload?' ('+esc(x.payload)+')':'')):'-> record only';
  return '<div class="mrow"><span class="badge">'+(x.enabled?'on':'off')+'</span>'+
   '<div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(x.name)+'</div>'+
   '<div class="dim" style="font-size:11px">'+when+' - '+act+(x.fireCount?' - fired '+x.fireCount+'x':'')+'</div></div>'+
   '<button class="btn sm" onclick="toggleAlert(\\''+x.id+'\\')">'+(x.enabled?'Disable':'Enable')+'</button>'+
   '<button class="btn sm" onclick="editAlert(\\''+x.id+'\\')">Edit</button>'+
   '<button class="btn sm danger" onclick="deleteAlert(\\''+x.id+'\\')">Delete</button></div>'}).join('')+'</div>'}
function editAlert(rid){var x=alertCache[rid];if(!x)return;
 document.getElementById('arId').value=x.id;document.getElementById('arName').value=x.name||'';
 document.getElementById('arMetric').value=x.metric;document.getElementById('arCmp').value=x.comparison;
 document.getElementById('arThreshold').value=x.threshold;document.getElementById('arFor').value=x.forSeconds;
 document.getElementById('arCool').value=x.cooldownSeconds;document.getElementById('arGrace').value=x.graceSeconds;
 document.getElementById('arAction').value=x.action||'';document.getElementById('arPayload').value=x.payload||'';
 arActionChanged();window.scrollTo(0,0)}
function alertBody(){var a=document.getElementById('arAction').value;
 var b={name:document.getElementById('arName').value.trim(),
  metric:document.getElementById('arMetric').value,comparison:document.getElementById('arCmp').value,
  threshold:Number(document.getElementById('arThreshold').value)||0,
  forSeconds:Number(document.getElementById('arFor').value)||0,
  cooldownSeconds:Number(document.getElementById('arCool').value)||900,
  graceSeconds:Number(document.getElementById('arGrace').value)||0};
 if(a){b.action=a;if(a==='command'||a==='broadcast')b.payload=document.getElementById('arPayload').value}
 var rid=document.getElementById('arId').value;if(rid)b.id=rid;
 return b}
function saveAlert(){var b=alertBody();
 if(!b.name){document.getElementById('arHint').textContent='Give the rule a name.';return}
 api('/api/servers/'+current.id+'/alerts',{method:'POST',body:JSON.stringify(b)}).then(function(r){
  if(!r.ok){document.getElementById('arHint').textContent=r.status===403
   ?'Refused: this action needs a permission you do not have.'
   :('Could not save: '+((r.body&&r.body.error)||r.status));return}
  resetAlertForm();loadAlerts()})}
function toggleAlert(rid){var x=alertCache[rid];if(!x)return;
 var b={id:x.id,name:x.name,metric:x.metric,comparison:x.comparison,threshold:x.threshold,
  forSeconds:x.forSeconds,cooldownSeconds:x.cooldownSeconds,graceSeconds:x.graceSeconds,enabled:!x.enabled};
 if(x.action){b.action=x.action;if(x.payload)b.payload=x.payload}
 api('/api/servers/'+current.id+'/alerts',{method:'POST',body:JSON.stringify(b)}).then(function(r){
  if(!r.ok){alert('Could not change the rule: '+((r.body&&r.body.error)||r.status));return}loadAlerts()})}
function deleteAlert(rid){if(!confirm('Delete this alert rule?'))return;
 api('/api/servers/'+current.id+'/alerts?ruleId='+encodeURIComponent(rid),{method:'DELETE'}).then(function(r){
  if(!r.ok){alert('Could not delete the rule');return}loadAlerts()})}

/* ---- performance (metrics + uptime) ---- */
function setRange(ms,btn){statsRange=ms;
 var row=btn.parentNode.querySelectorAll('.btn');for(var i=0;i<row.length;i++)row[i].classList.remove('primary');
 btn.classList.add('primary');loadStats()}
function fmtDur(ms){var s=Math.round(ms/1000);if(s<60)return s+'s';var m=Math.floor(s/60);if(m<60)return m+'m';
 var h=Math.floor(m/60);if(h<24)return h+'h '+(m%60)+'m';return Math.floor(h/24)+'d '+(h%24)+'h'}
/* Tiny inline sparkline; breaks the path on gaps so downtime is not drawn as a line. */
function spark(points,pick,color,top){
 var W=300,H=46,vals=[],i;
 for(i=0;i<points.length;i++){var v=pick(points[i]);vals.push(v==null?null:v)}
 var maxV=top||1;for(i=0;i<vals.length;i++)if(vals[i]!=null&&vals[i]>maxV)maxV=vals[i];
 if(!points.length)return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"></svg>';
 var t0=points[0].ts,t1=points[points.length-1].ts||t0+1,span=Math.max(1,t1-t0);
 var gaps=[];for(i=1;i<points.length;i++)gaps.push(points[i].ts-points[i-1].ts);
 gaps.sort(function(a,b){return a-b});var gap=(gaps[Math.floor(gaps.length/2)]||0)*3;
 var d='',prev=null,started=false;
 for(i=0;i<points.length;i++){
  if(vals[i]==null){started=false;continue}
  var x=((points[i].ts-t0)/span)*W, y=H-(vals[i]/maxV)*(H-4)-2;
  if(!started||(gap&&prev!=null&&points[i].ts-prev>gap)){d+=' M '+x.toFixed(1)+' '+y.toFixed(1);started=true}
  else d+=' L '+x.toFixed(1)+' '+y.toFixed(1);
  prev=points[i].ts}
 return '<svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
  '<path class="line" d="'+d+'" stroke="'+color+'"/></svg>'}
function chartCard(title,val,points,pick,color,top){
 var any=false;for(var i=0;i<points.length;i++){if(pick(points[i])!=null){any=true;break}}
 return '<div class="chartcard"><div class="hd"><span class="dim">'+esc(title)+'</span><b>'+esc(val)+'</b></div>'+
  (any?spark(points,pick,color,top)
      :'<div class="dim" style="height:46px;display:flex;align-items:center;justify-content:center;font-size:12px">not recorded</div>')+
  '</div>'}
function loadStats(){
 if(!current)return;var to=Date.now(),from=to-statsRange;
 var q='?from='+from+'&to='+to;
 api('/api/servers/'+current.id+'/metrics'+q+'&limit=800').then(function(m){
  if(!m.ok){document.getElementById('dStats').innerHTML='<div class="dim">No access to stats.</div>';return}
  api('/api/servers/'+current.id+'/uptime'+q).then(function(u){
   var s=m.body.summary||{},pts=m.body.points||[],up=u.ok?u.body:null;
   document.getElementById('dStats').innerHTML=
    '<div class="stat"><b>'+(up&&up.ratio!=null?(up.ratio*100).toFixed(1)+'%':'—')+'</b><span>Uptime</span></div>'+
    '<div class="stat"><b>'+(s.tpsAvg!=null?s.tpsAvg:'—')+'</b><span>Avg TPS</span></div>'+
    '<div class="stat'+(up&&up.crashes?' bad':'')+'"><b>'+(up?up.crashes:'—')+'</b><span>Crashes</span></div>'+
    '<div class="stat"><b>'+(up?up.starts:'—')+'</b><span>Starts</span></div>'+
    '<div class="stat"><b>'+(up?fmtDur(up.longestUpMs):'—')+'</b><span>Longest run</span></div>'+
    '<div class="stat"><b>'+(s.playersMax!=null?s.playersMax:'—')+'</b><span>Peak players</span></div>';
   document.getElementById('dCharts').innerHTML=pts.length
    ? chartCard('TPS',(s.tpsAvg!=null?s.tpsAvg+' avg':'—'),pts,function(p){return p.tps},'#4ade80',20)+
      chartCard('CPU',(s.cpuAvg!=null?s.cpuAvg+'% avg · '+s.cpuMax+'% peak':'—'),pts,function(p){return p.cpu},'#dc2727',100)+
      chartCard('Memory',(s.rssAvg!=null?s.rssAvg+' MB avg · '+s.rssMax+' MB peak':'—'),pts,function(p){return p.rss},'#60a5fa',0)+
      chartCard('Players',(s.playersMax!=null?s.playersMax+' peak':'—'),pts,function(p){return p.players},'#fbbf24',0)
    : '<div class="dim">Nothing recorded in this range yet.</div>';
   loadFindings()})})}

/* ---- performance analysis (#25) ----
   The API returns findings as {code, severity, data}; the sentences live here
   because the panel is English-only. Wording mirrors the desktop analysis.*
   locale keys - if those change, change these too. */
var FINDING_TEXT={
 'insufficient-data':['Not enough history yet - {samples} readings, {needed} needed.','Leave the server running for a while and come back; nothing is diagnosed from a handful of samples.'],
 'tps-unavailable':['No tick rate reported in this range.','Only Paper and its forks report TPS. On {type} the TPS chart stays empty - that is not a fault.'],
 'tps-not-reported':['No tick rate recorded, although this server can report one.','TPS is read over RCON. Check that RCON is enabled in server.properties and that MSMS connected.'],
 'chronic-lag':['The server ticked below {min} for {share}% of this range (avg {avg}).','Check the timeline for what was running then, and look at plugins/mods, view-distance and entity counts before adding memory.'],
 'lag-with-players':['Tick rate follows the player count: {quietTps} when quiet, {busyTps} from about {players} players (peak {peak}).','The load is player-driven. Lower view-distance / simulation-distance, or cap players below the point where it degrades.'],
 'cpu-saturated':['CPU was at or above {max}% for {share}% of this range (avg {avg}%).','Minecraft is largely single-threaded, so this is one core saturating. More RAM will not help; reduce the work per tick.'],
 'memory-over-allocated':['The process peaked at {rssMax} MB against a {xmx} MB heap - {share}% of it.','You can safely give this server less memory and leave the rest to the operating system.'],
 'frequent-crashes':['{crashes} crash(es) in the last {days} days.','Open the Crash Analyzer in the desktop app - it reads the actual log and names the cause.'],
 'no-backups':['No backup taken in the last {days} days.','Add a scheduled backup on the Automation tab - a daily 4 AM world backup takes seconds.'],
 'aikars-flags':['Running basic launch flags with a {xmx} MB heap.','Switch the Java preset to the Aikar flags in Settings; they tune the garbage collector for exactly this heap size.'],
 'healthy':['Nothing worth flagging across {days} days and {samples} readings.','Tick rate, CPU, memory and stability all look normal for this range.']};
// No regex: this string is inside a TS template literal, and a backslash escape
// here resolves TWICE (template literal, then the browser), which silently turned
// /\{(\w+)\}/ into /{(w+)}/ and interpolated nothing. split/join cannot be
// mis-escaped. An absent datum leaves its {placeholder} visible on purpose -
// that is a legible signal, not a silent '?'.
function fillFinding(tpl,data){var out=tpl,d=data||{};
 for(var k in d){if(d[k]!==undefined&&d[k]!==null)out=out.split('{'+k+'}').join(String(d[k]))}
 return out}
function loadFindings(){var el=document.getElementById('dFindings');if(!el)return;
 api('/api/servers/'+current.id+'/analysis?hours='+Math.max(1,Math.round(statsRange/3600000))).then(function(r){
  if(!r.ok){el.innerHTML='';return}
  var f=(r.body&&r.body.findings)||[];
  if(!f.length){el.innerHTML='';return}
  el.innerHTML=f.map(function(x){var t=FINDING_TEXT[x.code];
   // An unknown code must still render - a newer app version can emit one.
   var what=t?fillFinding(t[0],x.data):x.code;var fix=t?fillFinding(t[1],x.data):'';
   var sev=(x.severity==='error'||x.severity==='warn')?x.severity:'info';
   return '<div class="finding '+sev+'"><div class="fw">'+esc(what)+'</div>'+
    (fix?'<div class="ff">'+esc(fix)+'</div>':'')+'</div>'}).join('')})}

/* ---- timeline ---- */
var EV_ICON={'server.starting':'▶','server.ready':'✓','server.stopped':'■','server.crashed':'✕','server.error':'!',
 'player.join':'→','player.leave':'←','backup.created':'💾','backup.failed':'!','backup.restored':'↺','backup.deleted':'🗑',
 'schedule.run':'⏱','schedule.failed':'⏱','alert.triggered':'🔔','alert.failed':'🔔'};
var EV_CMP={below:'below',above:'above'};
function evText(e){var d=e.data||{};
 switch(e.type){
  case 'server.starting':return 'Server starting'+(d.type?' ('+d.type+' '+(d.version||'')+')':'');
  case 'server.ready':return 'Server ready'+(d.startupMs?' in '+(Math.round(d.startupMs/100)/10)+' s':'');
  case 'server.stopped':return 'Server stopped'+(d.uptimeMs?' after '+fmtDur(d.uptimeMs):'')+(d.code!=null?' (code '+d.code+')':'');
  case 'server.crashed':return 'Server crashed'+(d.uptimeMs?' after '+fmtDur(d.uptimeMs):'')+(d.code!=null?' (code '+d.code+')':'');
  case 'server.error':return 'Process error: '+(e.text||'');
  case 'player.join':return (d.player||'?')+' joined'+(d.online!=null?' — '+d.online+' online':'');
  case 'player.leave':return (d.player||'?')+' left'+(d.online!=null?' — '+d.online+' online':'');
  case 'backup.created':return 'Backup created'+(d.sizeMB!=null?' — '+d.sizeMB+' MB':'')+(e.text?' ('+e.text+')':'');
  case 'backup.failed':return 'Backup failed: '+(e.text||'');
  case 'backup.restored':return 'Backup restored'+(e.text?': '+e.text:'');
  case 'backup.deleted':return 'Backup deleted'+(e.text?': '+e.text:'');
  case 'schedule.run':return 'Scheduled task ran'+(e.text?': '+e.text:'');
  case 'schedule.failed':return 'Scheduled task failed'+(e.text?': '+e.text:'');
  case 'alert.triggered':return 'Alert'+(e.text?' "'+e.text+'"':'')+': '+(d.metric||'?')+' '+(EV_CMP[d.comparison]||'past')+' '+d.threshold+
   (d.value!=null?' (was '+d.value+')':'')+(d.heldSeconds!=null?' for '+d.heldSeconds+' s':'')+(d.action?' → '+d.action:'');
  case 'alert.failed':return 'Alert action failed'+(e.text?': '+e.text:'');
  default:return e.type}}
function loadEvents(){
 if(!current)return;var to=Date.now(),from=to-7*86400000;
 api('/api/servers/'+current.id+'/events?from='+from+'&to='+to+'&limit=150').then(function(r){
  var el=document.getElementById('dEvents');if(!el)return;
  if(!r.ok){el.innerHTML='<div style="padding:16px" class="dim">No access to the timeline.</div>';return}
  var evs=r.body.events||[];
  if(!evs.length){el.innerHTML='<div style="padding:16px" class="dim">Nothing recorded in the last 7 days.</div>';return}
  el.innerHTML=evs.map(function(e){
   return '<div class="ev '+esc(e.severity)+'"><span class="ic">'+(EV_ICON[e.type]||'•')+'</span>'+
    '<span>'+esc(evText(e))+'</span><span class="when">'+new Date(e.ts).toLocaleString()+'</span></div>'}).join('')})}

/* ---- store ---- */
/* The panel's storefront is a PREVIEW (#102). It renders what a player sees so
   an operator can check their own work, and it buys nothing: the panel is where
   a store is authored, and the buyer is a player on the public site with a
   linked Minecraft name. The balance badge went with the Buy button — an
   operator's own balance is not information about the store. */
function loadStore(){api('/api/servers/'+current.id+'/store').then(function(r){if(!r.ok)return;
 SF.mode='preview';
 SF.canEdit=!!(current&&current.scopes.indexOf('store')>=0);
 var nw=document.getElementById('sfNewRow');if(nw)nw.classList.toggle('hidden',!SF.canEdit);
 SF.layout=r.body.layout||'crates-first';sfCurrencyName=r.body.currency||'';
 /* sfSetProducts, not an assignment: it also refreshes an open detail, which
    is where stock and per-player counts are read. */
 sfSetProducts(r.body.products)})}
/* Open the real editor for a previewed product.
   The storefront holds the PUBLIC shape — rewards trimmed to name/icon/odds,
   commands stripped at the boundary on purpose — so the id has to be resolved
   against the admin catalogue before pmEdit can fill a draft. Fetched when it
   is not already there, because the Store tab does not load the admin one. */
function sfEdit(id){
 /* Close the detail first. Both overlays are position:fixed, and .sf-modal
    sits at z-index 75 against .pm-modal's 50 — so opening the editor from the
    detail view put it UNDER the thing the operator clicked Edit in, behind a
    dimmed backdrop. Same shape as the bug on the site's login (#106): a modal
    opened from a modal has to say which one wins. */
 sfCloseDetail();
 if((mstore.products||[]).some(function(p){return p.id===id}))return pmEdit(id);
 api('/api/servers/'+current.id+'/store/admin').then(function(r){
  if(!r.ok){sfNotice('err','Cannot edit','No access to the product editor.');return}
  mstore=r.body;renderMProducts();pmEdit(id)})}
/* The four hooks the shared storefront calls back into. The panel is English
   only, so its translator returns a small table and falls back to the key. */
var sfCurrencyName='';
function sfCurrency(){return sfCurrencyName}
function sfImg(src){return src}
var SF_TEXT={'store.buy':'Buy','store.crate':'Crate','store.search':'Search products…',
 'store.empty':'No products yet.','store.noMatch':'Nothing matches that search.',
 'store.type_all':'Everything','store.type_crate':'Crates','store.type_item':'Items',
 'store.sort_featured':'Featured','store.sort_price-asc':'Price: low to high','store.sort_price-desc':'Price: high to low',
 'store.sort_name-asc':'Name: A-Z','store.sort_name-desc':'Name: Z-A',
 'store.section_crate':'Crates','store.section_item':'Items','store.contents':'What is inside',
 'store.outOfStock':'Sold out','store.limitReached':'Limit reached','store.stockLeft':'{n} left',
 'store.limitOf':'Max {n} per player','common.close':'Close',
 /* Preview-mode copy. Deliberately not in siteI18n: none of it can ever render
    on the public site, and adding the keys there would hand every operator's
    custom language pack four entries that translate nothing. */
 'store.preview':'▶ Preview','store.edit':'Edit',
 'store.previewTitle':'Preview',
 'store.previewLead':'This is the storefront exactly as a player sees it. Nothing here buys anything — players buy on the public site.',
 'store.previewNote':'Preview — nothing was bought.'};
function sfText(k){return SF_TEXT[k]||k}
${CRATE_JS}
${STORE_JS}
${MAP_JS}
function mapServerId(){return current?current.id:''}
function mapFeedUrl(dim,cell){
 return '/api/servers/'+mapServerId()+'/map?dim='+encodeURIComponent(dim)+'&cell='+encodeURIComponent(cell)}
/* The avatar service, by uuid. Named here rather than hardcoded in the shared
   map so an operator running an air-gapped panel can point it elsewhere, and so
   the public site can refuse to draw heads at all (#104). */
function mapAvatarUrl(uuid){return 'https://crafatar.com/avatars/'+encodeURIComponent(uuid)+'?size=32&overlay'}
var CRATE_ICON_SVG=${JSON.stringify(CRATE_ICON_SVG)};

/* ---- store admin: configuration (store scope) ---- */
function escAttr(t){return esc(t).replace(/"/g,'&quot;')}
var mstore={currency:'Coins',products:[]}, pmDraft=null;
function loadManage(){api('/api/servers/'+current.id+'/store/admin').then(function(r){
 if(!r.ok){document.getElementById('mProducts').innerHTML='<div class="dim">No access.</div>';return}
 mstore=r.body;document.getElementById('mCur').value=mstore.currency||'';
 document.getElementById('mAnim').innerHTML=crateAnimationOptions(mstore.crateAnimation);
 document.getElementById('mLayout').innerHTML=[['crates-first','Crates first'],['items-first','Items first'],['mixed','One mixed grid']]
  .map(function(o){return '<option value="'+o[0]+'"'+(mstore.layout===o[0]?' selected':'')+'>'+o[1]+'</option>'}).join('');
 renderMProducts();renderCategories();renderBalances();loadLedger()})}
function saveStoreAnimation(){var v=document.getElementById('mAnim').value;
 api('/api/servers/'+current.id+'/store/admin/crate-animation',{method:'POST',body:JSON.stringify({animation:v})}).then(function(r){
  if(!r.ok){alert('Could not save the animation');return}
  /* Trust what was stored, not what was asked for - the server coerces an
     unknown value and the picker must not claim otherwise. */
  mstore.crateAnimation=r.body.animation;
  document.getElementById('mAnim').innerHTML=crateAnimationOptions(mstore.crateAnimation)})}
function saveLayout(){var v=document.getElementById('mLayout').value;
 api('/api/servers/'+current.id+'/store/admin/layout',{method:'POST',body:JSON.stringify({layout:v})}).then(function(r){
  if(r.ok)mstore.layout=r.body.layout})}
function previewStoreAnimation(){cratePreview(document.getElementById('mAnim').value,null,'Preview - nothing was bought.')}
function renderBalances(){var el=document.getElementById('mBalances');var bals=mstore.balances||{};var names=Object.keys(bals);
 if(!names.length){el.innerHTML='<div class="dim">No balances yet.</div>';return}
 el.innerHTML=names.map(function(n){return '<div class="mrow"><span style="flex:1;min-width:0;font-weight:700">'+esc(n)+'</span>'+
  '<span class="price">'+(bals[n]||0)+' '+esc(mstore.currency||'')+'</span>'+
  '<button class="btn sm" onclick="pickPlayer(\\''+n+'\\')" title="Adjust">Adjust</button></div>'}).join('')}
function pickPlayer(n){document.getElementById('mBalName').value=n}
function adjustBalance(mode){var name=document.getElementById('mBalName').value.trim();if(!name){alert('Enter a player name');return}
 var amt=Math.floor(Number(document.getElementById('mBalAmt').value)||0);var reason=document.getElementById('mBalReason').value;
 var cat=document.getElementById('mBalCat').value||undefined;
 var body=mode==='set'?{mcName:name,amount:amt,reason:reason,category:cat,mode:'set'}:{mcName:name,amount:mode==='remove'?-amt:amt,reason:reason,category:cat,mode:'add'};
 api('/api/servers/'+current.id+'/store/admin/balance',{method:'POST',body:JSON.stringify(body)}).then(function(r){
  if(!r.ok){alert(r.body&&r.body.error==='invalid-mcname'?'Invalid Minecraft name (3-16 letters, digits, underscore)':('Error: '+(r.body&&r.body.error||r.status)));return}
  document.getElementById('mBalReason').value='';loadManage()})}
var mledger=[];var mledgerFor='';
function toggleLedger(){var b=document.getElementById('mLedgerBody');var open=b.style.display==='none';
 b.style.display=open?'block':'none';document.getElementById('mLedgerCaret').textContent=open?'▾':'▸'}
// Reset the filter only when the ledger belongs to a DIFFERENT server - a
// filter must survive a refresh (and loadManage runs after every adjustment),
// but must not silently hide another server's entries.
function resetLedgerFilter(){document.getElementById('mLedgerQ').value='';document.getElementById('mLedgerKind').value='all';
 document.getElementById('mLedgerBody').style.display='none';document.getElementById('mLedgerCaret').textContent='▸'}
function loadLedger(){api('/api/servers/'+current.id+'/store/admin/ledger').then(function(r){if(r.ok){
 if(mledgerFor!==current.id){mledgerFor=current.id;resetLedgerFilter()}
 mledger=r.body.ledger||[];renderLedger()}})}
// Mirrors filterLedger/ledgerSummary in shared/economy.ts - the panel is plain
// browser JS and cannot import the module, so keep the two in step by hand.
function ledgerFiltered(){var q=(document.getElementById('mLedgerQ').value||'').trim().toLowerCase();
 var k=document.getElementById('mLedgerKind').value;var c=document.getElementById('mLedgerCat').value;
 return mledger.filter(function(e){if(k!=='all'&&e.kind!==k)return false;
  if(c==='none'){if(e.category!=null)return false}else if(c!=='all'&&e.category!==c)return false;
  if(!q)return true;
  return (e.mcName||'').toLowerCase().indexOf(q)>=0||(e.reason||'').toLowerCase().indexOf(q)>=0||(e.by||'').toLowerCase().indexOf(q)>=0})}
function renderLedger(){var el=document.getElementById('mLedger');var led=ledgerFiltered();
 var g=0,rm=0,sp=0;mledger.forEach(function(e){var d=e.delta||0;
  if(e.kind==='purchase')sp+=Math.abs(d);else if(d>=0)g+=d;else rm+=-d});
 document.getElementById('mLedgerSum').textContent=mledger.length?(' '+mledger.length+' entries · +'+g+' granted · −'+rm+' removed · '+sp+' spent'):'';
 if(!mledger.length){el.innerHTML='<div class="dim">No balance changes recorded yet.</div>';return}
 if(!led.length){el.innerHTML='<div class="dim">No entries match this filter.</div>';return}
 el.innerHTML=led.map(function(e){var d=e.delta||0;return '<div class="mrow"><span class="badge" style="'+(d>=0?'color:var(--online)':'color:#f87171')+'">'+(d>=0?'+':'')+d+'</span>'+
  '<div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(e.mcName)+' <span class="dim" style="font-weight:400">→ '+(e.balanceAfter||0)+' '+esc(mstore.currency||'')+'</span></div>'+
  '<div class="dim" style="font-size:11px">'+esc(e.kind||'')+' · by '+esc(e.by||'')+(e.category?' · '+esc(catName(e.category)):'')+(e.reason?' · '+esc(e.reason):'')+' · '+new Date(e.at).toLocaleString()+'</div></div></div>'}).join('')}
// Falls back to the raw id: deleting a category must not rewrite past entries.
function catName(id){var c=(mstore.categories||[]).filter(function(x){return x.id===id})[0];return c?c.name:id}
function renderCategories(){var cats=mstore.categories||[];
 var ids=cats.map(function(c){return c.id});
 var opts=cats.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'}).join('');
 // A selection is only restored if it still EXISTS. Restoring a deleted id
 // leaves the select with no matching option (value becomes ''), which the
 // filter then reads as a real category and matches nothing - a silently blank
 // ledger with nothing on screen explaining why.
 var sel=document.getElementById('mBalCat');var keep=sel.value;
 sel.innerHTML='<option value="">— none —</option>'+opts;
 sel.value=(keep&&ids.indexOf(keep)>=0)?keep:'';
 var f=document.getElementById('mLedgerCat');var keepF=f.value;
 f.innerHTML='<option value="all">All categories</option><option value="none">Uncategorised</option>'+opts;
 f.value=(keepF==='none'||(keepF&&ids.indexOf(keepF)>=0))?keepF:'all'}
function saveCurrency(){var c=document.getElementById('mCur').value.trim()||'Coins';
 api('/api/servers/'+current.id+'/store/admin/currency',{method:'POST',body:JSON.stringify({currency:c})}).then(function(r){if(!r.ok){alert('Could not save currency');return}loadManage()})}
function renderMProducts(){var el=document.getElementById('mProducts');var ps=mstore.products||[];
 if(!ps.length){el.innerHTML='<div class="dim">No products yet.</div>';return}
 el.innerHTML=ps.map(function(p){return '<div class="mrow"'+(p.hidden?' style="opacity:.55"':'')+'><span class="ic">'+(p.type==='crate'?CRATE_ICON_SVG:'📦')+'</span>'+
  '<div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(p.name)+
   (p.hidden?' <span class="badge">hidden</span>':'')+
   (typeof p.stock==='number'?' <span class="badge">'+(p.stock?p.stock+' left':'sold out')+'</span>':'')+'</div>'+
  '<div class="dim" style="font-size:12px">'+(p.price||0)+' '+esc(mstore.currency||'')+' · '+esc(p.description||'')+'</div></div>'+
  '<button class="btn sm" onclick="pmEdit(\\''+p.id+'\\')">Edit</button>'+
  '<button class="btn sm danger" onclick="pmDelete(\\''+p.id+'\\')">🗑</button></div>'}).join('')}
function pmDelete(id){if(!confirm('Delete this product?'))return;
 api('/api/servers/'+current.id+'/store/admin/delete',{method:'POST',body:JSON.stringify({productId:id})}).then(function(r){if(r.ok)loadManage()})}
function pmNew(type){pmDraft={id:'',type:type,name:'',description:'',price:100,icon:'',images:[],crateAnimation:'',_cmdText:'',rewards:type==='crate'?[{name:'Common',weight:70,icon:'',_ct:''}]:[]};renderPmEditor()}
function pmEdit(id){var p=null,ps=mstore.products||[];for(var i=0;i<ps.length;i++){if(ps[i].id===id)p=ps[i]}if(!p)return;
 pmDraft={id:p.id,type:p.type==='crate'?'crate':'item',name:p.name||'',description:p.description||'',price:p.price||0,icon:p.icon||'',crateAnimation:p.crateAnimation||'',images:(p.images||[]).slice(),hidden:!!p.hidden,stock:p.stock,perPlayerLimit:p.perPlayerLimit,sort:p.sort,_cmdText:(p.commands||[]).join('\\n'),
  rewards:(p.rewards||[]).map(function(r){return {name:r.name||'',weight:r.weight||0,icon:r.icon||'',_ct:(r.commands||[]).join('\\n')}})};renderPmEditor()}
function pmClose(){document.getElementById('pmModal').classList.add('hidden')}
function pmBackdrop(e){if(e.target&&e.target.id==='pmModal')pmClose()}
function pmField(f,v){pmDraft[f]=v}
function pmSetReward(i,f,v){var r=pmDraft.rewards[i];if(!r)return;r[f]=v;if(f==='weight')pmPct()}
function pmPct(){var tot=0;(pmDraft.rewards||[]).forEach(function(r){tot+=Math.max(0,Number(r.weight)||0)});if(!tot)tot=1;
 (pmDraft.rewards||[]).forEach(function(r,i){var b=document.getElementById('pmPct'+i);if(b)b.textContent=Math.round(Math.max(0,Number(r.weight)||0)/tot*100)+'%'})}
function pmAddReward(){pmDraft.rewards.push({name:'',weight:10,icon:'',_ct:''});renderPmEditor()}
function pmDelReward(i){pmDraft.rewards.splice(i,1);renderPmEditor()}
/* A picture chosen by URL or by upload, with a thumbnail of what buyers see.
   'field' is 'icon', 'images' (with an index) or 'reward' (with an index). */
function pmImageRow(field,val,idx){
 var v=val||'';
 var id='pmimg_'+field+'_'+idx;
 var setter=field==='images'?'pmSetImage('+idx+',this.value)'
  :field==='reward'?'pmSetReward('+idx+',\\'icon\\',this.value)'
  :'pmField(\\'icon\\',this.value)';
 return '<div class="row" style="gap:8px;align-items:center;margin:4px 0">'+
  '<span class="pm-thumb">'+(v?'<img src="'+escAttr(v)+'" alt="" onerror="this.style.display=\\'none\\'"/>':'')+'</span>'+
  '<input id="'+id+'" style="flex:1;min-width:80px" placeholder="https://… or upload" value="'+escAttr(v)+'" oninput="'+setter+'"/>'+
  '<button class="btn sm" onclick="pmUpload(\\''+field+'\\','+idx+')">Upload</button></div>'}
function pmAddImage(){pmDraft.images=(pmDraft.images||[]).concat(['']);renderPmEditor()}
function pmSetImage(i,v){var l=pmDraft.images||[];l[i]=v;
 /* An emptied slot is removed rather than kept blank, so clearing one is how
    you delete it - but only once the field loses focus, or the row would
    vanish from under the cursor mid-edit. */
 pmDraft.images=l}
/* Blank stays blank: undefined is "unlimited", 0 is "sold out". */
function pmNum(f,v){pmDraft[f]=(v===''?undefined:Number(v))}
function pmUpload(field,idx){
 var inp=document.getElementById('pmFile');
 inp.onchange=function(){var f=inp.files&&inp.files[0];if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
   fetch('/api/servers/'+current.id+'/store/admin/upload',{method:'POST',
    headers:{'Content-Type':f.type,'Authorization':'Bearer '+token},body:rd.result})
    .then(function(r){return r.json().then(function(j){return{ok:r.ok,body:j}})})
    .then(function(r){
     if(!r.ok){alert(r.body.error==='unsupported-image-type'?'That file type is not an image we serve.':r.body.error==='image-too-large'||r.body.error==='body-too-large'?'That image is too large.':'Upload failed.');return}
     if(field==='images')pmSetImage(idx,r.body.src);
     else if(field==='reward')pmSetReward(idx,'icon',r.body.src);
     else pmDraft.icon=r.body.src;
     renderPmEditor()})};
  rd.readAsArrayBuffer(f);inp.value=''};
 inp.click()}
function renderPmEditor(){var d=pmDraft;
 var h='<h3 style="margin:0 0 10px">'+(d.id?'Edit ':'New ')+(d.type==='crate'?'crate':'item')+'</h3>';
 h+='<div class="row" style="gap:10px">'+
  '<div style="flex:1;min-width:150px"><label>Name</label><input value="'+escAttr(d.name)+'" oninput="pmField(\\'name\\',this.value)"/></div>'+
  '<div style="width:120px"><label>Price</label><input type="number" value="'+(Number(d.price)||0)+'" oninput="pmField(\\'price\\',Number(this.value))"/></div></div>';
 h+='<label>Description</label><input value="'+escAttr(d.description)+'" oninput="pmField(\\'description\\',this.value)"/>';
 /* URL or upload, with a live thumbnail of what buyers will see (#76). */
 h+='<label>Icon</label>'+pmImageRow('icon',d.icon,-1);
 /* Extra pictures for the detail view (#77). Emptying a slot removes it. */
 h+='<label>Extra images</label><div id="pmImgs">'+(d.images||[]).map(function(im,i){return pmImageRow('images',im,i)}).join('')+'</div>';
 if((d.images||[]).length<8)h+='<button class="btn sm" onclick="pmAddImage()">+ Add image</button>';
 /* Availability (#81). Blank is unlimited; 0 is sold out - different things. */
 h+='<div class="row" style="gap:10px;margin-top:10px">'+
  '<div style="width:110px"><label>Stock</label><input type="number" min="0" placeholder="unlimited" value="'+(d.stock===''||d.stock===undefined||d.stock===null?'':Number(d.stock))+'" oninput="pmNum(\\'stock\\',this.value)"/></div>'+
  '<div style="width:140px"><label>Limit per player</label><input type="number" min="0" placeholder="unlimited" value="'+(d.perPlayerLimit===''||d.perPlayerLimit===undefined||d.perPlayerLimit===null?'':Number(d.perPlayerLimit))+'" oninput="pmNum(\\'perPlayerLimit\\',this.value)"/></div>'+
  '<div style="width:100px"><label>Order</label><input type="number" placeholder="—" value="'+(d.sort===''||d.sort===undefined||d.sort===null?'':Number(d.sort))+'" oninput="pmNum(\\'sort\\',this.value)"/></div>'+
  '<label class="row" style="gap:6px;align-self:flex-end;font-size:13px;margin-bottom:6px"><input type="checkbox" style="width:auto"'+(d.hidden?' checked':'')+' onchange="pmField(\\'hidden\\',this.checked)"/> Hidden</label></div>';
 h+='<div class="dim" style="font-size:12px;margin-top:4px">Blank stock or limit means unlimited. Hidden products are never sent to the storefront, so nobody can buy one by guessing its id. Order drives the Featured sort — blank comes after everything numbered.</div>';
 if(d.type==='item'){
  h+='<label>Commands — one per line, {player} = buyer</label><textarea style="min-height:90px" oninput="pmField(\\'_cmdText\\',this.value)">'+esc(d._cmdText)+'</textarea>';
 }else{
  /* The control that did not exist before (#74): the panel could reach the
     crate-animation route but never offered anything that called it. */
  h+='<label>Opening animation</label>';
  h+='<div class="row" style="gap:8px"><select id="pmAnim" style="flex:1" onchange="pmField(\\'crateAnimation\\',this.value)">'+
   '<option value=""'+(d.crateAnimation?'':' selected')+'>Use the store default</option>'+
   crateAnimationOptions(d.crateAnimation)+'</select>'+
   '<button class="btn sm" onclick="pmPreviewAnim()">&#9654; Preview</button></div>';
  h+='<label>Rewards (weighted)</label>';
  h+=(d.rewards||[]).map(function(r,i){return '<div class="rw-card"><div class="row" style="gap:8px">'+
   '<input style="flex:1;min-width:100px" placeholder="Reward name" value="'+escAttr(r.name)+'" oninput="pmSetReward('+i+',\\'name\\',this.value)"/>'+
   '<input style="width:78px" type="number" placeholder="Weight" value="'+(Number(r.weight)||0)+'" oninput="pmSetReward('+i+',\\'weight\\',Number(this.value))"/>'+
   '<span class="badge" id="pmPct'+i+'"></span>'+
   '<button class="btn sm danger" onclick="pmDelReward('+i+')">✕</button></div>'+
   pmImageRow('reward',r.icon||'',i)+
   '<textarea style="min-height:48px" placeholder="give {player} minecraft:diamond 3" oninput="pmSetReward('+i+',\\'_ct\\',this.value)">'+esc(r._ct||'')+'</textarea></div>'}).join('');
  h+='<button class="btn sm" onclick="pmAddReward()">＋ Add reward</button>';
 }
 h+='<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" onclick="pmClose()">Cancel</button><button class="btn primary" onclick="pmSave()">Save</button></div>';
 document.getElementById('pmBox').innerHTML=h;document.getElementById('pmModal').classList.remove('hidden');if(d.type==='crate')pmPct()}
/* Play the animation with this crate's own reward names, without buying
   anything. An empty selection previews whatever the store default is. */
function pmPreviewAnim(){var d=pmDraft;
 var pool=(d.rewards||[]).filter(function(r){return (r.name||'').trim()}).map(function(r){return {name:r.name,icon:r.icon}});
 var v=d.crateAnimation||mstore.crateAnimation||'reel';
 cratePreview(v,pool,'Preview of the "'+v+'" animation - nothing was bought.')}
function pmSave(){var d=pmDraft;var split=function(t){return (t||'').split('\\n').map(function(s){return s.trim()}).filter(Boolean)};
 var product={id:d.id||'',type:d.type==='crate'?'crate':'item',name:(d.name||'').trim()||'Product',description:d.description||'',price:Math.max(0,Math.floor(Number(d.price)||0)),icon:d.icon||'',
  commands:d.type==='item'?split(d._cmdText):[],
  rewards:d.type==='crate'?(d.rewards||[]).map(function(r){return {name:r.name||'',weight:Math.max(0,Number(r.weight)||0),icon:r.icon||'',commands:split(r._ct)}}):[]};
 /* Omitted rather than sent empty: an absent field means "inherit the store
    default", and '' would be a value the server has to guess about. */
 if(d.type==='crate'&&d.crateAnimation)product.crateAnimation=d.crateAnimation;
 var imgs=(d.images||[]).map(function(x){return (x||'').trim()}).filter(Boolean);
 if(imgs.length)product.images=imgs;
 if(d.hidden)product.hidden=true;
 /* Only sent when actually set - undefined is unlimited and 0 is sold out, so
    this cannot collapse to a truthiness check. */
 if(d.stock!==undefined&&d.stock!==null&&d.stock!=='')product.stock=Number(d.stock);
 if(d.perPlayerLimit!==undefined&&d.perPlayerLimit!==null&&d.perPlayerLimit!=='')product.perPlayerLimit=Number(d.perPlayerLimit);
 if(d.sort!==undefined&&d.sort!==null&&d.sort!=='')product.sort=Number(d.sort);
 api('/api/servers/'+current.id+'/store/admin/product',{method:'POST',body:JSON.stringify(product)}).then(function(r){if(!r.ok){alert('Could not save product');return}pmClose();loadManage()})}
function power(a){api('/api/servers/'+current.id+'/power',{method:'POST',body:JSON.stringify({action:a})})}
function sendCmd(){var i=document.getElementById('dCmd');var v=i.value.trim();if(!v)return;api('/api/servers/'+current.id+'/command',{method:'POST',body:JSON.stringify({command:v})});i.value=''}
function pollConsole(){if(!current)return;api('/api/servers/'+current.id+'/console').then(function(r){if(!r.ok)return;var box=document.getElementById('dConsole');var atBottom=box.scrollTop+box.clientHeight>=box.scrollHeight-40;
 box.innerHTML=(r.body.lines||[]).map(function(l){var cls=l.stream==='stderr'?'err':l.stream==='system'?'sys':/WARN/.test(l.line)?'warn':'';return '<div class="'+cls+'">'+esc(l.line.replace(/\\u00a7[0-9a-fk-or]/gi,''))+'</div>'}).join('');
 if(atBottom)box.scrollTop=box.scrollHeight;
 document.getElementById('dStatus').innerHTML=statusDot(r.body.status)+' '+r.body.status})}
function startPoll(){stopPoll();pollConsole();pollTimer=setInterval(function(){pollConsole();if(activeTab==='timeline')loadEvents()},2000)}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}
function showList(){stopPoll();mapStop();current=null;loadServers()}
/* ---- news (publish to the public website from the panel) ---- */
var editingPost=null;var galleryImages=[];var allUploads=[];
function showSection(which){
 document.getElementById('list').classList.toggle('hidden',which!=='servers');
 document.getElementById('newsSection').classList.toggle('hidden',which!=='news');
 document.getElementById('auditSection').classList.toggle('hidden',which!=='audit');
 document.getElementById('keysSection').classList.toggle('hidden',which!=='keys');
 document.getElementById('tabServersBtn').className='tab'+(which==='servers'?' on':'');
 document.getElementById('tabNewsBtn').className='tab'+(which==='news'?' on':'');
 document.getElementById('tabAuditBtn').classList.toggle('on',which==='audit');
 document.getElementById('tabKeysBtn').classList.toggle('on',which==='keys');
 if(which==='news'){loadPosts();loadUploads()}
 if(which==='audit'){loadAudit()}
 if(which==='keys'){loadKeys()}}

/* ---- API keys (#48). Owner-only; the routes enforce it too. ---- */
var KEY_SCOPES=['view','console','power','players','files','backups','settings','store'];
var kScopeSel={view:true},kServerSel={},kServerList=[];
function renderKeyScopes(){var el=document.getElementById('kScopes');
 el.innerHTML=KEY_SCOPES.map(function(s){return '<label class="chip" style="cursor:pointer"><input type="checkbox" '+(kScopeSel[s]?'checked':'')+' onchange="kScopeSel[\\''+s+'\\']=this.checked" style="width:auto;margin-right:5px"/>'+s+'</label>'}).join('')+
  '<label class="chip" style="cursor:pointer"><input type="checkbox" id="kAudit" style="width:auto;margin-right:5px"/>audit log</label>'}
function renderKeyServers(){var el=document.getElementById('kServers');var all=document.getElementById('kAll').checked;
 el.classList.toggle('hidden',all);
 if(all){el.innerHTML='';return}
 if(!kServerList.length){el.innerHTML='<span class="dim" style="font-size:12px">No servers.</span>';return}
 el.innerHTML=kServerList.map(function(s){return '<label class="chip" style="cursor:pointer"><input type="checkbox" '+(kServerSel[s.id]?'checked':'')+' onchange="kServerSel[\\''+s.id+'\\']=this.checked" style="width:auto;margin-right:5px"/>'+esc(s.name)+'</label>'}).join('')}
function loadKeys(){renderKeyScopes();
 api('/api/servers').then(function(r){kServerList=(r.ok&&r.body.servers)||[];renderKeyServers()});
 api('/api/keys').then(function(r){var el=document.getElementById('keysList');
  if(r.status===403){el.innerHTML='<div class="card dim">Owner access required.</div>';return}
  if(!r.ok){el.innerHTML='<div class="card dim">Could not load API keys.</div>';return}
  renderKeys(r.body.keys||[])})}
function keyState(k){if(k.revoked)return 'revoked';if(k.expiresAt&&k.expiresAt<=Date.now())return 'expired';return 'active'}
function renderKeys(keys){var el=document.getElementById('keysList');
 if(!keys.length){el.innerHTML='<div class="card dim">No API keys yet.</div>';return}
 el.innerHTML='<div class="card">'+keys.map(function(k){var st=keyState(k);
  var where=k.servers==='all'?'all servers':((k.servers||[]).length?k.servers.length+' server(s)':'no servers');
  return '<div class="mrow"><span class="ic">'+(st==='active'?'🔑':'✕')+'</span>'+
   '<div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(k.label)+' <span class="badge">'+st+'</span></div>'+
   '<div class="dim" style="font-size:12px">'+esc((k.scopes||[]).join(', ')||'no permissions')+' · '+esc(where)+
   (k.expiresAt?' · expires '+new Date(k.expiresAt).toLocaleDateString():'')+
   (k.lastUsedAt?' · last used '+new Date(k.lastUsedAt).toLocaleString():' · never used')+'</div></div>'+
   (k.revoked?'':'<button class="btn sm" onclick="revokeKey(\\''+k.id+'\\')">Revoke</button>')+
   '<button class="btn sm danger" onclick="deleteKey(\\''+k.id+'\\')">🗑</button></div>'}).join('')+'</div>'}
function createKey(){var label=document.getElementById('kLabel').value.trim();if(!label){alert('Give the key a label.');return}
 var scopes=KEY_SCOPES.filter(function(s){return kScopeSel[s]});
 var all=document.getElementById('kAll').checked;
 var servers=all?'all':kServerList.filter(function(s){return kServerSel[s.id]}).map(function(s){return s.id});
 var body={label:label,scopes:scopes,servers:servers,expiresInDays:Number(document.getElementById('kDays').value)||0,canAudit:document.getElementById('kAudit').checked};
 api('/api/keys',{method:'POST',body:JSON.stringify(body)}).then(function(r){
  if(!r.ok){alert('Could not issue the key.');return}
  /* Shown once, then gone: the server keeps only a hash. */
  var box=document.getElementById('keySecret');box.classList.remove('hidden');
  box.innerHTML='<div class="title">Key issued — '+esc(r.body.key.label)+'</div>'+
   '<div class="dim" style="font-size:12px;margin-bottom:6px">Copy it now. It is stored hashed and will never be shown again.</div>'+
   '<div style="word-break:break-all;font-family:ui-monospace,monospace;font-size:12px;background:var(--elev);padding:10px;border-radius:8px">'+esc(r.body.secret)+'</div>';
  document.getElementById('kLabel').value='';loadKeys()})}
function revokeKey(id){if(!confirm('Revoke this key? Anything using it stops working immediately.'))return;
 api('/api/keys/revoke',{method:'POST',body:JSON.stringify({keyId:id})}).then(function(r){if(r.ok)loadKeys()})}
function deleteKey(id){if(!confirm('Delete this key permanently? Audit entries will keep referring to it.'))return;
 api('/api/keys?keyId='+encodeURIComponent(id),{method:'DELETE'}).then(function(r){if(r.ok)loadKeys()})}
var auditTimer=null;
function auditDebounce(){clearTimeout(auditTimer);auditTimer=setTimeout(loadAudit,200)}
function loadAudit(){var qs=['limit=500'];
 var tx=document.getElementById('auditText').value.trim();if(tx)qs.push('text='+encodeURIComponent(tx));
 var src=document.getElementById('auditSource').value;if(src)qs.push('sources='+encodeURIComponent(src));
 var ok=document.getElementById('auditOk').value;if(ok)qs.push('ok='+ok);
 api('/api/audit?'+qs.join('&')).then(function(r){
  var el=document.getElementById('auditList'),meta=document.getElementById('auditMeta');
  if(r.status===403){el.innerHTML='<div class="card dim">Owner access required to view the audit log.</div>';meta.textContent='';return}
  if(!r.ok){el.innerHTML='<div class="card dim">Could not load the audit log.</div>';meta.textContent='';return}
  var p=r.body;meta.textContent=(p.total||0)+' entries';
  if(!p.entries||!p.entries.length){el.innerHTML='<div class="card dim">No matching audit entries.</div>';return}
  var rows=p.entries.map(function(e){
   return '<tr><td class="dim" style="white-space:nowrap">'+new Date(e.ts).toLocaleString()+'</td>'+
    '<td>'+esc(e.source)+'</td><td><b>'+esc(e.action)+'</b></td><td>'+esc(e.actor)+'</td>'+
    '<td class="dim">'+esc(e.ip||'—')+'</td><td class="dim">'+esc(e.target||e.detail||e.serverId||'—')+'</td>'+
    '<td style="text-align:center">'+(e.ok?'<span style="color:#4ade80">✓</span>':'<span style="color:#f87171">✕</span>')+'</td></tr>'}).join('');
  el.innerHTML='<div class="card tight" style="overflow-x:auto"><table class="audit-tbl"><thead><tr>'+
   '<th>When</th><th>Source</th><th>Action</th><th>Actor</th><th>IP</th><th>Target</th><th>Outcome</th></tr></thead><tbody>'+rows+'</tbody></table></div>'})}
function loadUploads(){return api('/api/site/uploads').then(function(r){var sel=document.getElementById('npCover');if(!sel)return;
 if(!r.ok){allUploads=[];sel.innerHTML='<option value="">(no cover)</option>';renderGallery();return}
 allUploads=r.body.uploads||[];var cover=sel.value;
 sel.innerHTML='<option value="">(no cover)</option>'+allUploads.map(function(u){return '<option value="'+esc(u)+'">'+esc(u)+'</option>'}).join('');
 sel.value=cover;renderGallery()})}
function renderGallery(){var g=document.getElementById('npGallery');if(!g)return;
 if(!allUploads.length){g.innerHTML='<span class="dim" style="font-size:12px">No images uploaded yet.</span>';return}
 g.innerHTML=allUploads.map(function(u){var on=galleryImages.indexOf(u)>=0;
  return '<button type="button" class="chip'+(on?' on':'')+'" onclick="toggleGallery(\\''+u+'\\')">'+esc(u.slice(0,14))+'</button>'}).join('')}
function toggleGallery(name){var i=galleryImages.indexOf(name);if(i>=0)galleryImages.splice(i,1);else galleryImages.push(name);renderGallery()}
function uploadImage(){var inp=document.getElementById('npFile'),hint=document.getElementById('npUpHint'),btn=document.getElementById('npUpBtn');
 var f=inp.files&&inp.files[0];if(!f)return;
 if(f.size>6*1024*1024){hint.textContent='Too large (max 6 MB)';inp.value='';return}
 btn.disabled=true;hint.textContent='Uploading…';
 fetch('/api/site/upload',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':f.type},body:f})
  .then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j}})})
  .then(function(r){btn.disabled=false;inp.value='';
   if(!r.ok){hint.textContent='Failed: '+((r.body&&r.body.error)||r.status);return}
   hint.textContent='Uploaded';var name=r.body.name;
   loadUploads().then(function(){if(!document.getElementById('npCover').value)document.getElementById('npCover').value=name;
    if(galleryImages.indexOf(name)<0)galleryImages.push(name);renderGallery()})})
  .catch(function(){btn.disabled=false;hint.textContent='Upload failed'})}
function loadPosts(){api('/api/site/posts').then(function(r){var el=document.getElementById('newsList');if(!el)return;
 if(!r.ok){el.innerHTML='<div class="card dim">No permission to manage news.</div>';return}
 var posts=r.body.posts||[];
 if(!posts.length){el.innerHTML='<div class="card dim">No posts yet.</div>';return}
 el.innerHTML=posts.map(function(p){return '<div class="srv" style="cursor:default"><div class="meta"><div class="name">'+esc(p.title)+'</div>'+
  '<div class="dim" style="font-size:13px">'+new Date(p.at).toLocaleString()+(p.author?' · by '+esc(p.author):'')+(p.updatedAt?' · updated':'')+'</div></div>'+
  '<button class="btn sm" onclick="editPost(\\''+p.id+'\\')">Edit</button>'+
  '<button class="btn sm danger" onclick="deletePost(\\''+p.id+'\\')">✕</button></div>'}).join('')})}
function editPost(id){api('/api/site/posts').then(function(r){if(!r.ok)return;
 var p=(r.body.posts||[]).find(function(x){return x.id===id});if(!p)return;
 editingPost=p.id;document.getElementById('npTitle').value=p.title||'';
 document.getElementById('npExcerpt').value=p.excerpt||'';document.getElementById('npBody').value=p.body||'';
 document.getElementById('npCover').value=p.cover||'';
 /* Load the existing gallery so saving an edit doesn't wipe it (the API
    overwrites images[] whenever the field is present). */
 galleryImages=(p.images||[]).slice();renderGallery();
 document.getElementById('newsFormTitle').textContent='Edit post';
 document.getElementById('npHint').textContent='editing';window.scrollTo(0,0)})}
function resetPostForm(){editingPost=null;['npTitle','npExcerpt','npBody'].forEach(function(i){document.getElementById(i).value=''});
 document.getElementById('npCover').value='';galleryImages=[];renderGallery();
 var uh=document.getElementById('npUpHint');if(uh)uh.textContent='';
 var pv=document.getElementById('npPreview');if(pv)pv.classList.add('hidden');
 document.getElementById('newsFormTitle').textContent='New post';document.getElementById('npHint').textContent=''}
function hidePreview(){var b=document.getElementById('npPreview');if(b)b.classList.add('hidden')}
/* Render the post as it will look published (mirrors the public site's detail:
   cover, excerpt, pre-wrapped body, gallery). Each click re-renders the current
   form state so it never goes stale after an edit; the x closes it. */
function previewPost(){var box=document.getElementById('npPreview');
 function up(n){return '/uploads/'+encodeURIComponent(n)}
 var title=document.getElementById('npTitle').value,exc=document.getElementById('npExcerpt').value,
  body=document.getElementById('npBody').value,cover=document.getElementById('npCover').value;
 box.innerHTML='<div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="dim" style="font-size:11px">Preview</span>'+
  '<button class="btn sm" onclick="hidePreview()">✕</button></div>'+
  '<h3>'+esc(title||'Untitled')+'</h3>'+
  (exc?'<div class="pv-excerpt">'+esc(exc)+'</div>':'')+
  (cover?'<img class="pv-cover" src="'+up(cover)+'" alt=""/>':'')+
  '<div class="pv-body">'+esc(body)+'</div>'+
  (galleryImages.length?'<div class="pv-gal">'+galleryImages.map(function(im){return '<img src="'+up(im)+'" alt=""/>'}).join('')+'</div>':'');
 box.classList.remove('hidden')}
function savePost(){var body={id:editingPost||undefined,title:document.getElementById('npTitle').value,
 excerpt:document.getElementById('npExcerpt').value,body:document.getElementById('npBody').value,
 cover:document.getElementById('npCover').value||undefined,images:galleryImages.slice()};
 if(!body.title.trim()){alert('Title required');return}
 api('/api/site/posts',{method:'POST',body:JSON.stringify(body)}).then(function(r){
  if(!r.ok){alert('Failed: '+(r.body.error||r.status));return}
  resetPostForm();loadPosts()})}
function deletePost(id){if(!confirm('Delete this post?'))return;
 api('/api/site/posts/delete',{method:'POST',body:JSON.stringify({id:id})}).then(function(){loadPosts()})}
if(token){loadServers()}else{show('login')}
</script>
</body></html>`
}
