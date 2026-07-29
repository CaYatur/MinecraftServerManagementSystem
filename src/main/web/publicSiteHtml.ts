// Public, themeable, multi-page server website.
// Pages: #/ (home) · #/news · #/news/:id · #/store · #/servers
// Everything user-authored is escaped before rendering.
import { pickSiteLang } from './siteLang'
import { CRATE_CSS, CRATE_JS, CRATE_MODAL_HTML } from '@shared/crateUi'
import { STORE_CSS, STORE_JS, STORE_MODAL_HTML, CRATE_ICON_SVG } from '@shared/storeUi'
import { MAP_CSS, MAP_HTML, MAP_JS } from '@shared/mapUi'
import { avatarUrl, itemIconId, itemIconUrl, itemLabel } from '@shared/profile'
import { iconSvg, STRUCTURE_ICONS } from '@shared/mapIcons'

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
body{margin:0;background:var(--bg);color:var(--text);font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden;display:flex;flex-direction:column;min-height:100vh}
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
/* min-width:0 so a long server name shortens instead of shoving the nav links
   and the account chip out of the row (#137). */
.brand{display:flex;align-items:center;gap:11px;font-weight:850;font-size:19.5px;letter-spacing:-.3px;
  margin-right:18px;min-width:0;flex-shrink:0}
.brand span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.navend{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto}
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
.connect{display:inline-flex;align-items:center;gap:12px;margin-top:24px;padding:8px 8px 8px 18px;border-radius:999px;
  background:color-mix(in srgb,var(--card) 82%,transparent);border:1px solid var(--line);backdrop-filter:blur(8px);flex-wrap:wrap;justify-content:center}
.connect .connect-lbl{font-size:11.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--dim);font-weight:800}
.connect code{font-family:ui-monospace,SFMono-Regular,Menlo,'Cascadia Code',monospace;font-size:16px;font-weight:800;color:var(--text);letter-spacing:.3px;user-select:all}
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
/* Grow to fill the viewport so a short page keeps the footer pinned to the
   bottom instead of floating up under the content. */
main{min-height:52vh;flex:1 0 auto}
.section{padding:64px 0}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:28px}
.section h2{position:relative;font-size:clamp(23px,3.1vw,32px);margin:0;font-weight:850;letter-spacing:-.6px;padding-left:15px}
.section h2::before{content:'';position:absolute;left:0;top:.18em;bottom:.18em;width:4px;border-radius:3px;background:var(--accent);box-shadow:0 0 14px var(--glow)}
.muted{color:var(--dim)}
/* Player profile (#107). A head is pixel art: smoothing 8x8 pixels up to 48
   is mush, so every one of them is rendered without interpolation. */
.phead{image-rendering:pixelated;border-radius:6px;vertical-align:middle}
/* An account chip, not a bare name. A head image followed by loose text, with
   no framing, read as debug output next to a styled button (#116). */
.whoami{display:inline-flex;align-items:center;gap:9px;margin-right:10px;padding:5px 12px 5px 6px;
  border-radius:999px;font-size:14px;font-weight:600;text-decoration:none;color:var(--text);
  border:1px solid var(--line);background:color-mix(in srgb,var(--card) 70%,transparent);
  transition:border-color .16s ease,background .16s ease}
.whoami:hover{border-color:var(--accent);background:color-mix(in srgb,var(--card) 95%,transparent)}
.whoami .phead{border-radius:50%}
.phero{display:flex;align-items:center;gap:20px;margin-bottom:24px}
.phero .big{width:96px;height:96px;border-radius:14px;border:1px solid var(--line);
  background:color-mix(in srgb,var(--card) 70%,transparent);padding:6px}
.pid h2{margin:0 0 6px;font-size:32px;letter-spacing:-.8px}
.prow{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--dim)}
.pdot{width:9px;height:9px;border-radius:50%;background:var(--dim);display:inline-block}
.pdot.on{background:#4ade80;box-shadow:0 0 0 3px color-mix(in srgb,#4ade80 25%,transparent)}
.pmeta{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}
.pmeta>div{display:flex;flex-direction:column;gap:2px;padding:10px 14px;border-radius:12px;
  border:1px solid var(--line);background:color-mix(in srgb,var(--card) 70%,transparent);min-width:120px}
.pmeta span{font-size:12px}
.pmeta b{font-size:15px;font-weight:800}
/* Health and food are fractions of a known maximum, so they get a bar. A bare
   "20" says nothing about whether that is full. */
.pbars{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:8px}
.pbar{flex:1;min-width:180px}
.pbl{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px}
.pbl span{color:var(--dim)}
.ptrack{height:8px;border-radius:999px;background:color-mix(in srgb,var(--card) 60%,transparent);
  border:1px solid var(--line);overflow:hidden}
.ptrack i{display:block;height:100%;border-radius:999px}
.ptrack .hp{background:linear-gradient(90deg,#e0524a,#ff8a80)}
.ptrack .food{background:linear-gradient(90deg,#c98b34,#e8c07d)}
.pcoords{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.pcoords>div{display:flex;flex-direction:column;gap:2px;padding:8px 16px;border-radius:10px;
  border:1px solid var(--line);background:color-mix(in srgb,var(--card) 70%,transparent)}
.pcoords span{font-size:11px}
.pcoords b{font-size:15px;font-variant-numeric:tabular-nums}
.phid{margin-top:20px;font-size:13px}
.ihead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.ihead h3{margin-right:auto}
.imeta{display:flex;align-items:center;gap:10px;font-size:12.5px}
/* An inventory should look like one: square slots, the picture at item size,
   pixelated, with the name underneath as the fallback when there is none. */
.inv{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin-bottom:8px}
.slot{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;
  padding:10px 6px 8px;border-radius:10px;border:1px solid var(--line);
  background:color-mix(in srgb,var(--card) 70%,transparent);font-size:11px;text-align:center}
.slot .iicon{width:36px;height:36px;object-fit:contain;image-rendering:pixelated}
.slot .iicon.gone{display:none}
.slot .iname{display:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
/* The name shows when there is no picture — either the id was not one we can
   build a URL for, or the fetch failed and onerror marked the slot. */
.slot.noimg .iname,.slot:not(:has(.iicon)) .iname{display:block}
.slot.noimg{padding-top:20px;padding-bottom:18px}
.slot .icount{position:absolute;right:6px;bottom:4px;font-weight:800;font-size:12px;color:var(--accent);
  text-shadow:0 1px 2px rgba(0,0,0,.8)}
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
/* Above the product detail (.sf-modal, 75) and the lightbox (80): signing in is
   a blocking step, so whatever opened it must not sit on top of it. buy() also
   closes the detail; this is the rule that holds if a later path forgets to.
   No backticks in here - the whole stylesheet is a template literal. */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.74);display:grid;place-items:center;z-index:88;padding:18px}
.modal{background:linear-gradient(165deg,var(--card),color-mix(in srgb,var(--bg) 55%,var(--card)));
  border:1px solid var(--line);border-radius:var(--radius);padding:28px;width:min(430px,95vw);
  box-shadow:0 40px 90px -40px #000,0 0 0 1px color-mix(in srgb,var(--accent) 18%,transparent)}
.modal h3{margin:0 0 14px;font-size:21px;font-weight:800}
input{width:100%;padding:12px 14px;background:color-mix(in srgb,var(--bg) 70%,var(--card));border:1px solid var(--line);border-radius:11px;color:var(--text);margin:7px 0;font-size:15px;font-family:inherit}
input:focus{outline:none;border-color:var(--accent)}
.err{color:#f87171;font-size:13.5px;margin-top:8px;min-height:18px}
/* crate + storefront - one implementation, shared with the admin panel */
${CRATE_CSS}
${STORE_CSS}
${MAP_CSS}
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
  /* Brand and the account controls share the top row; the links get their own
     full-width, scrollable strip underneath. */
  .brand{margin-right:0;font-size:17px}
  .navend{order:2}
  .navlinks{order:3;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;
    flex:0 0 100%;padding-bottom:2px;scrollbar-width:none}
  .navlinks::-webkit-scrollbar{display:none}
  .navlink{white-space:nowrap;padding:8px 11px;font-size:14px}
  .hero{padding:64px 0 48px}.hero.image{padding:88px 0 62px}
  .section{padding:44px 0}.stats{gap:10px}.stat{padding:13px 16px;min-width:0}
  .stat b{font-size:22px}.foot{flex-direction:column;text-align:center}
  /* The profile stacks rather than running off the side. */
  .phero{gap:14px}.phero .big{width:72px;height:72px}
  .pid h2{font-size:25px}
  .pmeta>div,.pcoords>div{flex:1 1 128px;min-width:0}
  .inv{grid-template-columns:repeat(auto-fill,minmax(72px,1fr))}
  .ihead{gap:8px}
  .mp-bar{gap:6px}.mp-bar select,.mp-bar button{font-size:12.5px;padding:7px 9px}}
@media(max-width:460px){
  /* At phone width the brand name is the first thing worth dropping — the logo
     still says which server this is, and the account chip must not be pushed
     off the screen for a word. */
  .brand span:last-child{display:none}
  .btn{padding:9px 14px;font-size:13.5px}
  .wrap{padding:0 14px}
  .hero h1{font-size:clamp(28px,9vw,44px)}
  .inv{grid-template-columns:repeat(auto-fill,minmax(64px,1fr))}
  .whoami span{max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
</style></head>
<body>
<header><div class="wrap nav">
  <a class="brand" href="#/"><span id="brandLogo"></span><span id="brandName">Server</span></a>
  <nav class="navlinks" id="navlinks"></nav>
  <!-- The right-hand controls are one group, so a narrow window moves them
       together instead of dealing them out between the nav links (#137). -->
  <div class="navend">
    <select class="lang" id="langSel" onchange="setLang(this.value)"></select>
    <span id="accBtn"></span>
  </div>
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
    <p class="muted" style="font-size:13.5px;margin-top:4px"><a href="#" style="color:var(--accent)" onclick="showReset(1);return false" id="forgotLink"></a></p>
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
  <div class="ok" id="amNote" style="font-size:13.5px"></div>
  <button class="btn sm ghost" style="margin-top:8px" onclick="closeAuth()" id="closeBtn"></button>
</div></div>

${CRATE_MODAL_HTML}
${STORE_MODAL_HTML}

<div id="lightbox" class="lb hidden" onclick="this.classList.add('hidden')"><img id="lbImg" alt=""/></div>

<script>
var S=null,LANG='en',ptoken=localStorage.getItem('msms_ptoken')||'',pname=localStorage.getItem('msms_pname')||'',STORE=null;
/* The signed-in player's uuid, for the head beside their name (#107). Cached in
   localStorage rather than re-fetched on every render: it never changes for a
   given name, and the profile read parses player .dat files. */
var puuid=localStorage.getItem('msms_puuid')||'',whoamiTried=false;
function refreshWhoami(){
 if(!ptoken){puuid='';whoamiTried=false;localStorage.removeItem('msms_puuid');return}
 if(puuid||whoamiTried)return;
 /* Once per page load, not once per render. A player who has registered but
    never joined has no uuid to find, so without the flag every navigation
    would fire another request — and on the server side that request is the
    only public one that parses the world's player files. */
 whoamiTried=true;
 api('/api/public/profile',null,ptoken).then(function(r){
  /* The first authenticated request after a restart is usually this one, so it
     is where a dead token is found. */
  if(r.s===401){staleSession();return}
  if(!r.ok||!r.j.uuid)return;
  puuid=r.j.uuid;localStorage.setItem('msms_puuid',puuid);renderChrome()})}
function esc(t){var d=document.createElement('div');d.textContent=(t==null?'':t);return d.innerHTML}
/* esc() escapes < > &, which is right for text but NOT for an attribute: it
   leaves quotes alone, so esc(url) inside src="..." lets a store admin close
   the attribute and add an onerror handler that runs for every visitor.
   Anything going between quotes goes through here. */
function escAttr(t){return esc(t).replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
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
 refreshWhoami();
 var route=location.hash||'#/';
 var links=[['#/','nav.home'],['#/news','nav.news']];
 if(S.showStore)links.push(['#/store','nav.store']);
 if(S.showMap)links.push(['#/map','nav.map']);
 if(S.servers&&S.servers.length)links.push(['#/servers','nav.servers']);
 document.getElementById('navlinks').innerHTML=links.map(function(l){
   var act=(route===l[0]||(l[0]!=='#/'&&route.indexOf(l[0])===0))?' active':'';
   return '<a class="navlink'+act+'" href="'+l[0]+'">'+esc(T(l[1]))+'</a>'}).join('');
 var sel=document.getElementById('langSel');var codes=Object.keys(S.i18n.langs);
 sel.innerHTML=codes.map(function(c){return '<option value="'+c+'"'+(c===LANG?' selected':'')+'>'+c.toUpperCase()+'</option>'}).join('');
 document.getElementById('accBtn').innerHTML=ptoken
  ? (S.showProfiles
      ? '<a href="#/profile" class="whoami" title="'+escAttr(T('profile.title'))+'">'+headImg(pname,28)+'<span>'+esc(pname)+'</span></a>'
      /* No server behind the site means no profile to link to: the page would
         load and say "no such player" about the visitor themselves. */
      : '<span class="muted" style="margin-right:10px;font-size:14px">'+esc(pname)+'</span>')+
    '<button class="btn sm" onclick="plogout()">'+esc(T('auth.logout'))+'</button>'
  : '<button class="btn sm primary" onclick="openAuth()">'+esc(T('auth.login'))+'</button>';
 var links=[['#/','nav.home'],['#/news','nav.news']];
 if(S.showStore)links.push(['#/store','nav.store']);
 if(S.showMap)links.push(['#/map','nav.map']);
 if(S.servers&&S.servers.length)links.push(['#/servers','nav.servers']);
 document.getElementById('footer').innerHTML='<div class="foot">'+
  '<span class="fbrand">'+esc(S.siteName)+'</span>'+
  '<span class="flinks">'+links.map(function(l){return '<a href="'+l[0]+'">'+esc(T(l[1]))+'</a>'}).join('')+
   (S.discordUrl?'<a target="_blank" rel="noopener" href="'+escAttr(S.discordUrl)+'">Discord</a>':'')+'</span>'+
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
/* Copy the connect address. navigator.clipboard needs a secure context, which a
   plain-http LAN site is not, so fall back to selecting the text + execCommand
   (both run inside the button's click gesture). Either way flash "Copied!". */
function copyIp(btn){
 var el=document.getElementById('ipVal');if(!el)return;
 var flash=function(){var o=btn.getAttribute('data-o')||btn.textContent;btn.setAttribute('data-o',o);
  btn.textContent=T('connect.copied');clearTimeout(btn.__t);btn.__t=setTimeout(function(){btn.textContent=o},1400)};
 var txt=el.textContent||'';
 if(navigator.clipboard&&navigator.clipboard.writeText){
  navigator.clipboard.writeText(txt).then(flash,function(){if(legacyCopy(el))flash()})
 }else if(legacyCopy(el))flash()
}
function legacyCopy(el){try{var r=document.createRange();r.selectNodeContents(el);
 var s=window.getSelection();s.removeAllRanges();s.addRange(r);var ok=document.execCommand('copy');
 s.removeAllRanges();return ok}catch(e){return false}}

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
   (S.discordUrl?'<a class="btn lg" target="_blank" rel="noopener" href="'+escAttr(S.discordUrl)+'">'+esc(T('hero.discord'))+'</a>':'')+
   '</div>'+
   (S.serverIp?'<div class="connect"><span class="connect-lbl">'+esc(T('connect.ip'))+
     '</span><code id="ipVal">'+esc(S.serverIp)+'</code>'+
     '<button type="button" class="btn sm" onclick="copyIp(this)">'+esc(T('connect.copy'))+'</button></div>':'')+
   statStrip()+'</div></section>';
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
/* The live map (#104). The same engine the panel uses — pan, zoom and the
   coordinate readout are client-side, so nothing here depends on the bridge
   beyond the positions themselves. What differs is the FEED: the public one
   rounds coordinates, drops the height, and only sends a uuid when the operator
   turned heads on. */
function pageMap(){
 /* The operator's settings, not the visitor's. Structures and read-ahead are
    published decisions; a visitor toggling them would only be asking for data
    the feed refuses anyway (#131). */
 MAP.marksOn=!!S.mapStructures;
 MAP.loadAhead=!!S.mapLoadAhead;
 MAP.world=!!S.mapWorld;
 setTimeout(function(){mapStart()},0);
 return '<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('map.title'))+'</h2>'+
  '<span class="muted" id="mapRoundNote"></span></div>'+${JSON.stringify(MAP_HTML)}+'</div></section>'}
function mapFeedUrl(dim,cell){
 return '/api/public/map?dim='+encodeURIComponent(dim)+'&cell='+encodeURIComponent(cell)}
/* This page's api() answers {ok,s,j}; the panel's answers {ok,status,body}. The
   map engine used to read .body unconditionally, so on this page every poll
   threw on undefined and the map never drew (#115). */
/* No marks parameter: the public feed decides from the operator's setting and
   ignores what the caller asks for, so there is nothing to send (#131). */
function mapTilesUrl(dim,list){
 return '/api/public/map/tiles?dim='+encodeURIComponent(dim)+'&c='+encodeURIComponent(list)}
function mapGet(u){return api(u).then(function(r){return r.ok?r.j:null}).catch(function(){return null})}
function mapPost(u){return api(u,{}).then(function(r){return r.j||null}).catch(function(){return null})}
/* No admin server id on the public site: the bridge install affordance is an
   operator's, and a visitor offered it would get a 404. */
function mapServerId(){return ''}
/* Only ever called when the feed said heads are on, which is only when the
   operator agreed to send player names to a third party. */
function mapAvatarUrl(name){return avatarUrl(name,32)}
/* ---------- player profile (#107) ----------
   The head, the dates, and whatever server data the operator has published.
   What comes back is decided on the server: a field the viewer may not see is
   ABSENT from the response, not hidden here. */
var PROFILE=null;
function pageProfile(name){
 setTimeout(function(){loadProfile(name)},0);
 return '<section class="section"><div class="wrap"><div id="profBox" class="muted">'+esc(T('common.loading'))+'</div></div></section>'}
function loadProfile(name){
 api('/api/public/profile'+(name?('?name='+encodeURIComponent(name)):''),null,ptoken).then(function(r){
  var el=document.getElementById('profBox');if(!el)return;
  /* The token we hold is dead — the app was restarted, or it expired. Saying
     "no such player" about the person holding it is the bug in #120; drop it
     and offer a login instead. */
  if(r.s===401){staleSession();el.innerHTML='<p class="muted">'+esc(T('auth.sessionExpired'))+'</p>';return}
  if(!r.ok){el.innerHTML='<p class="muted">'+esc(T('profile.notFound'))+'</p>';return}
  PROFILE=r.j;el.innerHTML=profileHtml(r.j)})}
/* Forget a session the server has already forgotten. Without this the header
   goes on showing a name and every request stays silently anonymous. */
function staleSession(){
 if(!ptoken)return;
 ptoken='';pname='';puuid='';whoamiTried=false;
 localStorage.removeItem('msms_ptoken');localStorage.removeItem('msms_pname');localStorage.removeItem('msms_puuid');
 renderChrome();openAuth()}
/* By name, not uuid: on an offline-mode server the uuid MSMS holds is the
   derived offline one, which no skin service has ever seen — every head was a
   broken image on exactly the servers this app is most used on (#116). */
var avatarUrl=${avatarUrl.toString()};
var STRUCTURE_ICONS=${JSON.stringify(STRUCTURE_ICONS)};
var MAP_ICONS=STRUCTURE_ICONS;
function mapIconFor(kind){return STRUCTURE_ICONS[kind]||STRUCTURE_ICONS.other}
var mapIconSvg=${iconSvg.toString()};
var itemIconUrl=${itemIconUrl.toString()};
var itemIconId=${itemIconId.toString()};
var itemLabel=${itemLabel.toString()};
function headImg(name,size,cls){
 return '<img class="phead '+(cls||'')+'" width="'+size+'" height="'+size+'" src="'+
  escAttr(avatarUrl(name,size))+'" alt="" loading="lazy"/>'}
/* An item as a picture, falling back to its name when the picture cannot be
   fetched. The fallback is not politeness: an offline LAN server is a normal
   place to run this, and without it the grid is broken-image icons. */
function itemHtml(i){
 var label=itemLabel(i.id);var src=itemIconUrl(i.id);
 return '<div class="slot" title="'+escAttr(label+(i.count>1?' x'+i.count:''))+'">'+
  (src?'<img class="iicon" src="'+escAttr(src)+'" alt="" loading="lazy" '+
    'onerror="this.classList.add(\\'gone\\');this.parentNode.classList.add(\\'noimg\\')"/>':'')+
  '<span class="iname">'+esc(label)+'</span>'+
  (i.count>1?'<span class="icount">'+esc(String(i.count))+'</span>':'')+'</div>'}
function invHtml(items){
 if(!items||!items.length)return '<p class="muted">'+esc(T('profile.empty'))+'</p>';
 return '<div class="inv">'+items.map(itemHtml).join('')+'</div>'}
function profDate(ms){return ms?new Date(ms).toLocaleDateString():'—'}
/* How old this actually is, and a way to ask for something newer (#117).
   Minecraft writes a player's file on a world save or a disconnect, so an
   inventory can be minutes behind — which reads as a bug unless the page says
   so. Only the owner gets the button: the refresh asks the server to flush the
   whole world, which is a real cost, and one visitor should not be able to
   spend it on everybody's behalf. */
function invMeta(p){
 var mine=ptoken&&pname&&p.mcName&&pname.toLowerCase()===p.mcName.toLowerCase();
 return '<div class="imeta">'+
  (p.dataAt?'<span class="muted">'+esc(T('profile.asOf').replace('{when}',new Date(p.dataAt).toLocaleTimeString()))+'</span>':'')+
  (mine?'<button class="btn sm" id="invRefreshBtn" onclick="refreshInventory()">'+esc(T('profile.refresh'))+'</button>':'')+
  '</div>'}
var invBusy=false;
function refreshInventory(){
 if(invBusy)return;
 invBusy=true;
 var b=document.getElementById('invRefreshBtn');
 if(b){b.disabled=true;b.textContent=T('profile.refreshing')}
 api('/api/public/profile/refresh',{},ptoken).then(function(r){
  invBusy=false;
  if(r.s===401){staleSession();return}
  if(r.s===429){
   /* Say which limit and for how long. "Try again later" is not an answer when
      the caller can be told exactly. */
   if(b){b.disabled=false;b.textContent=T('profile.refresh')}
   var el=document.getElementById('profBox');
   var note=document.createElement('p');note.className='muted';
   note.textContent=T('profile.refreshLimited').replace('{n}',(r.j&&r.j.retryAfter)||60);
   if(el)el.appendChild(note);
   return}
  loadProfile('')})}
function statBar(cls,value,max,label,text){
 var pct=Math.max(0,Math.min(100,(value/max)*100));
 return '<div class="pbar"><div class="pbl"><span>'+esc(label)+'</span><b>'+esc(text)+'</b></div>'+
  '<div class="ptrack"><i class="'+cls+'" style="width:'+pct.toFixed(1)+'%"></i></div></div>'}
function profileHtml(p){
 /* A hero: the head large, the name and presence together. Three grey boxes
    and a list of ids was a debug view, not a profile (#116). */
 var h='<div class="phero">'+headImg(p.mcName,96,'big')+
  '<div class="pid"><h2>'+esc(p.mcName)+'</h2>'+
  '<div class="prow">'+(p.online
   ?'<span class="pdot on"></span>'+esc(T('status.online'))
   :'<span class="pdot"></span>'+esc(T('status.offline')))+'</div></div></div>'+
  '<div class="pmeta">'+
  [[T('profile.registered'),profDate(p.registeredAt)],
   [T('profile.lastSeen'),profDate(p.lastSeen)],
   [T('profile.playtime'),(typeof p.playtimeHours==='number')?(p.playtimeHours+' h'):'—']]
  .map(function(r){return '<div><span class="muted">'+esc(r[0])+'</span><b>'+esc(String(r[1]))+'</b></div>'}).join('')+
  '</div>';
 /* Health and food as bars, because they are fractions of a known maximum and
    a bare "20" says nothing about that. */
 if(p.stats){
  h+='<h3>'+esc(T('profile.stats'))+'</h3><div class="pbars">';
  if(p.stats.health!=null)h+=statBar('hp',p.stats.health,20,T('profile.health'),Math.round(p.stats.health)+' / 20');
  if(p.stats.food!=null)h+=statBar('food',p.stats.food,20,T('profile.food'),Math.round(p.stats.food)+' / 20');
  if(p.stats.xpLevel!=null)h+='<div class="pbar"><div class="pbl"><span>'+esc(T('profile.xp'))+
   '</span><b>'+esc(String(p.stats.xpLevel))+'</b></div></div>';
  h+='</div>'}
 if(p.location)h+='<h3>'+esc(T('profile.location'))+'</h3><div class="pcoords">'+
  ['X','Y','Z'].map(function(ax,n){
   var v=[p.location.x,p.location.y,p.location.z][n];
   return '<div><span class="muted">'+ax+'</span><b>'+esc(String(Math.round(v)))+'</b></div>'}).join('')+
  (p.location.dimension?'<div><span class="muted">'+esc(T('profile.dimension'))+'</span><b>'+
    esc(String(p.location.dimension).replace(/^minecraft:/,''))+'</b></div>':'')+'</div>';
 if(p.inventory)h+='<div class="ihead"><h3>'+esc(T('profile.inventory'))+'</h3>'+invMeta(p)+'</div>'+invHtml(p.inventory);
 if(p.enderChest)h+='<h3>'+esc(T('profile.enderChest'))+'</h3>'+invHtml(p.enderChest);
 /* Say what is missing and why. A profile that simply stops after the dates
    reads as broken; "the server has not published this" reads as a choice. */
 var hid=(p.hidden||[]).filter(function(k){return k!=='dates'&&k!=='playtime'&&k!=='identity'});
 if(hid.length)h+='<p class="muted phid">'+esc(T('profile.hidden'))+'</p>';
 return h}
function pageServers(){
 return '<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('servers.title'))+'</h2></div>'+
  (S.servers.length?serverGrid():'<p class="muted">'+esc(T('servers.empty'))+'</p>')+'</div></section>'}
function pageStore(){
 var h='<section class="section"><div class="wrap"><div class="section-head"><h2>'+esc(T('store.title'))+'</h2><span id="balBox"></span></div><div id="sfBox" class="muted">'+esc(T('common.loading'))+'</div></div></section>';
 setTimeout(loadStore,0);return h}
function loadStore(){
 api('/api/public/store').then(function(r){STORE=r.j;
  /* The one page that sells. The shared storefront defaults to preview, so
     this is the declaration that turns Buy back on (#102). */
  SF.mode='buy';
  SF.layout=STORE.layout||'crates-first';
  /* sfSetProducts, not an assignment: it also refreshes an open detail, which
     is where the stock and per-player numbers a failed purchase just changed
     are actually read. */
  sfSetProducts(STORE.products);
  revealAll();refreshBalance()})}
/* The hooks the shared storefront calls back into. */
function sfCurrency(){return (STORE&&STORE.currency)||''}
function sfImg(src){return src}
function sfText(k){return T(k)}
function sfBuy(pid){buy(pid)}
function refreshBalance(){var el=document.getElementById('balBox');if(!el)return;
 if(!ptoken){el.innerHTML='<button class="btn sm primary" onclick="openAuth()">'+esc(T('store.loginToBuy'))+'</button>';return}
 api('/api/public/store/balance',null,ptoken).then(function(b){if(!b.ok)return;
  el.innerHTML='<span class="pill">'+esc(T('store.balance'))+': <b style="color:var(--accent)">'+b.j.balance+' '+esc(b.j.currency||'')+'</b></span>'})}
function buy(pid){if(!ptoken){
 /* Close the product first. Both overlays are position:fixed, and the detail
    sits above the auth modal, so opening the login without this dimmed the
    screen and put the form behind the thing the visitor just clicked in. */
 sfCloseDetail();openAuth();return}
 var bought=sfFind(pid);
 api('/api/public/store/buy',{productId:pid},ptoken).then(function(r){
  if(!r.ok){
   /* In the page, not an alert(): the failure has a reason worth reading, and
      the storefront should say it in its own voice. */
   sfNotice('err',T('store.buyFailed'),
    r.j.error==='insufficient'?T('store.insufficient')
    :r.j.error==='out-of-stock'?T('store.outOfStock')
    :r.j.error==='limit-reached'?T('store.limitReached')
    :(r.j.error||String(r.s)),
    bought&&bought.icon);
   /* Somebody else may have taken the last one while this page was open. */
   loadStore();return}
  refreshBalance();sfCloseDetail();
  /* Reload so a stock count or per-player limit updates immediately rather
     than on the next visit. */
  loadStore();
  /* The animation rides on the reward: the server resolved it for this crate,
     and the buyer never has the product it came from (#75). */
  if(r.j.reward&&r.j.reward.crate){document.getElementById('crateTitle').textContent=T('crate.opening');
   /* Localised here, not only in fillAuthTexts: a visitor with a stored token
      never opens the auth modal, and would meet an English crate. */
   document.getElementById('crateOk').textContent=T('crate.ok');
   openCrate(r.j.reward,{prefix:T('crate.congrats')+': '})}
  else sfNotice('ok',T('crate.congrats'),r.j.reward?r.j.reward.name:'',r.j.reward&&r.j.reward.icon)})}
function zoom(src){document.getElementById('lbImg').src=src;document.getElementById('lightbox').classList.remove('hidden')}

/* ---------- router ---------- */
function render(){
 if(!S)return;renderChrome();applyTheme();
 var h=location.hash||'#/';var app=document.getElementById('app');
 if(h.indexOf('#/news/')===0)app.innerHTML=pagePost(decodeURIComponent(h.slice(7)));
 else if(h==='#/news')app.innerHTML=pageNews();
 else if(h==='#/store')app.innerHTML=pageStore();
 else if(h==='#/servers')app.innerHTML=pageServers();
 else if(h==='#/map'&&S.showMap)app.innerHTML=pageMap();
 else if(h.indexOf('#/player/')===0&&S.showProfiles)app.innerHTML=pageProfile(decodeURIComponent(h.slice(9)));
 else if(h==='#/profile'&&ptoken&&S.showProfiles)app.innerHTML=pageProfile('');
 else app.innerHTML=pageHome();
 /* Stop the 2s feed on the way OUT of the map. Without this a visitor who
    opened it once keeps polling for as long as the tab is open, from every
    page of the site. */
 if(h!=='#/map')mapStop();
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
 document.getElementById('forgotLink').textContent=T('auth.forgot');
 document.getElementById('crateTitle').textContent=T('crate.opening');document.getElementById('crateOk').textContent=T('crate.ok')}
function amClear(){document.getElementById('amErr').textContent='';document.getElementById('amNote').textContent=''}
function showLogin(){fillAuthTexts();AUTH_MODE='register';document.getElementById('amTitle').textContent=T('auth.login');document.getElementById('loginForm').classList.remove('hidden');document.getElementById('regForm').classList.add('hidden');amClear()}
/* The same two-step form serves registration and reset (#105): both prove the
   same claim with the same single-use code, so a second form would be a second
   place to get the code handling wrong. Only the copy differs. */
var AUTH_MODE='register';
function showReg(step){AUTH_MODE='register';showClaim(step,T('auth.register'),T('auth.registerHint'))}
function showReset(step){AUTH_MODE='reset';showClaim(step,T('auth.resetTitle'),T('auth.resetHint'))}
function showClaim(step,title,hint){fillAuthTexts();
 document.getElementById('amTitle').textContent=title;
 document.getElementById('regHint').textContent=hint;
 document.getElementById('loginForm').classList.add('hidden');document.getElementById('regForm').classList.remove('hidden');
 document.getElementById('regStep1').classList.toggle('hidden',step!==1);document.getElementById('regStep2').classList.toggle('hidden',step!==2);amClear()}
function doLogin(){api('/api/public/login',{mcName:document.getElementById('liName').value,password:document.getElementById('liPass').value}).then(function(r){
 if(!r.ok){document.getElementById('amErr').textContent=T('auth.invalid');return}
 ptoken=r.j.token;pname=r.j.mcName;localStorage.setItem('msms_ptoken',ptoken);localStorage.setItem('msms_pname',pname);closeAuth();render();if((location.hash||'#/')==='#/store')loadStore()})}
function authErr(e){return e==='not-online'?T('auth.notOnline'):e==='server-offline'?T('auth.serverOffline'):e==='rate-limited'?T('auth.rateLimited'):e==='bad-code'?T('auth.badCode'):e==='expired'?T('auth.expired'):e==='weak-password'?T('auth.weakPassword'):'Error'}
function sendCode(){amClear();
 api('/api/public/'+(AUTH_MODE==='reset'?'reset':'register')+'/start',{mcName:document.getElementById('rgName').value}).then(function(r){
  if(!r.ok||!r.j.ok){document.getElementById('amErr').textContent=authErr(r.j&&r.j.error);return}
  window._rgName=document.getElementById('rgName').value;
  /* On a cracked server nothing proves who is standing in the game as that
     name, so an operator has to agree first. Saying so beats a code that
     silently never arrives. */
  if(r.j.pending==='approval'){document.getElementById('amNote').textContent=T('auth.needsApproval');return}
  if(AUTH_MODE==='reset')showReset(2);else showReg(2)})}
function doVerify(){amClear();
 api('/api/public/'+(AUTH_MODE==='reset'?'reset':'register')+'/verify',{mcName:window._rgName,code:document.getElementById('rgCode').value,password:document.getElementById('rgPass').value}).then(function(r){
  if(!r.ok){document.getElementById('amErr').textContent=authErr(r.j.error);return}
  ptoken=r.j.token;pname=r.j.mcName;localStorage.setItem('msms_ptoken',ptoken);localStorage.setItem('msms_pname',pname);closeAuth();render();if((location.hash||'#/')==='#/store')loadStore()})}
function plogout(){api('/api/public/logout',{},ptoken);ptoken='';pname='';puuid='';
 localStorage.removeItem('msms_ptoken');localStorage.removeItem('msms_pname');localStorage.removeItem('msms_puuid');
 /* A profile page belongs to whoever was signed in, so signing out has to leave
    it rather than re-render it empty. */
 if((location.hash||'#/')==='#/profile'){location.hash='#/';return}
 render();if((location.hash||'#/')==='#/store')loadStore()}

/* ---------- crate ----------
   Was a hardcoded 5.2s reel that ignored the server's animation setting
   entirely (#75) — an operator could pick one of five and the website, the
   place most buyers actually see, played none of them. openCrate now comes
   from crateUi.ts, the same implementation the admin panel runs, and reads the
   animation the server resolved for that specific crate. */
${CRATE_JS}
${STORE_JS}
${MAP_JS}
var CRATE_ICON_SVG=${JSON.stringify(CRATE_ICON_SVG)};

loadSite();setInterval(pollStatus,15000);
</script>
</body></html>`
}
