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
.mp-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;opacity:.75}
.mp-legend b{font-weight:800;opacity:1}
.mp-list{display:flex;flex-wrap:wrap;gap:6px}
.mp-chip{padding:4px 9px;border-radius:999px;font-size:12px;font-weight:700;
  border:1px solid var(--line,var(--border,rgba(255,255,255,.14)));background:var(--elev,rgba(255,255,255,.05))}
.mp-chip span{opacity:.6;font-weight:600;margin-left:5px}
`

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
  </div>
  <div class="mp-canvas-wrap"><canvas id="mpCanvas"></canvas><div id="mpEmpty" class="mp-empty"></div></div>
  <div class="mp-legend">
    <span id="mpBounds"></span>
    <span id="mpCount"></span>
  </div>
  <div id="mpList" class="mp-list"></div>
</div>`

export const MAP_JS = `
var MAP={data:null,heat:true,timer:null,dim:'overworld',bridge:null,busy:false,msg:''};
/* The bridge warning and its install button (#103).
   Deliberately here, in the empty map, and nowhere else: this is where an
   operator finds out positions are missing, so it is the only place the answer
   is useful. A global banner would be shown to people whose servers cannot run
   the plugin at all. */
function mapNoBridgeHtml(){
 var b=MAP.bridge;
 var head='<div>No live positions — this server has no MSMS-Bridge plugin.</div>';
 if(MAP.msg)return head+'<div class="mp-note">'+mapEsc(MAP.msg)+'</div>';
 if(!b)return head;
 if(b.state==='unsupported')return '<div>This server type cannot run the Bridge plugin.</div>';
 if(b.state!=='missing'||!b.actionable)return head;
 return head+'<div class="mp-note">Positions arrive over the server console, so no extra port is opened.'+
  (b.offline?' GitHub is unreachable; the copy shipped with the app will be used.':'')+'</div>'+
  '<button class="btn primary" onclick="mapInstallBridge()"'+(MAP.busy?' disabled':'')+'>'+
  (MAP.busy?'Installing…':'Install MSMS-Bridge '+mapEsc(b.latest||''))+'</button>'}
function mapBridgeCheck(){
 /* Once per tab open, not on the 2s position poll: the answer changes when
    somebody installs a jar, and the check reaches GitHub. */
 api('/api/servers/'+mapServerId()+'/bridge').then(function(r){
  MAP.bridge=r.ok?r.body:null;mapDraw()})}
function mapInstallBridge(){
 if(MAP.busy)return;
 MAP.busy=true;MAP.msg='';mapDraw();
 api('/api/servers/'+mapServerId()+'/bridge/install',{method:'POST'}).then(function(r){
  MAP.busy=false;
  /* "Installed" is not "working". Bukkit loads plugins at startup, so the jar
     does nothing until a restart — an operator watching a still-empty map
     would otherwise read that as a failed install. */
  MAP.msg=r.ok?('Installed '+(r.body.version||'')+'. Restart the server to load it.')
   :('Install failed: '+((r.body&&r.body.error)||r.status));
  mapBridgeCheck();mapDraw()})}
function mapEsc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
function mapToggleHeat(){MAP.heat=!MAP.heat;
 document.getElementById('mpHeatBtn').textContent='Heatmap: '+(MAP.heat?'on':'off');mapDraw()}
function mapStart(){mapStop();mapRefresh();mapBridgeCheck();MAP.timer=setInterval(mapRefresh,2000)}
function mapStop(){if(MAP.timer){clearInterval(MAP.timer);MAP.timer=null}}
function mapRefresh(){
 var sel=document.getElementById('mpDim');
 var dim=sel&&sel.value?sel.value:MAP.dim;
 var cell=document.getElementById('mpCell').value||'16';
 api('/api/servers/'+mapServerId()+'/map?dim='+encodeURIComponent(dim)+'&cell='+cell).then(function(r){
  if(!r.ok)return;MAP.data=r.body;MAP.dim=r.body.dimension;
  var dot=document.getElementById('mpDot'),state=document.getElementById('mpState');
  dot.className='mp-dot'+(r.body.bridge?' on':'');
  state.textContent=r.body.bridge?'Bridge live':'Bridge not connected';
  /* The dimension list comes from who is actually online, so it changes as
     people travel. Rebuilt only when it differs, or the select would reset
     mid-choice on every poll. */
  var dims=(r.body.dimensions||[]);
  if(dims.indexOf(r.body.dimension)<0)dims=dims.concat([r.body.dimension]);
  var want=dims.map(function(d){return '<option value="'+mapEsc(d)+'"'+(d===r.body.dimension?' selected':'')+'>'+mapEsc(d)+'</option>'}).join('');
  if(sel.innerHTML!==want)sel.innerHTML=want;
  mapDraw()})}
function mapDraw(){
 var d=MAP.data;var cv=document.getElementById('mpCanvas');if(!cv||!d)return;
 /* Match the backing store to the CSS size and the device pixel ratio, or the
    whole map is drawn blurry on any HiDPI screen. */
 var rect=cv.getBoundingClientRect();var dpr=window.devicePixelRatio||1;
 var w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
 if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}
 var g=cv.getContext('2d');g.clearRect(0,0,w,h);
 var b=d.bounds;var spanX=(b.maxX-b.minX)||1,spanZ=(b.maxZ-b.minZ)||1;
 var px=function(x){return (x-b.minX)/spanX*w};
 var pz=function(z){return (z-b.minZ)/spanZ*h};
 /* Grid every 64 blocks, so distances on screen mean something. */
 g.strokeStyle='rgba(255,255,255,.06)';g.lineWidth=1*dpr;
 var step=64;var startX=Math.ceil(b.minX/step)*step;
 for(var gx=startX;gx<=b.maxX;gx+=step){g.beginPath();g.moveTo(px(gx),0);g.lineTo(px(gx),h);g.stroke()}
 var startZ=Math.ceil(b.minZ/step)*step;
 for(var gz=startZ;gz<=b.maxZ;gz+=step){g.beginPath();g.moveTo(0,pz(gz));g.lineTo(w,pz(gz));g.stroke()}
 /* Origin, when it is in view - the one landmark every Minecraft player shares. */
 if(b.minX<=0&&b.maxX>=0&&b.minZ<=0&&b.maxZ>=0){
  g.strokeStyle='rgba(220,39,39,.5)';g.lineWidth=1*dpr;
  g.beginPath();g.moveTo(px(0),0);g.lineTo(px(0),h);g.stroke();
  g.beginPath();g.moveTo(0,pz(0));g.lineTo(w,pz(0));g.stroke()}
 if(MAP.heat&&d.heatmap&&d.heatmap.length){
  var max=d.heatmap[0].count||1;var cw=(d.cell/spanX)*w,ch=(d.cell/spanZ)*h;
  for(var i=0;i<d.heatmap.length;i++){var c=d.heatmap[i];
   g.fillStyle='rgba(220,39,39,'+(0.12+0.55*(c.count/max)).toFixed(3)+')';
   g.fillRect(px(c.x),pz(c.z),Math.max(2*dpr,cw),Math.max(2*dpr,ch))}}
 var ps=d.players||[];
 g.font=(11*dpr)+'px Inter,system-ui,sans-serif';g.textAlign='center';g.textBaseline='bottom';
 for(var j=0;j<ps.length;j++){var p=ps[j];var x=px(p.x),y=pz(p.z);
  g.beginPath();g.arc(x,y,4.5*dpr,0,Math.PI*2);
  g.fillStyle='#4ade80';g.fill();
  g.lineWidth=1.5*dpr;g.strokeStyle='rgba(0,0,0,.55)';g.stroke();
  g.fillStyle='rgba(255,255,255,.92)';g.fillText(p.name,x,y-7*dpr)}
 /* innerHTML rather than textContent: the empty state now carries an action
    (#103). Everything interpolated into it is generated here or run through
    mapEsc — nothing from the server reaches it unescaped. */
 document.getElementById('mpEmpty').innerHTML=
  ps.length?'':(d.bridge?'Nobody in this dimension right now.':mapNoBridgeHtml());
 document.getElementById('mpBounds').innerHTML='<b>X</b> '+Math.round(b.minX)+' … '+Math.round(b.maxX)+
  ' &nbsp; <b>Z</b> '+Math.round(b.minZ)+' … '+Math.round(b.maxZ);
 document.getElementById('mpCount').innerHTML='<b>'+ps.length+'</b> shown';
 document.getElementById('mpList').innerHTML=ps.map(function(p){
  return '<span class="mp-chip">'+mapEsc(p.name)+'<span>'+p.x+', '+p.y+', '+p.z+'</span></span>'}).join('')}
`
