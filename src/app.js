{
/* ====== BLAGOVNA ZNAMKA — tu nastavite svoje podjetje ====== */
const CONFIG = {
  company: 'Vaše podjetje d.o.o.',
  accent: '#e4002b',
  logo: null, // npr. 'data:image/svg+xml;base64,...' ali null za privzeti znak
};

const $ = s => document.querySelector(s);
const OPS = CNC.OPS, fmt = CNC.fmt;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- dokument ---------- */
let nextId = 1;
// privzete vrednosti iz programov SolidCAM za ta stroj (PART2/PART3.xxl) in part8.xxl
const XXL_DEFAULT = { header: 'H DX={DX} DY={DY} DZ={DZ}-IL C=0 T=16973825 R=999 *MM /"def" BX=0 BY=0 BZ=0 V=10', routerT: 1,
  leadR: 22, dOut: 25, dIn: 43, dOther: 25, stock: 5,
  drills: [{ d: 8, T: 2, S: 3500, V: 2 }, { d: 5, T: 119, S: 3500, V: 2 }] };
const mk = (o) => ({ id: nextId++, hidden: false, through: true, depth: 18, ...o });
function sampleDoc() {
  nextId = 1;
  return {
    v: 3, name: 'Regal - stranica in polica', company: CONFIG.company, post: 'xilog',
    xxl: { ...XXL_DEFAULT, drills: XXL_DEFAULT.drills.map(d => ({ ...d })) },
    sheet: { w: 1000, h: 600, t: 18 },
    tool: { d: 20, rpm: 18000, feed: 6000, plunge: 2000, stepdown: 10 },
    cut: { safeZ: 15, clearZ: 3, overcut: 2, stepover: 0.45, climb: true, tabs: 0, tabW: 8, tabH: 3 },
    shapes: [
      mk({ name: 'Stranica', type: 'rect', x: 30, y: 30, w: 400, h: 540, r: 0, op: 'outside' }),
      mk({ name: 'Utor za polico', type: 'rect', x: 30, y: 280, w: 380, h: 30, r: 0, op: 'pocket', through: false, depth: 8 }),
      mk({ name: 'Ročaj', type: 'rect', x: 150, y: 460, w: 160, h: 50, r: 25, op: 'inside' }),
      ...[110, 174, 398, 462].map((y, i) => mk({ name: `Luknja ${i + 1}`, type: 'circle', cx: 393, cy: y, r: 2.5, op: 'drill', through: false, depth: 10 })),
      mk({ name: 'Polica', type: 'rect', x: 480, y: 30, w: 380, h: 300, r: 0, op: 'outside' }),
      mk({ name: 'Nosilec', type: 'poly', closed: true, op: 'outside',
        pts: [{ x: 480, y: 380 }, { x: 720, y: 380 }, { x: 720, y: 420 }, { x: 560, y: 560 }, { x: 480, y: 560 }] }),
      mk({ name: 'Oznaka', type: 'poly', closed: false, op: 'engrave', through: false, depth: 1,
        pts: [{ x: 500, y: 300 }, { x: 540, y: 300 }, { x: 540, y: 280 }, { x: 580, y: 280 }] }),
    ],
  };
}
function upgrade(d) {
  const base = sampleDoc();
  d = { ...base, ...d, tool: { ...base.tool, ...d.tool }, cut: { ...base.cut, ...d.cut }, sheet: { ...base.sheet, ...d.sheet } };
  if (!d.xxl || (d.v || 1) < 3) { d.xxl = base.xxl; d.post = 'xilog'; d.tool = base.tool; d.cut = base.cut; d.v = 3; }
  d.xxl = { ...XXL_DEFAULT, ...d.xxl };
  return d;
}
let doc = upgrade(store.get('cnc-doc') || sampleDoc());
nextId = Math.max(0, ...doc.shapes.map(s => s.id)) + 1;
const brand = store.get('cnc-brand') || {};
let sel = null, tool = 'select', showPaths = true, snapOn = true, grid = 5;
let hist = [], fut = [], result = null;

const snapshot = () => JSON.stringify(doc);
function commit() { hist.push(lastSaved); if (hist.length > 200) hist.shift(); fut = []; lastSaved = snapshot(); changed(); }
let lastSaved = snapshot();
function undo() { if (!hist.length) return; fut.push(snapshot()); doc = JSON.parse(hist.pop()); lastSaved = snapshot(); if (!getSel()) sel = null; changed(); }
function redo() { if (!fut.length) return; hist.push(snapshot()); doc = JSON.parse(fut.pop()); lastSaved = snapshot(); changed(); }
const getSel = () => doc.shapes.find(s => s.id === sel);

function changed(opts = {}) {
  try { result = CNC.generate(doc); } catch (e) { result = { gcode: '', warnings: ['Napaka pri izračunu: ' + e.message], preview: [], stats: { cut: 0, minutes: 0 } }; }
  store.set('cnc-doc', doc);
  draw();
  if (!opts.keepPanel) renderPanel();
  renderOutput();
}

/* ---------- pogled ---------- */
const cv = $('#cv'), ctx = cv.getContext('2d');
let view = { s: 1, ox: 0, oy: 0 }, W = 0, H = 0, userView = false;
const toScr = p => ({ x: p.x * view.s + view.ox, y: -p.y * view.s + view.oy });
const toW = (x, y) => ({ x: (x - view.ox) / view.s, y: -(y - view.oy) / view.s });
function fit() {
  userView = false;
  const m = 48, sw = doc.sheet.w, sh = doc.sheet.h;
  view.s = Math.min((W - 2 * m) / sw, (H - 2 * m) / sh);
  view.ox = (W - sw * view.s) / 2; view.oy = (H + sh * view.s) / 2; draw();
}
function resize() {
  const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const first = !W; W = r.width; H = r.height;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (first || !userView) fit(); else draw();
}
const ro = new ResizeObserver(resize); ro.observe(cv.parentElement);

const probe = document.createElement('i'); probe.style.display = 'none'; document.body.appendChild(probe);
const css = n => { probe.style.color = `var(${n})`; return getComputedStyle(probe).color; };
function tracePath(p) {
  const pts = CNC.pathToPoints(p, 0.3 / view.s + 0.02);
  ctx.beginPath(); pts.forEach((q, i) => { const s = toScr(q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
  if (p.closed) ctx.closePath();
}
function draw() {
  if (!W) return;
  const c = { bed: css('--bed'), grid: css('--grid'), grid2: css('--grid2'), sheet: css('--sheet'), edge: css('--sheet-edge'), ink: css('--ink'), mute: css('--mute'), path: css('--path') };
  ctx.fillStyle = c.bed; ctx.fillRect(0, 0, W, H);
  // mreža
  const a = toW(0, 0), b = toW(W, H);
  let gs = grid; while (gs * view.s < 7) gs *= gs === grid ? 2 : 5;
  ctx.lineWidth = 1;
  for (const [step, col] of [[gs, c.grid], [gs * 10, c.grid2]]) {
    ctx.strokeStyle = col; ctx.beginPath();
    for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) { const sx = Math.round(toScr({ x, y: 0 }).x) + .5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = Math.floor(b.y / step) * step; y <= a.y; y += step) { const sy = Math.round(toScr({ x: 0, y }).y) + .5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();
  }
  // plošča
  const o = toScr({ x: 0, y: 0 }), sw = doc.sheet.w * view.s, sh = doc.sheet.h * view.s;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.fillStyle = c.sheet; ctx.fillRect(o.x, o.y - sh, sw, sh); ctx.restore();
  ctx.strokeStyle = c.edge; ctx.lineWidth = 1.5; ctx.strokeRect(o.x, o.y - sh, sw, sh);
  ctx.font = '12px Archivo, system-ui, sans-serif'; ctx.fillStyle = c.mute; ctx.textAlign = 'center';
  ctx.fillText(`${fmt(doc.sheet.w)} mm`, o.x + sw / 2, o.y + 18);
  ctx.save(); ctx.translate(o.x - 12, o.y - sh / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(`${fmt(doc.sheet.h)} mm`, 0, 0); ctx.restore();
  // izhodišče
  ctx.lineWidth = 2; ctx.strokeStyle = '#e4002b'; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + 28, o.y); ctx.stroke();
  ctx.strokeStyle = '#15803d'; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - 28); ctx.stroke();
  ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(o.x, o.y, 3.5, 0, 7); ctx.fill();
  // oblike
  for (const s of doc.shapes) {
    if (s.hidden) continue;
    const col = OPS[s.op].color, on = s.id === sel;
    tracePath(CNC.shapePath(s));
    if (CNC.isClosed(s)) { ctx.fillStyle = col + (s.op === 'pocket' ? '33' : s.op === 'outside' ? '14' : '1f'); ctx.fill('evenodd'); }
    ctx.lineWidth = on ? 3 : 1.8; ctx.strokeStyle = col; ctx.setLineDash(s.op === 'engrave' ? [6, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    if (s.op === 'drill') { const p = toScr({ x: s.cx, y: s.cy }); ctx.beginPath(); ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6); ctx.stroke(); }
  }
  // poti orodja
  if (showPaths && result) {
    ctx.strokeStyle = c.path; ctx.lineWidth = 1; ctx.globalAlpha = .85;
    for (const pv of result.preview) {
      if (pv.kind === 'path') { tracePath(pv.path); ctx.stroke(); }
      else if (pv.kind === 'poly') { ctx.beginPath(); pv.pts.forEach((q, i) => { const s = toScr(q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke(); }
      else if (pv.kind === 'drill') { const p = toScr(pv); ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, pv.r * view.s), 0, 7); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }
  // izbor: ročice
  const s = getSel();
  if (s && !s.hidden) handles(s).forEach(h => { const p = toScr(h); ctx.fillStyle = '#fff'; ctx.strokeStyle = CONFIG_ACCENT(); ctx.lineWidth = 2; ctx.fillRect(p.x - 5, p.y - 5, 10, 10); ctx.strokeRect(p.x - 5, p.y - 5, 10, 10); });
  drawDraft();
}
const CONFIG_ACCENT = () => css('--accent');

/* ---------- risanje: snap, ročice, zadetki ---------- */
function keyPoints() {
  const P = [{ x: 0, y: 0 }, { x: doc.sheet.w, y: 0 }, { x: 0, y: doc.sheet.h }, { x: doc.sheet.w, y: doc.sheet.h }];
  for (const s of doc.shapes) {
    if (s.hidden) continue;
    if (s.type === 'rect') P.push({ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x, y: s.y + s.h }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x + s.w / 2, y: s.y + s.h / 2 });
    else if (s.type === 'circle') P.push({ x: s.cx, y: s.cy });
    else P.push(...s.pts);
  }
  if (draft && draft.pts) P.push(...draft.pts);
  return P;
}
let snapHit = null;
function snap(p, ignoreId) {
  snapHit = null;
  if (!snapOn) return p;
  let best = null, bd = 10 / view.s;
  for (const q of keyPoints()) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
  if (best) { snapHit = best; return { ...best }; }
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}
function handles(s) {
  if (s.type === 'rect') return [{ x: s.x + s.w, y: s.y + s.h, k: 'tr' }, { x: s.x, y: s.y, k: 'bl' }];
  if (s.type === 'circle') return [{ x: s.cx + s.r, y: s.cy, k: 'r' }];
  return s.pts.map((p, i) => ({ ...p, k: i }));
}
function hit(p) {
  const tol = 7 / view.s;
  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const s = doc.shapes[i]; if (s.hidden) continue;
    const pts = CNC.pathToPoints(CNC.shapePath(s), 0.5);
    const n = CNC.isClosed(s) ? pts.length : pts.length - 1;
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], dx = b.x - a.x, dy = b.y - a.y;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / ((dx * dx + dy * dy) || 1); t = Math.max(0, Math.min(1, t));
      if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < tol) return s;
    }
  }
  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const s = doc.shapes[i]; if (s.hidden || !CNC.isClosed(s)) continue;
    if (CNC.pointInPoly(p, CNC.pathToPoints(CNC.shapePath(s), 0.5))) return s;
  }
  return null;
}

/* ---------- osnutek ---------- */
let draft = null, drag = null, cursor = { x: 0, y: 0 }, typed = '', spaceDown = false;
function drawDraft() {
  if (snapHit) { const p = toScr(snapHit); ctx.strokeStyle = CONFIG_ACCENT(); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.stroke(); }
  if (!draft) return;
  ctx.strokeStyle = CONFIG_ACCENT(); ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]);
  const label = (t, p) => { ctx.setLineDash([]); ctx.font = '600 13px Archivo, system-ui, sans-serif'; const w = ctx.measureText(t).width + 12;
    ctx.fillStyle = css('--ink'); ctx.fillRect(p.x + 12, p.y + 10, w, 22); ctx.fillStyle = css('--bg'); ctx.textAlign = 'left'; ctx.fillText(t, p.x + 18, p.y + 25); };
  if (draft.type === 'rect') {
    const r = normRect(draft.a, draft.b), p = toScr({ x: r.x, y: r.y + r.h });
    ctx.strokeRect(p.x, p.y, r.w * view.s, r.h * view.s); label(`${fmt(r.w)} × ${fmt(r.h)} mm`, toScr(draft.b));
  } else if (draft.type === 'circle') {
    const c = toScr(draft.a), r = Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y);
    ctx.beginPath(); ctx.arc(c.x, c.y, r * view.s, 0, 7); ctx.stroke(); label(`⌀ ${fmt(2 * r)} mm`, toScr(draft.b));
  } else if (draft.type === 'poly') {
    const pts = [...draft.pts, draft.b];
    ctx.beginPath(); pts.forEach((q, i) => { const s = toScr(q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke();
    const l = draft.pts[draft.pts.length - 1], d = Math.hypot(draft.b.x - l.x, draft.b.y - l.y);
    const ang = Math.atan2(draft.b.y - l.y, draft.b.x - l.x) * 180 / Math.PI;
    label(typed ? `dolžina: ${typed}▍ mm` : `${fmt(d)} mm  ∠ ${fmt(Math.round(ang * 10) / 10)}°`, toScr(draft.b));
  }
  ctx.setLineDash([]);
}
const normRect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
function ortho(from, p, on) {
  if (!on) return p;
  const dx = p.x - from.x, dy = p.y - from.y, L = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
  return { x: from.x + Math.round(L * Math.cos(a) * 1000) / 1000, y: from.y + Math.round(L * Math.sin(a) * 1000) / 1000 };
}
function addShape(s) { const n = doc.shapes.filter(x => x.type === s.type).length + 1;
  const base = { rect: 'Pravokotnik', circle: 'Krog', poly: s.closed ? 'Oblika' : 'Črta' }[s.type];
  const sh = mk({ name: `${base} ${n}`, depth: doc.sheet.t, ...s }); doc.shapes.push(sh); sel = sh.id; commit(); }
function finishPoly(close) {
  if (!draft || draft.type !== 'poly') return;
  const pts = draft.pts; draft = null; typed = '';
  if (pts.length < 2 || (close && pts.length < 3)) { draw(); return; }
  addShape(close ? { type: 'poly', pts, closed: true, op: 'outside' } : { type: 'poly', pts, closed: false, op: 'engrave', through: false, depth: 1 });
}

cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  const r = cv.getBoundingClientRect(), raw = toW(e.clientX - r.left, e.clientY - r.top);
  if (e.button === 1 || e.button === 2 || spaceDown || tool === 'pan') { userView = true; drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy }; cv.style.cursor = 'grabbing'; return; }
  const p = snap(raw);
  if (tool === 'select') {
    const s = getSel();
    if (s) for (const h of handles(s)) { const q = toScr(h), m = toScr(raw); if (Math.abs(q.x - m.x) < 8 && Math.abs(q.y - m.y) < 8) { drag = { kind: 'handle', k: h.k, orig: JSON.stringify(s) }; return; } }
    const h = hit(raw);
    sel = h ? h.id : null;
    if (h) drag = { kind: 'move', start: p, orig: JSON.stringify(groupOf(h)), moved: false };
    renderPanel(); draw(); return;
  }
  if (tool === 'rect' || tool === 'circle') { draft = { type: tool, a: p, b: p }; draw(); return; }
  if (tool === 'poly') {
    if (!draft) { draft = { type: 'poly', pts: [p], b: p }; draw(); return; }
    const first = draft.pts[0], ps = ortho(draft.pts[draft.pts.length - 1], p, e.shiftKey);
    if (draft.pts.length >= 3 && Math.hypot(ps.x - first.x, ps.y - first.y) < 1e-6) { finishPoly(true); return; }
    const last = draft.pts[draft.pts.length - 1];
    if (Math.hypot(ps.x - last.x, ps.y - last.y) > 1e-6) draft.pts.push(ps);
    typed = ''; draw();
  }
});
cv.addEventListener('pointermove', e => {
  const r = cv.getBoundingClientRect(), raw = toW(e.clientX - r.left, e.clientY - r.top);
  if (drag && drag.kind === 'pan') { view.ox = drag.ox + e.clientX - drag.sx; view.oy = drag.oy + e.clientY - drag.sy; draw(); return; }
  const p = snap(raw); cursor = p;
  $('#xy').textContent = `X ${fmt(p.x)}  Y ${fmt(p.y)}`;
  if (drag && drag.kind === 'move') {
    const o = JSON.parse(drag.orig), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    for (const og of o) { const s = doc.shapes.find(x => x.id === og.id); if (!s) continue;
      if (s.type === 'rect') { s.x = og.x + dx; s.y = og.y + dy; } else if (s.type === 'circle') { s.cx = og.cx + dx; s.cy = og.cy + dy; }
      else s.pts = og.pts.map(q => ({ x: q.x + dx, y: q.y + dy })); }
    drag.moved = drag.moved || dx || dy; result = CNC.generate(doc); draw(); return;
  }
  if (drag && drag.kind === 'handle') {
    const s = getSel(), o = JSON.parse(drag.orig);
    if (s.type === 'rect') {
      if (drag.k === 'tr') { s.w = Math.max(1, p.x - o.x); s.h = Math.max(1, p.y - o.y); }
      else { s.x = Math.min(p.x, o.x + o.w - 1); s.y = Math.min(p.y, o.y + o.h - 1); s.w = o.x + o.w - s.x; s.h = o.y + o.h - s.y; }
    } else if (s.type === 'circle') s.r = Math.max(0.5, Math.hypot(p.x - s.cx, p.y - s.cy));
    else s.pts[drag.k] = p;
    drag.moved = true; result = CNC.generate(doc); draw(); return;
  }
  if (draft) { draft.b = draft.type === 'poly' ? ortho(draft.pts[draft.pts.length - 1], p, e.shiftKey) : p; }
  draw();
});
cv.addEventListener('pointerup', () => {
  if (drag) { const d = drag; drag = null; cv.style.cursor = '';
    if ((d.kind === 'move' || d.kind === 'handle') && d.moved) { commit(); } return; }
  if (draft && (draft.type === 'rect' || draft.type === 'circle')) {
    const d = draft; draft = null;
    if (d.type === 'rect') { const r = normRect(d.a, d.b); if (r.w >= 1 && r.h >= 1) addShape({ type: 'rect', ...r, r: 0, op: 'outside' }); else hint('Povleci z miško, da narišeš pravokotnik.'); }
    else { const rr = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y); if (rr >= 0.5) addShape({ type: 'circle', cx: d.a.x, cy: d.a.y, r: rr, op: 'inside' }); else hint('Klikni središče in povleci do želenega polmera.'); }
    draw();
  }
});
cv.addEventListener('dblclick', () => { if (tool === 'poly' && draft) finishPoly(false); });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  e.preventDefault(); userView = true;
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, w = toW(mx, my);
  view.s = Math.max(0.05, Math.min(80, view.s * Math.exp(-e.deltaY * 0.0015)));
  view.ox = mx - w.x * view.s; view.oy = my + w.y * view.s; draw();
}, { passive: false });

/* ---------- tipkovnica ---------- */
const inField = e => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
window.addEventListener('keydown', e => {
  if (inField(e)) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  if (k === ' ') { spaceDown = true; e.preventDefault(); return; }
  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
  if (draft && draft.type === 'poly') {
    if (/^[0-9.,]$/.test(k)) { typed += k === ',' ? '.' : k; draw(); return; }
    if (k === 'Backspace') { if (typed) typed = typed.slice(0, -1); else if (draft.pts.length > 1) draft.pts.pop(); else draft = null; draw(); return; }
    if (k === 'Enter') {
      const L = parseFloat(typed);
      if (L > 0) { const l = draft.pts[draft.pts.length - 1], dx = draft.b.x - l.x, dy = draft.b.y - l.y, d = Math.hypot(dx, dy) || 1;
        const a = d > 1e-9 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
        draft.pts.push({ x: +(l.x + a.x * L).toFixed(3), y: +(l.y + a.y * L).toFixed(3) }); typed = ''; draw(); }
      else finishPoly(false);
      return;
    }
    if (k === 'c' || k === 'C') { finishPoly(true); return; }
  }
  if (k === 'Escape') { if (draft) { draft = null; typed = ''; } else { sel = null; renderPanel(); } draw(); return; }
  if ((k === 'Delete' || k === 'Backspace') && getSel()) { removeSel(); return; }
  if (k.startsWith('Arrow') && getSel()) {
    e.preventDefault(); const st = e.shiftKey ? 10 : 1, dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowDown' ? -st : k === 'ArrowUp' ? st : 0;
    groupOf(getSel()).forEach(x => moveShape(x, dx, dy)); commit(); return;
  }
  const map = { v: 'select', r: 'rect', c: 'circle', l: 'poly', h: 'pan' };
  if (!mod && map[k.toLowerCase()]) setTool(map[k.toLowerCase()]);
  if (!mod && k.toLowerCase() === 'f') fit();
  if (!mod && k.toLowerCase() === 'p') openTpl();
});
window.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });

function moveShape(s, dx, dy) {
  if (s.type === 'rect') { s.x += dx; s.y += dy; } else if (s.type === 'circle') { s.cx += dx; s.cy += dy; }
  else s.pts.forEach(p => { p.x += dx; p.y += dy; });
}
const groupOf = s => s && s.group ? doc.shapes.filter(x => x.group === s.group) : (s ? [s] : []);
function duplicate() {
  const s = getSel(); if (!s) return; const g = s.group ? 'g' + Date.now().toString(36) : null, ref = groupOf(s);
  let first = null;
  ref.forEach(x => { const c = JSON.parse(JSON.stringify(x)); c.id = nextId++; if (g) c.group = g; else c.name = x.name + ' (kopija)'; moveShape(c, 20, -20); doc.shapes.push(c); if (x.id === s.id) first = c; });
  sel = first.id; commit();
}
function removeSel() { const ids = new Set(groupOf(getSel()).map(x => x.id)); doc.shapes = doc.shapes.filter(s => !ids.has(s.id)); sel = null; commit(); }

const HINTS = {
  select: 'Klikni element, da ga izbereš. Vleci za premik, kvadratki spremenijo velikost. Puščice premaknejo za 1 mm (Shift: 10 mm).',
  rect: 'Povleci od enega kota do nasprotnega. Točne mere vpiši desno.',
  circle: 'Klikni središče in povleci do polmera.',
  poly: 'Klikaj točke. Vtipkaj dolžino + Enter za točen odsek. Klik na prvo točko ali C zapre obliko, dvoklik ali Enter konča črto. Shift = koti po 45°.',
  pan: 'Vleci za premik pogleda. Kolešček = povečava. F = prilagodi.',
};
function hint(t) { $('#hint').textContent = t; }
function setTool(t) {
  tool = t; draft = null; typed = '';
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
  cv.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
  hint(HINTS[t]); draw();
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

/* ---------- desni panel ---------- */
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (id, label, v, step = 1, unit = 'mm', min) => `<label class="f"><span>${label}</span><input id="${id}" type="number" inputmode="decimal" step="${step}" ${min !== undefined ? `min="${min}"` : ''} value="${fmt(v)}"><em>${unit}</em></label>`;
function renderPanel() {
  const s = getSel(), el = $('#selbox');
  if (!s) {
    const rows = [], seen = new Set();
    for (const x of doc.shapes) {
      if (x.group) { if (seen.has(x.group)) continue; seen.add(x.group);
        const g = doc.shapes.filter(y => y.group === x.group), o = g.find(y => y.outline) || g[0];
        rows.push(`<li><button data-pick="${o.id}"><i style="background:${OPS[o.op].color}"></i><b>${esc(x.gname || o.name)}</b><span>kos · ${g.length} ${g.length === 1 ? 'element' : g.length < 5 ? 'elementi' : 'elementov'}</span></button></li>`);
      } else rows.push(`<li><button data-pick="${x.id}"><i style="background:${OPS[x.op].color}"></i><b>${esc(x.name)}</b><span>${OPS[x.op].label}</span></button></li>`);
    }
    el.innerHTML = `<h2>Elementi <small>${doc.shapes.length}</small></h2>
      <div class="row" style="margin:0 0 10px"><button class="ghost" id="tpl-open2">+ Iz predloge</button><button class="ghost" id="arrange" ${doc.shapes.length ? '' : 'disabled'}>Razporedi na ploščo</button></div>
      <ul class="list">${rows.join('') || '<li class="empty">Še ni elementov. Nariši kos z orodji levo ali dodaj kos iz predloge.</li>'}</ul>`;
    $('#tpl-open2').addEventListener('click', openTpl); $('#arrange').addEventListener('click', arrangeAll);
    el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { sel = +b.dataset.pick; setTool('select'); renderPanel(); }));
    return;
  }
  const ops = CNC.allowedOps(s);
  let geo = '';
  if (s.type === 'rect') geo = num('gx', 'X', s.x, 1) + num('gy', 'Y', s.y, 1) + num('gw', 'Širina', s.w, 1, 'mm', 0.1) + num('gh', 'Višina', s.h, 1, 'mm', 0.1) + num('gr', 'Zaobljenje kotov', s.r || 0, 0.5, 'mm', 0);
  else if (s.type === 'circle') geo = num('gcx', 'Središče X', s.cx) + num('gcy', 'Središče Y', s.cy) + num('gd', 'Premer', s.r * 2, 0.5, 'mm', 0.1);
  else geo = `<div class="pts">${s.pts.map((p, i) => `<div class="pt"><span>${i + 1}</span><input data-px="${i}" type="number" step="1" value="${fmt(p.x)}" aria-label="Točka ${i + 1} X"><input data-py="${i}" type="number" step="1" value="${fmt(p.y)}" aria-label="Točka ${i + 1} Y"><button class="x" data-pdel="${i}" aria-label="Odstrani točko ${i + 1}">×</button></div>`).join('')}</div>
    <label class="chk"><input id="gclosed" type="checkbox" ${s.closed ? 'checked' : ''}> Zaprta oblika (kos)</label>`;
  const canThrough = s.op !== 'engrave' && s.op !== 'pocket';
  const grp = s.group ? doc.shapes.filter(x => x.group === s.group) : null;
  el.innerHTML = `<h2><button class="back" id="back" aria-label="Nazaj na seznam">←</button><input id="gname" class="name" value="${esc(s.name)}" aria-label="Ime elementa"></h2>
    ${grp ? `<div class="grp"><span>Del kosa <b>${esc(s.gname || '')}</b> (${grp.length} el.) – premik, kopija in brisanje veljajo za cel kos.</span><button class="ghost" id="ungroup">Razdruži</button></div>` : ''}
    <div class="grid2">${geo}</div>
    <label class="f wide"><span>Operacija</span><select id="gop">${ops.map(o => `<option value="${o}" ${o === s.op ? 'selected' : ''}>${OPS[o].label}</option>`).join('')}</select></label>
    ${canThrough ? `<label class="chk"><input id="gthr" type="checkbox" ${s.through ? 'checked' : ''}> Skozi celo ploščo (${fmt(doc.sheet.t + doc.cut.overcut)} mm)</label>` : ''}
    ${!canThrough || !s.through ? num('gdep', 'Globina', s.depth, 0.5, 'mm', 0.1) : ''}
    <p class="note">${opNote(s.op)}</p>
    <div class="row"><button id="gdup" class="ghost">Podvoji</button><button id="gdel" class="ghost danger">Izbriši</button></div>`;
  const bindNum = (id, fn) => { const i = $('#' + id); if (i) i.addEventListener('change', () => { const v = parseFloat(i.value); if (isFinite(v)) { fn(v); commit(); } else renderPanel(); }); };
  bindNum('gx', v => s.x = v); bindNum('gy', v => s.y = v); bindNum('gw', v => s.w = Math.max(0.1, v)); bindNum('gh', v => s.h = Math.max(0.1, v)); bindNum('gr', v => s.r = Math.max(0, v));
  bindNum('gcx', v => s.cx = v); bindNum('gcy', v => s.cy = v); bindNum('gd', v => s.r = Math.max(0.05, v / 2)); bindNum('gdep', v => s.depth = Math.max(0.1, v));
  el.querySelectorAll('[data-px]').forEach(i => i.addEventListener('change', () => { s.pts[+i.dataset.px].x = parseFloat(i.value) || 0; commit(); }));
  el.querySelectorAll('[data-py]').forEach(i => i.addEventListener('change', () => { s.pts[+i.dataset.py].y = parseFloat(i.value) || 0; commit(); }));
  el.querySelectorAll('[data-pdel]').forEach(b => b.addEventListener('click', () => { if (s.pts.length > 2) { s.pts.splice(+b.dataset.pdel, 1); if (s.pts.length < 3) s.closed = false; fixOp(s); commit(); } }));
  const gc = $('#gclosed'); if (gc) gc.addEventListener('change', () => { if (gc.checked && s.pts.length < 3) { gc.checked = false; return; } s.closed = gc.checked; fixOp(s); commit(); });
  $('#gname').addEventListener('change', e => { s.name = e.target.value || s.name; commit(); });
  $('#gop').addEventListener('change', e => { s.op = e.target.value; if (s.op === 'engrave' && s.depth > 3) s.depth = 1; commit(); });
  const th = $('#gthr'); if (th) th.addEventListener('change', () => { s.through = th.checked; commit(); });
  $('#gdup').addEventListener('click', duplicate); $('#gdel').addEventListener('click', removeSel);
  $('#back').addEventListener('click', () => { sel = null; renderPanel(); draw(); });
  const ug = $('#ungroup'); if (ug) ug.addEventListener('click', () => { grp.forEach(x => { delete x.group; delete x.outline; }); commit(); });
}
function fixOp(s) { const a = CNC.allowedOps(s); if (!a.includes(s.op)) s.op = a[0]; }
function opNote(op) {
  return {
    outside: 'Rezkar teče zunaj črte – kos ima točno narisano mero. Mostički držijo kos do konca.',
    inside: 'Rezkar teče znotraj črte – luknja ima točno narisano mero.',
    pocket: 'Odstrani ves material znotraj oblike do izbrane globine.',
    engrave: 'Središče rezkarja gre točno po črti (gravura, utor, oznaka).',
    drill: 'Vrtanje: če imaš sveder tega premera (Material in orodje), gre luknja na sveder, sicer jo naredi rezkar.',
  }[op];
}

/* nastavitve materiala in orodja */
const SET = [
  ['sheet', 'w', 'Širina plošče', 1, 'mm'], ['sheet', 'h', 'Višina plošče', 1, 'mm'], ['sheet', 't', 'Debelina', 0.5, 'mm'],
  ['tool', 'd', 'Premer rezkarja', 0.5, 'mm'], ['tool', 'rpm', 'Vrtljaji', 500, 'obr/min'], ['tool', 'feed', 'Pomik', 100, 'mm/min'],
  ['tool', 'plunge', 'Pomik potopa', 50, 'mm/min'], ['tool', 'stepdown', 'Globina na prehod', 0.5, 'mm'],
  ['cut', 'stepover', 'Prekrivanje žepa', 5, '% fi', 100], ['cut', 'overcut', 'Prerez pod ploščo', 0.1, 'mm'],
  ['cut', 'safeZ', 'Varna višina Z', 1, 'mm'], ['cut', 'tabs', 'Mostički na kos', 1, 'kos'], ['cut', 'tabW', 'Širina mostička', 1, 'mm'], ['cut', 'tabH', 'Višina mostička', 0.5, 'mm'],
];
function renderSettings() {
  $('#setbox').innerHTML = `<div class="grid2">${SET.map(([g, k, l, st, u, mul]) => num(`s-${g}-${k}`, l, doc[g][k] * (mul || 1), st, u, 0)).join('')}</div>
    <label class="f wide"><span>Smer rezkanja</span><select id="s-dir"><option value="1" ${doc.cut.climb ? 'selected' : ''}>Soteklo (climb) – lepši rob</option><option value="0" ${!doc.cut.climb ? 'selected' : ''}>Protismerno (conventional)</option></select></label>
    <label class="f wide"><span>Krmilnik stroja</span><select id="s-post">${Object.entries(CNC.POSTS).map(([k, p]) => `<option value="${k}" ${k === doc.post ? 'selected' : ''}>${p.name}</option>`).join('')}</select></label>
    ${doc.post === 'xilog' ? `<div class="xxl">
      <div class="grid2">${num('x-rt', 'Rezkar – številka orodja T', doc.xxl.routerT, 1, 'T')}${num('x-lead', 'Polmer vstopnega loka', doc.xxl.leadR, 1)}${num('x-dout', 'D pri zunanjem obrisu', doc.xxl.dOut, 1, '')}${num('x-din', 'D pri notranjem izrezu', doc.xxl.dIn, 1, '')}${num('x-stock', 'Dodatek surovca na stran', doc.xxl.stock, 1)}</div>
      <p class="sub">Svedri (luknje s tem premerom gredo v vrtine B)</p>
      <div class="drills"><span>⌀ mm</span><span>T</span><span>S obr/min</span><span>V</span><span></span>
      ${doc.xxl.drills.map((b, i) => `<input data-dr="${i}" data-k="d" type="number" step="0.5" value="${fmt(b.d)}" aria-label="Premer svedra ${i + 1}"><input data-dr="${i}" data-k="T" type="number" value="${b.T}" aria-label="Orodje T"><input data-dr="${i}" data-k="S" type="number" step="100" value="${b.S}" aria-label="Vrtljaji"><input data-dr="${i}" data-k="V" type="number" value="${b.V}" aria-label="Hitrost V"><button class="x" data-drdel="${i}" aria-label="Odstrani sveder">×</button>`).join('')}
      </div><button class="ghost small" id="x-add">+ Dodaj sveder</button>
      <label class="f wide"><span>Glava programa (H). {DX} {DY} {DZ} se zamenjajo z merami plošče.</span><textarea id="x-head" rows="3">${esc(doc.xxl.header)}</textarea></label>
    </div>` : ''}`;
  SET.forEach(([g, k, , , , mul]) => $(`#s-${g}-${k}`).addEventListener('change', e => {
    let v = parseFloat(e.target.value); if (!isFinite(v) || v < 0) { renderSettings(); return; }
    if (k === 'tabs') v = Math.round(v); doc[g][k] = v / (mul || 1);
    if (g === 'sheet' || k === 'd') { if (doc.tool.d <= 0) doc.tool.d = 0.1; }
    commit(); if (g === 'sheet') fit();
  }));
  $('#s-dir').addEventListener('change', e => { doc.cut.climb = e.target.value === '1'; commit(); });
  $('#s-post').addEventListener('change', e => { doc.post = e.target.value; commit(); renderSettings(); });
  if (doc.post === 'xilog') {
    $('#x-rt').addEventListener('change', e => { const v = parseInt(e.target.value); if (v >= 0) { doc.xxl.routerT = v; commit(); } });
    [['x-lead', 'leadR'], ['x-dout', 'dOut'], ['x-din', 'dIn'], ['x-stock', 'stock']].forEach(([id, k]) => $('#' + id).addEventListener('change', e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) { doc.xxl[k] = v; commit(); } }));
    document.querySelectorAll('[data-dr]').forEach(i => i.addEventListener('change', () => { const v = parseFloat(i.value); if (isFinite(v) && v >= 0) { doc.xxl.drills[+i.dataset.dr][i.dataset.k] = v; commit(); } }));
    document.querySelectorAll('[data-drdel]').forEach(b => b.addEventListener('click', () => { doc.xxl.drills.splice(+b.dataset.drdel, 1); commit(); renderSettings(); }));
    $('#x-add').addEventListener('click', () => { doc.xxl.drills.push({ d: 10, T: 100, S: 3000, V: 1 }); commit(); renderSettings(); });
    $('#x-head').addEventListener('change', e => { doc.xxl.header = e.target.value.trim() || XXL_DEFAULT.header; commit(); });
  }
}

/* izhod */
function renderOutput() {
  const r = result; if (!r) return;
  const m = r.stats.minutes || 0;
  const sec = Math.round(m * 60); $('#time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('#len').textContent = `${fmt(Math.round((r.stats.cut || 0) / 10) / 100)} m`;
  $('#nops').textContent = r.stats.ops || 0;
  const grpW = new Map();
  for (const w of r.warnings) { const i = w.indexOf(': '), k = i > 0 ? w.slice(i + 2) : w, n = i > 0 ? w.slice(0, i) : ''; if (!grpW.has(k)) grpW.set(k, []); grpW.get(k).push(n); }
  $('#warn').innerHTML = grpW.size ? [...grpW].map(([k, ns]) => `<li>${ns[0] ? `<b>${esc(ns[0])}${ns.length > 1 ? ` in še ${ns.length - 1}` : ''}</b>: ` : ''}${esc(k)}</li>`).join('') : '<li class="ok">Ni opozoril – program je pripravljen.</li>';
  $('#warn').className = r.warnings.length ? 'warn' : 'warn good';
  const lines = r.gcode.replace(/\r/g, '').split('\n');
  $('#gcode').textContent = lines.slice(0, 400).join('\n') + (lines.length > 400 ? `\n… še ${lines.length - 400} vrstic` : '');
  $('#gclines').textContent = `${lines.length - 1} vrstic`;
  const lbl = doc.post === 'xilog' ? 'Prenesi XXL' : 'Prenesi G-kodo';
  $('#dl-nc').textContent = lbl; $('#dl-nc2').textContent = lbl;
  document.querySelector('#gsum').textContent = doc.post === 'xilog' ? 'Predogled programa XXL' : 'Predogled G-kode';
}

/* ---------- datoteke ---------- */
const slug = () => (doc.name || 'projekt').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'projekt';
const dlP = (window.claude && window.claude.use) ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
function crc32(b) { let c, t = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  let x = ~0; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (~x) >>> 0; }
function zip(files) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  const u16 = v => [v & 255, v >> 8 & 255], u32 = v => [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const h = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    parts.push(new Uint8Array(h), name, data);
    cen.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
    off += h.length + name.length + data.length;
  }
  const cs = cen.reduce((a, b) => a + b.length, 0);
  return new Blob([...parts, ...cen, new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cs), ...u32(off), 0, 0])], { type: 'application/zip' });
}
async function save(name, data) {
  const d = await dlP;
  if (d) {
    const ext = name.split('.').pop();
    const ok = ['svg', 'json', 'txt', 'zip'].includes(ext);
    try { await d.save(ok ? { filename: name, data } : { filename: name + '.zip', data: zip([{ name, data }]) }); toast(ok ? `Shranjeno: ${name}` : `Shranjeno: ${name}.zip (v njem ${name})`); }
    catch (e) { toast(e && e.code === 'declined' ? 'Shranjevanje preklicano.' : 'Datoteke ni bilo mogoče shraniti – uporabi Kopiraj.'); }
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(`Prenos: ${name}`);
}
const ext = () => CNC.POSTS[doc.post].ext;
$('#dl-nc').addEventListener('click', () => save(`${slug()}.${ext()}`, result.gcode));
$('#dl-nc2').addEventListener('click', () => save(`${slug()}.${ext()}`, result.gcode));
$('#dl-dxf').addEventListener('click', () => save(`${slug()}.dxf`, CNC.toDXF(doc)));
$('#dl-svg').addEventListener('click', () => save(`${slug()}.svg`, CNC.toSVG(doc)));
$('#dl-zip').addEventListener('click', () => save(`${slug()}.zip`, zip([
  { name: `${slug()}.${ext()}`, data: result.gcode }, { name: `${slug()}.dxf`, data: CNC.toDXF(doc) },
  { name: `${slug()}.svg`, data: CNC.toSVG(doc) }, { name: `${slug()}.json`, data: JSON.stringify(doc, null, 1) }])));
/* izvoz po kosih: vsak kos svoj program (za stroj, kjer kos leži na podstavkih) */
function partDocs(withOutline) {
  const names = new Map();
  return units().map(u => {
    const o = u.shapes.find(x => x.outline) || u.shapes.find(x => x.op === 'outside') || null;
    const b = o ? CNC.shapeBounds(o) : u.b;
    let nm = (o && (o.gname || o.name)) || u.shapes[0].name || 'kos';
    const k = nm.toLowerCase(); names.set(k, (names.get(k) || 0) + 1); if (names.get(k) > 1) nm += ` ${names.get(k)}`;
    const m = withOutline && o ? (doc.xxl ? doc.xxl.stock : 5) : 0;
    const shapes = u.shapes.filter(x => withOutline || x !== o).map(x => { const c = JSON.parse(JSON.stringify(x)); moveShape(c, m - b.x0, m - b.y0); return c; });
    return { name: nm, doc: { ...doc, name: nm, sheet: { ...doc.sheet, w: +(b.x1 - b.x0 + 2 * m).toFixed(3), h: +(b.y1 - b.y0 + 2 * m).toFixed(3) }, shapes } };
  });
}
const fileSlug = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'kos';
$('#dl-parts').addEventListener('click', () => {
  const P = partDocs($('#with-outline').checked); if (!P.length) { toast('Ni kosov za izvoz.'); return; }
  const warn = [], files = P.map(p => { const r = CNC.generate(p.doc); r.warnings.forEach(w => warn.push(w)); return { name: `${fileSlug(p.name)}.${ext()}`, data: r.gcode }; });
  save(`${slug()}-kosi.zip`, zip(files));
});
$('#dl-json').addEventListener('click', () => save(`${slug()}.json`, JSON.stringify(doc, null, 1)));
$('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(result.gcode); toast('Program kopiran.'); } catch { toast('Kopiranje ni dovoljeno v tem oknu.'); } });
$('#open').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d.sheet || !Array.isArray(d.shapes)) throw 0;
    hist.push(snapshot()); doc = { ...sampleDoc(), ...d }; nextId = Math.max(0, ...doc.shapes.map(s => s.id)) + 1; sel = null; lastSaved = snapshot(); renderSettings(); changed(); fit(); toast(`Odprt projekt: ${doc.name}`); }
  catch { toast('To ni veljavna projektna datoteka (.json).'); }
  e.target.value = '';
});
$('#new').addEventListener('click', () => { hist.push(snapshot()); const d = sampleDoc(); d.shapes = []; d.name = 'Nov projekt'; d.sheet = { w: 2800, h: 2070, t: 18 }; doc = d; sel = null; lastSaved = snapshot(); renderSettings(); changed(); fit(); $('#pname').value = doc.name; toast('Nov prazen projekt. Razveljavi s Ctrl+Z.'); });
$('#sample').addEventListener('click', () => { hist.push(snapshot()); doc = sampleDoc(); sel = null; lastSaved = snapshot(); renderSettings(); changed(); fit(); $('#pname').value = doc.name; });
$('#undo').addEventListener('click', undo); $('#redo').addEventListener('click', redo);
$('#pname').value = doc.name; $('#pname').addEventListener('change', e => { doc.name = e.target.value; commit(); });
$('#fit').addEventListener('click', fit);
$('#paths').addEventListener('change', e => { showPaths = e.target.checked; draw(); });
$('#snap').addEventListener('change', e => { snapOn = e.target.checked; });
$('#gridsel').addEventListener('change', e => { grid = +e.target.value; draw(); });

let tt; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 2800); }

/* ---------- znamka ---------- */
function applyBrand() {
  const name = brand.company || CONFIG.company, acc = brand.accent || CONFIG.accent, logo = brand.logo || CONFIG.logo;
  document.documentElement.style.setProperty('--accent', acc);
  $('#cname').textContent = name; doc.company = name;
  $('#logo').innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(name.trim().slice(0, 1).toUpperCase())}</span>`;
  $('#b-name').value = name; $('#b-acc').value = acc;
}
$('#b-name').addEventListener('change', e => { brand.company = e.target.value; store.set('cnc-brand', brand); applyBrand(); changed(); });
$('#b-acc').addEventListener('input', e => { brand.accent = e.target.value; store.set('cnc-brand', brand); applyBrand(); draw(); });
$('#b-logo').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { brand.logo = r.result; store.set('cnc-brand', brand); applyBrand(); }; r.readAsDataURL(f); });
$('#b-reset').addEventListener('click', () => { for (const k in brand) delete brand[k]; store.set('cnc-brand', brand); applyBrand(); changed(); });


/* ---------- razporejanje in predloge ---------- */
function units() {
  // enota = kos (skupina) ali prosto narisan zunanji rez z vsem, kar leži znotraj njega
  const U = [], used = new Set(), bb = x => CNC.shapeBounds(x);
  const groups = new Map();
  doc.shapes.forEach(x => { if (x.group) { if (!groups.has(x.group)) groups.set(x.group, []); groups.get(x.group).push(x); } });
  for (const g of groups.values()) { const o = g.find(x => x.outline) || g[0]; U.push({ shapes: g, b: bb(o) }); g.forEach(x => used.add(x.id)); }
  const free = doc.shapes.filter(x => !used.has(x.id));
  const outs = free.filter(x => x.op === 'outside' && CNC.isClosed(x)).map(x => ({ x, b: bb(x) })).sort((a, c) => (c.b.x1 - c.b.x0) * (c.b.y1 - c.b.y0) - (a.b.x1 - a.b.x0) * (a.b.y1 - a.b.y0));
  for (const o of outs) {
    if (used.has(o.x.id)) continue;
    const inside = free.filter(y => !used.has(y.id) && y !== o.x && (() => { const b = bb(y); return b.x0 >= o.b.x0 - 1e-6 && b.x1 <= o.b.x1 + 1e-6 && b.y0 >= o.b.y0 - 1e-6 && b.y1 <= o.b.y1 + 1e-6; })());
    [o.x, ...inside].forEach(y => used.add(y.id)); U.push({ shapes: [o.x, ...inside], b: o.b });
  }
  free.filter(x => !used.has(x.id)).forEach(x => U.push({ shapes: [x], b: bb(x) }));
  return U;
}
const kos = n => `${n} ${n === 1 ? 'kos' : n === 2 ? 'kosa' : n < 5 ? 'kosi' : 'kosov'}`;
const GAP = () => doc.tool.d + 4, MARGIN = 10;
function arrangeAll() {
  const U = units(); if (!U.length) return;
  const pl = TPL.pack(U.map(u => ({ w: u.b.x1 - u.b.x0, h: u.b.y1 - u.b.y0 })), [], doc.sheet, GAP(), MARGIN, false);
  U.forEach((u, i) => u.shapes.forEach(x => moveShape(x, pl[i].x - u.b.x0, pl[i].y - u.b.y0)));
  const out = pl.filter(p => p.out).length;
  commit(); fit(); toast(out ? `Na ploščo ne gre: ${kos(out)} (postavljeno desno od nje).` : 'Kosi so razporejeni na ploščo.');
}

let tplKey = 'korpus', tplVals = {};
const dlg = $('#tpl');
function tplParams() {
  const T = TPL.LIST[tplKey], p = {};
  T.fields.forEach(([k, , def]) => { p[k] = tplVals[tplKey] && k in tplVals[tplKey] ? tplVals[tplKey][k] : def; });
  return p;
}
function openTpl() { renderTpl(); try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
function renderTpl() {
  $('#tpl-list').innerHTML = Object.entries(TPL.LIST).map(([k, t]) => `<button type="button" data-tk="${k}" aria-pressed="${k === tplKey}"><b>${t.name}</b><span>${t.desc}</span></button>`).join('');
  document.querySelectorAll('[data-tk]').forEach(b => b.addEventListener('click', () => { tplKey = b.dataset.tk; renderTpl(); }));
  const T = TPL.LIST[tplKey], p = tplParams();
  $('#tpl-form').innerHTML = `<h3>${T.name}</h3><p class="note">Debelina plošče: ${fmt(doc.sheet.t)} mm (nastavitev Material).</p><div class="grid2">${T.fields.map(([k, l, , t]) => t === 'bool'
    ? `<label class="chk" style="grid-column:1/-1"><input type="checkbox" data-tp="${k}" ${p[k] ? 'checked' : ''}> ${l}</label>`
    : `<label class="f"><span>${l}</span><input type="number" data-tp="${k}" step="${t === 'kos' ? 1 : 0.5}" min="0" value="${fmt(p[k])}"><em>${t === 'kos' ? 'kos' : 'mm'}</em></label>`).join('')}</div>`;
  document.querySelectorAll('[data-tp]').forEach(i => i.addEventListener(i.type === 'checkbox' ? 'change' : 'input', () => {
    const v = i.type === 'checkbox' ? i.checked : parseFloat(i.value); if (i.type !== 'checkbox' && !isFinite(v)) return;
    (tplVals[tplKey] = tplVals[tplKey] || {})[i.dataset.tp] = v; tplPreview(); }));
  tplPreview();
}
function tplResult() { return TPL.make(tplKey, tplParams(), doc.sheet.t, doc.tool.d); }
function tplPreview() {
  let res; try { res = tplResult(); } catch (e) { $('#tpl-parts').innerHTML = `<li>Napaka: ${esc(e.message)}</li>`; return; }
  const bad = res.parts.find(p => !(p.w > 0 && p.h > 0));
  $('#tpl-add').disabled = !!bad;
  $('#tpl-parts').innerHTML = res.parts.map(p => `<li><b>${esc(p.name)}</b><span>${fmt(p.w)} × ${fmt(p.h)} mm${p.feats.length ? ` · ${p.feats.length} obdelav` : ''}</span></li>`).join('');
  $('#tpl-notes').innerHTML = (bad ? ['Mere niso veljavne (kos ima širino ali višino 0 ali manj).'] : res.notes).map(n => `<li>${esc(n)}</li>`).join('');
  // predogled: kosi v vrsti
  const gap = 40; let x = 0; const pl = res.parts.map(p => { const o = { x, y: 0, turn: false }; x += Math.max(p.w, 1) + gap; return o; });
  const shapes = TPL.build(res.parts, pl), W = Math.max(1, x - gap), H = Math.max(1, ...res.parts.map(p => p.h));
  const sw = Math.max(W, H) / 220;
  $('#tpl-svg').setAttribute('viewBox', `${-gap / 2} ${-gap / 2} ${W + gap} ${H + gap}`);
  $('#tpl-svg').innerHTML = `<g transform="translate(0 ${H}) scale(1 -1)">${shapes.map(s => `<path d="${CNC.pathToSVGd(CNC.shapePath(s))}" fill="${s.outline ? 'var(--sheet)' : OPS[s.op].color + '30'}" stroke="${OPS[s.op].color}" stroke-width="${sw}"/>`).join('')}</g>`;
}
$('#tpl-add').addEventListener('click', () => {
  const res = tplResult(), clear = $('#tpl-clear').checked, rotOk = $('#tpl-rot').checked;
  if (clear) doc.shapes = [];
  const occ = units().map(u => ({ x: u.b.x0, y: u.b.y0, w: u.b.x1 - u.b.x0, h: u.b.y1 - u.b.y0 }));
  const pl = TPL.pack(res.parts, occ, doc.sheet, GAP(), MARGIN, rotOk);
  const shapes = TPL.build(res.parts, pl).map(x => mk(x));
  doc.shapes.push(...shapes); sel = null;
  const out = pl.filter(p => p.out).length;
  $('#tpl-clear').checked = false;
  try { dlg.close(); } catch { dlg.removeAttribute('open'); }
  commit(); fit();
  toast(out ? `Dodano: ${kos(res.parts.length)}; ${kos(out)} ne gre na ploščo (desno od nje).` : `Dodano na ploščo: ${kos(res.parts.length)}.`);
});
$('#tpl-close').addEventListener('click', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } });
$('#tpl-open').addEventListener('click', openTpl); $('#tpl-open3').addEventListener('click', openTpl);

applyBrand(); renderSettings(); setTool('select'); changed(); resize();
}
