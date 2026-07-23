// Public, themeable, multi-page server website.
// Pages: #/ (home) · #/news · #/news/:id · #/store · #/servers
// Everything user-authored is escaped before rendering.
import { pickSiteLang } from './siteLang'

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
  --glow:color-mix(in srgb,var(--accent) 55%,transparent);
  --faint:color-mix(in srgb,var(--accent) 12%,transparent);
  --maxw:1180px}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
/* ambient backdrop: two slow accent glows over a faint grid */
body::before{content:'';position:fixed;inset:-20% -10%;z-index:-2;pointer-events:none;
  background:radial-gradient(50% 40% at 15% 0%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 70%),
             radial-gradient(45% 35% at 85% 12%,color-mix(in srgb,var(--accent) 13%,transparent),transparent 70%);
  animation:drift 26s ease-in-out infinite alternate}
body::after{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.5;
  background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
  background-size:64px 64px;
  -webkit-mask-image:radial-gradient(70% 55% at 50% 0%,#000,transparent 78%);
  mask-image:radial-gradient(70% 55% at 50% 0%,#000,transparent 78%)}
@keyframes drift{to{transform:translate3d(0,32px,0) scale(1.06)}}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 22px}
.hidden{display:none!important}
/* header */
header{position:sticky;top:0;z-index:40;backdrop-filter:blur(16px) saturate(140%);background:color-mix(in srgb,var(--bg) 76%,transparent);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;gap:8px;height:70px}
.brand{display:flex;align-items:center;gap:11px;font-weight:850;font-size:19.5px;letter-spacing:-.3px;margin-right:18px}
.brand img{width:36px;height:36px;border-radius:10px;object-fit:cover;box-shadow:0 0 0 1px var(--line),0 6px 18px -6px var(--glow)}
.brand svg{width:36px;height:36px;filter:drop-shadow(0 4px 14px var(--glow))}
.navlinks{display:flex;gap:2px;flex:1}
.navlink{position:relative;padding:9px 14px;border-radius:10px;font-weight:650;font-size:14.5px;color:var(--dim);transition:.16s}
.navlink:hover{color:var(--text);background:color-mix(in srgb,var(--text) 6%,transparent)}
.navlink.active{color:var(--text)}
.navlink.active::after{content:'';position:absolute;left:14px;right:14px;bottom:2px;height:2px;border-radius:2px;background:var(--accent);box-shadow:0 0 12px var(--glow)}
.btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 20px;border-radius:12px;border:1px solid var(--line);background:var(--elev);color:var(--text);font-weight:700;font-size:14.5px;cursor:pointer;font-family:inherit;transition:.18s;overflow:hidden}
.btn::after{content:'';position:absolute;top:0;bottom:0;left:-60%;width:40%;transform:skewX(-20deg);
  background:linear-gradient(90deg,transparent,color-mix(in srgb,#fff 22%,transparent),transparent);transition:left .55s ease}
.btn:hover::after{left:130%}
.btn:hover{border-color:color-mix(in srgb,var(--accent) 55%,transparent);transform:translateY(-2px);box-shadow:0 10px 26px -14px var(--glow)}
.btn.primary{background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 62%,#000));border-color:transparent;color:#fff;box-shadow:0 8px 24px -12px var(--glow)}
.btn.primary:hover{filter:brightness(1.1);box-shadow:0 14px 34px -12px var(--glow)}
.btn.sm{padding:8px 13px;font-size:13px;border-radius:10px}
.btn.ghost{background:transparent}
.btn.lg{padding:14px 26px;font-size:16px;border-radius:14px}
select.lang{background:var(--elev);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-family:inherit;font-size:13px;cursor:pointer}
/* hero */
.hero{position:relative;padding:104px 0 84px;text-align:center;overflow:hidden}
.hero.image{padding:150px 0 110px}
.hero::before{content:'';position:absolute;inset:0;z-index:0}
.hero.gradient::before{background:radial-gradient(820px 420px at 50% -14%,color-mix(in srgb,var(--accent) 34%,transparent),transparent 64%)}
.hero.image::before{background-size:cover;background-position:center;opacity:.36}
.hero.image::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 20%,var(--bg));z-index:0}
.hero>*{position:relative;z-index:1}
.hero h1{font-size:clamp(40px,7vw,76px);margin:0 0 14px;font-weight:900;letter-spacing:-2px;line-height:1.03;
  background:linear-gradient(180deg,var(--text),color-mix(in srgb,var(--text) 58%,var(--bg)));
  -webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 0 60px color-mix(in srgb,var(--accent) 26%,transparent)}
/* No text-transform here: the tagline is the owner's own words and may be in a
   different language than the page, where locale casing mangles it
   (a Turkish page would uppercase "Join" to "JOİN"). */
.hero .tag{color:var(--accent);font-weight:850;font-size:clamp(15px,2.2vw,22px);margin-bottom:18px;letter-spacing:.3px}
.hero .desc{color:var(--dim);max-width:660px;margin:0 auto 32px;font-size:17px}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:9px;padding:9px 18px;border-radius:999px;background:color-mix(in srgb,var(--card) 80%,transparent);border:1px solid var(--line);font-weight:700;font-size:14px;margin-bottom:22px;backdrop-filter:blur(8px)}
.dot{width:9px;height:9px;border-radius:50%;background:#6b7280;flex:none}
.dot.on{background:#4ade80;box-shadow:0 0 10px #4ade80;animation:beat 2s ease-in-out infinite}
@keyframes beat{50%{box-shadow:0 0 18px 3px #4ade80}}
/* stat strip under the hero */
.stats{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:40px}
.stat{min-width:150px;padding:16px 22px;border-radius:var(--radius);border:1px solid var(--line);
  background:linear-gradient(160deg,color-mix(in srgb,var(--card) 92%,transparent),color-mix(in srgb,var(--bg) 60%,transparent))}
.stat b{display:block;font-size:27px;font-weight:900;letter-spacing:-.6px;line-height:1.2}
.stat span{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);font-weight:700}
/* sections */
main{min-height:52vh}
.section{padding:64px 0}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:28px}
.section h2{position:relative;font-size:clamp(23px,3.1vw,32px);margin:0;font-weight:850;letter-spacing:-.6px;padding-left:15px}
.section h2::before{content:'';position:absolute;left:0;top:.18em;bottom:.18em;width:4px;border-radius:3px;background:var(--accent);box-shadow:0 0 14px var(--glow)}
.muted{color:var(--dim)}
.grid{display:grid;gap:18px}
.grid.c3{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.grid.c4{grid-template-columns:repeat(auto-fill,minmax(225px,1fr))}
.card{position:relative;background:linear-gradient(165deg,color-mix(in srgb,var(--card) 96%,transparent),color-mix(in srgb,var(--bg) 55%,var(--card)));
  border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;transition:transform .2s,border-color .2s,box-shadow .2s}
.card::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .2s;
  background:radial-gradient(420px 160px at 50% 0%,var(--faint),transparent 70%)}
.card:hover{border-color:color-mix(in srgb,var(--accent) 48%,transparent);transform:translateY(-4px);box-shadow:0 20px 44px -26px var(--glow)}
.card:hover::before{opacity:1}
.card .pad{padding:19px 21px}
.card h3{margin:0 0 8px;font-size:19px;font-weight:800;letter-spacing:-.3px}
.thumb{aspect-ratio:16/9;object-fit:cover;width:100%;background:var(--elev);transition:transform .35s ease}
.card:hover .thumb{transform:scale(1.04)}
.thumb-wrap{overflow:hidden;position:relative}
.thumb-wrap::after{content:'';position:absolute;inset:auto 0 0 0;height:55%;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--card) 85%,transparent))}
.meta{font-size:12.5px;color:var(--dim);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;color:var(--dim);font-size:14.5px}
.more{margin-top:13px;color:var(--accent);font-weight:750;font-size:14px;display:inline-flex;gap:6px;transition:gap .2s}
.card:hover .more{gap:12px}
/* server cards */
.srv{display:flex;align-items:center;gap:15px;padding:20px 21px}
.srv .info{flex:1;min-width:0}
.srv .nm{font-weight:800;font-size:16.5px;letter-spacing:-.2px}
.srv .cnt{font-weight:900;font-size:20px;letter-spacing:-.5px}
.bar{height:5px;border-radius:3px;background:color-mix(in srgb,var(--text) 10%,transparent);overflow:hidden;margin:0 21px 18px}
.bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#fff));box-shadow:0 0 12px var(--glow);transition:width .6s ease}
.chip{padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--text) 8%,transparent);font-size:12px;font-weight:700;border:1px solid var(--line)}
/* store */
.prod{display:flex;flex-direction:column;padding:20px;gap:11px;height:100%}
.prod .ico{width:60px;height:60px;border-radius:13px;image-rendering:pixelated;background:var(--elev);object-fit:contain;border:1px solid var(--line)}
.prod .nm{font-weight:800;font-size:16.5px}
.prod .ds{color:var(--dim);font-size:14px;flex:1}
.price{color:var(--accent);font-weight:900;font-size:17px;letter-spacing:-.3px}
.card.crate{border-color:color-mix(in srgb,var(--accent) 38%,transparent)}
.card.crate::after{content:'';position:absolute;inset:-40%;pointer-events:none;
  background:conic-gradient(from 0deg,transparent 0 78%,color-mix(in srgb,var(--accent) 26%,transparent) 88%,transparent 100%);
  animation:spin 5.5s linear infinite;opacity:.6}
.card.crate .prod{position:relative;z-index:1}
@keyframes spin{to{transform:rotate(360deg)}}
/* Reveal on scroll. The hidden state only applies once the script has armed
   it (html.anim), so content is never invisible if JS or IntersectionObserver
   is unavailable - a failsafe timer reveals anything left behind. */
html.anim .reveal{opacity:0;transform:translateY(18px);transition:opacity .5s ease,transform .5s ease}
html.anim .reveal.in{opacity:1;transform:none}
/* failsafe: final state without waiting for a transition to tick */
html.anim .reveal.shown{opacity:1!important;transform:none!important;transition:none!important}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}
  html.anim .reveal{opacity:1;transform:none}}
/* article */
.article{max-width:780px;margin:0 auto}
.article h1{font-size:clamp(29px,4.6vw,48px);font-weight:900;letter-spacing:-1.2px;margin:16px 0 10px;line-height:1.1}
.article .cover{width:100%;border-radius:var(--radius);margin:20px 0;max-height:460px;object-fit:cover;cursor:zoom-in;
  box-shadow:0 30px 60px -34px var(--glow);border:1px solid var(--line)}
.article .body{font-size:17.5px;white-space:pre-wrap;color:color-mix(in srgb,var(--text) 92%,transparent);line-height:1.75}
.article .body::first-letter{font-size:1.05em}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:26px}
.gal img{border-radius:12px;aspect-ratio:1;object-fit:cover;cursor:zoom-in;transition:.15s}
.gal img:hover{transform:scale(1.03)}
/* lightbox */
.lb{position:fixed;inset:0;background:rgba(0,0,0,.9);display:grid;place-items:center;z-index:80;padding:24px;cursor:zoom-out}
.lb img{max-width:94vw;max-height:90vh;border-radius:12px;object-fit:contain}
/* modal */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.74);display:grid;place-items:center;z-index:70;padding:18px}
.modal{background:linear-gradient(165deg,var(--card),color-mix(in srgb,var(--bg) 55%,var(--card)));
  border:1px solid var(--line);border-radius:var(--radius);padding:28px;width:min(430px,95vw);
  box-shadow:0 40px 90px -40px #000,0 0 0 1px color-mix(in srgb,var(--accent) 18%,transparent)}
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
footer{border-top:1px solid var(--line);padding:44px 0 34px;color:var(--dim);font-size:13.5px;margin-top:56px;
  background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--accent) 7%,transparent))}
.foot{display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between}
.foot .fbrand{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--text);font-size:16px}
.foot .flinks{display:flex;gap:14px;flex-wrap:wrap}
.foot a:hover{color:var(--accent)}
/* layout variants */
body.compact .section{padding:38px 0}
body.compact .hero{padding:62px 0 46px}
body.compact .stats{margin-top:26px}
body.classic .card{border-radius:6px}
body.classic .btn{border-radius:6px}
body.classic .hero{text-align:left}
body.classic .cta{justify-content:flex-start}
body.classic .stats{justify-content:flex-start}
body.classic .hero .desc{margin-left:0}
body.classic .hero h1{letter-spacing:-1.2px}
@media(max-width:820px){.stat{flex:1;min-width:130px}}
@media(max-width:720px){.nav{height:auto;flex-wrap:wrap;padding:10px 0;gap:6px}
  .navlinks{order:3;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .hero{padding:64px 0 48px}.hero.image{padding:88px 0 62px}
  .section{padding:44px 0}.stats{gap:10px}.stat{padding:13px 16px;min-width:0}
  .stat b{font-size:22px}.foot{flex-direction:column;text-align:center}}
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
function fmtDate(ts){try{return new Date(ts).toLocaleString(LANG,{dateStyle:'medium',timeStyle:'short'})}catch(e){return new Date(ts).toLocaleString()}}

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
 var links=[['#/','nav.home'],['#/news','nav.news']];
 if(S.showStore)links.push(['#/store','nav.store']);
 if(S.servers&&S.servers.length)links.push(['#/servers','nav.servers']);
 document.getElementById('footer').innerHTML='<div class="foot">'+
  '<span class="fbrand">'+esc(S.siteName)+'</span>'+
  '<span class="flinks">'+links.map(function(l){return '<a href="'+l[0]+'">'+esc(T(l[1]))+'</a>'}).join('')+
   (S.discordUrl?'<a target="_blank" rel="noopener" href="'+esc(S.discordUrl)+'">Discord</a>':'')+'</span>'+
  '<span>'+esc(T('footer.poweredBy'))+'</span></div>';
}
/* Fade sections in as they scroll into view. Decoration only: everything is
   force-revealed shortly after, so a background tab or a browser without
   IntersectionObserver still shows the content. */
function showAll(){var e=document.querySelectorAll('.reveal:not(.shown)');
 for(var i=0;i<e.length;i++){e[i].classList.add('in');e[i].classList.add('shown')}}
function revealAll(){
 if(!('IntersectionObserver' in window)){showAll();return}
 document.documentElement.classList.add('anim');
 var els=document.querySelectorAll('.reveal:not(.in)');
 var io=new IntersectionObserver(function(entries){
  entries.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}})},
  {rootMargin:'0px 0px -40px 0px'});
 for(var j=0;j<els.length;j++)io.observe(els[j]);
 clearTimeout(window.__revealFail);
 window.__revealFail=setTimeout(showAll,700);
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
   (S.showStore?'<a class="btn primary lg" href="#/store">'+esc(T('hero.cta'))+'</a>':'')+
   (S.discordUrl?'<a class="btn lg" target="_blank" rel="noopener" href="'+esc(S.discordUrl)+'">'+esc(T('hero.discord'))+'</a>':'')+
   '</div>'+statStrip()+'</div></section>';
 if(S.servers.length){h+='<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('servers.title'))+'</h2>'+
   ((S.servers.length>3)?'<a class="btn sm" href="#/servers">'+esc(T('nav.servers'))+'</a>':'')+'</div>'+serverGrid(S.servers.slice(0,6))+'</div></section>'}
 var recent=(S.posts||[]).slice(0,3);
 if(recent.length){h+='<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('hero.news'))+'</h2><a class="btn sm" href="#/news">'+esc(T('nav.news'))+'</a></div><div class="grid c3">'+recent.map(postCard).join('')+'</div></div></section>'}
 return h
}
/* Live totals across every published server. */
function statStrip(){
 var svs=S.servers||[];if(!svs.length)return '';
 var online=0,max=0,up=0;
 svs.forEach(function(s){online+=s.online||0;max+=s.max||0;if(s.running)up++});
 var cells=[[online,T('status.players')],[up+' / '+svs.length,T('stats.serversUp')]];
 if(max)cells.push([Math.round((online/Math.max(1,max))*100)+'%',T('stats.capacity')]);
 return '<div class="stats">'+cells.map(function(c){
  return '<div class="stat"><b>'+esc(String(c[0]))+'</b><span>'+esc(c[1])+'</span></div>'}).join('')+'</div>'}
function serverGrid(list){return '<div class="grid c3">'+(list||S.servers).map(function(sv){
 var pct=sv.max?Math.min(100,Math.round((sv.online/sv.max)*100)):0;
 return '<div class="card reveal"><div class="srv"><span class="dot'+(sv.running?' on':'')+'"></span><div class="info"><div class="nm">'+esc(sv.name)+'</div>'+
 '<div class="meta"><span class="chip">'+esc(sv.type)+'</span><span>'+esc(T('servers.version'))+' '+esc(sv.version)+'</span>'+
 '<span class="chip">'+(sv.running?esc(T('status.online')):esc(T('status.offline')))+'</span></div></div>'+
 '<div style="text-align:right"><div class="cnt">'+sv.online+'<span class="muted" style="font-weight:600;font-size:15px">/'+sv.max+'</span></div><div class="meta">'+esc(T('status.players'))+'</div></div></div>'+
 '<div class="bar"><i style="width:'+pct+'%"></i></div></div>'}).join('')+'</div>'}
function excerptOf(p){return p.excerpt||(p.body||'').slice(0,160)}
function postCard(p){
 return '<a class="card reveal" href="#/news/'+encodeURIComponent(p.id)+'">'+
  (p.cover?'<div class="thumb-wrap"><img class="thumb" src="'+up(p.cover)+'" alt=""/></div>':'')+
  '<div class="pad"><h3>'+esc(p.title)+'</h3><div class="meta" style="margin-bottom:8px">'+fmtDate(p.at)+
  (p.author?' · '+esc(T('news.by'))+' '+esc(p.author):'')+'</div>'+
  '<div class="clamp">'+esc(excerptOf(p))+'</div>'+
  '<div class="more">'+esc(T('news.readMore'))+' <span>→</span></div></div></a>'}
function pageNews(){
 var posts=S.posts||[];
 return '<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('news.title'))+'</h2>'+
  '<span class="muted">'+posts.length+'</span></div>'+
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
    return '<div class="card reveal'+(p.type==='crate'?' crate':'')+'"><div class="prod">'+(p.icon?'<img class="ico" src="'+esc(p.icon)+'" alt=""/>':'')+
    '<div class="nm">'+esc(p.name)+(p.type==='crate'?' 🎁':'')+'</div><div class="ds">'+esc(p.description||'')+'</div>'+
    '<div style="display:flex;align-items:center;gap:10px"><span class="price">'+p.price+' '+esc(STORE.currency||'')+'</span>'+
    '<button class="btn primary sm" style="margin-left:auto" onclick="buy(\\''+p.id+'\\')">'+esc(T('store.buy'))+'</button></div></div></div>'}).join('')+'</div>';
  revealAll();refreshBalance()})}
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
 window.scrollTo(0,0);revealAll()
}
window.addEventListener('hashchange',render);

function setLang(l){LANG=l;localStorage.setItem('msms_lang',l);document.documentElement.lang=l;render()}
/* Shared with the main process so the smoke suite can unit-test the same code. */
var pickSiteLang=${pickSiteLang.toString()};
/* Explicit visitor choice -> browser language ('pt-br' then 'pt') -> English. */
function pickLang(){
 var nav=(navigator.languages&&navigator.languages.length)?Array.prototype.slice.call(navigator.languages):[navigator.language||'en'];
 return pickSiteLang(Object.keys(S.i18n.langs),localStorage.getItem('msms_lang'),nav,S.i18n.defaultLang);
}
function loadSite(){api('/api/public/site').then(function(r){if(!r.ok)return;S=r.j;LANG=pickLang();document.documentElement.lang=LANG;render()})}
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
