export const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    font-family:'Segoe UI',system-ui,-apple-system,sans-serif;user-select:none}
  .card{position:absolute;inset:12px;border-radius:22px;
    background:radial-gradient(620px 320px at 30% 0%, rgba(220,39,39,.20), transparent 60%),
      linear-gradient(160deg,#17151b,#0b0b10);
    border:1px solid rgba(220,39,39,.35);box-shadow:0 24px 70px rgba(0,0,0,.55);
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
    animation:fade .35s ease}
  @keyframes fade{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}
  .logo{filter:drop-shadow(0 10px 24px rgba(220,39,39,.5));animation:pop .5s cubic-bezier(.2,1.2,.3,1)}
  @keyframes pop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
  .title{color:#fff;font-weight:800;font-size:27px;letter-spacing:1px;margin-top:2px}
  .title span{color:#dc2727}
  .sub{color:#9aa0ad;font-size:12px;margin-top:-10px;letter-spacing:.5px}
  .bar{width:210px;height:4px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:8px}
  .bar>i{display:block;height:100%;width:38%;border-radius:4px;
    background:linear-gradient(90deg,#f04444,#a81d1d);animation:slide 1.15s ease-in-out infinite}
  @keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(380%)}}
</style></head><body>
  <div class="card">
    <svg class="logo" width="88" height="88" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c1622"/><stop offset=".55" stop-color="#131219"/><stop offset="1" stop-color="#0b0b10"/></linearGradient>
        <radialGradient id="gl" cx=".32" cy=".26" r=".85"><stop offset="0" stop-color="#dc2727" stop-opacity=".5"/><stop offset=".45" stop-color="#dc2727" stop-opacity=".1"/><stop offset="1" stop-color="#dc2727" stop-opacity="0"/></radialGradient>
        <linearGradient id="c" x1=".15" y1=".05" x2=".85" y2=".95"><stop offset="0" stop-color="#f04444"/><stop offset="1" stop-color="#a81d1d"/></linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#bg)"/>
      <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#gl)"/>
      <rect x="17" y="17" width="478" height="478" rx="115" fill="none" stroke="#dc2727" stroke-opacity=".35" stroke-width="2"/>
      <path fill="url(#c)" d="M 330 106 L 150 106 L 106 150 L 106 362 L 150 406 L 330 406 L 330 332 L 180 332 L 180 180 L 330 180 Z"/>
      <rect x="356" y="232" width="48" height="48" rx="9" fill="url(#c)" transform="rotate(45 380 256)"/>
    </svg>
    <div class="title">CaYa<span>Dev</span></div>
    <div class="sub">Server Manager</div>
    <div class="bar"><i></i></div>
  </div>
</body></html>`
