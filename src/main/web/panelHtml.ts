// Self-contained, responsive (mobile-friendly) web panel served by the embedded
// HTTP server. Vanilla JS; authenticates with a bearer token in localStorage.
export function getPanelHtml(): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="theme-color" content="#0b0b10"/>
<title>CaYaDev Panel</title>
<style>
:root{--bg:#0b0b10;--panel:#16151b;--elev:#1b1a22;--hover:#232231;--border:#2a2a36;--text:#e7e9ee;--dim:#9aa0ad;--accent:#dc2727;--accent2:#a81d1d;--online:#4ade80}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:radial-gradient(900px 400px at 20% -5%,rgba(220,39,39,.12),transparent 60%),var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:15px}
a{color:var(--accent)}
.wrap{max-width:900px;margin:0 auto;padding:16px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:.5px}
.brand span{color:var(--accent)}
.logo{width:32px;height:32px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;margin:12px 0}
input,button,select{font-family:inherit;font-size:15px}
input,select{width:100%;padding:11px 13px;background:#101019;border:1px solid var(--border);border-radius:9px;color:var(--text);margin:6px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:11px 15px;border-radius:9px;border:1px solid var(--border);background:var(--elev);color:var(--text);font-weight:600;cursor:pointer}
.btn:hover{background:var(--hover)}
.btn.primary{background:var(--accent);border-color:var(--accent2);color:#fff}
.btn.primary:hover{background:var(--accent2)}
.btn.block{width:100%}
.btn.sm{padding:8px 11px;font-size:13px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.spacer{flex:1}
.dim{color:var(--dim)}
.badge{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:12px;background:var(--hover);border:1px solid var(--border);color:var(--dim)}
.dot{width:8px;height:8px;border-radius:50%;background:#6b7280}
.dot.running{background:var(--online)}.dot.crashed{background:var(--accent)}.dot.starting,.dot.stopping{background:#fbbf24}
.srv{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--panel);margin:10px 0;cursor:pointer}
.srv:hover{background:var(--hover)}
.srv .meta{flex:1;min-width:0}
.srv .name{font-weight:700}
.console{background:#08080c;border:1px solid var(--border);border-radius:10px;padding:12px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;line-height:1.5;height:52vh;overflow:auto;white-space:pre-wrap;word-break:break-word}
.console .warn{color:#fbbf24}.console .err{color:#f87171}.console .sys{color:#60a5fa}
.hidden{display:none}
.err-msg{color:#f87171;font-size:13px;margin-top:8px}
.title{font-weight:800;font-size:18px;margin:4px 0 12px}
h2{margin:6px 0}
@media(max-width:560px){.wrap{padding:12px}.console{height:44vh}}
</style></head>
<body>
<div class="wrap">
  <div class="row" style="margin-bottom:8px">
    <div class="brand">
      <svg class="logo" viewBox="0 0 512 512"><defs><linearGradient id="c" x1=".15" y1=".05" x2=".85" y2=".95"><stop offset="0" stop-color="#f04444"/><stop offset="1" stop-color="#a81d1d"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="120" fill="#17151b" stroke="#dc2727" stroke-opacity=".4" stroke-width="3"/><path fill="url(#c)" d="M 330 106 L 150 106 L 106 150 L 106 362 L 150 406 L 330 406 L 330 332 L 180 332 L 180 180 L 330 180 Z"/><rect x="356" y="232" width="48" height="48" rx="9" fill="url(#c)" transform="rotate(45 380 256)"/></svg>
      CaYa<span>Dev</span>
    </div>
    <div class="spacer"></div>
    <button id="logout" class="btn sm hidden" onclick="logout()">Logout</button>
  </div>

  <div id="login" class="card" style="max-width:380px;margin:8vh auto">
    <div class="title">Sign in</div>
    <input id="u" placeholder="Username" autocomplete="username"/>
    <input id="p" type="password" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()"/>
    <button class="btn primary block" onclick="doLogin()">Sign in</button>
    <div id="loginErr" class="err-msg"></div>
  </div>

  <div id="app" class="hidden">
    <div id="list"></div>
  </div>

  <div id="detail" class="hidden">
    <div class="row"><button class="btn sm" onclick="showList()">← Back</button><div class="spacer"></div><span id="dStatus" class="badge"></span></div>
    <h2 id="dName"></h2>
    <div id="dControls" class="row" style="margin-bottom:10px"></div>
    <div id="dConsole" class="console"></div>
    <div id="dCmdRow" class="row" style="margin-top:8px">
      <input id="dCmd" placeholder="Command…" style="flex:1" onkeydown="if(event.key==='Enter')sendCmd()"/>
      <button class="btn primary" onclick="sendCmd()">Send</button>
    </div>
  </div>
</div>

<script>
var token=localStorage.getItem('msms_token')||'';
var current=null, pollTimer=null;
function api(path,opts){opts=opts||{};opts.headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});if(token)opts.headers['Authorization']='Bearer '+token;return fetch(path,opts).then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j}})})}
function show(id){['login','app','detail'].forEach(function(x){document.getElementById(x).classList.add('hidden')});document.getElementById(id).classList.remove('hidden');document.getElementById('logout').classList.toggle('hidden',id==='login')}
function doLogin(){var u=document.getElementById('u').value,p=document.getElementById('p').value;
 api('/api/login',{method:'POST',body:JSON.stringify({username:u,password:p})}).then(function(r){
  if(!r.ok){document.getElementById('loginErr').textContent=r.body.error==='too-many-attempts'?'Too many attempts, wait a bit.':'Invalid credentials';return}
  token=r.body.token;localStorage.setItem('msms_token',token);renderList(r.body.servers)})}
function logout(){api('/api/logout',{method:'POST'});token='';localStorage.removeItem('msms_token');stopPoll();show('login')}
function loadServers(){api('/api/servers').then(function(r){if(r.status===401){logout();return}renderList(r.body.servers)})}
function statusDot(s){return '<span class="dot '+s+'"></span>'}
function renderList(servers){show('app');var el=document.getElementById('list');
 if(!servers||!servers.length){el.innerHTML='<div class="card dim">No servers you can access.</div>';return}
 el.innerHTML=servers.map(function(s){return '<div class="srv" onclick="openServer(\\''+s.id+'\\')">'+statusDot(s.status)+'<div class="meta"><div class="name">'+esc(s.name)+'</div><div class="dim">'+s.type+' · '+s.mcVersion+' · '+s.status+'</div></div><span class="dim">›</span></div>'}).join('')}
function esc(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML}
function openServer(id){api('/api/servers/'+id).then(function(r){if(!r.ok){alert('No access');return}current=r.body;renderDetail();startPoll()})}
function renderDetail(){show('detail');var s=current;document.getElementById('dName').textContent=s.name;
 document.getElementById('dStatus').innerHTML=statusDot(s.status)+' '+s.status;
 var has=function(sc){return s.scopes.indexOf(sc)>=0};
 var c=document.getElementById('dControls');c.innerHTML='';
 if(has('power')){c.innerHTML=['start','stop','restart','kill'].map(function(a){return '<button class="btn sm" onclick="power(\\''+a+'\\')">'+a+'</button>'}).join('')}
 document.getElementById('dCmdRow').style.display=has('console')?'flex':'none'}
function power(a){api('/api/servers/'+current.id+'/power',{method:'POST',body:JSON.stringify({action:a})})}
function sendCmd(){var i=document.getElementById('dCmd');var v=i.value.trim();if(!v)return;api('/api/servers/'+current.id+'/command',{method:'POST',body:JSON.stringify({command:v})});i.value=''}
function pollConsole(){if(!current)return;api('/api/servers/'+current.id+'/console').then(function(r){if(!r.ok)return;var box=document.getElementById('dConsole');var atBottom=box.scrollTop+box.clientHeight>=box.scrollHeight-40;
 box.innerHTML=(r.body.lines||[]).map(function(l){var cls=l.stream==='stderr'?'err':l.stream==='system'?'sys':/WARN/.test(l.line)?'warn':'';return '<div class="'+cls+'">'+esc(l.line.replace(/\\u00a7[0-9a-fk-or]/gi,''))+'</div>'}).join('');
 if(atBottom)box.scrollTop=box.scrollHeight;
 document.getElementById('dStatus').innerHTML=statusDot(r.body.status)+' '+r.body.status})}
function startPoll(){stopPoll();pollConsole();pollTimer=setInterval(pollConsole,2000)}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}
function showList(){stopPoll();current=null;loadServers()}
if(token){loadServers()}else{show('login')}
</script>
</body></html>`
}
