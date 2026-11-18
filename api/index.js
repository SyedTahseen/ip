// IP info Worker  (Outrun look: globe map + fly-to animation)
//   /            -> HTML page (browsers) or plain-text IP (curl and similar)
//   /json        -> full server-side details as JSON
//   /ip          -> plain-text IP only
//   /world.json  -> country borders (Natural Earth), proxied and cached at the edge

const POLL_MS = 15000; // how often an open tab re-checks the IP (also re-checks on focus / tab switch)

const esc = (s) =>
  String(s ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function countryName(cc) {
  try { return cc ? new Intl.DisplayNames(["en"], { type: "region" }).of(cc) : null; } catch { return cc; }
}

function localTime(tz) {
  try {
    return new Date().toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "medium" });
  } catch { return null; }
}

function parseUA(ua = "") {
  let browser = "Unknown";
  if (/curl\//i.test(ua)) browser = "curl";
  else if (/Edg\//.test(ua)) browser = "Edge " + (ua.match(/Edg\/([\d.]+)/)?.[1] || "");
  else if (/OPR\//.test(ua)) browser = "Opera " + (ua.match(/OPR\/([\d.]+)/)?.[1] || "");
  else if (/Firefox\//.test(ua)) browser = "Firefox " + (ua.match(/Firefox\/([\d.]+)/)?.[1] || "");
  else if (/Chrome\//.test(ua)) browser = "Chrome " + (ua.match(/Chrome\/([\d.]+)/)?.[1] || "");
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari " + (ua.match(/Version\/([\d.]+)/)?.[1] || "");

  let os = "Unknown";
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android " + (ua.match(/Android ([\d.]+)/)?.[1] || "");
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS " + (ua.match(/OS ([\d_]+)/)?.[1] || "").replace(/_/g, ".");
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  const device = /iPad|Tablet/.test(ua) ? "Tablet" : /Mobi|iPhone|Android/.test(ua) ? "Mobile" : "Desktop";
  return { browser: browser.trim(), os: os.trim(), device };
}

function collect(request) {
  const h = request.headers;
  const dec = (v) => { if (!v) return undefined; try { return decodeURIComponent(v); } catch { return v; } };
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const ua = h.get("User-Agent") || "";
  const parsed = parseUA(ua);
  const country = h.get("x-vercel-ip-country") || undefined;
  const timezone = h.get("x-vercel-ip-timezone") || undefined;
  const EU = ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"];
  return {
    ip,
    ipVersion: ip.includes(":") ? "IPv6" : "IPv4",
    country,
    countryName: countryName(country),
    isEU: country ? EU.includes(country) : false,
    continent: h.get("x-vercel-ip-continent") || undefined,
    region: h.get("x-vercel-ip-country-region") || undefined,
    city: dec(h.get("x-vercel-ip-city")),
    postalCode: h.get("x-vercel-ip-postal-code") || undefined,
    latitude: h.get("x-vercel-ip-latitude") || undefined,
    longitude: h.get("x-vercel-ip-longitude") || undefined,
    timezone,
    localTime: timezone ? localTime(timezone) : null,
    vercelRegion: (h.get("x-vercel-id") || "").split("::")[0] || undefined,
    vercelId: h.get("x-vercel-id"),
    browser: parsed.browser,
    os: parsed.os,
    device: parsed.device,
    acceptLanguage: h.get("Accept-Language"),
    acceptEncoding: h.get("Accept-Encoding"),
    referer: h.get("Referer"),
    doNotTrack: h.get("DNT"),
    userAgent: ua,
  };
}

// ---------------------------------------------------------------------------
// Country borders for the globe. Same source the Android app bakes into world.bin
// (Natural Earth admin-0). Proxied through the Worker so the browser stays same-origin,
// and cached at Vercel's edge so GitHub is only hit rarely.
// ---------------------------------------------------------------------------
const worldSources = (s) => [
  `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_${s}m_admin_0_countries.geojson`,
  `https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_${s}m_admin_0_countries.geojson`,
];

async function worldData(scale) {
  for (const url of worldSources(scale)) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        return new Response(r.body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=604800, s-maxage=2592000",
          },
        });
      }
    } catch { /* try next source */ }
  }
  return new Response("map data unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
}

// ---------------------------------------------------------------------------
// Page: styles (colors and sizes are taken from the app's Colors.kt / Tokens.kt)
// ---------------------------------------------------------------------------
const CSS = String.raw`
:root{
  --bg:#FFFFFF;--bg-rgb:255,255,255;--card:#F5F4F2;--card-rgb:245,244,242;--control:#EAE7E4;--border:#EAE7E4;
  --scrim:rgba(23,24,28,.48);--text:#0C0C14;--text-rgb:12,12,20;--muted:#706D6B;--hint:#999693;
  --primary:#6D4AFF;--accent:#6D4AFF;--red:#CC2D4F;--green:#1C9C7C;--amber:#E65200;
  --land:#F1EEEB;--land-active:#D1CFCD;--land-line:#C2BFBC;--pin-red:#CA2D4D;--pin-green:#1A9D7C;
  --ov-red:rgba(204,45,79,.24);--ov-red-0:rgba(204,45,79,0);
  --ov-green:rgba(28,156,124,.2);--ov-green-0:rgba(28,156,124,0);
  --ov-wait:rgba(255,255,255,.5);--ov-wait-0:rgba(255,255,255,0);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#1C1B24;--bg-rgb:28,27,36;--card:#292733;--card-rgb:41,39,51;--control:#3B3747;--border:#3B3747;
  --scrim:rgba(0,0,0,.52);--text:#FFFFFF;--text-rgb:255,255,255;--muted:#A7A4B5;--hint:#6D697D;
  --accent:#8A6EFF;--red:#F08FA4;--green:#2CFFCC;--amber:#FFB84D;
  --land:#292733;--land-active:#4A4658;--land-line:#5B576B;--pin-red:#F08FA5;--pin-green:#23DEB1;
  --ov-red:rgba(240,143,164,.5);--ov-red-0:rgba(240,143,164,0);
  --ov-green:rgba(44,255,204,.5);--ov-green-0:rgba(44,255,204,0);
  color-scheme:dark;
}}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:400 16px/24px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  letter-spacing:.03em;overflow:hidden;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
button{font:inherit;letter-spacing:inherit;color:inherit}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}

#stage{position:fixed;inset:0;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
#stage:active{cursor:grabbing}
#stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#pin{pointer-events:none}

.ov{position:fixed;left:0;right:0;top:0;height:200px;pointer-events:none}
.ov i{position:absolute;inset:0;opacity:0;transition:opacity .5s}
.ov .ovr{background:linear-gradient(var(--ov-red),var(--ov-red-0))}
.ov .ovg{background:linear-gradient(var(--ov-green),var(--ov-green-0))}
.ov .ovw{background:linear-gradient(var(--ov-wait),var(--ov-wait-0))}
body[data-mode=direct] .ov .ovr,body[data-mode=vpn] .ov .ovg,body[data-mode=checking] .ov .ovw{opacity:1}

.hdr{position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;
  padding:env(safe-area-inset-top,0px) 16px 0;pointer-events:none}
.hdr-in{min-height:48px;display:flex;flex-direction:column;align-items:center;text-align:center;animation:fade .5s both}
.hdr-in>*{pointer-events:auto}
@keyframes fade{from{opacity:0}to{opacity:1}}
.ic{display:block;width:32px;height:32px;margin:8px}
.ic svg{width:32px;height:32px;display:block;fill:currentColor}
.red{color:var(--red)}.green{color:var(--green)}
.h-title{font-weight:500;padding:8px}
.chip{display:inline-block;max-width:100%;overflow-wrap:anywhere;border-radius:8px;padding:4px 8px;
  background:rgba(var(--card-rgb),.86);border:1px solid rgba(var(--text-rgb),.06)}
.chip .m,.muted{color:var(--muted)}
.h-row{display:flex;align-items:center;padding:8px}
.h-row .ic{margin:0 8px 0 0}
.h-head{font-weight:700;font-size:20px;line-height:24px;letter-spacing:.01em}
.h-card{width:100%;margin-top:8px;padding:16px;border-radius:12px;display:flex;align-items:center;gap:16px;text-align:left;
  background:rgba(var(--card-rgb),.86);border:1px solid rgba(var(--text-rgb),.06)}
.h-card .l{flex:1;min-width:0}
.h-card small{display:block;font-size:14px;line-height:20px;letter-spacing:.02em;color:var(--muted)}
.h-card b{display:block;font-size:20px;line-height:24px;letter-spacing:.01em;overflow-wrap:anywhere}
.spin{width:32px;height:32px;margin:8px;border-radius:50%;border:2px solid var(--text);border-right-color:transparent;animation:rot .9s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}

.panel{position:fixed;left:0;right:0;bottom:0;padding:68px 16px calc(16px + env(safe-area-inset-bottom,0px));
  background:linear-gradient(to bottom,rgba(var(--bg-rgb),0),var(--bg) 100px)}
.panel-in{max-width:480px;margin:0 auto}
.cap{margin:0;padding:24px 0;font-size:14px;line-height:20px;letter-spacing:.02em}
.sw{transition:opacity .15s}.sw.out{opacity:0}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
.row1{display:flex;align-items:flex-start;gap:16px;min-height:42px;cursor:pointer;border-radius:8px}
.flagbox{width:30px;height:30px;display:flex;align-items:center;justify-content:center;flex:none}
.flag{width:30px;height:20px;border-radius:4px;background:var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center}
.flag img{width:100%;height:100%;object-fit:cover;display:block}
.flag svg{width:16px;height:16px;fill:var(--muted)}
.txt{flex:1;min-width:0}
.name{font-weight:500;overflow-wrap:anywhere}
.sub{font-size:14px;line-height:20px;letter-spacing:.02em;color:var(--muted);margin-top:2px}
.chev{width:24px;height:24px;flex:none;fill:var(--muted)}
.btns{margin-top:16px;display:flex;flex-direction:column;gap:8px}
.btn{display:flex;align-items:center;justify-content:center;width:100%;height:48px;padding:0 16px;border-radius:8px;border:1px solid transparent;
  cursor:pointer;text-decoration:none;transition:background .3s,filter .15s}
.btn.primary{background:var(--primary);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.28),0 1px 2px rgba(0,0,0,.2)}
.btn.primary:hover{filter:brightness(1.08)}
.btn.outline{background:var(--card);border-color:var(--border);color:var(--text)}
.btn.outline:hover{filter:brightness(.97)}

.scrim{position:fixed;inset:0;background:var(--scrim);opacity:0;pointer-events:none;transition:opacity .3s}
.sheet{position:fixed;left:50%;bottom:0;width:100%;max-width:640px;max-height:88vh;max-height:88dvh;display:flex;flex-direction:column;
  background:var(--bg);border-radius:28px 28px 0 0;transform:translate(-50%,100%);visibility:hidden;
  transition:transform .3s cubic-bezier(.4,0,.2,1),visibility 0s .3s}
body.open .scrim{opacity:1;pointer-events:auto}
body.open .sheet{transform:translate(-50%,0);visibility:visible;transition:transform .3s cubic-bezier(.4,0,.2,1),visibility 0s}
.sh-top{display:flex;align-items:center;gap:4px;padding:16px 8px 8px 24px}
.sh-top h2{flex:1;margin:0;font-size:20px;line-height:24px;font-weight:700;letter-spacing:.01em}
.tbtn{background:none;border:0;min-height:48px;padding:0 12px;border-radius:8px;cursor:pointer;color:var(--accent);font-weight:500}
.xbtn{background:none;border:0;width:48px;height:48px;border-radius:8px;cursor:pointer;color:var(--text);display:flex;align-items:center;justify-content:center}
.xbtn svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round}
.sh-body{overflow-y:auto;padding:0 16px calc(24px + env(safe-area-inset-bottom,0px));overscroll-behavior:contain}
.note{margin:8px 0 0;font-size:14px;line-height:20px;letter-spacing:.02em;color:var(--amber)}
.sec{margin:24px 0 8px;font-size:14px;line-height:20px;font-weight:500;letter-spacing:.02em;color:var(--muted)}
.rows{margin:0;padding:0 16px;background:var(--card);border:1px solid var(--border);border-radius:12px}
.r{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:12px 0;font-size:14px;line-height:20px;letter-spacing:.02em}
.r+.r{border-top:1px solid var(--border)}
.r dt{color:var(--muted)}.r dd{margin:0;overflow-wrap:anywhere}
.links{display:flex;flex-wrap:wrap;gap:4px;margin-top:16px}
.links a{display:flex;align-items:center;min-height:48px;padding:0 12px;border-radius:8px;color:var(--accent);text-decoration:none;font-weight:500}

@media (min-width:720px){
  .panel{left:50%;right:auto;transform:translateX(-50%);width:480px;bottom:24px;padding:0 16px 16px;background:var(--bg);
    border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.18)}
  .panel-in{max-width:none}
  .cap{padding:16px 0}
  .sheet{bottom:24px;border-radius:28px}
}
@media (prefers-reduced-motion:reduce){
  *{animation-duration:.01s!important;transition-duration:.01s!important}
}
`;

// ---------------------------------------------------------------------------
// Page: client script. Written inside String.raw, so it must not contain
// backticks or ${...}. Globe math is a direct port of WorldMap.kt.
// ---------------------------------------------------------------------------
const CLIENT_JS = String.raw`
(function () {
"use strict";
var D = window.__D;
var POLL = window.__POLL;
var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
var $ = function (id) { return document.getElementById(id); };
var TAU = Math.PI * 2;
var RAD = Math.PI / 180;

/* ---------- small helpers ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function wrap(d) { while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
function smooth(x) { var t = clamp(x, 0, 1); return t * t * (3 - 2 * t); }
function decel(x) { var t = clamp(x, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); }
function rgba(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + a + ")"; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

/* FastOutSlowInEasing = cubic-bezier(0.4, 0, 0.2, 1) */
function bezier(x1, y1, x2, y2) {
  function cx(t) { return 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t; }
  function cy(t) { return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t; }
  return function (x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var lo = 0, hi = 1, t = x;
    for (var i = 0; i < 24; i++) { t = (lo + hi) / 2; if (cx(t) < x) lo = t; else hi = t; }
    return cy(t);
  };
}
var EASE = bezier(0.4, 0, 0.2, 1);

/* ---------- palette (read from CSS so light/dark follows the system) ---------- */
var PAL = {};
function hex(c) {
  c = c.trim();
  if (c.charAt(0) === "#") {
    if (c.length === 4) c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)];
  }
  return [128, 128, 128];
}
var dirty = true;
function readPalette() {
  var cs = getComputedStyle(document.documentElement);
  function g(n) { return hex(cs.getPropertyValue(n)); }
  PAL = { bg: g("--bg"), card: g("--card"), land: g("--land"), landActive: g("--land-active"), landLine: g("--land-line"),
          red: g("--red"), green: g("--green"), muted: g("--muted"), pinRed: g("--pin-red"), pinGreen: g("--pin-green") };
  dirty = true;
}
readPalette();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { readPalette(); toneNow = toneFor(mode); });

/* ---------- tweens, advanced from the main frame loop ---------- */
var tweens = {};
function tween(key, dur, ease, fn) {
  tweens[key] = { t0: null, dur: dur, ease: ease, fn: fn };
}
function stopTween(key) { delete tweens[key]; }
function stepTweens(ts) {
  for (var k in tweens) {
    var tw = tweens[k];
    if (tw.t0 === null) tw.t0 = ts;
    var p = tw.dur <= 0 ? 1 : Math.min(1, (ts - tw.t0) / tw.dur);
    tw.fn(tw.ease(p));
    dirty = true;
    if (p >= 1) delete tweens[k];
  }
}

/* ---------- geometry (port of WorldGeo.kt + GlobeGeo.kt) ---------- */
var globe = null;

function iso2(p) {
  if (p.ADM0_A3 === "KOS") return "XK";
  var keys = ["ISO_A2", "ISO_A2_EH", "WB_A2", "iso_a2", "iso_a2_eh"];
  for (var i = 0; i < keys.length; i++) {
    var v = p[keys[i]];
    if (typeof v === "string" && /^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  }
  return "--";
}

function makeRing(coords) {
  var pts = [], lx = null, ly = null, i;
  for (i = 0; i < coords.length; i++) {
    var x = Math.round(clamp(coords[i][0], -180, 180) * 100) / 100;
    var y = Math.round(clamp(coords[i][1], -90, 90) * 100) / 100;
    if (x !== lx || y !== ly) { pts.push(x, y); lx = x; ly = y; }
  }
  var n = pts.length / 2;
  if (n > 1 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) { pts.length -= 2; n--; }
  if (n < 3) return null;
  var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (i = 0; i < n; i++) {
    var px = pts[i * 2], py = pts[i * 2 + 1];
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  if (x1 - x0 < 0.04 && y1 - y0 < 0.04) return null;

  var xyz = new Float32Array(n * 3), sx = 0, sy = 0, sz = 0, area = 0;
  for (i = 0; i < n; i++) {
    var lon = pts[i * 2] * RAD, lat = pts[i * 2 + 1] * RAD;
    var X = Math.cos(lat) * Math.cos(lon), Y = Math.cos(lat) * Math.sin(lon), Z = Math.sin(lat);
    xyz[i * 3] = X; xyz[i * 3 + 1] = Y; xyz[i * 3 + 2] = Z;
    sx += X; sy += Y; sz += Z;
    var j = (i + 1) % n;
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  var ring = { xyz: xyz, n: n, ll: new Float32Array(pts), bb: [x0, x1, y0, y1], ccw: area > 0, cx: 1, cy: 0, cz: 0, radius: Math.PI };
  var len = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (len < 1e-6) return ring;
  ring.cx = sx / len; ring.cy = sy / len; ring.cz = sz / len;
  var maxAng = 0;
  for (i = 0; i < n; i++) {
    var d = clamp(xyz[i * 3] * ring.cx + xyz[i * 3 + 1] * ring.cy + xyz[i * 3 + 2] * ring.cz, -1, 1);
    var a = Math.acos(d);
    if (a > maxAng) maxAng = a;
  }
  ring.radius = maxAng + 0.002;
  return ring;
}

function buildGlobe(gj) {
  var out = [], feats = gj.features || [];
  for (var f = 0; f < feats.length; f++) {
    var p = feats[f].properties || {}, g = feats[f].geometry;
    var code = iso2(p);
    if (!g || code === "AQ" || p.ADM0_A3 === "ATA") continue;
    var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    var rings = [];
    for (var a = 0; a < polys.length; a++)
      for (var b = 0; b < polys[a].length; b++) {
        var r = makeRing(polys[a][b]);
        if (r) rings.push(r);
      }
    if (rings.length) out.push({ code: code, rings: rings });
  }
  return out;
}

function inRing(ll, lon, lat) {
  var inside = false, j = ll.length - 2;
  for (var i = 0; i < ll.length; i += 2) {
    var xi = ll[i], yi = ll[i + 1], xj = ll[j], yj = ll[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}
function codeAt(lon, lat) {
  if (!globe) return null;
  for (var i = 0; i < globe.length; i++) {
    var c = globe[i];
    if (c.code === "--") continue;
    var inside = false;
    for (var k = 0; k < c.rings.length; k++) {
      var r = c.rings[k];
      if (lon < r.bb[0] || lon > r.bb[1] || lat < r.bb[2] || lat > r.bb[3]) continue;
      if (inRing(r.ll, lon, lat)) inside = !inside;
    }
    if (inside) return c.code;
  }
  return null;
}
function centerOf(code) {
  if (!globe) return null;
  for (var i = 0; i < globe.length; i++) {
    if (globe[i].code !== code) continue;
    var best = null;
    for (var k = 0; k < globe[i].rings.length; k++) if (!best || globe[i].rings[k].n > best.n) best = globe[i].rings[k];
    if (!best) return null;
    return { lon: (best.bb[0] + best.bb[1]) / 2, lat: (best.bb[2] + best.bb[3]) / 2 };
  }
  return null;
}

/* ---------- ring -> screen path with horizon clipping (port of addRing / addArc) ---------- */
var sc = {
  xs: new Float32Array(2048), ys: new Float32Array(2048), n: 0,
  rr: new Float32Array(1024), uu: new Float32Array(1024), dd: new Float32Array(1024),
  add: function (x, y) {
    if (this.n === this.xs.length) {
      var nx = new Float32Array(this.n * 2), ny = new Float32Array(this.n * 2);
      nx.set(this.xs); ny.set(this.ys); this.xs = nx; this.ys = ny;
    }
    this.xs[this.n] = x; this.ys[this.n] = y; this.n++;
  },
  ensure: function (m) {
    if (this.rr.length < m) { this.rr = new Float32Array(m * 2); this.uu = new Float32Array(m * 2); this.dd = new Float32Array(m * 2); }
  }
};
function addArc(from, to, ccw, cx, cy, r) {
  var sweep = ccw ? to - from : from - to;
  sweep %= TAU;
  if (sweep < 0) sweep += TAU;
  if (sweep > TAU - 0.02) sweep = 0;
  var signed = ccw ? sweep : -sweep;
  var steps = Math.ceil(sweep / 0.0873);
  for (var i = 1; i < steps; i++) {
    var a = from + signed * i / steps;
    sc.add(cx + r * Math.cos(a), cy - r * Math.sin(a));
  }
}
function addRing(path, ring, step, cl, sl, cp, sp, cx, cy, r) {
  var n = ring.n, st = n < 16 ? 1 : step, m = ((n + st - 1) / st) | 0;
  if (m < 3) return false;
  sc.ensure(m);
  var rr = sc.rr, uu = sc.uu, dd = sc.dd, xyz = ring.xyz, first = -1, j, i;
  for (j = 0; j < m; j++) {
    i = j * st * 3;
    var x = xyz[i], y = xyz[i + 1], z = xyz[i + 2];
    var a = x * cl + y * sl;
    rr[j] = -x * sl + y * cl;
    dd[j] = a * cp + z * sp;
    uu[j] = -a * sp + z * cp;
    if (first < 0 && dd[j] > 0) first = j;
  }
  if (first < 0) return false;
  sc.n = 0;
  sc.add(cx + r * rr[first], cy - r * uu[first]);
  var exitA = 0;
  for (var k = 1; k <= m; k++) {
    j = (first + k) % m;
    var p = (first + k - 1) % m;
    var visP = dd[p] > 0, visJ = dd[j] > 0;
    if (visP && visJ) {
      if (k < m) sc.add(cx + r * rr[j], cy - r * uu[j]);
    } else if (visP || visJ) {
      var t = dd[p] / (dd[p] - dd[j]);
      var xr = rr[p] + t * (rr[j] - rr[p]);
      var xu = uu[p] + t * (uu[j] - uu[p]);
      var len = Math.hypot(xr, xu);
      if (len > 1e-6) { xr /= len; xu /= len; }
      if (visP) {
        sc.add(cx + r * xr, cy - r * xu);
        exitA = Math.atan2(xu, xr);
      } else {
        addArc(exitA, Math.atan2(xu, xr), ring.ccw, cx, cy, r);
        sc.add(cx + r * xr, cy - r * xu);
        if (k < m) sc.add(cx + r * rr[j], cy - r * uu[j]);
      }
    }
  }
  if (sc.n < 3) return false;
  path.moveTo(sc.xs[0], sc.ys[0]);
  for (var q = 1; q < sc.n; q++) path.lineTo(sc.xs[q], sc.ys[q]);
  path.closePath();
  return true;
}

/* ---------- camera state (port of WorldMap.kt) ---------- */
var VIEW_DEG = 30, R_DEFAULT = (180 / Math.PI) / VIEW_DEG, ZOOM_MIN = 0.2, ZOOM_MAX = 6;
var CENTER_Y = 0.46;
var from = { lon: 103.8, lat: 1.3 }, to = { lon: 103.8, lat: 1.3 };
var prog = 1, zoom = 1, offLon = 0, offLat = 0;
var oldCode = null, newCode = null;
var hasLoc = false;
var pinT0 = performance.now();

var W = 0, H = 0, BW = 0, DPR = 1;
var mapCv = $("map"), pinCv = $("pin"), mctx = mapCv.getContext("2d"), pctx = pinCv.getContext("2d");

function resize() {
  var r = $("stage").getBoundingClientRect();
  W = r.width; H = r.height; BW = Math.min(W, 560);
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  [mapCv, pinCv].forEach(function (c) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
  dirty = true; pinBox = null;
}
if (window.ResizeObserver) new ResizeObserver(resize).observe($("stage")); else addEventListener("resize", resize);
resize();

function camera() {
  var t = prog;
  var dLon = wrap(to.lon - from.lon), dLat = to.lat - from.lat;
  var mLon = from.lon + dLon * t, mLat = from.lat + dLat * t;
  var dist = Math.hypot(Math.abs(dLon), Math.abs(dLat));
  var dip = Math.min(dist / 100, 0.3);
  var z = zoom * (1 - dip * Math.sin(Math.PI * t));
  var r = BW * R_DEFAULT * z;
  var space = smooth((1.15 * BW - r) / (0.6 * BW));
  return { vLon: mLon + offLon, vLat: clamp(mLat + offLat, -85, 85), mLon: mLon, mLat: mLat, r: r, space: space };
}

function normCode(c) {
  c = c && String(c).trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}

function setTarget(lon, lat, code) {
  var act = normCode(code) || codeAt(lon, lat);
  if (hasLoc && to.lon === lon && to.lat === lat && act === newCode) return;
  oldCode = newCode; newCode = act;
  var t = prog;
  from = { lon: from.lon + wrap(to.lon - from.lon) * t, lat: from.lat + (to.lat - from.lat) * t };
  to = { lon: lon, lat: lat };
  hasLoc = true;
  if (offLon !== 0 || offLat !== 0) {
    var l0 = offLon, a0 = offLat;
    tween("off", reduced ? 1 : 2000, EASE, function (v) { offLon = l0 * (1 - v); offLat = a0 * (1 - v); });
  }
  prog = 0;
  tween("fly", reduced ? 1 : 2000, EASE, function (v) { prog = v; });
  pinT0 = performance.now();
}

/* ---------- drawing ---------- */
var stars = (function () {
  var s = 11, out = [];
  function rnd() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }
  for (var i = 0; i < 70; i++) out.push([rnd(), rnd(), 0.5 + rnd() * 1.1, 0.25 + rnd() * 0.55]);
  return out;
})();

var toneNow = [0, 0, 0];

function drawMap() {
  var ctx = mctx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  var cam = camera(), cx = W / 2, cy = H * CENTER_Y, r = cam.r, space = cam.space, dot = toneNow, g, i;

  if (space > 0) {
    for (i = 0; i < stars.length; i++) {
      ctx.fillStyle = "rgba(255,255,255," + (stars[i][3] * space) + ")";
      ctx.beginPath(); ctx.arc(stars[i][0] * W, stars[i][1] * H, stars[i][2], 0, TAU); ctx.fill();
    }
    var outer = r * 1.2;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
    g.addColorStop(0, rgba(dot, 0));
    g.addColorStop(r / outer, rgba(dot, 0.32 * space));
    g.addColorStop(1, rgba(dot, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, outer, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba(mix(PAL.bg, PAL.card, 0.9), space);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  }

  if (globe) {
    var t = prog, fadeOut = clamp(1 - t * 2, 0, 1), fadeIn = clamp((t - 0.5) * 2, 0, 1);
    var lonR = cam.vLon * RAD, latR = cam.vLat * RAD;
    var cl = Math.cos(lonR), sl = Math.sin(lonR), cp = Math.cos(latR), sp = Math.sin(latR);
    var vx = cp * cl, vy = cp * sl, vz = sp;
    var maxD = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    var visAng = maxD >= r ? Math.PI / 2 : Math.asin(maxD / r);
    var ppd = r * RAD;
    var step = ppd < 3 ? 4 : ppd < 6 ? 3 : ppd < 12 ? 2 : 1;

    var base = new Path2D(), lit = [];
    for (i = 0; i < globe.length; i++) {
      var gc = globe[i], l = 0;
      if (gc.code !== "--") {
        if (gc.code === newCode && gc.code === oldCode) l = 1;
        else if (gc.code === newCode) l = fadeIn;
        else if (gc.code === oldCode) l = fadeOut;
      }
      var path = l > 0 ? new Path2D() : base, any = false;
      for (var k = 0; k < gc.rings.length; k++) {
        var ring = gc.rings[k];
        if (ring.radius * r < 0.35 && l === 0) continue;
        var cosT = clamp(ring.cx * vx + ring.cy * vy + ring.cz * vz, -1, 1);
        if (Math.acos(cosT) - ring.radius > visAng) continue;
        if (addRing(path, ring, step, cl, sl, cp, sp, cx, cy, r)) any = true;
      }
      if (any && l > 0) lit.push([path, l]);
    }
    ctx.fillStyle = rgba(PAL.land, 1);
    ctx.fill(base, "evenodd");
    for (i = 0; i < lit.length; i++) {
      ctx.fillStyle = rgba(mix(PAL.land, PAL.landActive, lit[i][1]), 1);
      ctx.fill(lit[i][0], "evenodd");
    }
    ctx.lineWidth = 0.8; ctx.lineJoin = "round"; ctx.strokeStyle = rgba(PAL.landLine, 1);
    ctx.stroke(base);
    for (i = 0; i < lit.length; i++) ctx.stroke(lit[i][0]);
  }

  if (space > 0) {
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(PAL.bg, 0));
    g.addColorStop(0.65, rgba(PAL.bg, 0));
    g.addColorStop(1, rgba(PAL.bg, 0.55 * space));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(dot, 0.45 * space);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  }
}

/* map pin: pulsing ring + white dot, same timings as the app */
var pinBox = null;
function drawPin(now) {
  var ctx = pctx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (pinBox) { ctx.clearRect(pinBox[0], pinBox[1], pinBox[2], pinBox[3]); pinBox = null; }
  if (!hasLoc) return;
  var cam = camera();
  var lonR = cam.vLon * RAD, latR = cam.vLat * RAD;
  var mLon = cam.mLon * RAD, mLat = clamp(cam.mLat, -85, 85) * RAD;
  var x = Math.cos(mLat) * Math.cos(mLon), y = Math.cos(mLat) * Math.sin(mLon), z = Math.sin(mLat);
  var a = x * Math.cos(lonR) + y * Math.sin(lonR);
  var east = -x * Math.sin(lonR) + y * Math.cos(lonR);
  var depth = a * Math.cos(latR) + z * Math.sin(latR);
  var north = -a * Math.sin(latR) + z * Math.cos(latR);
  if (depth <= 0.02) return;
  var cx = W / 2 + cam.r * east, cy = H * CENTER_Y - cam.r * north;
  var animS = (now - pinT0) / 1000, showAnim = !reduced;
  var fullR = 48, smallR = 32, innerR = 12;
  var pin = mode === "vpn" ? "connected" : mode === "checking" ? "connecting" : "selected";

  if (pin !== "connecting") {
    var outerR;
    if (!showAnim) outerR = fullR;
    else {
      var delay = pin === "connected" ? 0 : 0.7;
      if (animS < delay) outerR = null;
      else {
        var st = animS - delay;
        if (st < 1) outerR = fullR * decel(st);
        else {
          var ps = (st - 1) % 3, half = 1.5;
          var f = ps > half ? decel((ps - half) / half) : 1 - decel(ps / half);
          outerR = smallR + (fullR - smallR) * f;
        }
      }
    }
    if (outerR != null && outerR > 0) {
      var col = pin === "connected" ? PAL.pinGreen : PAL.pinRed;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
      g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.43, rgba(col, 0)); g.addColorStop(1, rgba(col, 0.498));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, outerR, 0, TAU); ctx.fill();
    }
  }
  var r0;
  if (!showAnim || pin === "connected") r0 = innerR;
  else if (animS < 0.2) r0 = null;
  else { var s2 = animS - 0.2; r0 = s2 < 0.4 ? innerR * decel(s2 / 0.4) : innerR; }
  if (r0 != null && r0 > 0) {
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, r0, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba(toneNow, 1); ctx.beginPath(); ctx.arc(cx, cy, r0 / 2, 0, TAU); ctx.fill();
  }
  pinBox = [cx - fullR - 2, cy - fullR - 2, fullR * 2 + 4, fullR * 2 + 4];
}

function frame(ts) {
  stepTweens(ts);
  if (dirty) { dirty = false; drawMap(); }
  drawPin(performance.now());
  requestAnimationFrame(frame);
}

/* ---------- gestures: drag to pan, pinch / wheel to zoom, double tap to reset ---------- */
var stage = $("stage"), ptrs = {}, lastTap = null;
function ptrList() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
function centroid(l) {
  var x = 0, y = 0; l.forEach(function (p) { x += p.x; y += p.y; });
  return { x: x / l.length, y: y / l.length };
}
function spread(l) { return l.length < 2 ? 0 : Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y); }
function applyGesture(px, py, gz) {
  var r = BW * R_DEFAULT * zoom;
  var lat = clamp(to.lat + offLat, -85, 85);
  var cosLat = Math.max(0.15, Math.cos(lat * RAD));
  offLon = wrap(offLon - (px / (r * cosLat)) / RAD);
  offLat = clamp(offLat + (py / r) / RAD, -85 - to.lat, 85 - to.lat);
  zoom = clamp(zoom * gz, ZOOM_MIN, ZOOM_MAX);
  dirty = true;
}
stage.addEventListener("pointerdown", function (e) {
  stage.setPointerCapture(e.pointerId);
  ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() };
  stopTween("off"); stopTween("reset");
});
stage.addEventListener("pointermove", function (e) {
  var p = ptrs[e.pointerId];
  if (!p) return;
  var before = ptrList(), c0 = centroid(before), s0 = spread(before);
  p.x = e.clientX; p.y = e.clientY;
  var after = ptrList(), c1 = centroid(after), s1 = spread(after);
  applyGesture(c1.x - c0.x, c1.y - c0.y, s0 > 0 && s1 > 0 ? s1 / s0 : 1);
});
function endPtr(e) {
  var p = ptrs[e.pointerId];
  if (!p) return;
  delete ptrs[e.pointerId];
  var now = performance.now();
  if (e.type === "pointerup" && Math.hypot(p.x - p.x0, p.y - p.y0) < 10 && now - p.t0 < 300) {
    if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) { resetView(); lastTap = null; }
    else lastTap = { t: now, x: p.x, y: p.y };
  }
}
stage.addEventListener("pointerup", endPtr);
stage.addEventListener("pointercancel", endPtr);
stage.addEventListener("wheel", function (e) {
  e.preventDefault();
  stopTween("reset");
  zoom = clamp(zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), ZOOM_MIN, ZOOM_MAX);
  dirty = true;
}, { passive: false });
function resetView() {
  var z0 = zoom, l0 = offLon, a0 = offLat;
  stopTween("off");
  tween("reset", reduced ? 1 : 600, EASE, function (v) { zoom = z0 + (1 - z0) * v; offLon = l0 * (1 - v); offLat = a0 * (1 - v); });
}
stage.addEventListener("dblclick", resetView);

/* ---------- UI state ---------- */
var ICON = {
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M17.7137,7.7143C17.7137,7.6904 17.7136,7.6666 17.7133,7.6429C17.675,4.5199 15.1315,2 11.9994,2C8.8674,2 6.3239,4.5199 6.2856,7.6429C6.2853,7.6666 6.2852,7.6904 6.2852,7.7143V7.7417C5.7247,7.7759 5.3271,7.8529 4.9878,8.0258C4.4502,8.2997 4.0131,8.7368 3.7391,9.2744C3.4277,9.8856 3.4277,10.6856 3.4277,12.2858V17.4286C3.4277,19.0288 3.4277,19.8289 3.7391,20.44C4.0131,20.9776 4.4502,21.4147 4.9878,21.6887C5.5989,22.0001 6.399,22.0001 7.9992,22.0001H15.9992C17.5993,22.0001 18.3994,22.0001 19.0106,21.6887C19.5482,21.4147 19.9853,20.9776 20.2592,20.44C20.5706,19.8289 20.5706,19.0288 20.5706,17.4286V12.2858C20.5706,10.6856 20.5706,9.8856 20.2592,9.2744C19.9853,8.7368 19.5482,8.2997 19.0106,8.0258C18.6713,7.8529 18.2739,7.776 17.7137,7.7418V7.7143ZM11.9994,3.5C9.6958,3.5 7.8239,5.3483 7.7857,7.6429H16.2131C16.175,5.3483 14.3031,3.5 11.9994,3.5ZM12.6732,14.6894C13.1232,14.4489 13.4294,13.9745 13.4294,13.4286C13.4294,12.6396 12.7898,12 12.0008,12C11.2119,12 10.5723,12.6396 10.5723,13.4286C10.5723,13.9745 10.8785,14.4489 11.3285,14.6894L10.7054,17.1818C10.6378,17.4523 10.8424,17.7143 11.1212,17.7143H12.8805C13.1593,17.7143 13.3639,17.4523 13.2963,17.1818L12.6732,14.6894Z"/></svg>',
  lockOpen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M6,1.5a6,6 0,0 0,-6 6v0.75a0.75,0.75 0,0 0,1.5 0L1.5,7.5a4.5,4.5 0,0 1,9 0c-1.483,0.001 -2.26,0.02 -2.862,0.327a3,3 0,0 0,-1.311 1.311C6,9.78 6,10.62 6,12.3v5.4c0,1.68 0,2.52 0.327,3.162a3,3 0,0 0,1.311 1.311c0.642,0.327 1.482,0.327 3.162,0.327h8.4c1.68,0 2.52,0 3.162,-0.327a3,3 0,0 0,1.311 -1.311C24,20.22 24,19.38 24,17.7v-5.4c0,-1.68 0,-2.52 -0.327,-3.162a3,3 0,0 0,-1.311 -1.311C21.72,7.5 20.88,7.5 19.2,7.5L12,7.5a6,6 0,0 0,-6 -6ZM15.706,14.824a1.5,1.5 0,1 0,-1.412 0l-0.654,2.617a0.45,0.45 0,0 0,0.436 0.559h1.848a0.45,0.45 0,0 0,0.436 -0.56l-0.654,-2.616Z"/></svg>',
  earth: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12,22C17.5228,22 22,17.5228 22,12C22,6.4771 17.5228,2 12,2C6.4771,2 2,6.4771 2,12C2,17.5228 6.4771,22 12,22ZM12,3.5C16.6944,3.5 20.5,7.3056 20.5,12C20.5,16.6944 16.6944,20.5 12,20.5C7.3056,20.5 3.5,16.6944 3.5,12C3.5,7.3056 7.3056,3.5 12,3.5Z"/></svg>'
};

var mode = "direct", prevMode = "direct", scrambleTimer = null;

function uniq(a) { return a.filter(Boolean).filter(function (x, i, arr) { return i === 0 || String(x).toLowerCase() !== String(arr[i - 1]).toLowerCase(); }); }
function placeName() { return D.city || D.countryName || D.country || "Unknown location"; }
function subText() {
  var s = uniq([D.city, D.region, D.countryName || D.country]).join(", ");
  return s || "Location unknown";
}
function tzOffset(tz) {
  try {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date());
    for (var i = 0; i < parts.length; i++) if (parts[i].type === "timeZoneName") return parts[i].value;
  } catch (e) {}
  return null;
}
var browserTz = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ""; } })();
function tzMismatch() {
  if (!D.timezone || !browserTz) return false;
  if (D.timezone === browserTz) return false;
  var a = tzOffset(D.timezone), b = tzOffset(browserTz);
  return a && b ? a !== b : true;
}
function computeMode() { return tzMismatch() ? "vpn" : "direct"; }

function toneFor(m) { return m === "vpn" ? PAL.green : m === "checking" ? PAL.muted : PAL.red; }
toneNow = toneFor(mode);
function animateTone(m) {
  var a = toneNow, b = toneFor(m);
  tween("tone", reduced ? 1 : 600, EASE, function (v) { toneNow = mix(a, b, v); });
}

function swap(el, text) {
  if (el.textContent === text) return;
  if (reduced) { el.textContent = text; return; }
  el.classList.add("out");
  setTimeout(function () { el.textContent = text; el.classList.remove("out"); }, 150);
}

function chipHtml(place, ip) {
  return '<span class="chip"><span class="c-t">' + esc(place) + '</span><span class="m c-m"> \u00b7 ' + esc(ip) + '</span></span>';
}
function headerHtml(m) {
  if (m === "checking")
    return '<div class="spin" role="status" aria-label="Checking"></div><div class="h-title">Checking your connection</div>' + chipHtml(placeName(), D.ip);
  if (m === "vpn") {
    var rtt = D.tcpRttMs != null ? '<div><small>Latency</small><b>' + esc(D.tcpRttMs) + ' ms</b></div>' : "";
    return '<div class="h-row"><span class="ic green">' + ICON.lock + '</span><span class="h-head green">VPN or proxy likely</span></div>' +
      '<div class="h-card"><div class="l"><small>Appearing from</small><b>' + esc(uniq([D.city, D.countryName || D.country]).join(", ") || "Unknown") + '</b></div>' + rtt + '</div>';
  }
  return '<span class="ic red">' + ICON.lockOpen + '</span><div class="h-title">Direct connection</div>' + chipHtml(placeName(), D.ip);
}
function captionFor(m) {
  return m === "vpn" ? "Appearing to browse from" : m === "checking" ? "Checking\u2026" : "Your public " + D.ipVersion + " address";
}

function renderHeader() {
  var h = $("hdr");
  var el = document.createElement("div");
  el.className = "hdr-in";
  el.innerHTML = headerHtml(mode);
  if (mode === "direct" && !h.firstChild) el.style.animation = "none";
  h.innerHTML = "";
  h.appendChild(el);
  if (mode === "checking") startScramble();
}

function startScramble() {
  clearInterval(scrambleTimer);
  var t = $("hdr").querySelector(".c-t"), m = $("hdr").querySelector(".c-m");
  if (!t || reduced) return;
  var place = placeName(), text = place + " \u00b7 " + D.ip, chars = text.split("");
  var order = [];
  for (var i = 0; i < text.length; i++) if (text[i] !== "." && text[i] !== " " && text[i] !== "-" && text[i] !== "\u00b7") order.push(i);
  for (var j = order.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)), tmp = order[j]; order[j] = order[k]; order[k] = tmp; }
  var n = 0;
  scrambleTimer = setInterval(function () {
    if (n >= order.length) { clearInterval(scrambleTimer); return; }
    chars[order[n++]] = "*";
    var s = chars.join("");
    t.textContent = s.slice(0, place.length);
    m.textContent = s.slice(place.length);
  }, 50);
}

function setMode(m) {
  if (m === mode && $("hdr").firstChild) return;
  if (mode !== "checking") prevMode = mode;
  mode = m;
  document.body.setAttribute("data-mode", m);
  animateTone(m);
  pinT0 = performance.now();
  renderHeader();
  swap($("cap"), captionFor(m));
  dirty = true;
}

function setFlag(cc) {
  var box = $("flag");
  box.innerHTML = "";
  cc = normCode(cc);
  if (!cc) { box.innerHTML = ICON.earth; return; }
  var img = new Image();
  img.alt = ""; img.width = 40; img.height = 27;
  img.src = "https://flagcdn.com/w40/" + cc.toLowerCase() + ".png";
  img.srcset = "https://flagcdn.com/w80/" + cc.toLowerCase() + ".png 2x";
  img.onerror = function () { box.innerHTML = ICON.earth; };
  box.appendChild(img);
}

function renderInfo() {
  swap($("ipName"), D.ip);
  swap($("ipSub"), subText());
  setFlag(D.country);
  document.title = "Your IP address: " + D.ip;
  stage.setAttribute("aria-label", "Map showing the approximate location of " + D.ip + ": " + subText());
  if (mode !== "checking") {
    var t = $("hdr").querySelector(".c-t"), m = $("hdr").querySelector(".c-m");
    if (t && m) { t.textContent = placeName(); m.textContent = " \u00b7 " + D.ip; }
  }
  if (sheetOpen) renderSheet();
}

/* ---------- details sheet ---------- */
var sheetOpen = false, lastFocus = null;
function val(v) { return v === undefined || v === null || v === "" ? "\u2014" : String(v); }
function localTimeThere() {
  try { return new Date().toLocaleString("en-GB", { timeZone: D.timezone, dateStyle: "medium", timeStyle: "medium" }); } catch (e) { return D.localTime; }
}
function sections() {
  var conn = navigator.connection || {};
  var place = uniq([D.city, D.region, D.countryName || D.country]).join(", ");
  return [
    ["Location", [
      ["Place", place || null], ["Continent", D.continent], ["Region code", D.region], ["Postal code", D.postalCode],
      ["In the EU", D.country ? (D.isEU ? "Yes" : "No") : null],
      ["Coordinates", D.latitude && D.longitude ? D.latitude + ", " + D.longitude : null],
      ["Time zone", D.timezone], ["Time there", D.timezone ? localTimeThere() : null]]],
    ["Network", [
      ["IP version", D.ipVersion]]],
    ["Connection", [
      ["Edge region", D.vercelRegion], ["Request ID", D.vercelId]]],
    ["Browser and device", [
      ["Browser", D.browser], ["System", D.os], ["Device type", D.device], ["Languages", D.acceptLanguage],
      ["Do Not Track", D.doNotTrack === "1" ? "On" : D.doNotTrack === "0" ? "Off" : null], ["Referrer", D.referer]]],
    ["This device", [
      ["Screen", screen.width + " \u00d7 " + screen.height], ["Window", innerWidth + " \u00d7 " + innerHeight],
      ["Pixel ratio", String(devicePixelRatio)],
      ["Language", (navigator.languages && navigator.languages.join(", ")) || navigator.language],
      ["Time zone", browserTz], ["Local time", new Date().toLocaleString()],
      ["CPU cores", navigator.hardwareConcurrency], ["Memory", navigator.deviceMemory ? navigator.deviceMemory + " GB or more" : null],
      ["Touch points", navigator.maxTouchPoints],
      ["Connection", conn.effectiveType ? conn.effectiveType + (conn.downlink ? ", about " + conn.downlink + " Mbps" : "") : null],
      ["Data saver", conn.saveData ? "On" : conn.saveData === false ? "Off" : null],
      ["Online", navigator.onLine ? "Yes" : "No"], ["Cookies", navigator.cookieEnabled ? "Enabled" : "Disabled"],
      ["Color scheme", matchMedia("(prefers-color-scheme: dark)").matches ? "Dark" : "Light"],
      ["Reduced motion", reduced ? "On" : "Off"]]]
  ];
}
function renderSheet() {
  var html = "";
  if (tzMismatch())
    html += '<p class="note">Your device time zone (' + esc(browserTz) + ') differs from the one your IP address suggests (' + esc(D.timezone) +
      '). This can happen with a VPN or proxy.</p>';
  sections().forEach(function (s) {
    html += '<h3 class="sec">' + esc(s[0]) + '</h3><dl class="rows">';
    s[1].forEach(function (r) { html += '<div class="r"><dt>' + esc(r[0]) + '</dt><dd>' + esc(val(r[1])) + '</dd></div>'; });
    html += '</dl>';
  });
  html += '<div class="links"><a href="/json">View as JSON</a>';
  if (D.latitude && D.longitude)
    html += '<a href="https://www.openstreetmap.org/?mlat=' + encodeURIComponent(D.latitude) + '&amp;mlon=' + encodeURIComponent(D.longitude) +
      '#map=10/' + encodeURIComponent(D.latitude) + '/' + encodeURIComponent(D.longitude) + '" target="_blank" rel="noopener">Open in OpenStreetMap</a>';
  html += '</div>';
  $("shBody").innerHTML = html;
}
function openSheet() {
  if (sheetOpen) return;
  sheetOpen = true; lastFocus = document.activeElement;
  renderSheet();
  $("sheet").removeAttribute("inert"); $("panel").setAttribute("inert", ""); $("hdr").setAttribute("inert", "");
  document.body.classList.add("open");
  $("shClose").focus({ preventScroll: true });
}
function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  document.body.classList.remove("open");
  $("sheet").setAttribute("inert", ""); $("panel").removeAttribute("inert"); $("hdr").removeAttribute("inert");
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
$("sheet").setAttribute("inert", "");
$("scrim").addEventListener("click", closeSheet);
$("shClose").addEventListener("click", closeSheet);
$("more").addEventListener("click", openSheet);
$("row1").addEventListener("click", openSheet);
$("row1").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(); } });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

/* ---------- copy ---------- */
var copyTimer = null;
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
  return Promise.resolve((function () {
    try {
      var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e) { return false; }
  })());
}
$("copy").addEventListener("click", function () {
  var b = $("copyLbl");
  copyText(D.ip).then(function (ok) {
    b.textContent = ok ? "Copied" : "Copy failed";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(function () { b.textContent = "Copy IP address"; }, 1500);
  });
});

/* ---------- live updates: re-check the IP and fly the globe when it changes ---------- */
var busy = false;
function fetchInfo() {
  return fetch("/json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); });
}
function applyInfo(d) {
  D = d;
  var lat = parseFloat(d.latitude), lon = parseFloat(d.longitude);
  if (isFinite(lat) && isFinite(lon)) {
    setTarget(lon, lat, d.country);
    try { localStorage.setItem("ipinfo:last", JSON.stringify({ lon: lon, lat: lat })); } catch (e) {}
  } else {
    var cc = normCode(d.country), c = cc && centerOf(cc);
    if (c) setTarget(c.lon, c.lat, cc);
  }
  setMode(computeMode());
  renderInfo();
}
function refresh(manual) {
  if (busy) return;
  busy = true;
  if (manual) setMode("checking");
  var t0 = Date.now();
  fetchInfo().then(function (d) {
    setTimeout(function () { busy = false; applyInfo(d); }, manual ? Math.max(0, 1200 - (Date.now() - t0)) : 0);
  }).catch(function () {
    busy = false;
    if (manual) setMode(prevMode);
  });
}
$("refresh").addEventListener("click", function () { closeSheet(); refresh(true); });
setInterval(function () { if (!document.hidden) refresh(false); }, POLL);
document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(false); });
addEventListener("focus", function () { refresh(false); });
addEventListener("online", function () { refresh(false); });

/* ---------- boot ---------- */
(function boot() {
  // Start where the last visit ended so a changed location flies from the old spot.
  // First visit: start from a default spot so there is a short intro fly-in.
  var s = null;
  try { s = JSON.parse(localStorage.getItem("ipinfo:last") || "null"); } catch (e) {}
  var lat = parseFloat(D.latitude), lon = parseFloat(D.longitude);
  if (s && isFinite(s.lon) && isFinite(s.lat)) { from = { lon: s.lon, lat: s.lat }; to = { lon: s.lon, lat: s.lat }; hasLoc = true; newCode = null; }
  else if (isFinite(lat) && isFinite(lon)) {
    var near = Math.abs(wrap(lon - 103.8)) < 8 && Math.abs(lat - 1.3) < 8;
    from = near ? { lon: -40, lat: 30 } : { lon: 103.8, lat: 1.3 }; to = { lon: from.lon, lat: from.lat }; hasLoc = true;
  }
  mode = computeMode();
  document.body.setAttribute("data-mode", mode);
  toneNow = toneFor(mode);
  renderHeader();
  $("cap").textContent = captionFor(mode);
  renderInfo();
  if (isFinite(lat) && isFinite(lon)) {
    if (s && Math.abs(s.lon - lon) < 1e-6 && Math.abs(s.lat - lat) < 1e-6) { newCode = normCode(D.country); }
    else setTarget(lon, lat, D.country);
    try { localStorage.setItem("ipinfo:last", JSON.stringify({ lon: lon, lat: lat })); } catch (e) {}
  } else if (normCode(D.country)) { newCode = normCode(D.country); }
  requestAnimationFrame(frame);

  function load(scale) {
    return fetch("/world.json?s=" + scale).then(function (r) { if (!r.ok) throw new Error("map"); return r.json(); }).then(function (gj) {
      globe = buildGlobe(gj);
      if (!newCode && hasLoc) newCode = codeAt(to.lon, to.lat);
      if (!isFinite(lat) && normCode(D.country)) { var c = centerOf(normCode(D.country)); if (c) setTarget(c.lon, c.lat, D.country); }
      dirty = true;
    });
  }
  load(110).catch(function () {}).then(function () { return load(50); }).catch(function () {});
})();
})();
`;

function page(d) {
  const json = JSON.stringify(d).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1C1B24">
<title>Your IP address: ${esc(d.ip)}</title>
<style>${CSS}</style>
</head>
<body data-mode="direct">
<div id="stage" role="img" aria-label="Map showing the approximate location of your IP address">
  <canvas id="map"></canvas>
  <canvas id="pin"></canvas>
</div>
<div class="ov" aria-hidden="true"><i class="ovr"></i><i class="ovg"></i><i class="ovw"></i></div>
<header class="hdr" id="hdr" aria-live="polite"></header>

<section class="panel" id="panel">
  <div class="panel-in">
    <p class="cap sw" id="cap">Your public ${esc(d.ipVersion)} address</p>
    <div class="card">
      <div class="row1" id="row1" role="button" tabindex="0" aria-label="Show all details">
        <div class="flagbox"><div class="flag" id="flag"></div></div>
        <div class="txt">
          <div class="name sw" id="ipName">${esc(d.ip)}</div>
          <div class="sub sw" id="ipSub"></div>
        </div>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5119,16.5694C18.8264,16.839 19.2999,16.8026 19.5694,16.4881C19.839,16.1736 19.8026,15.7001 19.4881,15.4306L18.5119,16.5694ZM12.2603,10.2231L12.7484,9.6537L12.7484,9.6537L12.2603,10.2231ZM11.7397,10.2231L12.2278,10.7926L12.2278,10.7926L11.7397,10.2231ZM4.5119,15.4306C4.1974,15.7001 4.161,16.1736 4.4306,16.4881C4.7001,16.8026 5.1736,16.839 5.4881,16.5694L4.5119,15.4306ZM19.4881,15.4306L12.7484,9.6537L11.7722,10.7926L18.5119,16.5694L19.4881,15.4306ZM11.2516,9.6537L4.5119,15.4306L5.4881,16.5694L12.2278,10.7926L11.2516,9.6537ZM12.7484,9.6537C12.3177,9.2845 11.6823,9.2845 11.2516,9.6537L12.2278,10.7926C12.0967,10.9049 11.9033,10.9049 11.7722,10.7926L12.7484,9.6537Z"/></svg>
      </div>
      <div class="btns">
        <button class="btn primary" id="copy" type="button"><span id="copyLbl" aria-live="polite">Copy IP address</span></button>
        <button class="btn outline" id="more" type="button">All details</button>
      </div>
    </div>
  </div>
</section>

<div class="scrim" id="scrim"></div>
<section class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="shTitle">
  <div class="sh-top">
    <h2 id="shTitle">Details</h2>
    <button class="tbtn" id="refresh" type="button">Check again</button>
    <button class="xbtn" id="shClose" type="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <div class="sh-body" id="shBody"></div>
</section>

<noscript><p style="position:fixed;top:40%;left:0;right:0;text-align:center">Your IP address: ${esc(d.ip)}</p></noscript>
<script>window.__D=${json};window.__POLL=${POLL_MS};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

export const config = { runtime: "edge" };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const noStore = { "Cache-Control": "no-store" };

    if (url.pathname === "/world.json") {
      return worldData(url.searchParams.get("s") === "50" ? "50" : "110");
    }

    const d = collect(request);

    if (url.pathname === "/json") {
      return new Response(JSON.stringify(d, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", ...noStore },
      });
    }

    const wantsHtml = (request.headers.get("Accept") || "").includes("text/html");
    if (url.pathname === "/ip" || !wantsHtml) {
      return new Response(d.ip + "\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*", ...noStore },
      });
    }

    return new Response(page(d), {
      headers: { "Content-Type": "text/html; charset=utf-8", ...noStore },
    });
  },
};
