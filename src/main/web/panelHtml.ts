// Self-contained, responsive (mobile-friendly) web panel served by the embedded
// HTTP server. Vanilla JS; authenticates with a bearer token in localStorage.
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
/* crate */
.crate-modal{position:fixed;inset:0;background:rgba(0,0,0,.72);display:grid;place-items:center;z-index:50;padding:16px}
.crate-box{background:linear-gradient(160deg,#17151b,#0c0c11);border:1px solid rgba(220,39,39,.45);border-radius:16px;padding:24px;width:min(470px,94vw);text-align:center;box-shadow:0 30px 70px rgba(0,0,0,.65)}
.reel-mask{position:relative;overflow:hidden;height:92px;border:1px solid var(--border);border-radius:10px;background:#08080c}
.reel{display:flex;gap:8px;padding:8px;transition:transform 4s cubic-bezier(.12,.7,.2,1)}
.reel-item{min-width:120px;height:76px;border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:var(--elev);border:1px solid var(--border);font-size:13px;font-weight:650;padding:6px;text-align:center}
.reel-item img{width:28px;height:28px;image-rendering:pixelated}
.reel-marker{position:absolute;top:0;left:50%;width:2px;height:100%;background:var(--accent);box-shadow:0 0 12px var(--accent)}
.crate-result{margin-top:15px;font-size:19px;font-weight:850;min-height:26px}
.crate-result.win{color:var(--accent);animation:pulse .5s ease 3}
@keyframes pulse{50%{transform:scale(1.12)}}
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
    </div>
    <div id="list"></div>
    <div id="newsSection" class="hidden">
      <div class="card">
        <div class="title" id="newsFormTitle">New post</div>
        <input id="npTitle" placeholder="Title"/>
        <input id="npExcerpt" placeholder="Short summary (optional)"/>
        <textarea id="npBody" rows="7" placeholder="Write your post…"></textarea>
        <div class="row" style="margin:6px 0">
          <select id="npCover" style="flex:1"></select>
          <button class="btn sm" onclick="loadUploads()" title="Refresh images">↻</button>
        </div>
        <div class="row">
          <button class="btn primary" onclick="savePost()">Publish</button>
          <button class="btn sm" onclick="resetPostForm()">Clear</button>
          <span class="dim" id="npHint" style="font-size:12px"></span>
        </div>
      </div>
      <div id="newsList"></div>
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
      <button class="tab" id="tabStore" onclick="showTab('store')">Store</button>
    </div>
    <div id="panelConsole">
      <div id="dConsole" class="console"></div>
      <div id="dCmdRow" class="row" style="margin-top:8px">
        <input id="dCmd" placeholder="Command…" style="flex:1" onkeydown="if(event.key==='Enter')sendCmd()"/>
        <button class="btn primary" onclick="sendCmd()">Send</button>
      </div>
    </div>
    <div id="panelStats" class="hidden">
      <div class="row" style="margin-bottom:4px">
        <button class="btn sm" onclick="setRange(3600000,this)">1 h</button>
        <button class="btn sm primary" onclick="setRange(86400000,this)">24 h</button>
        <button class="btn sm" onclick="setRange(604800000,this)">7 d</button>
      </div>
      <div id="dStats" class="stats"></div>
      <div id="dCharts" class="charts"></div>
    </div>
    <div id="panelTimeline" class="hidden"><div class="card tight" id="dEvents"></div></div>
    <div id="panelStore" class="hidden">
      <div class="row" style="margin-bottom:10px"><b>Store</b><div class="spacer"></div><span id="dBal" class="badge"></span></div>
      <div id="dProducts" class="pgrid"></div>
    </div>
  </div>
</div>

<div id="crate" class="crate-modal hidden" onclick="closeCrate(event)">
  <div class="crate-box">
    <div class="reel-mask"><div id="reel" class="reel"></div><div class="reel-marker"></div></div>
    <div id="crateResult" class="crate-result"></div>
    <button class="btn primary" onclick="closeCrate()" style="margin-top:12px">OK</button>
  </div>
</div>

<script>
var token=localStorage.getItem('msms_token')||'';
var current=null, pollTimer=null, statsRange=86400000, activeTab='console';
function api(path,opts){opts=opts||{};opts.headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});if(token)opts.headers['Authorization']='Bearer '+token;return fetch(path,opts).then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j}})})}
function show(id){['login','app','detail'].forEach(function(x){document.getElementById(x).classList.add('hidden')});document.getElementById(id).classList.remove('hidden');
 document.getElementById('logout').classList.toggle('hidden',id==='login');
 document.getElementById('who').classList.toggle('hidden',id==='login')}
function doLogin(){var u=document.getElementById('u').value,p=document.getElementById('p').value;
 api('/api/login',{method:'POST',body:JSON.stringify({username:u,password:p})}).then(function(r){
  if(!r.ok){document.getElementById('loginErr').textContent=r.body.error==='too-many-attempts'?'Too many attempts, wait a bit.':'Invalid credentials';return}
  token=r.body.token;localStorage.setItem('msms_token',token);
  if(r.body.user)document.getElementById('who').textContent=r.body.user.username+' · '+r.body.user.role;
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
  api('/api/me').then(function(r){if(r.ok)document.getElementById('who').textContent=r.body.username+' · '+r.body.role})}}
function esc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
function openServer(id){api('/api/servers/'+id).then(function(r){if(!r.ok){alert('No access');return}current=r.body;renderDetail();startPoll()})}
function renderDetail(){show('detail');var s=current;document.getElementById('dName').textContent=s.name;
 document.getElementById('dStatus').innerHTML=statusDot(s.status)+' '+s.status;
 var has=function(sc){return s.scopes.indexOf(sc)>=0};
 var c=document.getElementById('dControls');c.innerHTML='';
 if(has('power')){c.innerHTML=[['start','▶ Start'],['stop','■ Stop'],['restart','↻ Restart'],['kill','⚡ Kill']].map(function(a){
   return '<button class="btn sm'+(a[0]==='start'?' primary':a[0]==='kill'?' danger':'')+'" onclick="power(\\''+a[0]+'\\')">'+a[1]+'</button>'}).join('')}
 document.getElementById('dCmdRow').style.display=has('console')?'flex':'none';showTab('console')}
function showTab(tab){activeTab=tab;
 [['console','panelConsole','tabConsole'],['stats','panelStats','tabStats'],['timeline','panelTimeline','tabTimeline'],['store','panelStore','tabStore']]
  .forEach(function(t){document.getElementById(t[1]).classList.toggle('hidden',tab!==t[0]);
   document.getElementById(t[2]).classList.toggle('on',tab===t[0])});
 if(tab==='store')loadStore();
 if(tab==='stats')loadStats();
 if(tab==='timeline')loadEvents()}

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
    : '<div class="dim">Nothing recorded in this range yet.</div>'})})}

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
function loadStore(){api('/api/servers/'+current.id+'/store').then(function(r){if(!r.ok)return;api('/api/servers/'+current.id+'/store/balance').then(function(b){var bal=b.ok?b.body:{balance:0,mcName:null};document.getElementById('dBal').textContent=(bal.mcName?bal.mcName+': ':'')+(bal.balance||0)+' '+(r.body.currency||'');renderProducts(r.body)})})}
function renderProducts(store){var el=document.getElementById('dProducts');if(!store.products.length){el.innerHTML='<div class="dim">No products yet.</div>';return}el.innerHTML=store.products.map(function(p){return '<div class="pcard">'+(p.icon?'<img src="'+esc(p.icon)+'"/>':'')+'<div class="pname">'+esc(p.name)+(p.type==='crate'?' 🎁':'')+'</div><div class="pdesc">'+esc(p.description||'')+'</div><div class="row"><span class="price">'+p.price+' '+esc(store.currency)+'</span><div class="spacer"></div><button class="btn primary sm" onclick="buy(\\''+p.id+'\\')">Buy</button></div></div>'}).join('')}
function buy(pid){api('/api/servers/'+current.id+'/store/buy',{method:'POST',body:JSON.stringify({productId:pid})}).then(function(r){if(!r.ok){alert(r.body.error==='insufficient'?'Not enough balance':r.body.error==='no-mc-linked'?'No Minecraft name linked to your account':('Error: '+r.body.error));return}loadStore();if(r.body.reward&&r.body.reward.crate){openCrate(r.body.reward)}else{alert('You received: '+(r.body.reward?r.body.reward.name:''))}})}
function openCrate(reward){var modal=document.getElementById('crate');modal.classList.remove('hidden');var reel=document.getElementById('reel');var res=document.getElementById('crateResult');res.textContent='';res.className='crate-result';var pool=reward.pool&&reward.pool.length?reward.pool:[{name:reward.name}];var strip=[];for(var i=0;i<40;i++){strip.push(pool[Math.floor(Math.random()*pool.length)])}var winIdx=strip.length-4;strip[winIdx]={name:reward.name,icon:reward.icon};reel.style.transition='none';reel.style.transform='translateX(0)';reel.innerHTML=strip.map(function(it){return '<div class="reel-item">'+(it.icon?'<img src="'+esc(it.icon)+'"/>':'')+esc(it.name)+'</div>'}).join('');var itemW=128;var mask=document.querySelector('.reel-mask').clientWidth;var offset=winIdx*itemW-(mask/2-60);requestAnimationFrame(function(){reel.style.transition='transform 4s cubic-bezier(.12,.7,.2,1)';reel.style.transform='translateX(-'+offset+'px)'});setTimeout(function(){res.textContent='🎉 '+reward.name;res.className='crate-result win'},4100)}
function closeCrate(e){if(e&&e.target&&e.target.id!=='crate'&&e.target.tagName!=='BUTTON')return;document.getElementById('crate').classList.add('hidden')}
function power(a){api('/api/servers/'+current.id+'/power',{method:'POST',body:JSON.stringify({action:a})})}
function sendCmd(){var i=document.getElementById('dCmd');var v=i.value.trim();if(!v)return;api('/api/servers/'+current.id+'/command',{method:'POST',body:JSON.stringify({command:v})});i.value=''}
function pollConsole(){if(!current)return;api('/api/servers/'+current.id+'/console').then(function(r){if(!r.ok)return;var box=document.getElementById('dConsole');var atBottom=box.scrollTop+box.clientHeight>=box.scrollHeight-40;
 box.innerHTML=(r.body.lines||[]).map(function(l){var cls=l.stream==='stderr'?'err':l.stream==='system'?'sys':/WARN/.test(l.line)?'warn':'';return '<div class="'+cls+'">'+esc(l.line.replace(/\\u00a7[0-9a-fk-or]/gi,''))+'</div>'}).join('');
 if(atBottom)box.scrollTop=box.scrollHeight;
 document.getElementById('dStatus').innerHTML=statusDot(r.body.status)+' '+r.body.status})}
function startPoll(){stopPoll();pollConsole();pollTimer=setInterval(function(){pollConsole();if(activeTab==='timeline')loadEvents()},2000)}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}
function showList(){stopPoll();current=null;loadServers()}
/* ---- news (publish to the public website from the panel) ---- */
var editingPost=null;
function showSection(which){
 document.getElementById('list').classList.toggle('hidden',which!=='servers');
 document.getElementById('newsSection').classList.toggle('hidden',which!=='news');
 document.getElementById('tabServersBtn').className='tab'+(which==='servers'?' on':'');
 document.getElementById('tabNewsBtn').className='tab'+(which==='news'?' on':'');
 if(which==='news'){loadPosts();loadUploads()}}
function loadUploads(){api('/api/site/uploads').then(function(r){var sel=document.getElementById('npCover');if(!sel)return;
 if(!r.ok){sel.innerHTML='<option value="">(no cover)</option>';return}
 sel.innerHTML='<option value="">(no cover)</option>'+(r.body.uploads||[]).map(function(u){return '<option value="'+esc(u)+'">'+esc(u)+'</option>'}).join('')})}
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
 document.getElementById('newsFormTitle').textContent='Edit post';
 document.getElementById('npHint').textContent='editing';window.scrollTo(0,0)})}
function resetPostForm(){editingPost=null;['npTitle','npExcerpt','npBody'].forEach(function(i){document.getElementById(i).value=''});
 document.getElementById('npCover').value='';document.getElementById('newsFormTitle').textContent='New post';document.getElementById('npHint').textContent=''}
function savePost(){var body={id:editingPost||undefined,title:document.getElementById('npTitle').value,
 excerpt:document.getElementById('npExcerpt').value,body:document.getElementById('npBody').value,
 cover:document.getElementById('npCover').value||undefined};
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
