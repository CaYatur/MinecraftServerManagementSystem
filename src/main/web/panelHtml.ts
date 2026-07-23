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
.hidden{display:none!important}
.err-msg{color:#f87171;font-size:13px;margin-top:8px}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.pcard{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}
.pcard img{width:44px;height:44px;border-radius:8px;image-rendering:pixelated;background:#101019}
.pcard .pname{font-weight:700}
.pcard .pdesc{font-size:12px;color:var(--dim);flex:1}
.price{color:var(--accent);font-weight:700}
.crate-modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:grid;place-items:center;z-index:50;padding:16px}
.crate-box{background:linear-gradient(160deg,#17151b,#0c0c11);border:1px solid rgba(220,39,39,.4);border-radius:16px;padding:22px;width:min(460px,94vw);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.reel-mask{position:relative;overflow:hidden;height:88px;border:1px solid var(--border);border-radius:10px;background:#08080c}
.reel{display:flex;gap:8px;padding:8px;transition:transform 4s cubic-bezier(.12,.7,.2,1)}
.reel-item{min-width:120px;height:72px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:var(--elev);border:1px solid var(--border);font-size:13px;font-weight:600;padding:6px}
.reel-item img{width:28px;height:28px;image-rendering:pixelated}
.reel-marker{position:absolute;top:0;left:50%;width:2px;height:100%;background:var(--accent);box-shadow:0 0 10px var(--accent)}
.crate-result{margin-top:14px;font-size:18px;font-weight:800;min-height:24px}
.crate-result.win{color:var(--accent);animation:pulse .5s ease 3}
@keyframes pulse{50%{transform:scale(1.12)}}
.title{font-weight:800;font-size:18px;margin:4px 0 12px}
h2{margin:6px 0}
@media(max-width:560px){.wrap{padding:12px}.console{height:44vh}}
</style></head>
<body>
<div class="wrap">
  <div class="row" style="margin-bottom:8px">
    <div class="brand">
      <svg class="logo" viewBox="0 0 512 512"><defs><linearGradient id="c" x1=".15" y1=".05" x2=".85" y2=".95"><stop offset="0" stop-color="#f04444"/><stop offset="1" stop-color="#a81d1d"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="120" fill="#17151b" stroke="#dc2727" stroke-opacity=".4" stroke-width="3"/><path fill="url(#c)" d="M 330 106 L 150 106 L 106 150 L 106 362 L 150 406 L 330 406 L 330 332 L 180 332 L 180 180 L 330 180 Z"/><rect x="356" y="232" width="48" height="48" rx="9" fill="url(#c)" transform="rotate(45 380 256)"/></svg>
      <svg height="22" viewBox="0 0 287.34 36.78" style="margin-left:2px"><path fill="#fff" d="M246.93,0l21.5,22.56,13.19-21.51L287.34,0l-17.23,36.69h-3.35L241.21,0h5.72Z"/><polygon fill="#dc2727" points="47.33 0 34.18 8.71 8.62 8.71 8.62 29.55 34.07 29.55 47.33 36.7 0 36.7 0 0 47.33 0"/><polygon fill="#dc2727" points="133.16 .05 115.25 21.85 112.95 36.78 107.85 36.78 104.27 21.85 83.58 .05 90.78 .05 109.93 16.85 125.95 .05 133.16 .05"/><path fill="#fff" d="M184.93,32.42l15.99-15.72-22.52-12.42L177.15,0l33.84,15.45v2.51l-24.77,18.74-1.3-4.28Z"/><path fill="#dc2727" d="M84.34,18.89l-1.61-4.21L77.14,0h-19.22l-3.9,15.61-1.11,4.43-4.17,16.65h4.94l6.86-13.08,6.16,2.88h4.22l6.17-3.5,9.1,13.7h4.94l-6.79-17.81ZM68.81,20.5l-5.65-1.87,4.87-9.3,5.97,8.99-5.19,2.17Z"/><path fill="#dc2727" d="M165.49,18.89l-1.61-4.21L158.29,0h-19.22l-3.9,15.61-1.11,4.43-4.17,16.65h4.94l6.86-13.08,6.16,2.88h4.22l6.17-3.5,9.1,13.7h4.94l-6.79-17.81ZM149.96,20.5l-5.65-1.87,4.87-9.3,5.97,8.99-5.19,2.17Z"/><polygon fill="#fff" points="174.93 0 166.64 0 178.65 36.78 184.39 36.7 174.93 0"/><polygon fill="#fff" points="243.91 36.7 227.66 36.7 221.91 36.78 209.91 0 218.19 0 218.19 .01 239.17 0 237.85 3.22 219.83 6.36 222.09 15.13 237.15 15.13 237.38 19.11 223.73 21.48 226.04 30.41 241.59 33.12 243.91 36.7"/></svg>
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
    <div class="row" style="margin-bottom:10px">
      <button class="btn sm primary" id="tabServersBtn" onclick="showSection('servers')">Servers</button>
      <button class="btn sm" id="tabNewsBtn" onclick="showSection('news')">News</button>
    </div>
    <div id="list"></div>
    <div id="newsSection" class="hidden">
      <div class="card">
        <div class="title" id="newsFormTitle">New post</div>
        <input id="npTitle" placeholder="Title"/>
        <input id="npExcerpt" placeholder="Short summary (optional)"/>
        <textarea id="npBody" rows="7" placeholder="Write your post…" style="width:100%;padding:11px 13px;background:#101019;border:1px solid var(--border);border-radius:9px;color:var(--text);font-family:inherit;font-size:15px;margin:6px 0"></textarea>
        <div class="row" style="margin:6px 0">
          <select id="npCover" style="flex:1"></select>
          <button class="btn sm" onclick="loadUploads()">↻</button>
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
    <div class="row"><button class="btn sm" onclick="showList()">← Back</button><div class="spacer"></div><span id="dStatus" class="badge"></span></div>
    <h2 id="dName"></h2>
    <div class="row" style="gap:6px;margin-bottom:10px">
      <button class="btn sm" id="tabConsole" onclick="showTab('console')">Console</button>
      <button class="btn sm" id="tabStore" onclick="showTab('store')">Store</button>
    </div>
    <div id="dControls" class="row" style="margin-bottom:10px"></div>
    <div id="panelConsole">
      <div id="dConsole" class="console"></div>
      <div id="dCmdRow" class="row" style="margin-top:8px">
        <input id="dCmd" placeholder="Command…" style="flex:1" onkeydown="if(event.key==='Enter')sendCmd()"/>
        <button class="btn primary" onclick="sendCmd()">Send</button>
      </div>
    </div>
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
 document.getElementById('dCmdRow').style.display=has('console')?'flex':'none';showTab('console')}
function showTab(tab){document.getElementById('panelConsole').classList.toggle('hidden',tab!=='console');document.getElementById('panelStore').classList.toggle('hidden',tab!=='store');document.getElementById('tabConsole').classList.toggle('primary',tab==='console');document.getElementById('tabStore').classList.toggle('primary',tab==='store');if(tab==='store')loadStore()}
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
function startPoll(){stopPoll();pollConsole();pollTimer=setInterval(pollConsole,2000)}
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}
function showList(){stopPoll();current=null;loadServers()}
/* ---- news (publish to the public website from the panel) ---- */
var editingPost=null;
function showSection(which){
 document.getElementById('list').classList.toggle('hidden',which!=='servers');
 document.getElementById('newsSection').classList.toggle('hidden',which!=='news');
 document.getElementById('tabServersBtn').className='btn sm'+(which==='servers'?' primary':'');
 document.getElementById('tabNewsBtn').className='btn sm'+(which==='news'?' primary':'');
 if(which==='news'){loadPosts();loadUploads()}}
function loadUploads(){api('/api/site/uploads').then(function(r){var sel=document.getElementById('npCover');if(!sel)return;
 if(!r.ok){sel.innerHTML='<option value="">(no cover)</option>';return}
 sel.innerHTML='<option value="">(no cover)</option>'+(r.body.uploads||[]).map(function(u){return '<option value="'+esc(u)+'">'+esc(u)+'</option>'}).join('')})}
function loadPosts(){api('/api/site/posts').then(function(r){var el=document.getElementById('newsList');if(!el)return;
 if(!r.ok){el.innerHTML='<div class="card dim">No permission to manage news.</div>';return}
 var posts=r.body.posts||[];
 if(!posts.length){el.innerHTML='<div class="card dim">No posts yet.</div>';return}
 el.innerHTML=posts.map(function(p){return '<div class="srv"><div class="meta"><div class="name">'+esc(p.title)+'</div>'+
  '<div class="dim">'+new Date(p.at).toLocaleString()+(p.author?' · by '+esc(p.author):'')+(p.updatedAt?' · updated':'')+'</div></div>'+
  '<button class="btn sm" onclick="editPost(\\''+p.id+'\\')">Edit</button>'+
  '<button class="btn sm" onclick="deletePost(\\''+p.id+'\\')">✕</button></div>'}).join('')})}
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
