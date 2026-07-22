// Public, themeable server website: hero + live status + news + store (with
// in-game-code player accounts). Self-contained; escapes all user content.
export function getPublicSiteHtml(): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="theme-color" content="#0b0b10"/>
<title>Server</title>
<style>
:root{--bg:#0b0b10;--panel:#16151b;--elev:#1b1a22;--hover:#232231;--border:#2a2a36;--text:#e7e9ee;--dim:#9aa0ad;--accent:#dc2727;--online:#4ade80}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;scroll-behavior:smooth}
a{color:var(--accent);text-decoration:none}
.wrap{max-width:1000px;margin:0 auto;padding:0 18px}
header{position:sticky;top:0;z-index:20;background:rgba(11,11,16,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.nav{display:flex;align-items:center;gap:18px;height:60px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px}
.brand .logo{width:30px;height:30px}
.nav a.link{color:var(--dim);font-weight:600;font-size:14px}
.nav a.link:hover{color:var(--text)}
.spacer{flex:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 16px;border-radius:10px;border:1px solid var(--border);background:var(--elev);color:var(--text);font-weight:600;font-size:14px;cursor:pointer}
.btn:hover{background:var(--hover)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{filter:brightness(1.1)}
.btn.sm{padding:7px 11px;font-size:13px}
.hero{position:relative;padding:80px 0 60px;text-align:center;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(700px 340px at 50% -10%,color-mix(in srgb,var(--accent) 26%,transparent),transparent 60%);z-index:-1}
.hero h1{font-size:clamp(34px,6vw,60px);margin:0 0 10px;font-weight:900;letter-spacing:-1px}
.hero .tag{color:var(--accent);font-weight:800;font-size:clamp(16px,2.5vw,22px);margin-bottom:16px}
.hero .desc{color:var(--dim);max-width:600px;margin:0 auto 24px;line-height:1.6}
.statuspill{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:var(--panel);border:1px solid var(--border);font-weight:600;margin-bottom:22px}
.dot{width:9px;height:9px;border-radius:50%;background:#6b7280}
.dot.on{background:var(--online);box-shadow:0 0 8px var(--online)}
.section{padding:40px 0}
.section h2{font-size:26px;margin:0 0 20px;font-weight:800}
.posts{display:grid;gap:16px}
.post{background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.post img{width:100%;max-height:300px;object-fit:cover;display:block}
.post .pc{padding:16px 18px}
.post h3{margin:0 0 6px;font-size:19px}
.post .meta{color:var(--dim);font-size:12px;margin-bottom:8px}
.post .body{color:var(--text);line-height:1.6;white-space:pre-wrap}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px}
.pcard{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px}
.pcard img{width:52px;height:52px;border-radius:8px;image-rendering:pixelated;background:#101019}
.pcard .pn{font-weight:700}
.pcard .pd{font-size:12.5px;color:var(--dim);flex:1}
.price{color:var(--accent);font-weight:800}
input{width:100%;padding:12px 14px;background:#101019;border:1px solid var(--border);border-radius:10px;color:var(--text);margin:6px 0;font-size:15px}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);display:grid;place-items:center;z-index:60;padding:16px}
.modal{background:linear-gradient(160deg,#17151b,#0c0c11);border:1px solid var(--border);border-radius:16px;padding:24px;width:min(420px,94vw)}
.modal h3{margin:0 0 12px}
.muted{color:var(--dim);font-size:13px}
.err{color:#f87171;font-size:13px;margin-top:6px;min-height:16px}
.hidden{display:none!important}
footer{border-top:1px solid var(--border);padding:26px 0;text-align:center;color:var(--dim);font-size:13px}
.crate-modal{position:fixed;inset:0;background:rgba(0,0,0,.8);display:grid;place-items:center;z-index:70;padding:16px}
.crate-box{background:linear-gradient(160deg,#17151b,#0c0c11);border:1px solid var(--accent);border-radius:18px;padding:26px;width:min(520px,95vw);text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.65)}
.reel-mask{position:relative;overflow:hidden;height:110px;border:1px solid var(--border);border-radius:12px;background:#08080c}
.reel{display:flex;gap:8px;padding:10px;transition:transform 5s cubic-bezier(.08,.72,.16,1)}
.reel-item{min-width:130px;height:88px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:var(--elev);border:1px solid var(--border);font-size:13px;font-weight:700;padding:8px;text-align:center}
.reel-item img{width:40px;height:40px;image-rendering:pixelated}
.reel-marker{position:absolute;top:0;left:50%;width:3px;height:100%;background:var(--accent);box-shadow:0 0 14px var(--accent);transform:translateX(-50%)}
.crate-result{margin-top:16px;font-size:22px;font-weight:900;min-height:28px}
.crate-result.win{color:var(--accent);animation:pop .5s ease 3}
@keyframes pop{50%{transform:scale(1.14)}}
</style></head>
<body>
<header><div class="wrap nav">
  <div class="brand">
    <svg class="logo" viewBox="0 0 512 512"><defs><linearGradient id="lc" x1=".15" y1=".05" x2=".85" y2=".95"><stop offset="0" stop-color="#f04444"/><stop offset="1" stop-color="#a81d1d"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="120" fill="#17151b" stroke="var(--accent)" stroke-width="3"/><path fill="url(#lc)" d="M330 106 L150 106 L106 150 L106 362 L150 406 L330 406 L330 332 L180 332 L180 180 L330 180 Z"/></svg>
    <span id="hName">Server</span>
  </div>
  <a class="link" href="#news">News</a>
  <a class="link" href="#store" id="navStore">Store</a>
  <div class="spacer"></div>
  <span id="accBtn"></span>
</div></header>

<section class="hero"><div class="wrap">
  <div class="statuspill"><span id="stDot" class="dot"></span><span id="stText">Checking…</span></div>
  <h1 id="hTitle">Welcome</h1>
  <div class="tag" id="hTag"></div>
  <p class="desc" id="hDesc"></p>
  <div class="row" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
    <a class="btn primary" href="#store">Visit Store</a>
    <a class="btn" id="discordBtn" target="_blank" rel="noopener">Discord</a>
  </div>
</div></section>

<section class="section" id="news"><div class="wrap">
  <h2>News</h2>
  <div id="posts" class="posts"></div>
</div></section>

<section class="section" id="store"><div class="wrap">
  <h2>Store</h2>
  <div id="storeBox"></div>
</div></section>

<footer><div class="wrap">Powered by CaYaDev Server Manager</div></footer>

<div id="authModal" class="modal-bg hidden"><div class="modal">
  <h3 id="amTitle">Log in</h3>
  <div id="loginForm">
    <input id="liName" placeholder="Minecraft username"/>
    <input id="liPass" type="password" placeholder="Password" onkeydown="if(event.key==='Enter')doLogin()"/>
    <button class="btn primary" style="width:100%" onclick="doLogin()">Log in</button>
    <p class="muted" style="margin-top:12px">No account? <a href="#" onclick="showReg(1);return false">Register</a></p>
  </div>
  <div id="regForm" class="hidden">
    <div id="regStep1">
      <p class="muted">Enter your Minecraft username. You must be <b>online on the server</b> — we'll send a code to your in-game chat.</p>
      <input id="rgName" placeholder="Minecraft username"/>
      <button class="btn primary" style="width:100%" onclick="sendCode()">Send code</button>
    </div>
    <div id="regStep2" class="hidden">
      <p class="muted">Check your in-game chat and enter the code, then set a password.</p>
      <input id="rgCode" placeholder="6-digit code" inputmode="numeric"/>
      <input id="rgPass" type="password" placeholder="New password"/>
      <button class="btn primary" style="width:100%" onclick="doVerify()">Verify & create</button>
    </div>
    <p class="muted" style="margin-top:12px"><a href="#" onclick="showLogin();return false">Back to login</a></p>
  </div>
  <div class="err" id="amErr"></div>
  <button class="btn sm" style="margin-top:10px" onclick="closeAuth()">Close</button>
</div></div>

<div id="crate" class="crate-modal hidden" onclick="closeCrate(event)"><div class="crate-box">
  <h3 style="margin-top:0">Opening crate…</h3>
  <div class="reel-mask"><div id="reel" class="reel"></div><div class="reel-marker"></div></div>
  <div id="crateResult" class="crate-result"></div>
  <button class="btn primary" onclick="closeCrate()" style="margin-top:14px">Awesome!</button>
</div></div>

<script>
var ptoken=localStorage.getItem('msms_ptoken')||'',pname=localStorage.getItem('msms_pname')||'',SITE=null,VER='1.21.4';
function esc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
function api(p,body,tok){var o={headers:{'Content-Type':'application/json'}};if(body){o.method='POST';o.body=JSON.stringify(body)}if(tok)o.headers.Authorization='Bearer '+tok;return fetch(p,o).then(function(r){return r.json().then(function(j){return{s:r.status,ok:r.ok,j:j}}).catch(function(){return{s:r.status,ok:r.ok,j:{}}})})}
function loadSite(){api('/api/public/site').then(function(r){if(!r.ok)return;SITE=r.j;if(r.j.version&&/^1\\.\\d+/.test(r.j.status.version))VER=r.j.status.version;
 document.documentElement.style.setProperty('--accent',r.j.accent||'#dc2727');
 document.title=r.j.siteName;document.getElementById('hName').textContent=r.j.siteName;
 document.getElementById('hTitle').textContent=r.j.siteName;document.getElementById('hTag').textContent=r.j.tagline;document.getElementById('hDesc').textContent=r.j.description;
 var db=document.getElementById('discordBtn');if(r.j.discordUrl){db.href=r.j.discordUrl}else{db.style.display='none'}
 renderStatus(r.j.status);renderPosts(r.j.posts);
 document.getElementById('navStore').style.display=r.j.showStore?'':'none';
 document.getElementById('store').style.display=r.j.showStore?'':'none';
 if(r.j.showStore)loadStore();else document.getElementById('storeBox').innerHTML='';
 renderAcc()})}
function renderStatus(st){var on=st.running;document.getElementById('stDot').className='dot'+(on?' on':'');document.getElementById('stText').textContent=on?('Online — '+st.online+' / '+st.max+' players'):'Offline'}
function pollStatus(){api('/api/public/status').then(function(r){if(r.ok)renderStatus(r.j)})}
function renderPosts(posts){var el=document.getElementById('posts');if(!posts||!posts.length){el.innerHTML='<div class="muted">No news yet.</div>';return}
 el.innerHTML=posts.map(function(p){return '<div class="post">'+(p.image?'<img src="/uploads/'+encodeURIComponent(p.image)+'" alt=""/>':'')+'<div class="pc"><h3>'+esc(p.title)+'</h3><div class="meta">'+new Date(p.at).toLocaleDateString()+'</div><div class="body">'+esc(p.body)+'</div></div></div>'}).join('')}
function renderAcc(){var el=document.getElementById('accBtn');if(ptoken){el.innerHTML='<span class="muted" style="margin-right:8px">'+esc(pname)+'</span><button class="btn sm" onclick="plogout()">Logout</button>'}else{el.innerHTML='<button class="btn sm primary" onclick="openAuth()">Log in</button>'}}
function loadStore(){var box=document.getElementById('storeBox');api('/api/public/store').then(function(r){var store=r.j;if(!store||!store.products||!store.products.length){box.innerHTML='<div class="muted">The store has no products yet.</div>';return}
 var bal='';if(ptoken){box.innerHTML='';api('/api/public/store/balance',null,ptoken).then(function(b){var t=b.ok?(b.j.balance+' '+(store.currency||'')):'';document.getElementById('balBadge')&&(document.getElementById('balBadge').textContent='Balance: '+t)})}
 box.innerHTML=(ptoken?'<div class="statuspill" style="margin-bottom:16px"><span id="balBadge">Balance…</span></div>':'<div class="muted" style="margin-bottom:16px">Log in to buy. <button class="btn sm primary" onclick="openAuth()">Log in</button></div>')+
  '<div class="pgrid">'+store.products.map(function(p){return '<div class="pcard">'+(p.icon?'<img src="'+esc(p.icon)+'"/>':'')+'<div class="pn">'+esc(p.name)+(p.type==='crate'?' 🎁':'')+'</div><div class="pd">'+esc(p.description||'')+'</div><div class="row" style="display:flex;align-items:center"><span class="price">'+p.price+' '+esc(store.currency||'')+'</span><div class="spacer"></div><button class="btn primary sm" onclick="buy(\\''+p.id+'\\')">Buy</button></div></div>'}).join('')+'</div>';
 if(ptoken)api('/api/public/store/balance',null,ptoken).then(function(b){var el=document.getElementById('balBadge');if(el)el.textContent='Balance: '+(b.ok?(b.j.balance+' '+(store.currency||'')):'—')})})}
function buy(pid){if(!ptoken){openAuth();return}api('/api/public/store/buy',{productId:pid},ptoken).then(function(r){if(!r.ok){alert(r.j.error==='insufficient'?'Not enough balance':('Error: '+(r.j.error||r.s)));return}loadStore();if(r.j.reward&&r.j.reward.crate)openCrate(r.j.reward);else alert('You received: '+(r.j.reward?r.j.reward.name:''))})}
/* auth */
function openAuth(){document.getElementById('authModal').classList.remove('hidden');showLogin()}
function closeAuth(){document.getElementById('authModal').classList.add('hidden');document.getElementById('amErr').textContent=''}
function showLogin(){document.getElementById('amTitle').textContent='Log in';document.getElementById('loginForm').classList.remove('hidden');document.getElementById('regForm').classList.add('hidden');document.getElementById('amErr').textContent=''}
function showReg(step){document.getElementById('amTitle').textContent='Register';document.getElementById('loginForm').classList.add('hidden');document.getElementById('regForm').classList.remove('hidden');document.getElementById('regStep1').classList.toggle('hidden',step!==1);document.getElementById('regStep2').classList.toggle('hidden',step!==2);document.getElementById('amErr').textContent=''}
function doLogin(){api('/api/public/login',{mcName:document.getElementById('liName').value,password:document.getElementById('liPass').value}).then(function(r){if(!r.ok){document.getElementById('amErr').textContent='Invalid username or password';return}ptoken=r.j.token;pname=r.j.mcName;localStorage.setItem('msms_ptoken',ptoken);localStorage.setItem('msms_pname',pname);closeAuth();renderAcc();loadStore()})}
function sendCode(){document.getElementById('amErr').textContent='';api('/api/public/register/start',{mcName:document.getElementById('rgName').value}).then(function(r){if(!r.ok){var e=r.j.error;document.getElementById('amErr').textContent=e==='not-online'?'You must be online on the server first':e==='server-offline'?'Server is offline — join once it is online':e==='rate-limited'?'Too many requests, wait a bit':e==='invalid-name'?'Invalid Minecraft username':'Error';return}window._rgName=document.getElementById('rgName').value;showReg(2)})}
function doVerify(){document.getElementById('amErr').textContent='';api('/api/public/register/verify',{mcName:window._rgName,code:document.getElementById('rgCode').value,password:document.getElementById('rgPass').value}).then(function(r){if(!r.ok){var e=r.j.error;document.getElementById('amErr').textContent=e==='bad-code'?'Wrong code':e==='expired'?'Code expired — send a new one':e==='weak-password'?'Password too short':'Error';return}ptoken=r.j.token;pname=r.j.mcName;localStorage.setItem('msms_ptoken',ptoken);localStorage.setItem('msms_pname',pname);closeAuth();renderAcc();loadStore()})}
function plogout(){api('/api/public/logout',{},ptoken);ptoken='';pname='';localStorage.removeItem('msms_ptoken');localStorage.removeItem('msms_pname');renderAcc();loadStore()}
/* crate */
function openCrate(reward){var m=document.getElementById('crate');m.classList.remove('hidden');var reel=document.getElementById('reel'),res=document.getElementById('crateResult');res.textContent='';res.className='crate-result';var pool=reward.pool&&reward.pool.length?reward.pool:[{name:reward.name}];var strip=[];for(var i=0;i<50;i++)strip.push(pool[Math.floor(Math.random()*pool.length)]);var win=strip.length-5;strip[win]={name:reward.name,icon:reward.icon};reel.style.transition='none';reel.style.transform='translateX(0)';reel.innerHTML=strip.map(function(it){return '<div class="reel-item">'+(it.icon?'<img src="'+esc(it.icon)+'"/>':'')+esc(it.name)+'</div>'}).join('');var iw=138,mask=document.querySelector('.reel-mask').clientWidth,off=win*iw-(mask/2-65);requestAnimationFrame(function(){reel.style.transition='transform 5s cubic-bezier(.08,.72,.16,1)';reel.style.transform='translateX(-'+off+'px)'});setTimeout(function(){res.textContent='🎉 '+reward.name;res.className='crate-result win'},5100)}
function closeCrate(e){if(e&&e.target&&e.target.id!=='crate'&&e.target.tagName!=='BUTTON')return;document.getElementById('crate').classList.add('hidden')}
loadSite();setInterval(pollStatus,10000);
</script>
</body></html>`
}
