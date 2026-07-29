/**
 * The live world map (#26), shared by the admin panel and any other vanilla
 * page that wants it — the same three-exported-strings arrangement as
 * `crateUi.ts` and `storeUi.ts`.
 *
 * Draws to a canvas rather than to DOM nodes: a busy server is hundreds of
 * markers redrawn every couple of seconds, and hundreds of absolutely
 * positioned divs re-laid-out at that rate is how a panel tab starts dropping
 * frames while doing nothing interesting.
 *
 * The host page provides `api(path)` and `mapServerId()`.
 */

export const MAP_CSS = `
.mp-wrap{display:flex;flex-direction:column;gap:10px}
.mp-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px}
.mp-bar select,.mp-bar button{padding:7px 11px;border-radius:9px;font-family:inherit;font-size:13px;
  border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));background:var(--elev,rgba(255,255,255,.05));color:inherit;cursor:pointer}
.mp-state{display:inline-flex;align-items:center;gap:6px;font-weight:700}
.mp-dot{width:8px;height:8px;border-radius:50%;background:#6b7280;flex:none}
.mp-dot.on{background:#4ade80;box-shadow:0 0 9px #4ade80}
.mp-canvas-wrap{position:relative;border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));
  border-radius:12px;overflow:hidden;background:#0a0a0f;aspect-ratio:16/10}
.mp-canvas-wrap canvas{width:100%;height:100%;display:block}
/* The empty state carries an action since #103: it stacks, and it is clickable.
   Turning pointer events off was right when it was one line of text over a
   canvas and is exactly wrong now — it would swallow every click on the install
   button while leaving it looking enabled. */
.mp-empty{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:9px;
  text-align:center;padding:20px;font-size:13px}
.mp-empty .mp-note{font-size:12.5px;opacity:.65;max-width:380px}
.mp-canvas-wrap canvas{cursor:grab}
.mp-canvas-wrap canvas:active{cursor:grabbing}
.mp-cursor{position:absolute;left:10px;bottom:10px;padding:4px 9px;border-radius:8px;
  font-size:12px;font-variant-numeric:tabular-nums;pointer-events:none;
  background:rgba(0,0,0,.55);color:#fff}
.mp-cursor:empty{display:none}
.mp-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;opacity:.75}
.mp-legend .mp-hint{margin-left:auto;opacity:.6}
.mp-legend b{font-weight:800;opacity:1}
.mp-list{display:flex;flex-wrap:wrap;gap:6px}
.mp-chip{padding:4px 9px;border-radius:999px;font-size:12px;font-weight:700;
  border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));background:var(--elev,rgba(255,255,255,.05))}
.mp-chip span{opacity:.6;font-weight:600;margin-left:5px}
`

/**
 * `#mpCursor` is the coordinate readout, kept outside the canvas so it is text a
 * reader can select and outside `#mpEmpty` so it survives an empty map.
 *
 * No HTML comments in here. The public site embeds this string inside its inline
 * `<script>`, and `<!--` puts an HTML parser into script-data-escaped state —
 * harmless today and a trap for whoever adds a `<script` to it later.
 */
export const MAP_HTML = `
<div class="mp-wrap">
  <div class="mp-bar">
    <span class="mp-state"><span id="mpDot" class="mp-dot"></span><span id="mpState">Bridge not connected</span></span>
    <div class="spacer" style="flex:1"></div>
    <select id="mpDim" onchange="mapRefresh()"></select>
    <select id="mpCell" onchange="mapRefresh()">
      <option value="16">Chunk (16)</option>
      <option value="32">32 blocks</option>
      <option value="64">64 blocks</option>
      <option value="128">128 blocks</option>
    </select>
    <button onclick="mapToggleHeat()" id="mpHeatBtn">Heatmap: on</button>
    <button onclick="mapToggleHeads()" id="mpHeadsBtn">Heads: on</button>
    <button onclick="mapToggleWorld()" id="mpWorldBtn">World: on</button>
    <button onclick="mapResetView()" title="Fit the view to everyone online">Reset view</button>
  </div>
  <div class="mp-canvas-wrap">
    <canvas id="mpCanvas"></canvas>
    <div id="mpEmpty" class="mp-empty"></div>
    <div id="mpCursor" class="mp-cursor"></div>
  </div>
  <div class="mp-legend">
    <span id="mpBounds"></span>
    <span id="mpCount"></span>
    <span class="mp-hint">Drag to pan · wheel to zoom</span>
  </div>
  <div id="mpList" class="mp-list"></div>
</div>`

/**
 * The map engine.
 *
 * The host page must provide:
 *  - `mapGet(url)`        — resolve to the parsed body, or null on any failure
 *  - `mapPost(url)`       — the same, for a body-less POST
 *  - `mapFeedUrl(dim,cell)`
 *  - `mapAvatarUrl(name)`
 *  - `mapServerId()`      — the admin server id, or '' on a public page
 *
 * `mapGet`/`mapPost` exist because this module must not know how either host
 * wraps a response, and it did: it read `r.body`, which is the panel's shape.
 * The public site's `api()` answers `{ok, s, j}`, so every call there evaluated
 * `undefined.dimension` and threw before anything was assigned — the map never
 * drew and the status pill sat on "Bridge not connected" while the bridge was
 * live. The store and crate modules never had this problem because they never
 * fetch for themselves; this was the first shared module that did, and it
 * inherited one page's convention as if it were universal.
 */
export const MAP_JS = `
var MAP={data:null,heat:true,timer:null,dim:'overworld',bridge:null,busy:false,msg:'',
 /* Heads and the world ON by default (#128): they are what make this a map of
    people and terrain rather than dots on a grid, and an operator should not
    have to find two toggles to get the obvious thing. The public feed can still
    refuse heads, and the public world is a separate operator decision. */
 view:null,vp:{width:640,height:400},fitFor:null,drag:null,cursor:null,headsOn:true,world:true};
/* The bridge warning and its install button (#103).
   Deliberately here, in the empty map, and nowhere else: this is where an
   operator finds out positions are missing, so it is the only place the answer
   is useful. A global banner would be shown to people whose servers cannot run
   the plugin at all. */
function mapNoBridgeHtml(){
 var b=MAP.bridge;
 /* A visitor is not an operator. "This server has no MSMS-Bridge plugin" means
    nothing to somebody who came to look at the map, and publishing which plugin
    the admin has not installed is an operator's business told to the internet.
    They get the fact, which is all that is true for them. */
 if(!mapAdminId())return '<div>Live positions are unavailable right now.</div>';
 var head='<div>No live positions — this server has no MSMS-Bridge plugin.</div>';
 if(MAP.msg)return head+'<div class="mp-note">'+mapEsc(MAP.msg)+'</div>';
 if(!b)return head;
 if(b.state==='unsupported')return '<div>This server type cannot run the Bridge plugin.</div>';
 if(b.state!=='missing'||!b.actionable)return head;
 return head+'<div class="mp-note">Positions arrive over the server console, so no extra port is opened.'+
  (b.offline?' GitHub is unreachable; the copy shipped with the app will be used.':'')+'</div>'+
  '<button class="btn primary" onclick="mapInstallBridge()"'+(MAP.busy?' disabled':'')+'>'+
  (MAP.busy?'Installing…':'Install MSMS-Bridge '+mapEsc(b.latest||''))+'</button>'}
function mapAdminId(){
 /* '' on the public site, which has no bridge routes and no operator to offer
    them to. The install affordance is an admin one; a visitor seeing "Install
    MSMS-Bridge" would be offered a button that answers 404. */
 return (typeof mapServerId==='function'&&mapServerId())||''}
function mapBridgeCheck(){
 /* Once per tab open, not on the 2s position poll: the answer changes when
    somebody installs a jar, and the check reaches GitHub. */
 if(!mapAdminId())return;
 mapGet('/api/servers/'+mapAdminId()+'/bridge').then(function(b){
  MAP.bridge=b;mapDraw()})}
function mapInstallBridge(){
 if(MAP.busy||!mapAdminId())return;
 MAP.busy=true;MAP.msg='';mapDraw();
 mapPost('/api/servers/'+mapAdminId()+'/bridge/install').then(function(b){
  MAP.busy=false;
  /* "Installed" is not "working". Bukkit loads plugins at startup, so the jar
     does nothing until a restart — an operator watching a still-empty map
     would otherwise read that as a failed install. */
  MAP.msg=(b&&b.ok)?('Installed '+(b.version||'')+'. Restart the server to load it.')
   :('Install failed: '+((b&&b.error)||'request failed'));
  mapBridgeCheck();mapDraw()})}
function mapEsc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
function mapToggleHeat(){MAP.heat=!MAP.heat;
 document.getElementById('mpHeatBtn').textContent='Heatmap: '+(MAP.heat?'on':'off');mapDraw()}
function mapToggleHeads(){MAP.headsOn=!MAP.headsOn;
 document.getElementById('mpHeadsBtn').textContent='Heads: '+(MAP.headsOn?'on':'off');mapDraw()}
function mapStart(){mapStop();mapRefresh();mapBridgeCheck();MAP.timer=setInterval(mapRefresh,2000)}
function mapStop(){if(MAP.timer){clearInterval(MAP.timer);MAP.timer=null}}
function mapRefresh(){
 var sel=document.getElementById('mpDim');
 var dim=sel&&sel.value?sel.value:MAP.dim;
 var cell=document.getElementById('mpCell').value||'16';
 mapGet(mapFeedUrl(dim,cell)).then(function(d){
  /* null is "the request did not produce a map" — refused, offline, or a body
     that is not one. Keeping the last good frame beats blanking the canvas on
     one dropped poll. */
  if(!d||typeof d.dimension!=='string')return;
  MAP.data=d;MAP.dim=d.dimension;
  var dot=document.getElementById('mpDot'),state=document.getElementById('mpState');
  dot.className='mp-dot'+(d.bridge?' on':'');
  state.textContent=d.bridge?'Bridge live':'Bridge not connected';
  /* The dimension list comes from who is actually online, so it changes as
     people travel. Rebuilt only when it differs, or the select would reset
     mid-choice on every poll. */
  var dims=(d.dimensions||[]);
  if(dims.indexOf(d.dimension)<0)dims=dims.concat([d.dimension]);
  var want=dims.map(function(x){return '<option value="'+mapEsc(x)+'"'+(x===d.dimension?' selected':'')+'>'+mapEsc(x)+'</option>'}).join('');
  if(sel.innerHTML!==want)sel.innerHTML=want;
  /* Said plainly, where the map is. A visitor comparing a dot to their own F3
     screen and finding it 40 blocks out should know the map is rounding, not
     that it is broken. */
  var note=document.getElementById('mapRoundNote');
  if(note)note.textContent=(d.round>0&&typeof T==='function')?T('map.rounded').replace('{n}',d.round):'';
  mapDraw()})}
/* ---- navigation (#104) ----
   The same maths as shared/livemap.ts, which cannot be imported into a page
   pasted together as a string. The smoke cross-checks the two implementations
   against each other so they cannot drift apart silently. */
function mapClampScale(s){return Math.min(8,Math.max(0.02,(isFinite(s)?s:1)))}
function mapW2S(p){var v=MAP.view,vp=MAP.vp;
 return {x:vp.width/2+(p.x-v.cx)*v.scale,y:vp.height/2+(p.z-v.cz)*v.scale}}
function mapS2W(pt){var v=MAP.view,vp=MAP.vp;
 return {x:v.cx+(pt.x-vp.width/2)/v.scale,z:v.cz+(pt.y-vp.height/2)/v.scale}}
function mapFit(b,vp){
 var w=Math.max(1,b.maxX-b.minX),h=Math.max(1,b.maxZ-b.minZ);
 return {cx:(b.minX+b.maxX)/2,cz:(b.minZ+b.maxZ)/2,
  scale:mapClampScale(Math.min(vp.width/w,vp.height/h)*0.9)}}
/* Zoom around the cursor, not the centre. Scaling around the centre drags
   whatever the user was looking at away from the pointer, so zooming towards
   something walks off it and every wheel notch needs a correcting pan. */
function mapZoomAt(anchor,factor){
 var before=mapS2W(anchor);
 MAP.view={cx:MAP.view.cx,cz:MAP.view.cz,scale:mapClampScale(MAP.view.scale*factor)};
 var after=mapS2W(anchor);
 MAP.view.cx+=before.x-after.x;MAP.view.cz+=before.z-after.z;
 MAP.followed=false;mapDraw()}
function mapPanBy(dx,dy){
 MAP.view.cx-=dx/MAP.view.scale;MAP.view.cz-=dy/MAP.view.scale;
 MAP.followed=false;mapDraw()}
function mapResetView(){MAP.followed=false;MAP.view=null;mapDraw()}
function mapLocalPoint(e,cv){var r=cv.getBoundingClientRect();
 return {x:e.clientX-r.left,y:e.clientY-r.top}}
function mapBindNav(){
 var cv=document.getElementById('mpCanvas');if(!cv||cv._mpBound)return;cv._mpBound=true;
 cv.addEventListener('mousedown',function(e){MAP.drag={x:e.clientX,y:e.clientY};e.preventDefault()});
 /* On window, not the canvas: a drag that leaves the canvas and releases
    outside it would otherwise never end, and the map would keep following the
    pointer after the button was let go. */
 window.addEventListener('mouseup',function(){MAP.drag=null});
 window.addEventListener('mousemove',function(e){
  if(MAP.drag){mapPanBy(e.clientX-MAP.drag.x,e.clientY-MAP.drag.y);MAP.drag={x:e.clientX,y:e.clientY};return}
  if(!MAP.view)return;
  var r=cv.getBoundingClientRect();
  var inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
  MAP.cursor=inside?mapS2W(mapLocalPoint(e,cv)):null;mapCursorText()});
 cv.addEventListener('wheel',function(e){
  if(!MAP.view)return;
  e.preventDefault();
  mapZoomAt(mapLocalPoint(e,cv),e.deltaY<0?1.15:1/1.15)},{passive:false});
 cv.addEventListener('mouseleave',function(){MAP.cursor=null;mapCursorText()})}
function mapCursorText(){
 var el=document.getElementById('mpCursor');if(!el)return;
 el.textContent=MAP.cursor?('X '+Math.round(MAP.cursor.x)+'  Z '+Math.round(MAP.cursor.z)):''}
/* Heads are drawn from an avatar service by uuid, and a fetch that fails must
   leave a dot rather than a hole. Cached per uuid so a 2s redraw does not
   re-request every avatar on the server. */
/* ---- the world under the markers (#119) ----
   Tiles are 16x16 columns of packed colour plus a height, drawn into a small
   offscreen canvas per chunk and then blitted. Building an ImageData per frame
   for every visible chunk is the difference between a map that pans and one
   that stutters; a chunk only changes when the server rewrites its region. */
var MAP_TILES={},MAP_TILE_PENDING=false;
function mapTileKey(cx,cz){return cx+','+cz}
function mapVisibleChunks(){
 if(!MAP.view)return [];
 var tl=mapS2W({x:0,y:0}),br=mapS2W({x:MAP.vp.width,y:MAP.vp.height});
 var out=[];
 var x0=Math.floor(tl.x/16),x1=Math.floor(br.x/16);
 var z0=Math.floor(tl.z/16),z1=Math.floor(br.z/16);
 /* Capped: zoomed all the way out a viewport covers tens of thousands of
    chunks, and asking for them would be pointless as well as expensive — at
    that scale a chunk is a fraction of a pixel. */
 if((x1-x0+1)*(z1-z0+1)>4096)return [];
 for(var z=z0;z<=z1;z++)for(var x=x0;x<=x1;x++)out.push({cx:x,cz:z});
 return out}
function mapFetchTiles(){
 if(!MAP.world||MAP_TILE_PENDING||!MAP.view)return;
 var want=mapVisibleChunks().filter(function(c){return MAP_TILES[mapTileKey(c.cx,c.cz)]===undefined});
 if(!want.length)return;
 want=want.slice(0,64);
 MAP_TILE_PENDING=true;
 mapGet(mapTilesUrl(MAP.dim,want.map(function(c){return c.cx+','+c.cz}).join(';'))).then(function(d){
  MAP_TILE_PENDING=false;
  if(!d||!d.tiles)return;
  for(var i=0;i<want.length;i++){
   var k=mapTileKey(want[i].cx,want[i].cz);
   var t=d.tiles[k];
   /* null, not undefined, for a chunk the server has parsed and found empty —
      otherwise it is re-requested forever. A pending one is left unset so the
      next poll asks again. */
   if(t)MAP_TILES[k]=mapBakeTile(t);
   else if(!d.pending)MAP_TILES[k]=null}
  mapDraw()})}
function mapBakeTile(t){
 var cv=document.createElement('canvas');cv.width=16;cv.height=16;
 var g=cv.getContext('2d');var img=g.createImageData(16,16);
 for(var i=0;i<256;i++){
  var c=t.c[i];var o=i*4;
  if(c<0){img.data[o+3]=0;continue}
  /* Shaded by the step to the column to the north, which is what makes a cliff
     visible. Without it the map is a flat colour chart. */
  var north=(i>=16)?t.h[i-16]:t.h[i];
  var f=(t.h[i]>north)?1.12:(t.h[i]<north)?0.86:1;
  img.data[o]=Math.max(0,Math.min(255,Math.round(((c>>16)&255)*f)));
  img.data[o+1]=Math.max(0,Math.min(255,Math.round(((c>>8)&255)*f)));
  img.data[o+2]=Math.max(0,Math.min(255,Math.round((c&255)*f)));
  img.data[o+3]=255}
 g.putImageData(img,0,0);return cv}
function mapDrawTiles(g,w,h){
 if(!MAP.world)return;
 var chunks=mapVisibleChunks();
 if(!chunks.length)return;
 var sx=w/MAP.vp.width,sy=h/MAP.vp.height;
 var size=16*MAP.view.scale;
 /* Nearest-neighbour: this is 16x16 pixel art scaled up, and smoothing it turns
    a blocky world map into a blur. */
 g.imageSmoothingEnabled=false;
 for(var i=0;i<chunks.length;i++){
  var t=MAP_TILES[mapTileKey(chunks[i].cx,chunks[i].cz)];
  if(!t)continue;
  var p=mapW2S({x:chunks[i].cx*16,z:chunks[i].cz*16});
  g.drawImage(t,p.x*sx,p.y*sy,size*sx+1,size*sy+1)}
 g.imageSmoothingEnabled=true}
function mapToggleWorld(){MAP.world=!MAP.world;
 document.getElementById('mpWorldBtn').textContent='World: '+(MAP.world?'on':'off');
 if(MAP.world)mapFetchTiles();mapDraw()}
var MAP_HEADS={};
function mapHead(name){
 /* Keyed by NAME since #116: the uuid MSMS holds is the offline-mode one on a
    cracked server, which no skin service has ever seen. */
 if(!name)return null;
 /* A head is decoration. If this environment has no Image at all, fall back to
    the dot rather than taking the whole draw down with it — the markers, the
    grid and the terrain are the map, and none of them needs an avatar. */
 if(typeof Image!=='function')return null;
 var hit=MAP_HEADS[name];
 if(hit!==undefined)return hit;
 MAP_HEADS[name]=null;
 var img=new Image();
 img.crossOrigin='anonymous';
 img.onload=function(){MAP_HEADS[name]=img;mapDraw()};
 img.onerror=function(){MAP_HEADS[name]=false};
 img.src=mapAvatarUrl(name);
 return null}
function mapDraw(){
 var d=MAP.data;var cv=document.getElementById('mpCanvas');if(!cv||!d)return;
 /* Match the backing store to the CSS size and the device pixel ratio, or the
    whole map is drawn blurry on any HiDPI screen. */
 var rect=cv.getBoundingClientRect();var dpr=window.devicePixelRatio||1;
 var w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
 if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}
 MAP.vp={width:rect.width||w,height:rect.height||h};
 /* The view is client-side and survives the feed: once the operator has moved
    it, a poll two seconds later must not yank it back to wherever the players
    happen to be. It is only fitted when there is no view yet, or when the
    dimension changed under it. */
 if(!MAP.view||MAP.fitFor!==d.dimension){MAP.view=mapFit(d.bounds,MAP.vp);MAP.fitFor=d.dimension}
 mapBindNav();
 /* Hide the controls this feed cannot honour. The public map carries no
    heatmap — a density map of where people are is the thing the coordinate
    rounding exists to blur — and refuses heads unless the operator agreed to
    send uuids to an avatar service. Leaving the buttons visible offers a
    visitor two switches that do nothing. */
 var hb=document.getElementById('mpHeatBtn');
 if(hb)hb.style.display=d.heatmap?'':'none';
 var db=document.getElementById('mpHeadsBtn');
 if(db)db.style.display=(d.heads===false)?'none':'';
 var g=cv.getContext('2d');g.clearRect(0,0,w,h);
 var sx=w/MAP.vp.width,sy=h/MAP.vp.height;
 /* The world first: everything else is drawn on top of it. */
 mapDrawTiles(g,w,h);
 mapFetchTiles();
 var px=function(x){return mapW2S({x:x,z:0}).x*sx};
 var pz=function(z){return mapW2S({x:0,z:z}).y*sy};
 /* A grid that adapts to the zoom: a fixed 64-block step is invisible when
    zoomed out to a whole world and a solid wall when zoomed in. */
 var step=64;while(step*MAP.view.scale<48)step*=4;while(step*MAP.view.scale>220&&step>1)step/=4;
 var tl=mapS2W({x:0,y:0}),br=mapS2W({x:MAP.vp.width,y:MAP.vp.height});
 g.strokeStyle='rgba(255,255,255,.06)';g.lineWidth=1*dpr;
 for(var gx=Math.ceil(tl.x/step)*step;gx<=br.x;gx+=step){g.beginPath();g.moveTo(px(gx),0);g.lineTo(px(gx),h);g.stroke()}
 for(var gz=Math.ceil(tl.z/step)*step;gz<=br.z;gz+=step){g.beginPath();g.moveTo(0,pz(gz));g.lineTo(w,pz(gz));g.stroke()}
 /* Origin, when it is in view - the one landmark every Minecraft player shares. */
 if(tl.x<=0&&br.x>=0&&tl.z<=0&&br.z>=0){
  g.strokeStyle='rgba(220,39,39,.5)';g.lineWidth=1*dpr;
  g.beginPath();g.moveTo(px(0),0);g.lineTo(px(0),h);g.stroke();
  g.beginPath();g.moveTo(0,pz(0));g.lineTo(w,pz(0));g.stroke()}
 if(MAP.heat&&d.heatmap&&d.heatmap.length){
  var max=d.heatmap[0].count||1;var cw=d.cell*MAP.view.scale*sx,ch=d.cell*MAP.view.scale*sy;
  for(var i=0;i<d.heatmap.length;i++){var c=d.heatmap[i];
   g.fillStyle='rgba(220,39,39,'+(0.12+0.55*(c.count/max)).toFixed(3)+')';
   g.fillRect(px(c.x),pz(c.z),Math.max(2*dpr,cw),Math.max(2*dpr,ch))}}
 var ps=d.players||[];
 g.font=(11*dpr)+'px Inter,system-ui,sans-serif';g.textAlign='center';g.textBaseline='bottom';
 for(var j=0;j<ps.length;j++){var p=ps[j];var x=px(p.x),y=pz(p.z);
  /* heads:false from the public feed is the operator saying they did not agree
     to send uuids to an avatar service — and without a uuid there is nothing to
     draw anyway. The toggle cannot override the server's answer. */
  var head=(MAP.headsOn&&d.heads!==false)?mapHead(p.name):null;
  if(head){var hs=18*dpr;
   g.drawImage(head,x-hs/2,y-hs/2,hs,hs);
   g.lineWidth=1.5*dpr;g.strokeStyle='rgba(0,0,0,.55)';g.strokeRect(x-hs/2,y-hs/2,hs,hs)}
  else{
   g.beginPath();g.arc(x,y,4.5*dpr,0,Math.PI*2);
   g.fillStyle='#4ade80';g.fill();
   g.lineWidth=1.5*dpr;g.strokeStyle='rgba(0,0,0,.55)';g.stroke()}
  if(p.name){g.fillStyle='rgba(255,255,255,.92)';g.fillText(p.name,x,y-(head?12:7)*dpr)}}
 /* innerHTML rather than textContent: the empty state now carries an action
    (#103). Everything interpolated into it is generated here or run through
    mapEsc — nothing from the server reaches it unescaped. */
 document.getElementById('mpEmpty').innerHTML=
  ps.length?'':(d.bridge?'Nobody in this dimension right now.':mapNoBridgeHtml());
 document.getElementById('mpBounds').innerHTML='<b>X</b> '+Math.round(tl.x)+' … '+Math.round(br.x)+
  ' &nbsp; <b>Z</b> '+Math.round(tl.z)+' … '+Math.round(br.z);
 document.getElementById('mpCount').innerHTML='<b>'+ps.length+'</b> shown';
 /* Height only when the payload carries one. The public map redacts it —
    knowing a player is 12 blocks down says they are in a cave, which is when
    they cannot defend the base you would then be walking to. */
 document.getElementById('mpList').innerHTML=ps.map(function(p){
  var pos=(typeof p.y==='number')?(p.x+', '+p.y+', '+p.z):(p.x+', '+p.z);
  return '<span class="mp-chip">'+mapEsc(p.name||'?')+'<span>'+pos+'</span></span>'}).join('')}
`
