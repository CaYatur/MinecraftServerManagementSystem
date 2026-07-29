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
/* The overlay covers the whole canvas, so it must be transparent to the mouse
   and only its CHILDREN clickable. Making the whole thing clickable — which is
   what #103 did so the install button would work — handed every mousedown,
   mousemove and wheel on the map to an invisible box: no panning, no zooming,
   and a wheel that fell through and scrolled the page (#135). */
.mp-empty{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:9px;
  text-align:center;padding:20px;font-size:13px;pointer-events:none}
.mp-empty>*{pointer-events:auto}
.mp-empty .mp-note{font-size:12.5px;opacity:.65;max-width:380px}
.mp-canvas-wrap canvas{cursor:grab}
.mp-canvas-wrap canvas:active{cursor:grabbing}
.mp-cursor{position:absolute;left:10px;bottom:10px;padding:4px 9px;border-radius:8px;
  font-size:12px;font-variant-numeric:tabular-nums;pointer-events:none;
  background:rgba(0,0,0,.55);color:#fff}
.mp-cursor:empty{display:none}
/* Said in words as well as drawn, so "nobody has been here" is not left to a
   faint hatch nobody reads as deliberate (#136). */
.mp-ungen{position:absolute;right:10px;top:10px;max-width:230px;padding:7px 11px;border-radius:10px;
  font-size:12px;line-height:1.35;pointer-events:none;
  border:1px dashed color-mix(in srgb,var(--accent,#dc2727) 45%,transparent);
  background:color-mix(in srgb,var(--accent,#dc2727) 10%,rgba(0,0,0,.55));color:#fff}
.mp-ungen.hidden{display:none}
.mp-iconkey{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;opacity:.8;margin-top:2px}
.mp-iconkey.hidden{display:none}
.mp-ik{display:inline-flex;align-items:center;gap:5px}
.mp-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;opacity:.75}
.mp-legend .mp-hint{margin-left:auto;opacity:.6}
.mp-legend b{font-weight:800;opacity:1}
.mp-list{display:flex;flex-wrap:wrap;gap:6px}
.mp-chip{padding:4px 9px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;
  color:inherit;font-family:inherit;
  border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));background:var(--elev,rgba(255,255,255,.05))}
.mp-chip:hover{border-color:var(--accent,#dc2727)}
.mp-chip span{opacity:.6;font-weight:600;margin-left:5px}
/* The area tooltip. Bottom-right, opposite the ungenerated note and clear of the
   coordinate readout, so a claimed chunk at the edge of the world can still show
   both. Clickable, because on a phone the pin is the only way to read it. */
.mp-areatip{position:absolute;right:10px;bottom:10px;max-width:250px;padding:8px 11px;border-radius:10px;
  font-size:12.5px;line-height:1.4;background:rgba(0,0,0,.78);color:#fff;
  border:1px solid rgba(255,255,255,.16)}
.mp-areatip.hidden{display:none}
.mp-areatip b{display:block;font-size:13px;margin-bottom:2px}
.mp-areatip div{opacity:.85}
.mp-areatip .mp-x{margin-top:6px;padding:3px 8px;border-radius:7px;font-size:11px;cursor:pointer;
  font-family:inherit;color:inherit;border:1px solid rgba(255,255,255,.2);background:transparent}
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
    <button onclick="mapToggleHeat()" id="mpHeatBtn">Heatmap: off</button>
    <button onclick="mapToggleHeads()" id="mpHeadsBtn">Heads: on</button>
    <button onclick="mapToggleWorld()" id="mpWorldBtn">World: on</button>
    <button onclick="mapLoadHere()" id="mpLoadBtn" class="hidden" title="Read the area now">Load this view</button>
    <button onclick="mapToggleMarks()" id="mpMarksBtn">Structures: off</button>
    <button onclick="mapToggleAreas()" id="mpAreasBtn">Areas: on</button>
    <select id="mpMarkFilter" onchange="mapSetMarkFilter(this.value)" title="Which structures to show">
      <option value="">All structures</option>
      <option value="village">Villages</option>
      <option value="dungeon">Dungeons &amp; ruins</option>
      <option value="temple">Temples</option>
      <option value="fortress">Fortresses</option>
      <option value="mine">Mineshafts</option>
    </select>
    <button onclick="mapResetView()" title="Fit the view to everyone online">Reset view</button>
  </div>
  <div class="mp-canvas-wrap">
    <canvas id="mpCanvas"></canvas>
    <div id="mpEmpty" class="mp-empty"></div>
    <div id="mpUngen" class="mp-ungen hidden"></div>
    <div id="mpCursor" class="mp-cursor"></div>
    <div id="mpAreaTip" class="mp-areatip hidden"></div>
  </div>
  <div id="mpIconKey" class="mp-iconkey hidden"></div>
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
/* The heatmap is an analysis overlay, not what a map is for — a red block over
   the one player online was the first thing anyone saw. Off by default (#131). */
var MAP={data:null,heat:false,timer:null,dim:'overworld',bridge:null,busy:false,msg:'',
 /* Heads and the world ON by default (#128): they are what make this a map of
    people and terrain rather than dots on a grid, and an operator should not
    have to find two toggles to get the obvious thing. The public feed can still
    refuse heads, and the public world is a separate operator decision. */
 view:null,vp:{width:640,height:400},fitFor:null,drag:null,cursor:null,headsOn:true,world:true,
 /* Structures off, and a per-kind filter. Read-ahead follows the host: the
    panel offers it as a control, the public map takes the operator's setting. */
 marksOn:false,markFilter:null,loadAhead:false,
 /* Areas ON, unlike structures. A structure marker is information the operator
    may not want published; an area is a label they wrote on purpose for people
    to read, so hiding it by default would defeat the point of writing it. */
 areasOn:true,
 /* Explicit rather than left undefined: the fetch guard reads it, and relying
    on undefined not being false for the default is a coincidence, not a
    decision. */
 loadOnPan:true};
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
/* Areas are fetched once on open and again when the dimension changes, not on
   the 2s position poll: they change when an operator edits one, which is orders
   of magnitude rarer than a player taking a step. */
function mapStart(){mapStop();mapRefresh();mapBridgeCheck();mapFetchAreas();MAP.timer=setInterval(mapRefresh,2000)}
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
  /* Tiles are keyed by chunk alone, and the nether uses the same coordinates as
     the overworld — so switching dimension without dropping them draws one
     world's terrain under another world's players. */
  var dimChanged=MAP.dim!==d.dimension;
  if(dimChanged){MAP_TILES={};MAP_MARKS={}}
  MAP.data=d;MAP.dim=d.dimension;
  /* The public feed is asked for one dimension at a time, so a switch needs a
     new request; a pinned area from the last world would otherwise stay drawn.
     The pin goes too — it belongs to a place the viewer has left. */
  if(dimChanged){MAP_AREA_PIN=null;mapAreaTip();mapFetchAreas()}
  /* The server's own budget, when the feed carries one. A public visitor has no
     control over it and should not be able to spend more than the operator
     allowed. */
  if(typeof d.loadOnPan==='boolean')MAP.loadOnPan=d.loadOnPan;
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
  MAP.cursor=inside?mapS2W(mapLocalPoint(e,cv)):null;mapCursorText();mapAreaTip()});
 /* A click, not a drag: a pan that happens to end inside an area must not pin
    it. Distance rather than a flag, because a click always carries a mousedown
    and the two are only told apart by how far the pointer moved. */
 cv.addEventListener('mousedown',function(e){MAP._down={x:e.clientX,y:e.clientY}});
 cv.addEventListener('click',function(e){
  if(!MAP.view)return;
  var d0=MAP._down;
  if(d0&&(Math.abs(e.clientX-d0.x)>4||Math.abs(e.clientY-d0.y)>4))return;
  var pt=mapS2W(mapLocalPoint(e,cv));
  var c=mapChunkOf(pt.x,pt.z);
  /* Picking, when the host has an editor open, takes the click: adding a chunk
     and pinning the area under it at the same time would fight each other. */
  if(typeof mapAreaPicking==='function'&&mapAreaPicking()){
   if(typeof mapAreaPickChunk==='function')mapAreaPickChunk(c.cx,c.cz);
   return}
  if(!MAP.areasOn)return;
  mapPinArea(mapAreaAt(MAP_AREAS,c.cx,c.cz,MAP.dim))});
 cv.addEventListener('wheel',function(e){
  if(!MAP.view)return;
  e.preventDefault();
  mapZoomAt(mapLocalPoint(e,cv),e.deltaY<0?1.15:1/1.15)},{passive:false});
 cv.addEventListener('mouseleave',function(){MAP.cursor=null;mapCursorText();mapAreaTip()})}
function mapCursorText(){
 var el=document.getElementById('mpCursor');if(!el)return;
 el.textContent=MAP.cursor?('X '+Math.round(MAP.cursor.x)+'  Z '+Math.round(MAP.cursor.z)):''}
/* ---- named chunk areas (#144) ----
   The same rules as shared/chunkAreas.ts, which cannot be imported into a page
   pasted together as a string — the convention this file already follows for the
   navigation maths above. The smoke runs both over the same battery of chunks
   and fails if they ever disagree, which is what keeps the copy honest. */
var MAP_AREAS=[],MAP_AREA_PIN=null;
/* Negative-safe: (-1/16|0) is 0, which puts the chunk west of spawn one chunk
   east of it — and an area boundary at x=0 would be off by one the whole way
   down the axis. */
function mapChunkOf(x,z){return {cx:Math.floor(x/16),cz:Math.floor(z/16)}}
function mapNormDim(d){
 var raw=(typeof d==='string')?d.trim():'';var s=raw.toLowerCase();
 if(!s)return 'overworld';
 if(s==='normal'||s==='overworld'||s==='minecraft:overworld')return 'overworld';
 if(s==='nether'||s==='the_nether'||s==='minecraft:the_nether')return 'nether';
 if(s==='the_end'||s==='end'||s==='minecraft:the_end')return 'end';
 /* A custom world keeps its case: the name becomes a folder name when regions
    are read, and lower-casing finds myworld/ for a folder called MyWorld. */
 return raw.replace(/^minecraft:/i,'')}
function mapAreaSize(a){var n=0,rs=a.rects||[];
 for(var i=0;i<rs.length;i++)n+=(rs[i].x2-rs[i].x1+1)*(rs[i].z2-rs[i].z1+1);
 return n}
function mapAreaHas(a,cx,cz){var rs=a.rects||[];
 for(var i=0;i<rs.length;i++){var r=rs[i];
  if(cx>=r.x1&&cx<=r.x2&&cz>=r.z1&&cz<=r.z2)return true}
 return false}
/* SMALLEST WINS, ties on the later edit then the id — the same total order as
   areaAt(), so a chunk reads the same here as it does in the app. */
function mapAreaAt(areas,cx,cz,dim){
 var want=mapNormDim(dim),best=null,bestSize=Infinity;
 for(var i=0;i<(areas||[]).length;i++){var a=areas[i];
  if(mapNormDim(a.dim)!==want)continue;
  if(!mapAreaHas(a,cx,cz))continue;
  var size=mapAreaSize(a);
  if(size<bestSize||(size===bestSize&&best&&(a.updatedAt>best.updatedAt||
   (a.updatedAt===best.updatedAt&&a.id>best.id)))){best=a;bestSize=size}}
 return best}
function mapAreasUrl(){
 /* A host may answer for itself. The map page (#146) is served from its own
    listener and has neither an admin id nor the public site's routes, so
    guessing from mapAdminId() would send it to a 404 on both branches. */
 if(typeof mapAreasUrlFor==='function')return mapAreasUrlFor(MAP.dim);
 var sid=mapAdminId();
 return sid?('/api/servers/'+sid+'/areas'):'/api/public/map/areas?dim='+encodeURIComponent(MAP.dim)}
function mapFetchAreas(){
 mapGet(mapAreasUrl()).then(function(d){
  MAP_AREAS=(d&&d.areas)||[];
  /* Optional host hook, like mapServerId: the panel keeps an editable list
     beside the map and has to redraw it when the areas change. The public site
     defines nothing and gets nothing. */
  if(typeof mapAreasChanged==='function')mapAreasChanged();
  mapDraw()})}
/* The selection in progress, when the host is offering one. Drawn in white
   rather than a palette colour so it cannot be mistaken for a saved area. */
function mapDrawPick(g,w,h,dpr){
 if(typeof mapAreaPickRects!=='function')return;
 var rs=mapAreaPickRects()||[];if(!rs.length)return;
 var sx=w/MAP.vp.width,sy=h/MAP.vp.height;
 for(var i=0;i<rs.length;i++){var r=rs[i];
  var p0=mapW2S({x:r.x1*16,z:r.z1*16}),p1=mapW2S({x:(r.x2+1)*16,z:(r.z2+1)*16});
  var x=p0.x*sx,y=p0.y*sy,ww=(p1.x-p0.x)*sx,hh=(p1.y-p0.y)*sy;
  g.fillStyle='rgba(255,255,255,.22)';g.fillRect(x,y,ww,hh);
  g.strokeStyle='rgba(255,255,255,.9)';g.lineWidth=1.5*dpr;
  g.setLineDash([4*dpr,3*dpr]);g.strokeRect(x,y,ww,hh);g.setLineDash([])}}
function mapDrawAreas(g,w,h,dpr){
 if(!MAP.areasOn||!MAP.view)return;
 var sx=w/MAP.vp.width,sy=h/MAP.vp.height;
 var want=mapNormDim(MAP.dim);
 g.textAlign='center';g.textBaseline='middle';
 for(var i=0;i<MAP_AREAS.length;i++){var a=MAP_AREAS[i];
  if(mapNormDim(a.dim)!==want)continue;
  var col=/^#[0-9a-f]{6}$/i.test(a.colour||'')?a.colour:'#e5484d';
  var n=parseInt(col.slice(1),16);
  var rgb=((n>>16)&255)+','+((n>>8)&255)+','+(n&255);
  var lit=(MAP_AREA_PIN&&MAP_AREA_PIN.id===a.id);
  var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(var j=0;j<(a.rects||[]).length;j++){var r=a.rects[j];
   var p0=mapW2S({x:r.x1*16,z:r.z1*16}),p1=mapW2S({x:(r.x2+1)*16,z:(r.z2+1)*16});
   var x=p0.x*sx,y=p0.y*sy,ww=(p1.x-p0.x)*sx,hh=(p1.y-p0.y)*sy;
   g.fillStyle='rgba('+rgb+','+(lit?0.42:0.24)+')';
   g.fillRect(x,y,ww,hh);
   g.strokeStyle='rgba('+rgb+',0.95)';g.lineWidth=(lit?2.5:1.5)*dpr;
   g.strokeRect(x,y,ww,hh);
   if(x<minX)minX=x;if(y<minY)minY=y;
   if(x+ww>maxX)maxX=x+ww;if(y+hh>maxY)maxY=y+hh}
  if(!isFinite(minX))continue;
  /* The label only when the shape is big enough to hold it. Drawn at any size it
     turns a zoomed-out world into a wall of overlapping text. */
  if(maxX-minX>46*dpr&&maxY-minY>16*dpr){
   var cxp=(minX+maxX)/2,cyp=(minY+maxY)/2;
   g.font='600 '+(11*dpr)+'px Inter,system-ui,sans-serif';
   g.lineWidth=3*dpr;g.strokeStyle='rgba(0,0,0,.65)';
   g.strokeText(a.name,cxp,cyp);
   g.fillStyle='rgba(255,255,255,.96)';g.fillText(a.name,cxp,cyp)}}
 g.textAlign='center';g.textBaseline='bottom'}
/* Hover shows it, a click keeps it — a tooltip that vanishes when the pointer
   moves cannot be read on a phone, where there is no hover at all. */
function mapAreaTip(){
 var el=document.getElementById('mpAreaTip');if(!el)return;
 var a=MAP_AREA_PIN;
 if(!a&&MAP.cursor&&MAP.areasOn){
  var c=mapChunkOf(MAP.cursor.x,MAP.cursor.z);
  a=mapAreaAt(MAP_AREAS,c.cx,c.cz,MAP.dim)}
 if(!a){el.classList.add('hidden');el.innerHTML='';return}
 var col=/^#[0-9a-f]{6}$/i.test(a.colour||'')?a.colour:'#e5484d';
 el.classList.remove('hidden');
 el.innerHTML='<b style="color:'+mapEsc(col)+'">'+mapEsc(a.name)+'</b>'+
  (a.note?'<div>'+mapEsc(a.note)+'</div>':'')+
  (MAP_AREA_PIN?'<button class="mp-x" onclick="mapPinArea(null)">close</button>':'')}
function mapPinArea(a){MAP_AREA_PIN=a;mapAreaTip();mapDraw()}
function mapToggleAreas(){MAP.areasOn=!MAP.areasOn;
 var b=document.getElementById('mpAreasBtn');
 if(b)b.textContent='Areas: '+(MAP.areasOn?'on':'off');
 if(MAP.areasOn&&!MAP_AREAS.length)mapFetchAreas();
 MAP_AREA_PIN=null;mapAreaTip();mapDraw()}
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
/* The viewport in chunk coordinates. */
function mapChunkBox(){
 if(!MAP.view)return null;
 var tl=mapS2W({x:0,y:0}),br=mapS2W({x:MAP.vp.width,y:MAP.vp.height});
 return {x0:Math.floor(tl.x/16),x1:Math.floor(br.x/16),
  z0:Math.floor(tl.z/16),z1:Math.floor(br.z/16)}}
/**
 * Chunks to REQUEST. Capped, because zoomed out a viewport covers tens of
 * thousands and asking for them is pointless as well as expensive — at that
 * scale a chunk is a fraction of a pixel.
 */
function mapVisibleChunks(){
 var b=mapChunkBox();if(!b)return [];
 if((b.x1-b.x0+1)*(b.z1-b.z0+1)>4096)return [];
 var out=[];
 for(var z=b.z0;z<=b.z1;z++)for(var x=b.x0;x<=b.x1;x++)out.push({cx:x,cz:z});
 return out}
/**
 * Tiles to DRAW: everything already held that falls in view.
 *
 * A different question from what to request, and conflating the two is why the
 * terrain vanished when zoomed out (#135) — the request cap correctly refused
 * to ask for a million chunks and took the drawing down with it. Iterating what
 * is HELD rather than what is visible also costs the size of the cache instead
 * of the size of the viewport, so it stays cheap however far out you go.
 */
function mapDrawableChunks(){
 var b=mapChunkBox();if(!b)return [];
 var out=[];
 for(var k in MAP_TILES){
  if(!MAP_TILES[k])continue;
  var p=k.split(',');var cx=+p[0],cz=+p[1];
  if(cx<b.x0-1||cx>b.x1+1||cz<b.z0-1||cz>b.z1+1)continue;
  out.push({cx:cx,cz:cz})}
 return out}
var MAP_MARKS={};
function mapFetchTiles(force){
 if(!MAP.world||MAP_TILE_PENDING||!MAP.view)return;
 /* When loading-on-pan is off the map draws what it holds and asks for nothing
    more until the operator presses to load. On a machine where the reading
    itself is the problem, this is the switch that ends it (#136). */
 if(MAP.loadOnPan===false&&!force)return;
 var chunks=mapVisibleChunks();
 /* Read ahead of the viewport when asked: a ring of chunks around what is on
    screen, so panning is already drawn. This never GENERATES terrain — MSMS
    reads what the server has written, and a map that could grow a world by
    being panned would be a map that can fill a disk (#131). */
 if(MAP.loadAhead&&chunks.length){
  var xs=chunks.map(function(c){return c.cx}),zs=chunks.map(function(c){return c.cz});
  var x0=Math.min.apply(null,xs)-2,x1=Math.max.apply(null,xs)+2;
  var z0=Math.min.apply(null,zs)-2,z1=Math.max.apply(null,zs)+2;
  if((x1-x0+1)*(z1-z0+1)<=4096){
   chunks=[];
   for(var rz=z0;rz<=z1;rz++)for(var rx=x0;rx<=x1;rx++)chunks.push({cx:rx,cz:rz})}}
 var want=chunks.filter(function(c){return MAP_TILES[mapTileKey(c.cx,c.cz)]===undefined});
 if(!want.length)return;
 mapTrimTiles();
 want=want.slice(0,64);
 MAP_TILE_PENDING=true;
 mapGet(mapTilesUrl(MAP.dim,want.map(function(c){return c.cx+','+c.cz}).join(';'),MAP.marksOn)).then(function(d){
  MAP_TILE_PENDING=false;
  if(!d||!d.tiles)return;
  /* The empty list is the server saying "I have read that region and there is
     nothing in that chunk". Marking a chunk null only when the WHOLE response had
     nothing pending was the bug: on a busy viewport something is always
     pending, so genuinely empty chunks were never marked and were re-requested
     on every single draw, forever (#136). */
  var known={};
  for(var e=0;e<(d.empty||[]).length;e++)known[d.empty[e]]=1;
  for(var i=0;i<want.length;i++){
   var k=mapTileKey(want[i].cx,want[i].cz);
   var t=d.tiles[k];
   if(t){MAP_TILES[k]=mapBakeTile(t);if(t.m)MAP_MARKS[k]=t.m}
   else if(known[k]||!d.pending)MAP_TILES[k]=null}
  mapDraw();
  /* Ask again straight away while anything is still coming. Waiting for the
     2-second position poll is why a viewport filled in visible bands over ten
     seconds instead of arriving at once. */
  /* A follow-up is finishing a load the operator already asked for, so it is
     not gated on loading-on-pan. */
  if(d.pending>0){clearTimeout(MAP_TILE_SOON);MAP_TILE_SOON=setTimeout(function(){mapFetchTiles(true)},180)}})}
var MAP_TILE_SOON=null;
/* Structure markers. Off by default: they are a spoiler for the players and
   clutter for everyone else. The server decides whether they arrive at all —
   the public feed sends none unless an operator published them. */
/* Cached Path2D per kind: rebuilding one from its path string for every marker
   on every frame is parsing the same string hundreds of times a second. */
var MAP_ICON_PATHS={};
function mapIconPath(kind){
 if(!MAP_ICON_PATHS[kind]){
  try{MAP_ICON_PATHS[kind]=new Path2D(mapIconFor(kind).path)}catch(e){MAP_ICON_PATHS[kind]=null}}
 return MAP_ICON_PATHS[kind]}
function mapDrawMarks(g,w,h,dpr){
 if(!MAP.marksOn)return;
 var sx=w/MAP.vp.width,sy=h/MAP.vp.height;
 var chunks=mapDrawableChunks();
 for(var i=0;i<chunks.length;i++){
  var list=MAP_MARKS[mapTileKey(chunks[i].cx,chunks[i].cz)];
  if(!list)continue;
  for(var j=0;j<list.length;j++){
   var mk=list[j];
   if(MAP.markFilter&&MAP.markFilter[mk.kind]===false)continue;
   var ic=mapIconFor(mk.kind);
   var p=mapW2S({x:mk.x,z:mk.z});
   var x=p.x*sx,y=p.y*sy,r=9*dpr;
   /* A disc behind the glyph so it reads against grass, water or netherrack
      alike — a bare silhouette disappears on anything its own colour. */
   g.beginPath();g.arc(x,y,r,0,Math.PI*2);
   g.fillStyle='rgba(16,16,20,.72)';g.fill();
   g.lineWidth=1.5*dpr;g.strokeStyle=ic.colour;g.stroke();
   var path=mapIconPath(mk.kind);
   if(path){
    var s=(r*1.5)/24;
    g.save();g.translate(x-r*0.75,y-r*0.75);g.scale(s,s);
    g.fillStyle=ic.colour;g.fill(path);g.restore()}}}}
/* Load what is on screen, once, when loading-on-pan is off. */
function mapLoadHere(){mapFetchTiles(true)}
function mapSetMarkFilter(kind){
 /* '' is everything. A single-kind filter is a whitelist of one, which reads
    better than five checkboxes for a list this short. */
 if(!kind){MAP.markFilter=null;mapDraw();return}
 var f={};
 ['village','dungeon','temple','fortress','mine','other'].forEach(function(k){f[k]=(k===kind)});
 MAP.markFilter=f;mapDraw()}
function mapToggleMarks(){
 MAP.marksOn=!MAP.marksOn;
 document.getElementById('mpMarksBtn').textContent='Structures: '+(MAP.marksOn?'on':'off');
 /* The tiles held were fetched without markers, so they carry none. Drop them
    and ask again rather than showing an empty layer that looks like "there are
    no villages here". */
 if(MAP.marksOn){MAP_TILES={};MAP_MARKS={}}
 mapFetchTiles();mapDraw()}
/* Panning a big world would otherwise hold every chunk ever looked at, for as
   long as the page is open — and since drawing iterates what is held, an
   unbounded cache is a per-frame cost as well as a memory one. Tiles outside
   the view are dropped past the cap; re-fetching one is cheap because the main
   process still has the region. */
function mapTrimTiles(){
 var keys=Object.keys(MAP_TILES);
 if(keys.length<=2048)return;
 var b=mapChunkBox();if(!b)return;
 for(var i=0;i<keys.length;i++){
  var p=keys[i].split(',');var cx=+p[0],cz=+p[1];
  if(cx<b.x0-8||cx>b.x1+8||cz<b.z0-8||cz>b.z1+8){delete MAP_TILES[keys[i]];delete MAP_MARKS[keys[i]]}}}
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
/* Area nobody has ever been to.
   Drawn as a deliberate, themed hatch rather than left black, because black is
   indistinguishable from "still loading" and from "broken" — an operator was
   waiting for a load that was never coming (#136). */
function mapDrawUngenerated(g,w,h,dpr){
 if(!MAP.world||!MAP.view)return;
 var b=mapChunkBox();if(!b)return;
 if((b.x1-b.x0+1)*(b.z1-b.z0+1)>4096)return;
 var sx=w/MAP.vp.width,sy=h/MAP.vp.height;
 var size=16*MAP.view.scale;
 /* Too small to read as anything but noise; leave it plain. */
 if(size*sx<3)return;
 var accent=mapAccent();var ungen=0;
 for(var cz=b.z0;cz<=b.z1;cz++)for(var cx=b.x0;cx<=b.x1;cx++){
  if(MAP_TILES[mapTileKey(cx,cz)]!==null)continue;
  var p=mapW2S({x:cx*16,z:cz*16});
  var x=p.x*sx,y=p.y*sy,d=size*sx,dh2=size*sy;
  g.fillStyle='rgba('+accent+',0.055)';
  g.fillRect(x,y,d+1,dh2+1);ungen++}
 mapUngenNote(ungen,(b.x1-b.x0+1)*(b.z1-b.z0+1))}
/* How much of the view is area nobody has generated, said in words. A hatch on
   its own is just a colour; the sentence is what stops someone waiting. */
function mapUngenNote(ungen,total){
 var el=document.getElementById('mpUngen');if(!el)return;
 var show=total>0&&ungen/total>0.15;
 el.classList.toggle('hidden',!show);
 if(show)el.textContent='Shaded area has never been generated — no player has been there, so there is nothing to draw.'}
/* The site accent as an "r,g,b" triple, so the hatch belongs to the theme
   rather than being a hardcoded red. */
function mapAccent(){
 try{
  var v=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  var m=/^#([0-9a-f]{6})$/i.exec(v);
  if(m){var n=parseInt(m[1],16);return ((n>>16)&255)+','+((n>>8)&255)+','+(n&255)}
 }catch(e){}
 return '220,39,39'}
function mapDrawTiles(g,w,h){
 if(!MAP.world)return;
 var chunks=mapDrawableChunks();
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
 /* Pinned: the operator chose the world, so there is nothing to switch to. */
 var ds=document.getElementById('mpDim');
 if(ds)ds.style.display=d.pinned?'none':'';
 var db=document.getElementById('mpHeadsBtn');
 if(db)db.style.display=(d.heads===false)?'none':'';
 /* The structure controls belong to whoever may change the answer. On the
    public map that is the operator, in their settings — a visitor offered a
    toggle the feed ignores is offered nothing. */
 var admin=!!mapAdminId();
 var mb=document.getElementById('mpMarksBtn');
 if(mb)mb.style.display=admin?'':'none';
 var mf=document.getElementById('mpMarkFilter');
 if(mf)mf.style.display=(MAP.marksOn)?'':'none';
 /* Only meaningful when the map will not fetch by itself. */
 var lb=document.getElementById('mpLoadBtn');
 if(lb)lb.classList.toggle('hidden',MAP.loadOnPan!==false);
 /* A glyph nobody can name is decoration. The key is only worth the space when
    the markers are actually on. */
 var ik=document.getElementById('mpIconKey');
 if(ik){
  ik.classList.toggle('hidden',!MAP.marksOn);
  if(MAP.marksOn&&!ik.childNodes.length){
   var html='';
   for(var kk in MAP_ICONS){
    var ii=MAP_ICONS[kk];
    html+='<span class="mp-ik">'+mapIconSvg(kk,14)+mapEsc(ii.label)+'</span>'}
   ik.innerHTML=html}}
 var g=cv.getContext('2d');g.clearRect(0,0,w,h);
 var sx=w/MAP.vp.width,sy=h/MAP.vp.height;
 /* The world first: everything else is drawn on top of it. */
 mapDrawUngenerated(g,w,h,dpr);
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
 /* Areas sit on the terrain and under everything that has to stay readable: a
    translucent claim over a village icon is fine, over a player is not. */
 mapDrawAreas(g,w,h,dpr);
 mapDrawPick(g,w,h,dpr);
 /* After the grid and the heatmap, before the players: a marker under a grid
    line reads as a smudge, and a player must never be hidden behind one. */
 mapDrawMarks(g,w,h,dpr);
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
 /* Clickable: with more than one person online, finding somebody meant panning
    around reading the coordinate readout (#131). */
 document.getElementById('mpList').innerHTML=ps.map(function(p,i){
  var pos=(typeof p.y==='number')?(p.x+', '+p.y+', '+p.z):(p.x+', '+p.z);
  return '<button class="mp-chip" onclick="mapGoTo('+i+')" title="Centre the map here">'+
   mapEsc(p.name||'?')+'<span>'+pos+'</span></button>'}).join('')}
/* Centre on one player, keeping the zoom. Jumping to a fixed zoom as well would
   throw away the scale the operator had chosen, which is usually the thing they
   were looking at them at. */
function mapGoTo(i){
 var d=MAP.data;if(!d||!MAP.view)return;
 var p=(d.players||[])[i];if(!p)return;
 MAP.view={cx:p.x,cz:p.z,scale:MAP.view.scale};
 MAP.followed=false;mapDraw()}
`
