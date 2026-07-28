/**
 * The crate opening UI, shared by the admin panel and the public website.
 *
 * Both pages are self-contained HTML strings with no build step and no module
 * loader, so "shared" here means three exported strings they each paste in.
 * That is worth doing rather than writing it twice: the two copies had already
 * drifted badly enough to be the bug behind #75 - the panel played whichever of
 * five animations the store was set to, while the website ignored the setting
 * completely and hardcoded a 5300 ms reel.
 *
 * Everything here is namespaced or self-contained. It defines its own escaping
 * rather than calling the host page's, because the panel has `escAttr` and the
 * website does not, and an attribute escaper that silently is not one is how an
 * icon URL becomes script injection.
 */

/**
 * Theme variables differ between the two pages - the panel says `--border`
 * where the site says `--line` - so every colour falls back through both names
 * to a literal. A missing variable must not render an invisible crate.
 */
export const CRATE_CSS = `
/* Above every other overlay in all three hosts. The desktop app's own
   .modal-backdrop is 90, so at 80 the animation played BEHIND the crate editor
   that launched the preview — the dialog dimmed and nothing else appeared.
   Below the desktop toast layer (100) on purpose: an error about the purchase
   has to be readable over the animation announcing it. */
.crate-modal{position:fixed;inset:0;background:rgba(0,0,0,.72);display:grid;place-items:center;z-index:95;padding:16px}
.crate-box{background:linear-gradient(160deg,#17151b,#0c0c11);border:1px solid var(--accent,#dc2727);border-radius:16px;padding:24px;width:min(520px,94vw);text-align:center;box-shadow:0 30px 70px rgba(0,0,0,.65)}
.reel-mask{position:relative;overflow:hidden;height:92px;border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));border-radius:10px;background:#08080c}
.reel{display:flex;gap:8px;padding:8px;transition:transform 4s cubic-bezier(.12,.7,.2,1)}
.reel-item{min-width:120px;height:76px;border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:var(--elev,#1a1a22);border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));font-size:13px;font-weight:650;padding:6px;text-align:center;color:#fff}
.reel-item img{width:28px;height:28px;image-rendering:pixelated;object-fit:contain}
.reel-marker{position:absolute;top:0;left:50%;width:2px;height:100%;background:var(--accent,#dc2727);box-shadow:0 0 12px var(--accent,#dc2727)}
.reel-mask.anim-spin{height:170px}
.reel-mask.anim-spin .reel-marker{top:50%;left:0;width:100%;height:2px}
.reel.reel-v{flex-direction:column;position:absolute;top:0;left:0;right:0}
.reel.reel-v .reel-item{min-width:0;width:auto;height:76px}
.reel-mask.anim-flip{height:100px}
.reel-mask.anim-flip .reel-marker{display:none}
.reel.reel-flip{justify-content:center}
.flip-card{transform:rotateY(180deg);color:transparent;background:linear-gradient(150deg,#241c22,#12121a);transition:transform .45s ease,color .1s ease .3s;backface-visibility:hidden}
.flip-card img{opacity:0;transition:opacity .1s ease .3s}
.flip-card.flipped{transform:rotateY(0deg);color:#fff}
.flip-card.flipped img{opacity:1}
.reel-mask.anim-burst{height:100px}
.reel-mask.anim-burst .reel-marker{display:none}
.reel.reel-burst{justify-content:center;align-items:center;height:100%}
.burst-card{min-width:150px;height:80px;animation:burstIn .18s ease}
.burst-card.burst-win{animation:burstWin .45s cubic-bezier(.2,1.5,.4,1);border-color:var(--accent,#dc2727)}
@keyframes burstIn{from{opacity:.3;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
@keyframes burstWin{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
.reel-mask.anim-instant{height:100px}
.reel-mask.anim-instant .reel-marker{display:none}
.reel-mask.anim-instant .reel{justify-content:center;align-items:center;height:100%}
.crate-result{margin-top:15px;font-size:19px;font-weight:850;min-height:26px;color:#fff}
.crate-result.win{color:var(--accent,#dc2727);animation:cratePulse .5s ease 3}
@keyframes cratePulse{50%{transform:scale(1.12)}}
.crate-preview-note{font-size:12px;opacity:.7;margin-top:6px;color:#fff}
/* contents list (#79): what a crate can give you, before you pay for it */
.crate-pool{display:flex;flex-direction:column;gap:5px;margin-top:9px}
.crate-pool-row{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:5px 8px;border-radius:8px;
  background:var(--elev,rgba(255,255,255,.04));border:1px solid var(--line,var(--border,rgba(255,255,255,.1)))}
.crate-pool-row img{width:22px;height:22px;image-rendering:pixelated;object-fit:contain;flex:none}
.crate-pool-row .cp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.crate-pool-row .cp-odds{font-weight:800;font-variant-numeric:tabular-nums;flex:none;opacity:.85}
.crate-pool-row.cp-rare .cp-odds{color:var(--accent,#dc2727)}
.crate-pool-more{font-size:11.5px;opacity:.65;padding-left:4px}
`

/** The modal both pages need in their markup for `openCrate` to have somewhere to draw. */
export const CRATE_MODAL_HTML = `
<div id="crate" class="crate-modal hidden" onclick="closeCrate(event)">
  <div class="crate-box" onclick="event.stopPropagation()">
    <h3 id="crateTitle" style="margin:0 0 14px;font-size:19px;font-weight:800;color:#fff">Opening…</h3>
    <div class="reel-mask"><div id="reel" class="reel"></div><div class="reel-marker"></div></div>
    <div id="crateResult" class="crate-result"></div>
    <div id="cratePreviewNote" class="crate-preview-note hidden"></div>
    <button class="btn primary" id="crateOk" onclick="closeCrate()" style="margin-top:12px">OK</button>
  </div>
</div>`

/**
 * The animation engine.
 *
 * `openCrate(reward)` reads `reward.animation`, which the server resolves per
 * crate and puts on the purchase result (#75). The client coerces it again
 * anyway: an unknown value must still open the crate, because the player has
 * already been charged and showing them nothing is the one unacceptable
 * outcome.
 */
export const CRATE_JS = `
var CRATE_MS={reel:4000,spin:3200,flip:2800,burst:1600,instant:0};
var CRATE_IDS=['reel','spin','flip','burst','instant'];
var CRATE_LABEL={reel:'Reel',spin:'Slot machine',flip:'Card flip',burst:'Quick burst',instant:'Instant'};
function cEsc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
function cAttr(t){return cEsc(t).replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
/* Every open gets a token. A crate can be closed and another bought while the
   first animation still has pending timers - without this the old run keeps
   writing into the reel and announces the PREVIOUS reward over the new one. */
var crateRun=0;
function crateVariant(v){return CRATE_MS[v]===undefined?'reel':v}
function cratePool(reward){return reward.pool&&reward.pool.length?reward.pool:[{name:reward.name,icon:reward.icon}]}
function crateCell(it,cls){return '<div class="'+cls+'">'+(it.icon?'<img src="'+cAttr(it.icon)+'" alt=""/>':'')+cEsc(it.name)+'</div>'}
function crateFinish(reward,ms,run,note){var res=document.getElementById('crateResult');
 setTimeout(function(){if(run!==crateRun)return;res.textContent=(note||'')+reward.name;res.className='crate-result win'},ms+100)}
function openCrate(reward,opts){opts=opts||{};
 var modal=document.getElementById('crate');modal.classList.remove('hidden');
 var reel=document.getElementById('reel');var mask=modal.querySelector('.reel-mask');
 var res=document.getElementById('crateResult');res.textContent='';res.className='crate-result';
 var pn=document.getElementById('cratePreviewNote');
 if(pn){pn.classList.toggle('hidden',!opts.note);pn.textContent=opts.note||''}
 var run=++crateRun;var v=crateVariant(reward.animation);var ms=CRATE_MS[v];
 mask.className='reel-mask anim-'+v;reel.className='reel';reel.style.cssText='';
 if(v==='instant'){reel.innerHTML=crateCell({name:reward.name,icon:reward.icon},'reel-item');crateFinish(reward,0,run,opts.prefix);return}
 if(v==='burst'){return crateBurst(reward,ms,reel,run,opts.prefix)}
 if(v==='flip'){return crateFlip(reward,ms,reel,run,opts.prefix)}
 if(v==='spin'){return crateSpin(reward,ms,reel,mask,run,opts.prefix)}
 return crateReel(reward,ms,reel,mask,run,opts.prefix)}
function crateReel(reward,ms,reel,mask,run,prefix){var pool=cratePool(reward);var strip=[];
 for(var i=0;i<40;i++){strip.push(pool[Math.floor(Math.random()*pool.length)])}
 var winIdx=strip.length-4;strip[winIdx]={name:reward.name,icon:reward.icon};
 reel.style.transition='none';reel.style.transform='translateX(0)';
 reel.innerHTML=strip.map(function(it){return crateCell(it,'reel-item')}).join('');
 var offset=winIdx*128-(mask.clientWidth/2-60);
 requestAnimationFrame(function(){reel.style.transition='transform '+(ms/1000)+'s cubic-bezier(.12,.7,.2,1)';
  reel.style.transform='translateX(-'+offset+'px)'});
 crateFinish(reward,ms,run,prefix)}
function crateSpin(reward,ms,reel,mask,run,prefix){var pool=cratePool(reward);var strip=[];
 for(var i=0;i<30;i++){strip.push(pool[Math.floor(Math.random()*pool.length)])}
 var winIdx=strip.length-3;strip[winIdx]={name:reward.name,icon:reward.icon};
 reel.className='reel reel-v';reel.style.transition='none';reel.style.transform='translateY(0)';
 reel.innerHTML=strip.map(function(it){return crateCell(it,'reel-item')}).join('');
 var offset=winIdx*84-(mask.clientHeight/2-38);
 requestAnimationFrame(function(){reel.style.transition='transform '+(ms/1000)+'s cubic-bezier(.15,.75,.2,1)';
  reel.style.transform='translateY(-'+offset+'px)'});
 crateFinish(reward,ms,run,prefix)}
function crateFlip(reward,ms,reel,run,prefix){var pool=cratePool(reward);
 var cards=[];for(var i=0;i<4;i++){cards.push(pool[Math.floor(Math.random()*pool.length)])}
 cards[cards.length-1]={name:reward.name,icon:reward.icon};
 reel.className='reel reel-flip';
 reel.innerHTML=cards.map(function(it){return crateCell(it,'reel-item flip-card')}).join('');
 var nodes=reel.children;var step=ms/cards.length;
 for(var j=0;j<nodes.length;j++){(function(n,d){setTimeout(function(){if(run!==crateRun)return;n.classList.add('flipped')},d)})(nodes[j],j*step)}
 crateFinish(reward,ms,run,prefix)}
function crateBurst(reward,ms,reel,run,prefix){var pool=cratePool(reward);
 reel.className='reel reel-burst';
 reel.innerHTML=crateCell(pool[Math.floor(Math.random()*pool.length)],'reel-item burst-card');
 var shuffles=Math.max(1,Math.floor(ms/220));var n=0;
 var iv=setInterval(function(){n++;
  if(run!==crateRun){clearInterval(iv);return}
  if(n>=shuffles){clearInterval(iv);reel.innerHTML=crateCell({name:reward.name,icon:reward.icon},'reel-item burst-card burst-win');return}
  reel.innerHTML=crateCell(pool[Math.floor(Math.random()*pool.length)],'reel-item burst-card')},200);
 crateFinish(reward,ms,run,prefix)}
function closeCrate(e){if(e&&e.target&&e.target.id!=='crate'&&e.target.tagName!=='BUTTON')return;
 /* Bump the token so a half-finished run cannot announce its reward into the
    next crate the player opens. */
 crateRun++;document.getElementById('crate').classList.add('hidden')}
/* Preview: play an animation with placeholder rewards, without buying anything
   (#75). Choosing an animation used to mean saving it, buying something, and
   watching what happened. */
function cratePreview(animation,pool,note){
 var items=(pool&&pool.length?pool:[{name:'Common'},{name:'Rare'},{name:'Epic'},{name:'Legendary'}]);
 var win=items[items.length-1];
 openCrate({name:win.name,icon:win.icon,pool:items,animation:animation},
  {note:note||'Preview — nothing was bought.',prefix:''})}
/* Contents list (#79): what a crate can give you, with odds, before you pay.
   Percentages, not raw weights - a buyer should not have to normalise a weight
   column in their head. */
function crateContentsHtml(rewards,limit){
 if(!rewards||!rewards.length)return '';
 var shown=limit&&rewards.length>limit?rewards.slice(0,limit):rewards;
 var html=shown.map(function(r){
  var pct=(typeof r.chancePct==='number')?r.chancePct:0;
  return '<div class="crate-pool-row'+(pct<10?' cp-rare':'')+'">'+
   (r.icon?'<img src="'+cAttr(r.icon)+'" alt=""/>':'')+
   '<span class="cp-name">'+cEsc(r.name)+'</span>'+
   '<span class="cp-odds">'+(pct<0.1&&pct>0?'<0.1':pct)+'%</span></div>'}).join('');
 if(shown.length<rewards.length)html+='<div class="crate-pool-more">+'+(rewards.length-shown.length)+' more</div>';
 return '<div class="crate-pool">'+html+'</div>'}
/* Options for an animation <select>.
   Compared against the raw value, NOT the coerced one: a crate that inherits
   the store default has no animation of its own, and coercing '' to 'reel'
   here would mark Reel selected alongside the caller's own "use the default"
   option. Two selected options means the browser picks the last, so the picker
   would sit on "Reel" while the crate actually means "inherit" - and would say
   Reel even on a store whose default is Flip. */
function crateAnimationOptions(sel){return CRATE_IDS.map(function(id){
 return '<option value="'+id+'"'+(id===sel?' selected':'')+'>'+CRATE_LABEL[id]+'</option>'}).join('')}
`
