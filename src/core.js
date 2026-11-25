/* ===== CNC jedro: geometrija, odmik orodja, poti, G-koda, DXF, SVG =====
   Enote: mm. Koordinatni sistem: X desno, Y gor, izhodišče = spodnji levi kot plošče,
   Z0 = zgornja ploskev materiala. */
const CNC = (() => {
  const TAU = Math.PI * 2;
  const fmt = n => { const v = Math.abs(n) < 5e-4 ? 0 : n; return (+v.toFixed(3)).toString(); };
  const ascii = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/[()]/g, '');
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  function area(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
    return a / 2;
  }
  function cleanPts(pts, closed) {
    const out = [];
    for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > 1e-6) out.push({ x: p.x, y: p.y });
    if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
    return out;
  }

  /* Pot: {start:{x,y}, segs:[{t:'L',x,y} | {t:'A',x,y,cx,cy,cw}], closed} */
  function rectPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (r < 1e-6) return { start: { x, y }, closed: true, segs: [
      { t: 'L', x: x + w, y }, { t: 'L', x: x + w, y: y + h }, { t: 'L', x, y: y + h }, { t: 'L', x, y }] };
    const s = [];
    const L = (px, py) => s.push({ t: 'L', x: px, y: py });
    const A = (px, py, cx, cy) => s.push({ t: 'A', x: px, y: py, cx, cy, cw: false });
    L(x + w - r, y); A(x + w, y + r, x + w - r, y + r);
    L(x + w, y + h - r); A(x + w - r, y + h, x + w - r, y + h - r);
    L(x + r, y + h); A(x, y + h - r, x + r, y + h - r);
    L(x, y + r); A(x + r, y, x + r, y + r);
    return { start: { x: x + r, y }, closed: true, segs: s };
  }
  function circlePath(cx, cy, r) {
    return { start: { x: cx + r, y: cy }, closed: true, segs: [
      { t: 'A', x: cx - r, y: cy, cx, cy, cw: false }, { t: 'A', x: cx + r, y: cy, cx, cy, cw: false }] };
  }
  function polyPath(pts, closed) {
    pts = cleanPts(pts, closed);
    if (closed && area(pts) < 0) pts = pts.slice().reverse();
    const segs = pts.slice(1).map(p => ({ t: 'L', x: p.x, y: p.y }));
    if (closed) segs.push({ t: 'L', x: pts[0].x, y: pts[0].y });
    return { start: { ...pts[0] }, closed, segs };
  }
  function shapePath(s) {
    if (s.type === 'rect') return rectPath(s.x, s.y, s.w, s.h, s.r);
    if (s.type === 'circle') return circlePath(s.cx, s.cy, s.r);
    return polyPath(s.pts, s.closed);
  }
  const isClosed = s => s.type !== 'poly' || !!s.closed;

  /* Odmik zaprtega poligona (CCW). d>0 navzven, d<0 navznoter.
     Kjer nastane vrzel → lok okoli oglišča, kjer prekrivanje → presečišče. */
  function polygonOffset(ptsIn, d) {
    let pts = cleanPts(ptsIn, true);
    if (pts.length < 3) return { ok: false };
    if (area(pts) < 0) pts = pts.slice().reverse();
    const n = pts.length, E = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], len = dist(p, q);
      const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len }, nr = { x: u.y, y: -u.x };
      E.push({ u, a: { x: p.x + nr.x * d, y: p.y + nr.y * d }, b: { x: q.x + nr.x * d, y: q.y + nr.y * d } });
    }
    const corners = [];
    for (let i = 0; i < n; i++) {
      const e0 = E[(i - 1 + n) % n], e1 = E[i];
      const cr = e0.u.x * e1.u.y - e0.u.y * e1.u.x, dot = e0.u.x * e1.u.x + e0.u.y * e1.u.y;
      if (Math.abs(cr) < 1e-9 && dot > 0) { corners.push({ first: e1.a, last: e1.a }); continue; }
      const convex = cr >= 0, gap = (convex && d > 0) || (!convex && d < 0);
      if (gap) corners.push({ first: e0.b, last: e1.a, arc: { cx: pts[i].x, cy: pts[i].y, cw: d < 0 } });
      else {
        const den = e0.u.x * e1.u.y - e0.u.y * e1.u.x;
        const t = ((e1.a.x - e0.a.x) * e1.u.y - (e1.a.y - e0.a.y) * e1.u.x) / den;
        const p = { x: e0.a.x + e0.u.x * t, y: e0.a.y + e0.u.y * t };
        corners.push({ first: p, last: p });
      }
    }
    let ok = true;
    for (let i = 0; i < n; i++) {
      const a = corners[i].last, b = corners[(i + 1) % n].first;
      if ((b.x - a.x) * E[i].u.x + (b.y - a.y) * E[i].u.y < -1e-6) ok = false;
    }
    const c0 = corners[0], segs = [];
    if (c0.arc) segs.push({ t: 'A', x: c0.last.x, y: c0.last.y, ...c0.arc });
    for (let i = 1; i < n; i++) {
      const c = corners[i];
      segs.push({ t: 'L', x: c.first.x, y: c.first.y });
      if (c.arc) segs.push({ t: 'A', x: c.last.x, y: c.last.y, ...c.arc });
    }
    segs.push({ t: 'L', x: c0.first.x, y: c0.first.y });
    const path = { start: { ...c0.first }, closed: true, segs: segs.filter((g, i) => {
      const prev = i ? segs[i - 1] : c0.first; return dist(prev, g) > 1e-7; }) };
    if (ok) { const a2 = area(pathToPoints(path, 0.05)); if (d < 0 && a2 <= 1e-6) ok = false; }
    return { ok, path };
  }

  function offsetShape(s, d) {
    if (s.type === 'rect') {
      const w = s.w + 2 * d, h = s.h + 2 * d;
      if (w < 0.01 || h < 0.01) return { ok: false };
      const rc = Math.max(0, Math.min(s.r || 0, s.w / 2, s.h / 2));
      const nr = rc > 0 ? Math.max(0, rc + d) : Math.max(0, d);
      return { ok: true, path: rectPath(s.x - d, s.y - d, w, h, nr) };
    }
    if (s.type === 'circle') {
      const r = s.r + d; if (r < 0.01) return { ok: false };
      return { ok: true, path: circlePath(s.cx, s.cy, r) };
    }
    return polygonOffset(s.pts, d);
  }

  function arcSweep(from, g) {
    const a0 = Math.atan2(from.y - g.cy, from.x - g.cx), a1 = Math.atan2(g.y - g.cy, g.x - g.cx);
    let sw = g.cw ? a0 - a1 : a1 - a0;
    while (sw <= 1e-9) sw += TAU;
    while (sw > TAU + 1e-9) sw -= TAU;
    return { a0, sw, r: Math.hypot(from.x - g.cx, from.y - g.cy) };
  }
  function pathToPoints(path, tol = 0.1) {
    const out = [{ ...path.start }]; let cur = path.start;
    for (const g of path.segs) {
      if (g.t === 'L') out.push({ x: g.x, y: g.y });
      else {
        const { a0, sw, r } = arcSweep(cur, g);
        const step = r > tol ? 2 * Math.acos(1 - tol / r) : sw;
        const n = Math.max(2, Math.ceil(sw / step)), dir = g.cw ? -1 : 1;
        for (let k = 1; k < n; k++) { const a = a0 + dir * sw * k / n; out.push({ x: g.cx + r * Math.cos(a), y: g.cy + r * Math.sin(a) }); }
        out.push({ x: g.x, y: g.y });
      }
      cur = g;
    }
    if (path.closed && out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
    return out;
  }
  function pathLength(path) {
    let L = 0, cur = path.start;
    for (const g of path.segs) { L += g.t === 'L' ? dist(cur, g) : (() => { const a = arcSweep(cur, g); return a.r * a.sw; })(); cur = g; }
    return L;
  }
  function reversePath(path) {
    const P = [path.start, ...path.segs];
    const segs = [];
    for (let i = path.segs.length - 1; i >= 0; i--) {
      const g = path.segs[i], to = P[i];
      segs.push(g.t === 'L' ? { t: 'L', x: to.x, y: to.y } : { t: 'A', x: to.x, y: to.y, cx: g.cx, cy: g.cy, cw: !g.cw });
    }
    const last = P[P.length - 1];
    return { start: { x: last.x, y: last.y }, closed: path.closed, segs };
  }
  function pointInPoly(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  function bounds(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x0, y0, x1, y1 };
  }
  function shapeBounds(s) { return bounds(pathToPoints(shapePath(s), 0.2)); }

  /* Žep: končni obris + cik-cak polnjenje */
  function pocket(s, tool, stepoverFrac) {
    const r = tool.d / 2, inner = offsetShape(s, -r);
    if (!inner.ok) return { ok: false };
    const poly = pathToPoints(inner.path, 0.05), b = bounds(poly);
    const step = Math.max(0.05, tool.d * stepoverFrac), strokes = [];
    let active = [], row = 0;
    const nearEdge = p => { for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], c = poly[i], dx = c.x - a.x, dy = c.y - a.y;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / ((dx * dx + dy * dy) || 1); t = Math.max(0, Math.min(1, t));
      if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 0.02) return true; } return false; };
    const okJoin = (a, c) => [0.2, 0.4, 0.6, 0.8].every(t => { const p = { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t }; return pointInPoly(p, poly) || nearEdge(p); });
    for (let y = b.y0 + step * 0.5; y < b.y1 - 1e-6; y += step, row++) {
      const xs = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], c = poly[j];
        if ((a.y > y) !== (c.y > y)) xs.push(a.x + (y - a.y) * (c.x - a.x) / (c.y - a.y));
      }
      xs.sort((p, q) => p - q);
      const iv = [];
      for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > 1e-4) iv.push([xs[k], xs[k + 1]]);
      const rev = row % 2 === 1, next = [], usedS = new Set(), segOf = [], pairs = [];
      iv.forEach(([x0, x1], k) => {
        segOf[k] = rev ? [{ x: x1, y }, { x: x0, y }] : [{ x: x0, y }, { x: x1, y }];
        active.forEach(st => {
          if (st.x1 < x0 || st.x0 > x1) return;
          const e = st.pts[st.pts.length - 1];
          pairs.push({ st, k, d: Math.hypot(e.x - segOf[k][0].x, e.y - segOf[k][0].y) });
        });
      });
      pairs.sort((p, q) => p.d - q.d);
      const taken = new Map();
      for (const p of pairs) {
        if (usedS.has(p.st) || taken.has(p.k)) continue;
        if (!okJoin(p.st.pts[p.st.pts.length - 1], segOf[p.k][0])) continue;
        usedS.add(p.st); taken.set(p.k, p.st);
      }
      const order = iv.map((_, k) => k); if (rev) order.reverse();
      for (const k of order) {
        const [x0, x1] = iv[k], sg = segOf[k], st0 = taken.get(k);
        if (st0) { st0.pts.push(...sg); st0.x0 = x0; st0.x1 = x1; next.push(st0); }
        else { const st = { pts: sg.slice(), x0, x1 }; strokes.push(st); next.push(st); }
      }
      active = next;
    }
    return { ok: true, strokes: strokes.map(st => st.pts), contour: inner.path };
  }

  function depthLevels(depth, stepdown) {
    const n = Math.max(1, Math.ceil(depth / Math.max(0.05, stepdown) - 1e-9));
    return Array.from({ length: n }, (_, i) => -depth * (i + 1) / n);
  }

  const OPS = {
    drill:   { label: 'Vrtanje',      order: 0, layer: 'VRTANJE',      aci: 4, color: '#0891b2' },
    engrave: { label: 'Gravura (po črti)', order: 1, layer: 'GRAVURA', aci: 6, color: '#a21caf' },
    pocket:  { label: 'Žep',           order: 2, layer: 'ZEP',          aci: 3, color: '#15803d' },
    inside:  { label: 'Notranji rez',  order: 3, layer: 'NOTRANJI_REZ', aci: 5, color: '#1d4ed8' },
    outside: { label: 'Zunanji rez',   order: 4, layer: 'ZUNANJI_REZ',  aci: 1, color: '#dc2626' },
  };
  function allowedOps(s) {
    if (!isClosed(s)) return ['engrave'];
    if (s.type === 'circle') return ['outside', 'inside', 'pocket', 'engrave', 'drill'];
    return ['outside', 'inside', 'pocket', 'engrave'];
  }
  function shapeDepth(doc, s) { return s.through && s.op !== 'engrave' && s.op !== 'pocket' ? doc.sheet.t + doc.cut.overcut : s.depth; }

  const POSTS = {
    grbl: { name: 'GRBL / grblHAL', ext: 'nc',
      head: c => ['G21 G90 G17 G94', `G0 Z${fmt(c.safeZ)}`, `M3 S${c.rpm}`, 'G4 P3'],
      foot: c => [`G0 Z${fmt(c.safeZ)}`, 'M5', 'G0 X0 Y0', 'M30'] },
    mach3: { name: 'Mach3 / Mach4', ext: 'tap',
      head: c => ['G21 G90 G17 G40 G49 G80', 'T1 M6', `G0 Z${fmt(c.safeZ)}`, `S${c.rpm} M3`, 'G4 P3'],
      foot: c => [`G0 Z${fmt(c.safeZ)}`, 'M5', 'G0 X0 Y0', 'M30'] },
    linuxcnc: { name: 'LinuxCNC', ext: 'ngc', pct: true,
      head: c => ['G21 G90 G17 G40 G49 G64 P0.02', 'T1 M6', `G0 Z${fmt(c.safeZ)}`, `S${c.rpm} M3`, 'G4 P3'],
      foot: c => [`G0 Z${fmt(c.safeZ)}`, 'M5', 'G0 X0 Y0', 'M2'] },
    xilog: { name: 'SCM Xilog Plus (.xxl)', ext: 'xxl' },
    iso: { name: 'ISO / Fanuc (s številkami vrstic)', ext: 'nc', pct: true, numbers: true, prog: 'O0001',
      head: c => ['G21 G90 G17 G40 G49 G80', 'T1 M6', `G0 Z${fmt(c.safeZ)}`, `S${c.rpm} M3`, 'G4 P3'],
      foot: c => [`G0 Z${fmt(c.safeZ)}`, 'M5', 'G0 X0 Y0', 'M30'] },
  };

  /* ---- Izhodni "zapisovalniki": G-koda in Xilog (XXL) imata isti vmesnik ---- */
  function gcodeWriter(doc, post) {
    const T = doc.tool, C = doc.cut, out = [];
    let pos = { x: 0, y: 0, z: C.safeZ };
    return {
      out, pos: () => pos,
      begin() {
        if (post.pct) out.push('%'); if (post.prog) out.push(post.prog);
        out.push(`(${ascii(doc.company || 'CNC')} - ${ascii(doc.name || 'projekt')})`);
        out.push(`(Plosca ${fmt(doc.sheet.w)} x ${fmt(doc.sheet.h)} x ${fmt(doc.sheet.t)} mm, X0 Y0 = spodnji levi kot, Z0 = vrh materiala)`);
        out.push(`(Orodje: rezkar fi ${fmt(T.d)} mm, ${T.rpm} obr/min, F${T.feed}, potop F${T.plunge})`);
        out.push(...post.head({ ...C, rpm: T.rpm }));
      },
      comment: t => out.push(`(${ascii(t)})`),
      travel(x, y) { if (pos.z < C.safeZ - 1e-6) { out.push(`G0 Z${fmt(C.safeZ)}`); pos.z = C.safeZ; } out.push(`G0 X${fmt(x)} Y${fmt(y)}`); out.push(`G0 Z${fmt(C.clearZ)}`); pos = { x, y, z: C.clearZ }; },
      plunge(z) { out.push(`G1 Z${fmt(z)} F${T.plunge}`); pos.z = z; },
      line(x, y) { out.push(`G1 X${fmt(x)} Y${fmt(y)} F${T.feed}`); pos.x = x; pos.y = y; },
      arc(g) { out.push(`${g.cw ? 'G2' : 'G3'} X${fmt(g.x)} Y${fmt(g.y)} I${fmt(g.cx - pos.x)} J${fmt(g.cy - pos.y)} F${T.feed}`); pos.x = g.x; pos.y = g.y; },
      lift() { out.push(`G0 Z${fmt(C.clearZ)}`); pos.z = C.clearZ; },
      drillBit: () => null,
      finish() {
        out.push(...post.foot(C));
        let body = out;
        if (post.numbers) { let n = 0; body = body.map(l => (l === '%' || l === post.prog || l.startsWith('(')) ? l : `N${(n += 10)} ${l}`); }
        if (post.pct) body.push('%');
        return body.join('\n') + '\n';
      },
    };
  }
  /* Xilog Plus (SCM) – po vzoru programov SolidCAM za ta stroj (PART2/PART3.xxl):
     Y je obrnjen (Y_stroj = -y), Z = globina v material (pozitivno), V v m/min,
     G=2 = v smeri urinega kazalca, kot ga vidiš na risbi, rezkanje obrisa po robu kosa s C=1 (stroj zamakne za polmer). */
  function xilogWriter(doc) {
    const T = doc.tool, X = doc.xxl, out = [];
    let pos = { x: 0, y: 0, z: doc.cut.safeZ }, open = false, startPt = null, firstFeed = true;
    const Y = y => fmt(-y), Z = z => fmt(-z), mpm = v => fmt(Math.round(v / 100) / 10);
    const G = cw => (cw ? 2 : 3);
    return {
      out, pos: () => pos, G, Y, Z, mpm,
      raw: l => out.push(l),
      begin() {
        out.push(X.header.replace(/\{DX\}/g, fmt(doc.sheet.w)).replace(/\{DY\}/g, fmt(doc.sheet.h)).replace(/\{DZ\}/g, fmt(doc.sheet.t)));
        out.push(';****************************************************************************');
        out.push(`;CAM_FileName: ${ascii(doc.name || 'projekt').slice(0, 60)}`);
        out.push(`;CNC risalnik - ${ascii(doc.company || '')}`);
        out.push(`;T${X.routerT}=REZKAR ${fmt(T.d)}MM`);
        for (const b of X.drills || []) out.push(`;T${b.T}=SVEDER ${fmt(b.d)}MM`);
        out.push(';****************************************************************************');
        out.push('IX=0', 'IY=0;', 'ROT A=0 X=0 Y=0', 'PL X=0 Y=0 Z=0 Q=0 R=0', ';', 'C=0', 'F=1');
      },
      section(title) { out.push(';Tilt Plane - POS 1', 'PL X=0 Y=0 Z=0 Q=0 R=0', ';******************************', `; ${ascii(title)}`, ';******************************', '; ', 'O X=0 Y=0 Z=0 F=1 ;Offset', '; '); },
      comment: t => out.push(`;${ascii(t)}`),
      travel(x, y) { open = false; startPt = { x, y }; pos = { x, y, z: doc.cut.clearZ }; },
      plunge(z) {
        if (!open) { out.push(`XG0 X=${fmt(startPt.x)} Y=${Y(startPt.y)} Z=${Z(z)} V=${mpm(T.plunge)} T=${X.routerT} P=0 D=${X.dOther} C=0 s=0`); open = true; firstFeed = true; }
        else out.push(`XL2P X=${fmt(pos.x)} Y=${Y(pos.y)} Z=${Z(z)}`);
        pos.z = z;
      },
      line(x, y) { out.push(`XL2P X=${fmt(x)} Y=${Y(y)} Z=${Z(pos.z)}${firstFeed ? ` V=${mpm(T.feed)}` : ''}`); firstFeed = false; pos.x = x; pos.y = y; },
      arc(g) { out.push(`XA2P X=${fmt(g.x)} Y=${Y(g.y)} Z=${Z(pos.z)} I=${fmt(g.cx)} J=${Y(g.cy)} G=${G(g.cw)}${firstFeed ? ` V=${mpm(T.feed)}` : ''}`); firstFeed = false; pos.x = g.x; pos.y = g.y; },
      lift() { open = false; pos.z = doc.cut.clearZ; },
      drillBit(d) { return (X.drills || []).find(b => Math.abs(b.d - d) < 0.01) || null; },
      drill(x, y, depth, b) { out.push(`B X=${fmt(x)} Y=${Y(y)} Z=${fmt(depth)} V=${b.V} S=${b.S} Q=0 R=1 x=0 y=0 D=2 G=1 T=${b.T}`); },
      finish() { out.push(';**********************************************************', ';END', ';**********************************************************', 'F=1', 'N X=0'); return out.join('\r\n') + '\r\n'; },
    };
  }

  /* pot začni na sredini najdaljše premice (za mehak vstop) */
  function startAtLongest(p) {
    const P = [p.start, ...p.segs];
    let best = -1, bl = 0;
    p.segs.forEach((g, i) => { if (g.t === 'L') { const l = dist(P[i], g); if (l > bl) { bl = l; best = i; } } });
    if (best < 0) return p;
    const a = P[best], b = p.segs[best], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const segs = [{ t: 'L', x: b.x, y: b.y }, ...p.segs.slice(best + 1), ...p.segs.slice(0, best), { t: 'L', x: m.x, y: m.y }];
    return { start: m, closed: true, segs };
  }
  function startTangent(p) {
    const g = p.segs[0], s = p.start;
    if (g.t === 'L') { const l = dist(s, g); return { x: (g.x - s.x) / l, y: (g.y - s.y) / l }; }
    const rx = s.x - g.cx, ry = s.y - g.cy, l = Math.hypot(rx, ry);
    return g.cw ? { x: ry / l, y: -rx / l } : { x: -ry / l, y: rx / l };
  }

  function generate(doc, format) {
    const T = doc.tool, C = doc.cut, r = T.d / 2, fmtKey = format || doc.post;
    const W = fmtKey === 'xilog' ? xilogWriter(doc) : gcodeWriter(doc, POSTS[fmtKey] || POSTS.grbl);
    const warnings = [], preview = [], st = { cut: 0, plunge: 0, rapid: 0, drills: 0 };
    const P = () => W.pos();
    const travel = (x, y) => { const p = P(); st.rapid += dist(p, { x, y }) + 2 * Math.abs(C.safeZ - C.clearZ); W.travel(x, y); };
    const plunge = z => { const p = P(); if (Math.abs(p.z - z) < 1e-6) return; st.plunge += Math.abs(p.z - z); W.plunge(z); };
    const line = (x, y) => { const d = dist(P(), { x, y }); if (d < 1e-6) return; st.cut += d; W.line(x, y); };
    const arc = g => { const a = arcSweep(P(), g); st.cut += a.r * a.sw; W.arc(g); };
    const runPath = p => { for (const g of p.segs) g.t === 'L' ? line(g.x, g.y) : arc(g); };
    const lift = () => { W.lift(); };

    function cutPathWithTabs(p, z, tabZ, tabs) {
      const pts = pathToPoints(p, 0.02), Ls = [0];
      for (let i = 1; i < pts.length; i++) Ls.push(Ls[i - 1] + dist(pts[i - 1], pts[i]));
      if (p.closed) { pts.push(pts[0]); Ls.push(Ls[Ls.length - 1] + dist(pts[pts.length - 2], pts[0])); }
      const total = Ls[Ls.length - 1], half = (C.tabW + T.d) / 2, iv = [];
      for (let k = 0; k < tabs; k++) { const c = total * (k + 0.5) / tabs; iv.push([c - half, c + half]); }
      const inTab = s => iv.some(([a, b]) => s > a && s < b);
      const cuts = new Set(Ls); iv.flat().forEach(s => { if (s > 0 && s < total) cuts.add(s); });
      const S = [...cuts].sort((a, b) => a - b);
      const at = s => { let i = 1; while (i < Ls.length - 1 && Ls[i] < s) i++; const t = (s - Ls[i - 1]) / ((Ls[i] - Ls[i - 1]) || 1);
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }; };
      for (let k = 1; k < S.length; k++) {
        plunge(inTab((S[k - 1] + S[k]) / 2) ? Math.max(z, tabZ) : z);
        const q = at(S[k]); line(q.x, q.y);
      }
    }

    const list = doc.shapes.filter(s => !s.hidden).slice().sort((a, b) => OPS[a.op].order - OPS[b.op].order);
    let drillSec = false;
    /* Xilog: obris po robu kosa, C=1, vstop/izstop po četrtinskem loku (kot SolidCAM) */
    function compProfile(s, op, depth, levels, nm) {
      const X = doc.xxl;
      let p = shapePath(s); if (op === 'inside') p = reversePath(p);
      p = startAtLongest(p);
      let R = 0;
      for (let k = 0; k <= 8; k++) {
        const cand = X.leadR * (1 - k / 10);
        if (cand < r + 1) break;
        if (op === 'outside' || offsetShape(s, -(r + cand + 1)).ok) { R = cand; break; }
      }
      if (!R) { warnings.push(`${nm}: odprtina je premajhna za vstopni lok – rezkano s sredino rezkarja (C=0, preveri na stroju).`); return false; }
      if (op === 'outside' && s.through && C.tabs > 0) warnings.push(`${nm}: mostički pri izvozu XXL niso podprti (kos drži vakuum).`);
      const u = startTangent(p), nR = { x: u.y, y: -u.x }, S = p.start;
      const c = { x: S.x + nR.x * R, y: S.y + nR.y * R }, A = { x: c.x - u.x * R, y: c.y - u.y * R }, B = { x: c.x + u.x * R, y: c.y + u.y * R };
      const D = op === 'outside' ? X.dOut : X.dIn;
      levels.forEach(z => {
        const zz = W.Z(z);
        W.raw(`XG0 X=${fmt(A.x)} Y=${W.Y(A.y)} Z=${zz} V=${W.mpm(T.plunge)} T=${X.routerT} P=0 D=${D} C=1 s=0`);
        W.raw(`XA2P X=${fmt(S.x)} Y=${W.Y(S.y)} Z=${zz} I=${fmt(c.x)} J=${W.Y(c.y)} G=${W.G(true)} V=${W.mpm(T.feed)}`);
        let cur = S;
        for (const g of p.segs) {
          if (g.t === 'L') W.raw(`XL2P X=${fmt(g.x)} Y=${W.Y(g.y)} Z=${zz}`);
          else W.raw(`XA2P X=${fmt(g.x)} Y=${W.Y(g.y)} Z=${zz} I=${fmt(g.cx)} J=${W.Y(g.cy)} G=${W.G(g.cw)}`);
          st.cut += g.t === 'L' ? dist(cur, g) : (() => { const a = arcSweep(cur, g); return a.r * a.sw; })(); cur = g;
        }
        W.raw(`XA2P X=${fmt(B.x)} Y=${W.Y(B.y)} Z=${zz} I=${fmt(c.x)} J=${W.Y(c.y)} G=${W.G(true)}`);
        st.cut += Math.PI * R; st.plunge += Math.abs(z); st.rapid += 300;
      });
      const off = offsetShape(s, op === 'outside' ? r : -r);
      preview.push({ kind: 'path', path: off.ok ? off.path : p, op });
      preview.push({ kind: 'poly', pts: pathToPoints({ start: A, closed: false, segs: [{ t: 'A', x: S.x, y: S.y, cx: c.x, cy: c.y, cw: true }] }, 0.3), op });
      return true;
    }
    W.begin();
    list.forEach(s => {
      let op = s.op;
      const depth = shapeDepth(doc, s), levels = depthLevels(depth, T.stepdown);
      const nm = s.name || `Element ${doc.shapes.indexOf(s) + 1}`;
      if (depth <= 0) { warnings.push(`${nm}: globina je 0.`); return; }
      if (depth > doc.sheet.t + C.overcut + 1e-6) warnings.push(`${nm}: globina ${fmt(depth)} mm je večja od debeline plošče.`);

      if (op === 'drill' && s.type === 'circle') {
        const d = s.r * 2, bit = W.drillBit(d);
        if (bit) { if (W.section && !drillSec) { W.section('luknje'); drillSec = true; } W.drill(s.cx, s.cy, depth, bit); st.drills++; preview.push({ kind: 'drill', x: s.cx, y: s.cy, r: d / 2 }); return; }
        if (d > T.d + 0.05) op = 'inside';
        else if (fmtKey === 'xilog') { warnings.push(`${nm}: ni svedra fi ${fmt(d)} in rezkar fi ${fmt(T.d)} je prevelik – luknja ni v programu.`); return; }
        else {
          if (d < T.d - 1e-6) warnings.push(`${nm}: luknja fi ${fmt(d)} je manjša od rezkarja fi ${fmt(T.d)}; izvrtana bo s fi ${fmt(T.d)}.`);
          W.comment(`${nm} - Vrtanje, globina ${fmt(depth)} mm`);
          travel(s.cx, s.cy); levels.forEach(z => { plunge(z); plunge(C.clearZ); }); lift();
          preview.push({ kind: 'drill', x: s.cx, y: s.cy, r }); return;
        }
      }
      if (W.section) W.section(`${nm} - ${OPS[op].label}`); else W.comment(`${nm} - ${OPS[op].label}, globina ${fmt(depth)} mm`);
      if (fmtKey === 'xilog' && (op === 'outside' || op === 'inside') && compProfile(s, op, depth, levels, nm)) return;
      if (op === 'engrave') {
        const p = shapePath(s);
        levels.forEach((z, i) => { if (i === 0 || !p.closed) { lift(); travel(p.start.x, p.start.y); } plunge(z); runPath(p); });
        lift(); preview.push({ kind: 'path', path: p, op }); return;
      }
      if (op === 'pocket') {
        const pk = pocket(s, T, C.stepover);
        if (!pk.ok) { warnings.push(`${nm}: rezkar fi ${fmt(T.d)} je prevelik za ta žep.`); return; }
        let contour = pk.contour; if (!C.climb) contour = reversePath(contour);
        levels.forEach(z => {
          pk.strokes.forEach(sk => { lift(); travel(sk[0].x, sk[0].y); plunge(z); sk.slice(1).forEach(q => line(q.x, q.y)); });
          lift(); travel(contour.start.x, contour.start.y); plunge(z); runPath(contour);
        });
        lift();
        pk.strokes.forEach(sk => preview.push({ kind: 'poly', pts: sk, op }));
        preview.push({ kind: 'path', path: contour, op }); return;
      }
      const off = offsetShape(s, op === 'outside' ? r : -r);
      if (!off.ok) { warnings.push(`${nm}: rezkar fi ${fmt(T.d)} je prevelik za to obliko (notranji rez).`); return; }
      let p = off.path;
      if (op === 'outside' ? C.climb : !C.climb) p = reversePath(p);
      const useTabs = op === 'outside' && s.through && C.tabs > 0 && C.tabH > 0;
      const tabZ = -(doc.sheet.t - C.tabH);
      if (useTabs && pathLength(p) < C.tabs * (C.tabW + T.d) * 1.5) warnings.push(`${nm}: kos je premajhen za ${C.tabs} mostičke.`);
      lift(); travel(p.start.x, p.start.y);
      levels.forEach(z => { if (useTabs && z < tabZ - 1e-6) cutPathWithTabs(p, z, tabZ, C.tabs); else { plunge(z); runPath(p); } });
      lift(); preview.push({ kind: 'path', path: p, op, tabs: useTabs ? C.tabs : 0 });
    });
    const code = W.finish();
    const minutes = st.cut / T.feed + st.plunge / T.plunge + st.rapid / 5000 + st.drills * 0.05;
    return { gcode: code, warnings, preview, stats: { ...st, minutes, ops: list.length } };
  }

  /* ---- DXF (R12, ASCII, mm) — en layer na operacijo + globino ---- */
  function layerName(doc, s) { return `${OPS[s.op].layer}_D${fmt(shapeDepth(doc, s)).replace('.', '_')}`; }
  function toDXF(doc) {
    const ents = [], layers = new Map([['PLOSCA', 8]]);
    const add = (...kv) => ents.push(...kv);
    const ang = (c, p) => { let a = Math.atan2(p.y - c.cy, p.x - c.cx) * 180 / Math.PI; return a < 0 ? a + 360 : a; };
    const sheet = rectPath(0, 0, doc.sheet.w, doc.sheet.h, 0);
    const emitPath = (p, layer) => {
      let cur = p.start;
      for (const g of p.segs) {
        if (g.t === 'L') add('0', 'LINE', '8', layer, '10', fmt(cur.x), '20', fmt(cur.y), '30', '0', '11', fmt(g.x), '21', fmt(g.y), '31', '0');
        else {
          const r = Math.hypot(cur.x - g.cx, cur.y - g.cy);
          const [sa, ea] = g.cw ? [ang(g, g), ang(g, cur)] : [ang(g, cur), ang(g, g)];
          add('0', 'ARC', '8', layer, '10', fmt(g.cx), '20', fmt(g.cy), '30', '0', '40', fmt(r), '50', fmt(sa), '51', fmt(ea));
        }
        cur = g;
      }
    };
    emitPath(sheet, 'PLOSCA');
    doc.shapes.filter(s => !s.hidden).forEach(s => {
      const L = layerName(doc, s); layers.set(L, OPS[s.op].aci);
      if (s.type === 'circle') add('0', 'CIRCLE', '8', L, '10', fmt(s.cx), '20', fmt(s.cy), '30', '0', '40', fmt(s.r));
      else emitPath(shapePath(s), L);
    });
    const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4',
      '9', '$EXTMIN', '10', '0', '20', '0', '9', '$EXTMAX', '10', fmt(doc.sheet.w), '20', fmt(doc.sheet.h), '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0', '0', 'ENDTAB',
      '0', 'TABLE', '2', 'LAYER', '70', String(layers.size)];
    for (const [n, c] of layers) out.push('0', 'LAYER', '2', n, '70', '0', '62', String(c), '6', 'CONTINUOUS');
    out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...ents, '0', 'ENDSEC', '0', 'EOF');
    return out.join('\r\n') + '\r\n';
  }

  function pathToSVGd(p) {
    let d = `M${fmt(p.start.x)} ${fmt(p.start.y)}`, cur = p.start;
    for (const g of p.segs) {
      if (g.t === 'L') d += ` L${fmt(g.x)} ${fmt(g.y)}`;
      else { const a = arcSweep(cur, g); d += ` A${fmt(a.r)} ${fmt(a.r)} 0 ${a.sw > Math.PI ? 1 : 0} ${g.cw ? 0 : 1} ${fmt(g.x)} ${fmt(g.y)}`; }
      cur = g;
    }
    return d + (p.closed ? ' Z' : '');
  }
  function toSVG(doc) {
    const W = doc.sheet.w, H = doc.sheet.h;
    const body = doc.shapes.filter(s => !s.hidden).map(s =>
      `<path d="${pathToSVGd(shapePath(s))}" fill="none" stroke="${OPS[s.op].color}" stroke-width="0.3" data-op="${s.op}" data-depth="${fmt(shapeDepth(doc, s))}"/>`).join('\n  ');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}">\n<g transform="translate(0 ${fmt(H)}) scale(1 -1)">\n  <rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="none" stroke="#999" stroke-width="0.2"/>\n  ${body}\n</g>\n</svg>\n`;
  }

  return { fmt, area, shapePath, offsetShape, polygonOffset, pathToPoints, pathLength, reversePath, pointInPoly,
    bounds, shapeBounds, pocket, depthLevels, OPS, POSTS, allowedOps, isClosed, shapeDepth, generate, toDXF, toSVG, pathToSVGd, arcSweep };
})();
if (typeof module !== 'undefined') module.exports = CNC;
