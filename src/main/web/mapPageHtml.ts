import { MAP_CSS, MAP_HTML, MAP_JS } from '@shared/mapUi'
import { mapPagePublic } from '@shared/mapPage'
import type { MapPageConfig } from '@shared/mapPage'
import { avatarUrl } from '@shared/profile'
import { iconSvg, STRUCTURE_ICONS } from '@shared/mapIcons'
import type { SiteTheme } from '@shared/web'

/**
 * The map page (#146).
 *
 * The SAME map engine as the panel and the public site — `MAP_CSS`, `MAP_HTML`,
 * `MAP_JS` from `@shared/mapUi`. Writing a fourth map here is the mistake #129
 * was about, and the only thing this page actually needs that the others do not
 * is a shell: the canvas fills the window instead of sitting in a card, and the
 * controls float over it rather than above it.
 *
 * So this file is a chrome, not a map. Everything below the CSS is the host
 * contract `MAP_JS` asks for, plus a passphrase gate.
 */

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  )

export function getMapPageHtml(cfg: MapPageConfig, theme?: SiteTheme): string {
  const pub = mapPagePublic(cfg)
  // The operator already chose colours for their website; a map page in a
  // different red would look like somebody else's site. Falls back to the same
  // defaults the site uses when nothing is configured.
  const t: Partial<SiteTheme> = theme ?? {}
  const hex = (v: unknown, d: string): string =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d
  const accent = hex(t.accent, '#dc2727')
  const bg = hex(t.bg, '#0b0b10')
  const card = hex(t.card, '#16151b')
  const text = hex(t.text, '#e7e9ee')
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<!-- A map is not a search result, and the coordinates on it are the operator's
     to publish, not a crawler's to keep after they stop publishing them. -->
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(pub.title)}</title>
<style>
:root{--accent:${accent};--bg:${bg};--card:${card};--text:${text};
  --dim:color-mix(in srgb,var(--text) 55%,transparent);
  --line:color-mix(in srgb,var(--text) 12%,transparent);
  --elev:color-mix(in srgb,var(--card) 88%,#fff 6%);
  --glow:color-mix(in srgb,var(--accent) 55%,transparent);
  --panel:color-mix(in srgb,var(--card) 82%,transparent)}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:var(--bg);color:var(--text);
  font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
${MAP_CSS}
/* The whole point of this page: the map IS the page. The shared markup lays a
   canvas out in a column with a legend under it, so the wrapper is restyled
   rather than rebuilt — a second copy of the markup would be a fourth map. */
.mp-wrap{position:fixed;inset:0;display:block;gap:0}
.mp-canvas-wrap{position:absolute;inset:0;border:0;border-radius:0;aspect-ratio:auto}
.mp-bar{position:absolute;left:12px;right:12px;top:12px;z-index:3;
  padding:8px 10px;border-radius:12px;backdrop-filter:blur(9px);
  background:var(--panel);border:1px solid var(--line);
  box-shadow:0 10px 30px color-mix(in srgb,var(--bg) 70%,transparent)}
.mp-legend{position:absolute;left:12px;bottom:12px;z-index:3;margin:0;
  padding:6px 10px;border-radius:10px;background:var(--panel);border:1px solid var(--line)}
.mp-list{position:absolute;right:12px;bottom:12px;z-index:3;max-width:44vw;justify-content:flex-end}
/* Bottom-left is a STACK, not three things at the same coordinates. The legend,
   the structure key and the cursor readout were all pinned near the corner and
   drew on top of each other — the coordinates ended up unreadable behind the
   bounds line. Each sits above the one below it, at offsets measured from their
   real heights, because every one of them wraps at some width. */
.mp-iconkey{position:absolute;left:12px;bottom:calc(var(--mp-legend-h, 30px) + 20px);z-index:3;margin:0;
  padding:6px 10px;border-radius:10px;background:var(--panel);border:1px solid var(--line)}
.mp-cursor{bottom:calc(var(--mp-legend-h, 30px) + var(--mp-key-h, 0px) + 20px);left:12px;z-index:3;
  background:var(--panel);border:1px solid var(--line)}
.mp-areatip{z-index:4}
/* The bar floats OVER the canvas on this page only, so the "nothing generated
   here" note at top:10px was hidden underneath it. Measured rather than
   guessed: the bar wraps, and at phone width it is one scrolling row, so any
   fixed offset is wrong at some width. */
.mp-ungen{top:calc(var(--mp-bar-h, 56px) + 20px)}
.mp-title{font-weight:800;font-size:14px;margin-right:4px;white-space:nowrap}
.hidden{display:none!important}
.btn{padding:7px 11px;border-radius:9px;font-family:inherit;font-size:13px;cursor:pointer;
  border:1px solid var(--line);background:var(--elev);color:inherit}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;
  box-shadow:0 6px 18px var(--glow)}
.btn:hover{border-color:var(--accent)}
/* The gate. A page that is not for this visitor should look like a door, not
   like a map that failed to load. */
.gate{position:fixed;inset:0;display:grid;place-content:center;justify-items:center;gap:12px;
  padding:24px;text-align:center;background:var(--bg);z-index:9}
/* The same ambient backdrop the website has, so the door looks like part of
   the same place rather than a blank error page. */
.gate::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;
  background:radial-gradient(50% 40% at 15% 0%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 70%),
  radial-gradient(45% 40% at 90% 10%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 70%)}
.gate input{padding:9px 12px;border-radius:9px;border:1px solid var(--line);
  background:var(--elev);color:inherit;font:inherit;min-width:230px}
.gate .msg{font-size:13px;opacity:.7;max-width:340px}
/* On a phone the bar wraps to three rows and eats the map. Scrolled sideways it
   keeps one row and the map keeps the screen. */
@media (max-width:720px){
  .mp-bar{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;left:8px;right:8px;top:8px}
  .mp-bar>*{flex:none}
  .mp-list{display:none}
  .mp-legend{font-size:11px;left:8px;bottom:8px}
}
</style></head>
<body>
<div id="gate" class="gate hidden">
  <div class="mp-title" style="font-size:18px">${esc(pub.title)}</div>
  <div id="gateMsg" class="msg"></div>
  <div id="gatePass" class="hidden">
    <input id="gateInput" type="password" placeholder="Passphrase" autocomplete="current-password"/>
    <button class="btn primary" onclick="gateSubmit()">Open the map</button>
  </div>
  <!-- This page signs players in itself. It cannot borrow the public site's
       session: that token lives in localStorage, which is per ORIGIN, and a
       different port is a different origin. -->
  <div id="gatePlayer" class="hidden">
    <div><input id="gateName" placeholder="Minecraft name" autocomplete="username"/></div>
    <div style="margin-top:6px"><input id="gatePw" type="password" placeholder="Password" autocomplete="current-password"/></div>
    <div style="margin-top:8px"><button class="btn primary" onclick="gateLogin()">Sign in</button></div>
  </div>
</div>
${MAP_HTML.replace(
  '<div class="mp-bar">',
  '<div class="mp-bar"><span class="mp-title" id="mpTitle"></span>'
)}
<script>
/* Less-than is escaped, not merely quoted. JSON.stringify escapes quotes and
   leaves it alone, so an operator whose page title contained a closing script
   tag would end this block and the rest of the page would be markup. */
var CFG=${JSON.stringify(pub).replace(/</g, '\\u003c')};
/* The host contract MAP_JS asks for. Three of the five differ from the panel's
   only in the URL; the other two are the reason the contract exists at all —
   this page wraps responses differently from either of the others. */
function mapGet(url){
 return fetch(url,{credentials:'same-origin'}).then(function(r){
  if(!r.ok)return null;return r.json()}).catch(function(){return null})}
function mapPost(){return Promise.resolve(null)}
/* '' — there is no operator here. It is what hides the bridge-install offer and
   the structure controls, which belong to whoever can change the answer. */
function mapServerId(){return ''}
function mapFeedUrl(dim,cell){
 return '/api/map?dim='+encodeURIComponent(dim)+'&cell='+encodeURIComponent(cell)}
function mapTilesUrl(dim,c,marks){
 return '/api/map/tiles?dim='+encodeURIComponent(dim)+'&c='+encodeURIComponent(c)+
  (marks?'&marks=1':'')}
function mapAreasUrlFor(dim){return '/api/map/areas?dim='+encodeURIComponent(dim)}
function mapAvatarUrl(name){return ${JSON.stringify(avatarUrl('__NAME__', 32))}.replace('__NAME__',encodeURIComponent(name))}
/* The rest of the host contract MAP_JS expects. Missing here until #153: with
   structures switched on, mapDraw threw "MAP_ICONS is not defined" and took the
   whole draw down with it, so the map stopped updating entirely. The panel and
   the public site have always provided these; this page is the fourth host and
   only got half of them. */
var STRUCTURE_ICONS=${JSON.stringify(STRUCTURE_ICONS)};
var MAP_ICONS=STRUCTURE_ICONS;
function mapIconFor(kind){return STRUCTURE_ICONS[kind]||STRUCTURE_ICONS.other}
var mapIconSvg=${iconSvg.toString()};
${MAP_JS}
/* Settings the operator chose, applied before the first draw so the map never
   flashes a layer it is not allowed to show. */
MAP.headsOn=CFG.heads;MAP.world=CFG.world;MAP.marksOn=CFG.structures;
MAP.areasOn=CFG.areas;MAP.heat=false;
function gateShow(mode,msg){
 document.getElementById('gate').classList.remove('hidden');
 document.getElementById('gateMsg').textContent=msg;
 document.getElementById('gatePass').classList.toggle('hidden',mode!=='password');
 document.getElementById('gatePlayer').classList.toggle('hidden',mode!=='players')}
function gateLogin(){
 fetch('/api/map/login',{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({mcName:document.getElementById('gateName').value.trim(),
   password:document.getElementById('gatePw').value})})
  .then(function(r){return r.ok?r.json():null}).then(function(d){
   if(d&&d.ok){document.getElementById('gate').classList.add('hidden');boot();return}
   document.getElementById('gateMsg').textContent='That name and password did not match.'})
  .catch(function(){document.getElementById('gateMsg').textContent='Could not reach the server.'})}
function gateSubmit(){
 var v=document.getElementById('gateInput').value;
 fetch('/api/map/open',{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:v})})
  .then(function(r){return r.ok?r.json():null}).then(function(d){
   if(d&&d.ok){document.getElementById('gate').classList.add('hidden');boot();return}
   document.getElementById('gateMsg').textContent='That passphrase was not accepted.'})
  .catch(function(){document.getElementById('gateMsg').textContent='Could not reach the server.'})}
/* Ask the server whether this visitor is in, rather than deciding here: the
   feeds check the same thing, so a client that lied to itself would get a
   working page and no data. */
function boot(){
 mapGet('/api/map/state').then(function(s){
  if(!s){gateShow('open','This map is not available right now.');return}
  if(!s.allowed){
   gateShow(s.access,s.access==='password'
    ?'This map is protected. Enter the passphrase to open it.'
    :'Sign in on the website with your Minecraft account to see this map.');
   return}
  document.getElementById('gate').classList.add('hidden');
  var ttl=document.getElementById('mpTitle');
  if(ttl)ttl.textContent=CFG.title;
  /* Pinned: the operator chose the world, so there is nothing to switch to. */
  var ds=document.getElementById('mpDim');
  if(ds&&CFG.fixedDim)ds.style.display='none';
  var hb=document.getElementById('mpHeadsBtn');
  if(hb)hb.style.display=CFG.names?'':'none';
  var cell=document.getElementById('mpCell');
  if(cell)cell.style.display='none';
  syncBarHeight();
  mapStart()})}
/* The bar's real height, republished whenever it can change. The note below it
   reads this; a constant would be wrong the moment the bar wrapped. */
function syncBarHeight(){
 var r=document.documentElement.style;
 var bar=document.querySelector('.mp-bar');
 if(bar)r.setProperty('--mp-bar-h',bar.offsetHeight+'px');
 /* The bottom-left stack. The structure key contributes nothing while it is
    hidden, or the readout would float above a gap. */
 var leg=document.querySelector('.mp-legend');
 if(leg)r.setProperty('--mp-legend-h',leg.offsetHeight+'px');
 var key=document.getElementById('mpIconKey');
 var keyOn=key&&!key.classList.contains('hidden');
 r.setProperty('--mp-key-h',(keyOn?key.offsetHeight+8:0)+'px')}
window.addEventListener('resize',function(){syncBarHeight();mapDraw()});
/* Re-measured after every draw: the structure key is shown and hidden by the
   toggle, and the legend's text changes length as the view moves. */
var mapDrawInner=mapDraw;
mapDraw=function(){mapDrawInner.apply(null,arguments);syncBarHeight()};
document.addEventListener('DOMContentLoaded',boot);
if(document.readyState!=='loading')boot();
</script>
</body></html>`
}
