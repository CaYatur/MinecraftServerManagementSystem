// Public, themeable, multi-page server website.
// Pages: #/ (home) · #/news · #/news/:id · #/store · #/servers
// Everything user-authored is escaped before rendering.
export function getPublicSiteHtml(): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Server</title>
<style>
:root{--accent:#dc2727;--bg:#0b0b10;--card:#16151b;--text:#e7e9ee;--radius:16px;
  --dim:color-mix(in srgb,var(--text) 55%,transparent);
  --line:color-mix(in srgb,var(--text) 12%,transparent);
  --elev:color-mix(in srgb,var(--card) 88%,#fff 6%);
  --maxw:1120px}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 22px}
.hidden{display:none!important}
/* header */
header{position:sticky;top:0;z-index:40;backdrop-filter:blur(14px);background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;gap:8px;height:66px}
.brand{display:flex;align-items:center;gap:11px;font-weight:800;font-size:19px;letter-spacing:-.2px;margin-right:14px}
.brand img{width:34px;height:34px;border-radius:9px;object-fit:cover}
.brand svg{width:34px;height:34px}
.navlinks{display:flex;gap:4px;flex:1}
.navlink{padding:8px 13px;border-radius:10px;font-weight:600;font-size:14.5px;color:var(--dim);transition:.15s}
.navlink:hover{color:var(--text);background:color-mix(in srgb,var(--text) 6%,transparent)}
.navlink.active{color:var(--text);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 18px;border-radius:12px;border:1px solid var(--line);background:var(--elev);color:var(--text);font-weight:650;font-size:14.5px;cursor:pointer;font-family:inherit;transition:.15s}
.btn:hover{border-color:color-mix(in srgb,var(--accent) 50%,transparent);transform:translateY(-1px)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{filter:brightness(1.08)}
.btn.sm{padding:8px 12px;font-size:13px;border-radius:10px}
.btn.ghost{background:transparent}
select.lang{background:var(--elev);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-family:inherit;font-size:13px;cursor:pointer}
/* hero */
.hero{position:relative;padding:86px 0 66px;text-align:center;overflow:hidden}
.hero.image{padding:120px 0 90px}
.hero::before{content:'';position:absolute;inset:0;z-index:0}
.hero.gradient::before{background:radial-gradient(760px 380px at 50% -12%,color-mix(in srgb,var(--accent) 30%,transparent),transparent 62%)}
.hero.image::before{background-size:cover;background-position:center;opacity:.34}
.hero.image::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent,var(--bg));z-index:0}
.hero>*{position:relative;z-index:1}
.hero h1{font-size:clamp(36px,6.2vw,64px);margin:0 0 12px;font-weight:900;letter-spacing:-1.5px;line-height:1.06}
.hero .tag{color:var(--accent);font-weight:800;font-size:clamp(15px,2.1vw,20px);margin-bottom:16px;letter-spacing:.2px}
.hero .desc{color:var(--dim);max-width:640px;margin:0 auto 28px;font-size:16.5px}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:9px;padding:9px 18px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-weight:650;font-size:14px;margin-bottom:24px}
.dot{width:9px;height:9px;border-radius:50%;background:#6b7280;flex:none}
.dot.on{background:#4ade80;box-shadow:0 0 10px #4ade80}
/* sections */
main{min-height:52vh}
.section{padding:56px 0}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:26px}
.section h2{font-size:clamp(22px,3vw,30px);margin:0;font-weight:800;letter-spacing:-.5px}
.muted{color:var(--dim)}
.grid{display:grid;gap:18px}
.grid.c3{grid-template-columns:repeat(auto-fill,minmax(290px,1fr))}
.grid.c4{grid-template-columns:repeat(auto-fill,minmax(215px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;transition:.18s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 42%,transparent);transform:translateY(-3px)}
.card .pad{padding:18px 20px}
.card h3{margin:0 0 8px;font-size:18.5px;font-weight:750;letter-spacing:-.2px}
.thumb{aspect-ratio:16/9;object-fit:cover;width:100%;background:var(--elev)}
.meta{font-size:12.5px;color:var(--dim);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;color:var(--dim);font-size:14.5px}
/* server cards */
.srv{display:flex;align-items:center;gap:14px;padding:18px 20px}
.srv .info{flex:1;min-width:0}
.srv .nm{font-weight:750;font-size:16px}
.chip{padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--text) 8%,transparent);font-size:12px;font-weight:650}
/* store */
.prod{display:flex;flex-direction:column;padding:18px 20px;gap:10px;height:100%}
.prod .ico{width:56px;height:56px;border-radius:12px;image-rendering:pixelated;background:var(--elev);object-fit:contain}
.prod .nm{font-weight:750;font-size:16.5px}
.prod .ds{color:var(--dim);font-size:14px;flex:1}
.price{color:var(--accent);font-weight:850;font-size:16px}
/* article */
.article{max-width:760px;margin:0 auto}
.article h1{font-size:clamp(28px,4.4vw,44px);font-weight:900;letter-spacing:-1px;margin:14px 0 10px;line-height:1.14}
.article .cover{width:100%;border-radius:var(--radius);margin:18px 0;max-height:440px;object-fit:cover}
.article .body{font-size:17px;white-space:pre-wrap;color:color-mix(in srgb,var(--text) 92%,transparent)}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:26px}
.gal img{border-radius:12px;aspect-ratio:1;object-fit:cover;cursor:zoom-in;transition:.15s}
.gal img:hover{transform:scale(1.03)}
/* lightbox */
.lb{position:fixed;inset:0;background:rgba(0,0,0,.9);display:grid;place-items:center;z-index:80;padding:24px;cursor:zoom-out}
.lb img{max-width:94vw;max-height:90vh;border-radius:12px;object-fit:contain}
/* modal */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.74);display:grid;place-items:center;z-index:70;padding:18px}
.modal{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;width:min(430px,95vw)}
.modal h3{margin:0 0 14px;font-size:21px;font-weight:800}
input{width:100%;padding:12px 14px;background:color-mix(in srgb,var(--bg) 70%,var(--card));border:1px solid var(--line);border-radius:11px;color:var(--text);margin:7px 0;font-size:15px;font-family:inherit}
input:focus{outline:none;border-color:var(--accent)}
.err{color:#f87171;font-size:13.5px;margin-top:8px;min-height:18px}
/* crate */
.crate-box{background:var(--card);border:1px solid var(--accent);border-radius:var(--radius);padding:28px;width:min(560px,95vw);text-align:center}
.reel-mask{position:relative;overflow:hidden;height:118px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--bg) 80%,#000)}
.reel{display:flex;gap:10px;padding:11px;transition:transform 5.2s cubic-bezier(.07,.72,.15,1)}
.reel-item{min-width:136px;height:94px;border-radius:11px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:var(--elev);border:1px solid var(--line);font-size:13px;font-weight:700;padding:8px;text-align:center}
.reel-item img{width:42px;height:42px;image-rendering:pixelated}
.reel-marker{position:absolute;top:0;left:50%;width:3px;height:100%;background:var(--accent);box-shadow:0 0 16px var(--accent);transform:translateX(-50%)}
.crate-result{margin-top:18px;font-size:23px;font-weight:900;min-height:30px}
.crate-result.win{color:var(--accent);animation:pop .55s ease 3}
@keyframes pop{50%{transform:scale(1.13)}}
footer{border-top:1px solid var(--line);padding:34px 0;text-align:center;color:var(--dim);font-size:13.5px;margin-top:40px}
/* layout variants */
body.compact .section{padding:34px 0}
body.compact .hero{padding:54px 0 40px}
body.classic .card{border-radius:6px}
body.classic .btn{border-radius:6px}
body.classic .hero{text-align:left}
body.classic .cta{justify-content:flex-start}
body.classic .hero .desc{margin-left:0}
@media(max-width:720px){.nav{height:auto;flex-wrap:wrap;padding:10px 0;gap:6px}.navlinks{order:3;width:100%;overflow-x:auto}.hero{padding:56px 0 42px}}
</style></head>
<body>
<header><div class="wrap nav">
  <a class="brand" href="#/"><span id="brandLogo"></span><span id="brandName">Server</span></a>
  <nav class="navlinks" id="navlinks"></nav>
  <select class="lang" id="langSel" onchange="setLang(this.value)"></select>
  <span id="accBtn"></span>
</div></header>

<main id="app"></main>

<footer><div class="wrap" id="footer"></div></footer>

<div id="authModal" class="modal-bg hidden"><div class="modal">
  <h3 id="amTitle"></h3>
  <div id="loginForm">
    <input id="liName" autocomplete="username"/>
    <input id="liPass" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()"/>
    <button class="btn primary" style="width:100%" onclick="doLogin()" id="liBtn"></button>
    <p class="muted" style="font-size:13.5px;margin-top:14px"><span id="noAcc"></span> <a href="#" style="color:var(--accent)" onclick="showReg(1);return false" id="regLink"></a></p>
  </div>
  <div id="regForm" class="hidden">
    <div id="regStep1">
      <p class="muted" style="font-size:14px" id="regHint"></p>
      <input id="rgName"/>
      <button class="btn primary" style="width:100%" onclick="sendCode()" id="sendBtn"></button>
    </div>
    <div id="regStep2" class="hidden">
      <p class="muted" style="font-size:14px" id="codeHint"></p>
      <input id="rgCode" inputmode="numeric"/>
      <input id="rgPass" type="password"/>
      <button class="btn primary" style="width:100%" onclick="doVerify()" id="verifyBtn"></button>
    </div>
    <p class="muted" style="font-size:13.5px;margin-top:14px"><a href="#" style="color:var(--accent)" onclick="showLogin();return false" id="backLink"></a></p>
  </div>
  <div class="err" id="amErr"></div>
  <button class="btn sm ghost" style="margin-top:8px" onclick="closeAuth()" id="closeBtn"></button>
</div></div>

<div id="crate" class="modal-bg hidden" onclick="closeCrate(event)"><div class="crate-box">
  <h3 style="margin:0 0 16px" id="crateTitle"></h3>
  <div class="reel-mask"><div id="reel" class="reel"></div><div class="reel-marker"></div></div>
  <div id="crateResult" class="crate-result"></div>
  <button class="btn primary" onclick="closeCrate()" style="margin-top:16px" id="crateOk"></button>
</div></div>

<div id="lightbox" class="lb hidden" onclick="this.classList.add('hidden')"><img id="lbImg" alt=""/></div>

<script>
var S=null,LANG='en',ptoken=localStorage.getItem('msms_ptoken')||'',pname=localStorage.getItem('msms_pname')||'',STORE=null;
function esc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
function T(k){var L=(S&&S.i18n&&S.i18n.langs[LANG])||{};var E=(S&&S.i18n&&S.i18n.langs.en)||{};return L[k]||E[k]||k}
function api(p,body,tok){var o={headers:{'Content-Type':'application/json'}};if(body){o.method='POST';o.body=JSON.stringify(body)}if(tok)o.headers.Authorization='Bearer '+tok;
 return fetch(p,o).then(function(r){return r.json().then(function(j){return{s:r.status,ok:r.ok,j:j}}).catch(function(){return{s:r.status,ok:r.ok,j:{}}})})}
function up(n){return '/uploads/'+encodeURIComponent(n)}
function fmtDate(ts){try{return new Date(ts).toLocaleString(LANG==='tr'?'tr-TR':undefined,{dateStyle:'medium',timeStyle:'short'})}catch(e){return new Date(ts).toLocaleString()}}

function applyTheme(){var t=S.theme||{};var r=document.documentElement.style;
 r.setProperty('--accent',t.accent||'#dc2727');r.setProperty('--bg',t.bg||'#0b0b10');
 r.setProperty('--card',t.card||'#16151b');r.setProperty('--text',t.text||'#e7e9ee');
 r.setProperty('--radius',(t.radius==null?16:t.radius)+'px');
 document.body.className=(t.layout||'modern');
 document.getElementById('brandLogo').innerHTML=t.logo
   ? '<img src="'+up(t.logo)+'" alt=""/>'
   : '<svg viewBox="0 0 512 512"><rect x="16" y="16" width="480" height="480" rx="120" fill="var(--card)" stroke="var(--accent)" stroke-width="3"/><path fill="var(--accent)" d="M330 106 L150 106 L106 150 L106 362 L150 406 L330 406 L330 332 L180 332 L180 180 L330 180 Z"/></svg>';
}
function renderChrome(){
 document.getElementById('brandName').textContent=S.siteName;document.title=S.siteName;
 var route=location.hash||'#/';
 var links=[['#/','nav.home'],['#/news','nav.news']];
 if(S.showStore)links.push(['#/store','nav.store']);
 if(S.servers&&S.servers.length)links.push(['#/servers','nav.servers']);
 document.getElementById('navlinks').innerHTML=links.map(function(l){
   var act=(route===l[0]||(l[0]!=='#/'&&route.indexOf(l[0])===0))?' active':'';
   return '<a class="navlink'+act+'" href="'+l[0]+'">'+esc(T(l[1]))+'</a>'}).join('');
 var sel=document.getElementById('langSel');var codes=Object.keys(S.i18n.langs);
 sel.innerHTML=codes.map(function(c){return '<option value="'+c+'"'+(c===LANG?' selected':'')+'>'+c.toUpperCase()+'</option>'}).join('');
 document.getElementById('accBtn').innerHTML=ptoken
  ? '<span class="muted" style="margin-right:10px;font-size:14px">'+esc(pname)+'</span><button class="btn sm" onclick="plogout()">'+esc(T('auth.logout'))+'</button>'
  : '<button class="btn sm primary" onclick="openAuth()">'+esc(T('auth.login'))+'</button>';
 document.getElementById('footer').textContent=T('footer.poweredBy');
}
function statusPill(sv){return '<span class="pill"><span class="dot'+(sv.running?' on':'')+'"></span>'+
  (sv.running?esc(T('status.online'))+' — '+sv.online+' / '+sv.max+' '+esc(T('status.players')):esc(T('status.offline')))+'</span>'}

/* ---------- pages ---------- */
function pageHome(){
 var t=S.theme||{};var heroCls='hero '+(t.heroStyle||'gradient');
 var style=t.heroStyle==='image'&&t.heroImage?' style="--hi:url('+up(t.heroImage)+')"':'';
 var main=S.servers[0];
 var h='<section class="'+heroCls+'"'+style+' id="hero"><div class="wrap">'+
   (main?statusPill(main):'')+
   '<h1>'+esc(S.siteName)+'</h1><div class="tag">'+esc(S.tagline)+'</div>'+
   '<p class="desc">'+esc(S.description)+'</p><div class="cta">'+
   (S.showStore?'<a class="btn primary" href="#/store">'+esc(T('hero.cta'))+'</a>':'')+
   (S.discordUrl?'<a class="btn" target="_blank" rel="noopener" href="'+esc(S.discordUrl)+'">'+esc(T('hero.discord'))+'</a>':'')+
   '</div></div></section>';
 if(S.servers.length){h+='<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('servers.title'))+'</h2></div>'+serverGrid()+'</div></section>'}
 var recent=(S.posts||[]).slice(0,3);
 if(recent.length){h+='<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('hero.news'))+'</h2><a class="btn sm" href="#/news">'+esc(T('nav.news'))+'</a></div><div class="grid c3">'+recent.map(postCard).join('')+'</div></div></section>'}
 return h
}
function serverGrid(){return '<div class="grid c3">'+S.servers.map(function(sv){
 return '<div class="card"><div class="srv"><span class="dot'+(sv.running?' on':'')+'"></span><div class="info"><div class="nm">'+esc(sv.name)+'</div>'+
 '<div class="meta"><span class="chip">'+esc(sv.type)+'</span><span>'+esc(T('servers.version'))+' '+esc(sv.version)+'</span></div></div>'+
 '<div style="text-align:right"><div style="font-weight:800;font-size:18px">'+sv.online+'<span class="muted" style="font-weight:600">/'+sv.max+'</span></div><div class="meta">'+esc(T('status.players'))+'</div></div></div></div>'}).join('')+'</div>'}
function excerptOf(p){return p.excerpt||(p.body||'').slice(0,160)}
function postCard(p){
 return '<a class="card" href="#/news/'+encodeURIComponent(p.id)+'">'+
  (p.cover?'<img class="thumb" src="'+up(p.cover)+'" alt=""/>':'')+
  '<div class="pad"><h3>'+esc(p.title)+'</h3><div class="meta" style="margin-bottom:8px">'+fmtDate(p.at)+
  (p.author?' · '+esc(T('news.by'))+' '+esc(p.author):'')+'</div>'+
  '<div class="clamp">'+esc(excerptOf(p))+'</div>'+
  '<div style="margin-top:12px;color:var(--accent);font-weight:700;font-size:14px">'+esc(T('news.readMore'))+' →</div></div></a>'}
function pageNews(){
 var posts=S.posts||[];
 return '<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('news.title'))+'</h2></div>'+
  (posts.length?'<div class="grid c3">'+posts.map(postCard).join('')+'</div>':'<p class="muted">'+esc(T('news.empty'))+'</p>')+'</div></section>'}
function pagePost(id){
 var p=(S.posts||[]).find(function(x){return x.id===id});
 if(!p)return '<section class="section"><div class="wrap"><p class="muted">'+esc(T('news.empty'))+'</p><a class="btn sm" href="#/news">'+esc(T('news.back'))+'</a></div></section>';
 return '<section class="section"><div class="wrap"><article class="article">'+
  '<a class="btn sm ghost" href="#/news">← '+esc(T('news.back'))+'</a>'+
  '<h1>'+esc(p.title)+'</h1>'+
  '<div class="meta">'+esc(T('news.published'))+' '+fmtDate(p.at)+
   (p.updatedAt?' · '+esc(T('news.updated'))+' '+fmtDate(p.updatedAt):'')+
   (p.author?' · '+esc(T('news.by'))+' <b>'+esc(p.author)+'</b>':'')+'</div>'+
  (p.cover?'<img class="cover" src="'+up(p.cover)+'" alt="" onclick="zoom(this.src)" style="cursor:zoom-in"/>':'')+
  '<div class="body">'+esc(p.body)+'</div>'+
  ((p.images&&p.images.length)?'<h3 style="margin-top:30px">'+esc(T('news.gallery'))+'</h3><div class="gal">'+
     p.images.map(function(im){return '<img src="'+up(im)+'" alt="" onclick="zoom(this.src)"/>'}).join('')+'</div>':'')+
  '</article></div></section>'}
function pageServers(){
 return '<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('servers.title'))+'</h2></div>'+
  (S.servers.length?serverGrid():'<p class="muted">'+esc(T('servers.empty'))+'</p>')+'</div></section>'}
function pageStore(){
 var h='<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('store.title'))+'</h2><span id="balBox"></span></div><div id="storeBox" class="muted">'+esc(T('common.loading'))+'</div></div></section>';
 setTimeout(loadStore,0);return h}
function loadStore(){
 api('/api/public/store').then(function(r){STORE=r.j;var box=document.getElementById('storeBox');if(!box)return;
  if(!STORE.products||!STORE.products.length){box.innerHTML='<p class="muted">'+esc(T('store.empty'))+'</p>';return}
  box.innerHTML='<div class="grid c4">'+STORE.products.map(function(p){
    return '<div class="card"><div class="prod">'+(p.icon?'<img class="ico" src="'+esc(p.icon)+'" alt=""/>':'')+
    '<div class="nm">'+esc(p.name)+(p.type==='crate'?' 🎁':'')+'</div><div class="ds">'+esc(p.description||'')+'</div>'+
    '<div style="display:flex;align-items:center;gap:10px"><span class="price">'+p.price+' '+esc(STORE.currency||'')+'</span>'+
    '<button class="btn primary sm" style="margin-left:auto" onclick="buy(\\''+p.id+'\\')">'+esc(T('store.buy'))+'</button></div></div></div>'}).join('')+'</div>';
  refreshBalance()})}
function refreshBalance(){var el=document.getElementById('balBox');if(!el)return;
 if(!ptoken){el.innerHTML='<button class="btn sm primary" onclick="openAuth()">'+esc(T('store.loginToBuy'))+'</button>';return}
 api('/api/public/store/balance',null,ptoken).then(function(b){if(!b.ok)return;
  el.innerHTML='<span class="pill">'+esc(T('store.balance'))+': <b style="color:var(--accent)">'+b.j.balance+' '+esc(b.j.currency||'')+'</b></span>'})}
function buy(pid){if(!ptoken){openAuth();return}
 api('/api/public/store/buy',{productId:pid},ptoken).then(function(r){
  if(!r.ok){alert(r.j.error==='insufficient'?T('store.insufficient'):('Error: '+(r.j.error||r.s)));return}
  refreshBalance();if(r.j.reward&&r.j.reward.crate)openCrate(r.j.reward);else alert(T('crate.congrats')+': '+(r.j.reward?r.j.reward.name:''))})}
function zoom(src){document.getElementById('lbImg').src=src;document.getElementById('lightbox').classList.remove('hidden')}

/* ---------- router ---------- */
function render(){
 if(!S)return;renderChrome();applyTheme();
 var h=location.hash||'#/';var app=document.getElementById('app');
 if(h.indexOf('#/news/')===0)app.innerHTML=pagePost(decodeURIComponent(h.slice(7)));
 else if(h==='#/news')app.innerHTML=pageNews();
 else if(h==='#/store')app.innerHTML=pageStore();
 else if(h==='#/servers')app.innerHTML=pageServers();
 else app.innerHTML=pageHome();
 var hero=document.getElementById('hero');
 if(hero&&S.theme&&S.theme.heroStyle==='image'&&S.theme.heroImage){
   hero.style.setProperty('background-image','none');
   var st=document.createElement('style');
   st.textContent='.hero.image::before{background-image:url("'+up(S.theme.heroImage)+'")}';
   document.head.appendChild(st)}
 window.scrollTo(0,0)
}
window.addEventListener('hashchange',render);

function setLang(l){LANG=l;localStorage.setItem('msms_lang',l);render()}
function loadSite(){api('/api/public/site').then(function(r){if(!r.ok)return;S=r.j;
 var saved=localStorage.getItem('msms_lang');
 LANG=(saved&&S.i18n.langs[saved])?saved:(S.i18n.defaultLang||'en');
 render()})}
function pollStatus(){api('/api/public/site').then(function(r){if(!r.ok||!S)return;S.servers=r.j.servers;
 if((location.hash||'#/')==='#/'||location.hash==='#/servers')render()})}

/* ---------- auth ---------- */
function openAuth(){document.getElementById('authModal').classList.remove('hidden');showLogin()}
function closeAuth(){document.getElementById('authModal').classList.add('hidden');document.getElementById('amErr').textContent=''}
function fillAuthTexts(){
 document.getElementById('liName').placeholder=T('auth.username');document.getElementById('liPass').placeholder=T('auth.password');
 document.getElementById('liBtn').textContent=T('auth.login');document.getElementById('noAcc').textContent=T('auth.noAccount');
 document.getElementById('regLink').textContent=T('auth.register');document.getElementById('regHint').textContent=T('auth.registerHint');
 document.getElementById('rgName').placeholder=T('auth.username');document.getElementById('sendBtn').textContent=T('auth.sendCode');
 document.getElementById('codeHint').textContent=T('auth.codeHint');document.getElementById('rgCode').placeholder=T('auth.code');
 document.getElementById('rgPass').placeholder=T('auth.newPassword');document.getElementById('verifyBtn').textContent=T('auth.verify');
 document.getElementById('backLink').textContent=T('auth.backToLogin');document.getElementById('closeBtn').textContent=T('common.close');
 document.getElementById('crateTitle').textContent=T('crate.opening');document.getElementById('crateOk').textContent=T('crate.ok')}
function showLogin(){fillAuthTexts();document.getElementById('amTitle').textContent=T('auth.login');document.getElementById('loginForm').classList.remove('hidden');document.getElementById('regForm').classList.add('hidden');document.getElementById('amErr').textContent=''}
function showReg(step){fillAuthTexts();document.getElementById('amTitle').textContent=T('auth.register');document.getElementById('loginForm').classList.add('hidden');document.getElementById('regForm').classList.remove('hidden');
 document.getElementById('regStep1').classList.toggle('hidden',step!==1);document.getElementById('regStep2').classList.toggle('hidden',step!==2);document.getElementById('amErr').textContent=''}
function doLogin(){api('/api/public/login',{mcName:document.getElementById('liName').value,password:document.getElementById('liPass').value}).then(function(r){
 if(!r.ok){document.getElementById('amErr').textContent=T('auth.invalid');return}
 ptoken=r.j.token;pname=r.j.mcName;localStorage.setItem('msms_ptoken',ptoken);localStorage.setItem('msms_pname',pname);closeAuth();render();if((location.hash||'#/')==='#/store')loadStore()})}
function authErr(e){return e==='not-online'?T('auth.notOnline'):e==='server-offline'?T('auth.serverOffline'):e==='rate-limited'?T('auth.rateLimited'):e==='bad-code'?T('auth.badCode'):e==='expired'?T('auth.expired'):e==='weak-password'?T('auth.weakPassword'):'Error'}
function sendCode(){document.getElementById('amErr').textContent='';
 api('/api/public/register/start',{mcName:document.getElementById('rgName').value}).then(function(r){
  if(!r.ok){document.getElementById('amErr').textContent=authErr(r.j.error);return}
  window._rgName=document.getElementById('rgName').value;showReg(2)})}
function doVerify(){document.getElementById('amErr').textContent='';
 api('/api/public/register/verify',{mcName:window._rgName,code:document.getElementById('rgCode').value,password:document.getElementById('rgPass').value}).then(function(r){
  if(!r.ok){document.getElementById('amErr').textContent=authErr(r.j.error);return}
  ptoken=r.j.token;pname=r.j.mcName;localStorage.setItem('msms_ptoken',ptoken);localStorage.setItem('msms_pname',pname);closeAuth();render();if((location.hash||'#/')==='#/store')loadStore()})}
function plogout(){api('/api/public/logout',{},ptoken);ptoken='';pname='';localStorage.removeItem('msms_ptoken');localStorage.removeItem('msms_pname');render();if((location.hash||'#/')==='#/store')loadStore()}

/* ---------- crate ---------- */
function openCrate(reward){var m=document.getElementById('crate');m.classList.remove('hidden');
 var reel=document.getElementById('reel'),res=document.getElementById('crateResult');res.textContent='';res.className='crate-result';
 var pool=(reward.pool&&reward.pool.length)?reward.pool:[{name:reward.name}];var strip=[];
 for(var i=0;i<55;i++)strip.push(pool[Math.floor(Math.random()*pool.length)]);
 var win=strip.length-5;strip[win]={name:reward.name,icon:reward.icon};
 reel.style.transition='none';reel.style.transform='translateX(0)';
 reel.innerHTML=strip.map(function(it){return '<div class="reel-item">'+(it.icon?'<img src="'+esc(it.icon)+'"/>':'')+esc(it.name)+'</div>'}).join('');
 var iw=146,mask=document.querySelector('.reel-mask').clientWidth,off=win*iw-(mask/2-68);
 requestAnimationFrame(function(){reel.style.transition='transform 5.2s cubic-bezier(.07,.72,.15,1)';reel.style.transform='translateX(-'+off+'px)'});
 setTimeout(function(){res.textContent='🎉 '+T('crate.congrats')+': '+reward.name;res.className='crate-result win'},5300)}
function closeCrate(e){if(e&&e.target&&e.target.id!=='crate'&&e.target.tagName!=='BUTTON')return;document.getElementById('crate').classList.add('hidden')}

loadSite();setInterval(pollStatus,15000);
</script>
</body></html>`
}
