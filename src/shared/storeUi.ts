/**
 * The buyer-facing storefront: cards, sections, detail view, toolbar.
 *
 * Shared between the admin panel's Store tab and the public website the same
 * way `crateUi.ts` is — three exported strings each page pastes in — because
 * two hand-maintained copies of a storefront is how the website ended up
 * ignoring the crate animation setting for two releases.
 *
 * Self-contained: it defines its own escaping (`sEsc`, `sAttr`) and depends on
 * the host page only for `api()` and for the two callbacks it names below.
 * It expects the crate helpers from `crateUi.ts` to be present on the page.
 */

export const STORE_CSS = `
.sf-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
.sf-bar input,.sf-bar select{padding:9px 12px;border-radius:10px;border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));
  background:var(--elev,rgba(255,255,255,.04));color:inherit;font-family:inherit;font-size:13.5px}
.sf-bar .sf-search{flex:1;min-width:150px}
.sf-count{font-size:12px;opacity:.6;margin-left:auto}
.sf-sec{margin-bottom:26px}
.sf-sec-head{display:flex;align-items:center;gap:9px;font-weight:800;font-size:15px;margin:0 0 12px;letter-spacing:-.2px}
.sf-sec-head .sf-n{font-weight:600;opacity:.55;font-size:13px}
/* auto-fill, not a fixed column count: a four-column grid on a wide screen
   stretches the card and leaves the picture inside it looking tiny, which is
   the complaint this replaces. */
.sf-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
.sf-card{display:flex;flex-direction:column;border-radius:14px;overflow:hidden;cursor:pointer;
  border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));background:var(--card,var(--panel,#16151b));
  transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
.sf-card:hover{transform:translateY(-3px);border-color:var(--accent,#dc2727);
  box-shadow:0 16px 34px -20px var(--glow,rgba(220,39,39,.5))}
.sf-card.is-crate{border-color:color-mix(in srgb,var(--accent,#dc2727) 40%,transparent)}
.sf-card.sold-out{opacity:.55}
.sf-card.sold-out:hover{transform:none}
/* A fixed aspect box so a 16x16 Minecraft icon and a 1024px render both fill
   the same space instead of one card being three times the height of another. */
.sf-shot{position:relative;aspect-ratio:16/10;background:var(--elev,rgba(255,255,255,.04));display:grid;place-items:center;overflow:hidden}
.sf-shot img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated;padding:12px}
.sf-shot .sf-none{opacity:.25;font-size:30px}
.sf-badge{position:absolute;top:8px;left:8px;display:inline-flex;align-items:center;gap:5px;
  padding:4px 8px;border-radius:999px;font-size:11px;font-weight:800;
  background:color-mix(in srgb,var(--accent,#dc2727) 88%,#000);color:#fff;box-shadow:0 4px 14px -6px #000}
.sf-badge svg{width:12px;height:12px}
.sf-flag{position:absolute;top:8px;right:8px;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:800;
  background:rgba(0,0,0,.62);color:#fff}
.sf-body{padding:12px 13px 13px;display:flex;flex-direction:column;gap:7px;flex:1}
.sf-name{font-weight:800;font-size:15px;letter-spacing:-.2px}
.sf-desc{font-size:12.5px;opacity:.68;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sf-foot{display:flex;align-items:center;gap:8px}
.sf-price{font-weight:900;font-size:15.5px;color:var(--accent,#dc2727);letter-spacing:-.3px}
.sf-foot .btn{margin-left:auto}
.sf-empty{opacity:.6;font-size:13.5px;padding:14px 0}
/* detail */
.sf-modal{position:fixed;inset:0;background:rgba(0,0,0,.74);display:grid;place-items:center;z-index:75;padding:16px;overflow:auto}
.sf-detail{background:var(--card,var(--panel,#16151b));border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));
  border-radius:16px;width:min(620px,95vw);max-height:90vh;overflow:auto;box-shadow:0 30px 70px rgba(0,0,0,.6)}
.sf-detail .sf-hero{aspect-ratio:16/9;background:var(--elev,rgba(255,255,255,.04));display:grid;place-items:center}
.sf-detail .sf-hero img{width:100%;height:100%;object-fit:contain;padding:16px;image-rendering:pixelated}
.sf-detail .sf-inner{padding:18px 20px 20px}
.sf-detail h3{margin:0 0 6px;font-size:21px;font-weight:850;letter-spacing:-.4px}
.sf-detail .sf-full{font-size:14px;opacity:.8;white-space:pre-wrap;margin:8px 0 0}
.sf-thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.sf-thumbs img{width:66px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer;
  border:1px solid var(--line,var(--border,rgba(255,255,255,.14)))}
.sf-thumbs img.on{border-color:var(--accent,#dc2727)}
.sf-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;font-size:12px;opacity:.75}
.sf-meta span{padding:4px 9px;border-radius:999px;border:1px solid var(--line,var(--border,rgba(255,255,255,.14)))}
.sf-actions{display:flex;align-items:center;gap:10px;margin-top:16px}
@media(max-width:520px){.sf-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}
`

/**
 * An inline crate glyph, replacing the gift emoji the two storefronts used to
 * append to the product name. An emoji renders as a different picture on every
 * platform, cannot be coloured, and carries no accessible name.
 */
export const CRATE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18"/>' +
  '<path d="M12 8v13"/><path d="M12 8S9.5 3 7 3a2.5 2.5 0 0 0 0 5z"/>' +
  '<path d="M12 8s2.5-5 5-5a2.5 2.5 0 0 1 0 5z"/></svg>'

/**
 * The storefront.
 *
 * The host page must provide:
 *  - `sfBuy(id)`           — what the Buy button does
 *  - `sfCurrency()`        — the currency label
 *  - `sfText(key)`         — a translator; may just return the key
 *  - `sfImg(src)`          — map a stored image source to something loadable
 */
export const STORE_JS = `
function sEsc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
function sAttr(t){return sEsc(t).replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
var SF={products:[],layout:'crates-first',text:'',type:'all',sort:'featured',detail:null};

function sfSetFilter(k,v){SF[k]=v;sfRender()}
function sfMatch(p){
 var q=(SF.text||'').trim().toLowerCase();
 if(SF.type!=='all'&&p.type!==SF.type)return false;
 if(!q)return true;
 if((p.name||'').toLowerCase().indexOf(q)>=0)return true;
 if((p.description||'').toLowerCase().indexOf(q)>=0)return true;
 /* A crate is usually searched for by what is inside it. */
 return (p.rewards||[]).some(function(r){return (r.name||'').toLowerCase().indexOf(q)>=0})}
function sfSorted(list){var by=function(a,b){return (a.name||'').localeCompare(b.name||'')};
 var c=list.slice();
 if(SF.sort==='price-asc')return c.sort(function(a,b){return (a.price-b.price)||by(a,b)});
 if(SF.sort==='price-desc')return c.sort(function(a,b){return (b.price-a.price)||by(a,b)});
 if(SF.sort==='name-asc')return c.sort(by);
 if(SF.sort==='name-desc')return c.sort(function(a,b){return by(b,a)});
 /* Unset sorts last, matching filterProducts: three products numbered 1-2-3
    among twenty unnumbered ones means "these three first", and unset-as-zero
    would bury them under all twenty. */
 var ord=function(p){return typeof p.sort==='number'?p.sort:Number.MAX_SAFE_INTEGER};
 return c.sort(function(a,b){return (ord(a)-ord(b))||by(a,b)})}
/* Why this cannot be bought, or '' - the storefront should say "sold out" or
   "you already have the maximum" rather than letting the click fail. */
function sfBlock(p){
 if(typeof p.stock==='number'&&p.stock<=0)return sfText('store.outOfStock');
 if(p.perPlayerLimit&&typeof p.owned==='number'&&p.owned>=p.perPlayerLimit)return sfText('store.limitReached');
 return ''}
function sfShot(p,cls){
 var block=sfBlock(p);
 return '<div class="'+cls+'">'+
  (p.icon?'<img src="'+sAttr(sfImg(p.icon))+'" alt="" loading="lazy"/>':'<div class="sf-none">'+(p.type==='crate'?'&#9634;':'&#9635;')+'</div>')+
  (p.type==='crate'?'<span class="sf-badge" title="'+sAttr(sfText('store.crate'))+'">'+CRATE_ICON_SVG+sEsc(sfText('store.crate'))+'</span>':'')+
  (block?'<span class="sf-flag">'+sEsc(block)+'</span>':'')+
  '</div>'}
function sfCard(p){
 var block=sfBlock(p);
 return '<div class="sf-card'+(p.type==='crate'?' is-crate':'')+(block?' sold-out':'')+'" onclick="sfOpen(\\''+p.id+'\\')">'+
  sfShot(p,'sf-shot')+
  '<div class="sf-body"><div class="sf-name">'+sEsc(p.name)+'</div>'+
  '<div class="sf-desc">'+sEsc(p.description||'')+'</div>'+
  (p.type==='crate'?crateContentsHtml(p.rewards,3):'')+
  '<div class="sf-foot"><span class="sf-price">'+p.price+' '+sEsc(sfCurrency())+'</span>'+
  '<button class="btn primary sm"'+(block?' disabled':'')+' onclick="event.stopPropagation();sfBuy(\\''+p.id+'\\')">'+
  sEsc(block||sfText('store.buy'))+'</button></div></div></div>'}
function sfSectionsFor(list){
 if(SF.layout==='mixed')return [{key:'all',items:list}];
 var crates=list.filter(function(p){return p.type==='crate'});
 var items=list.filter(function(p){return p.type!=='crate'});
 var order=SF.layout==='items-first'
  ?[{key:'item',items:items},{key:'crate',items:crates}]
  :[{key:'crate',items:crates},{key:'item',items:items}];
 /* An empty section is a heading with nothing under it, which reads as a bug. */
 return order.filter(function(s){return s.items.length})}
function sfRender(){
 var box=document.getElementById('sfBox');if(!box)return;
 var all=sfSorted((SF.products||[]).filter(sfMatch));
 var bar='<div class="sf-bar">'+
  '<input class="sf-search" placeholder="'+sAttr(sfText('store.search'))+'" value="'+sAttr(SF.text)+'" oninput="sfSetFilter(\\'text\\',this.value)"/>'+
  '<select onchange="sfSetFilter(\\'type\\',this.value)">'+
   ['all','crate','item'].map(function(v){return '<option value="'+v+'"'+(SF.type===v?' selected':'')+'>'+sEsc(sfText('store.type_'+v))+'</option>'}).join('')+
  '</select>'+
  '<select onchange="sfSetFilter(\\'sort\\',this.value)">'+
   ['featured','price-asc','price-desc','name-asc','name-desc'].map(function(v){return '<option value="'+v+'"'+(SF.sort===v?' selected':'')+'>'+sEsc(sfText('store.sort_'+v))+'</option>'}).join('')+
  '</select>'+
  '<span class="sf-count">'+sEsc(all.length+' / '+(SF.products||[]).length)+'</span></div>';
 if(!(SF.products||[]).length){box.innerHTML=bar+'<div class="sf-empty">'+sEsc(sfText('store.empty'))+'</div>';return}
 if(!all.length){box.innerHTML=bar+'<div class="sf-empty">'+sEsc(sfText('store.noMatch'))+'</div>';return}
 box.innerHTML=bar+sfSectionsFor(all).map(function(sec){
  return '<div class="sf-sec">'+
   (sec.key==='all'?'':'<div class="sf-sec-head">'+(sec.key==='crate'?CRATE_ICON_SVG:'')+sEsc(sfText('store.section_'+sec.key))+'<span class="sf-n">'+sec.items.length+'</span></div>')+
   '<div class="sf-grid">'+sec.items.map(sfCard).join('')+'</div></div>'}).join('');
 /* Re-focus the search box: the toolbar is inside the innerHTML that was just
    replaced, so without this every keystroke would drop the caret. */
 var q=box.querySelector('.sf-search');
 if(q&&SF.text){q.focus();q.setSelectionRange(SF.text.length,SF.text.length)}}
function sfFind(id){var l=SF.products||[];for(var i=0;i<l.length;i++){if(l[i].id===id)return l[i]}return null}
function sfOpen(id){var p=sfFind(id);if(!p)return;SF.detail=p;SF.shot=p.icon||'';sfRenderDetail()}
function sfCloseDetail(e){if(e&&e.target&&e.target.id!=='sfModal')return;SF.detail=null;
 var m=document.getElementById('sfModal');if(m)m.classList.add('hidden')}
function sfShotPick(src){SF.shot=src;sfRenderDetail()}
function sfRenderDetail(){
 var p=SF.detail;var m=document.getElementById('sfModal');if(!p||!m)return;
 var shots=[p.icon].concat(p.images||[]).filter(function(x){return x});
 var hero=SF.shot||shots[0]||'';
 var block=sfBlock(p);
 var meta=[];
 if(typeof p.stock==='number')meta.push(p.stock>0?sfText('store.stockLeft').replace('{n}',p.stock):sfText('store.outOfStock'));
 if(p.perPlayerLimit)meta.push(sfText('store.limitOf').replace('{n}',p.perPlayerLimit)+(typeof p.owned==='number'?' ('+p.owned+')':''));
 if(p.type==='crate'&&p.crateAnimation)meta.push(sfText('store.plays')+' '+p.crateAnimation);
 document.getElementById('sfDetail').innerHTML=
  '<div class="sf-hero">'+(hero?'<img src="'+sAttr(sfImg(hero))+'" alt=""/>':'<div class="sf-none">&#9635;</div>')+'</div>'+
  '<div class="sf-inner"><h3>'+sEsc(p.name)+'</h3>'+
  '<div class="sf-price">'+p.price+' '+sEsc(sfCurrency())+'</div>'+
  (p.description?'<p class="sf-full">'+sEsc(p.description)+'</p>':'')+
  (shots.length>1?'<div class="sf-thumbs">'+shots.map(function(sImg){
    return '<img class="'+(sImg===hero?'on':'')+'" src="'+sAttr(sfImg(sImg))+'" alt="" onclick="sfShotPick(\\''+String(sImg).replace(/'/g,"\\\\'")+'\\')"/>'}).join('')+'</div>':'')+
  (p.type==='crate'?'<div style="margin-top:12px"><div class="sf-sec-head" style="font-size:13px">'+sEsc(sfText('store.contents'))+'</div>'+crateContentsHtml(p.rewards)+'</div>':'')+
  (meta.length?'<div class="sf-meta">'+meta.map(function(x){return '<span>'+sEsc(x)+'</span>'}).join('')+'</div>':'')+
  '<div class="sf-actions"><button class="btn primary"'+(block?' disabled':'')+' onclick="sfBuy(\\''+p.id+'\\')">'+
  sEsc(block||sfText('store.buy'))+'</button>'+
  '<button class="btn" onclick="sfCloseDetail()">'+sEsc(sfText('common.close'))+'</button></div></div>';
 m.classList.remove('hidden')}
`

/** The detail modal both pages need in their markup. */
export const STORE_MODAL_HTML = `
<div id="sfModal" class="sf-modal hidden" onclick="sfCloseDetail(event)">
  <div class="sf-detail" id="sfDetail" onclick="event.stopPropagation()"></div>
</div>`
