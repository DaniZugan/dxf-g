/* ===== Predloge: parametrični kosi za delavnico ===== */
const TPL = (() => {
  const R = (x, y, w, h, op, depth, extra = {}) => ({ type: 'rect', x, y, w, h, r: 0, op, through: depth == null, depth: depth ?? 18, ...extra });
  const C = (cx, cy, d, op, depth) => ({ type: 'circle', cx, cy, r: d / 2, op, through: depth == null, depth: depth ?? 18 });
  const holeOp = () => 'drill'; // generator izbere sveder ali rezkar
  // utor čez cel kos v smeri X ali Y (podaljšan čez rob, da rezkar pride do roba)
  // utor, ki ni širši od rezkarja, se rezka kot gravura po sredinski črti (širina = premer rezkarja)
  let TOOL = 6;
  const line = (a, b, dep) => ({ type: 'poly', closed: false, pts: [a, b], op: 'engrave', through: false, depth: dep, name: 'Utor' });
  const grooveX = (len, y, wid, dep, ext) => wid <= TOOL + 0.05 ? line({ x: -ext, y: y + wid / 2 }, { x: len + ext, y: y + wid / 2 }, dep) : R(-ext, y, len + 2 * ext, wid, 'pocket', dep, { name: 'Utor' });
  const grooveY = (len, x, wid, dep, ext) => wid <= TOOL + 0.05 ? line({ x: x + wid / 2, y: -ext }, { x: x + wid / 2, y: len + ext }, dep) : R(x, -ext, wid, len + 2 * ext, 'pocket', dep, { name: 'Utor' });
  const narrowNote = (w, tool) => w < tool - 0.05 ? [`Utor ${w} mm je ožji od rezkarja ⌀${tool} – izrezkan bo širok ${tool} mm (po sredini).`] : [];

  function pinRows(w, h, p, tool, fromBack) {
    // System 32: luknje za nosilce polic, simetrično po višini
    const out = [], d = p.pinD, xs = [p.pinIn, w - p.pinIn - fromBack];
    const usable = h - 2 * p.pinStart, n = Math.max(0, Math.floor(usable / 32));
    const y0 = (h - n * 32) / 2;
    for (const x of xs) for (let k = 0; k <= n; k++) out.push({ ...C(x, y0 + k * 32, d, holeOp(d, tool), p.pinDepth), name: 'Luknja za nosilec' });
    return out;
  }

  const LIST = {
    korpus: {
      name: 'Korpus omarice', desc: 'Stranici, dno, strop in police. Po želji utor za hrbet (HDF) in luknje za nosilce polic (sistem 32).',
      fields: [
        ['W', 'Zunanja širina', 600], ['H', 'Zunanja višina', 720], ['D', 'Globina', 560], ['shelves', 'Število polic', 2, 'kos'],
        ['back', 'Utor za hrbet', true, 'bool'], ['backW', 'Širina utora za hrbet', 4], ['backDepth', 'Globina utora', 8], ['backIn', 'Odmik utora od zadnjega roba', 15],
        ['pins', 'Luknje za nosilce polic', true, 'bool'], ['pinD', 'Premer luknje', 5], ['pinDepth', 'Globina luknje', 10], ['pinIn', 'Odmik vrste lukenj od roba', 37], ['pinStart', 'Prosto od roba (zgoraj/spodaj)', 120],
      ],
      make(p, t, tool) {
        const ext = tool / 2 + 1, parts = [], back = p.back ? p.backIn + p.backW : 0;
        const side = [];
        if (p.back) side.push(grooveY(p.H, p.D - p.backIn - p.backW, p.backW, p.backDepth, ext));
        if (p.pins && p.shelves > 0) side.push(...pinRows(p.D, p.H, p, tool, back));
        parts.push({ name: 'Stranica leva', w: p.D, h: p.H, feats: side });
        parts.push({ name: 'Stranica desna', w: p.D, h: p.H, feats: side });
        const inner = p.W - 2 * t, hz = p.back ? [grooveX(inner, p.D - p.backIn - p.backW, p.backW, p.backDepth, ext)] : [];
        parts.push({ name: 'Dno', w: inner, h: p.D, feats: hz });
        parts.push({ name: 'Strop', w: inner, h: p.D, feats: hz });
        for (let i = 0; i < p.shelves; i++) parts.push({ name: `Polica ${i + 1}`, w: inner - 2, h: p.D - (p.back ? back + 2 : 0) - 20, feats: [] });
        const notes = p.back ? narrowNote(p.backW, tool) : [];
        if (p.back) notes.push(`Hrbet (HDF) ni na tej plošči: ${Math.round(inner + 2 * (t - p.backDepth) - 2)} × ${Math.round(p.H - 2 * t + 2 * p.backDepth - 2)} mm.`);
        return { parts, notes };
      },
    },
    predal: {
      name: 'Predal', desc: 'Stranici, sprednja in zadnja stranica ter utor za dno (vse štiri stranice).',
      fields: [['W', 'Zunanja širina', 450], ['H', 'Višina', 140], ['D', 'Globina', 500], ['bottom', 'Utor za dno', true, 'bool'],
        ['botW', 'Širina utora', 4], ['botDepth', 'Globina utora', 8], ['botUp', 'Odmik utora od spodnjega roba', 12]],
      make(p, t, tool) {
        const ext = tool / 2 + 1;
        const gr = len => p.bottom ? [grooveX(len, p.botUp, p.botW, p.botDepth, ext)] : [];
        const inner = p.W - 2 * t;
        return { parts: [
          { name: 'Stranica predala L', w: p.D, h: p.H, feats: gr(p.D) }, { name: 'Stranica predala D', w: p.D, h: p.H, feats: gr(p.D) },
          { name: 'Sprednja stranica', w: inner, h: p.H, feats: gr(inner) }, { name: 'Zadnja stranica', w: inner, h: p.H, feats: gr(inner) }],
          notes: p.bottom ? [...narrowNote(p.botW, tool), `Dno (HDF): ${Math.round(inner + 2 * p.botDepth - 2)} × ${Math.round(p.D - 2 * t + 2 * p.botDepth - 2)} mm.`] : [] };
      },
    },
    luknje: {
      name: 'Plošča z luknjami', desc: 'Pravokotna plošča z mrežo lukenj, npr. pokrov, perforirana plošča, nosilna plošča.',
      fields: [['W', 'Širina', 400], ['H', 'Višina', 300], ['r', 'Zaobljenje kotov', 10], ['d', 'Premer lukenj', 10],
        ['cols', 'Stolpcev', 4, 'kos'], ['rows', 'Vrstic', 3, 'kos'], ['m', 'Odmik od roba (do središča)', 40], ['hd', 'Globina lukenj (0 = skozi)', 0]],
      make(p, t, tool) {
        const f = [], dx = p.cols > 1 ? (p.W - 2 * p.m) / (p.cols - 1) : 0, dy = p.rows > 1 ? (p.H - 2 * p.m) / (p.rows - 1) : 0;
        for (let i = 0; i < p.cols; i++) for (let j = 0; j < p.rows; j++)
          f.push({ ...C(p.cols > 1 ? p.m + i * dx : p.W / 2, p.rows > 1 ? p.m + j * dy : p.H / 2, p.d, holeOp(p.d, tool), p.hd > 0 ? p.hd : null), name: 'Luknja' });
        return { parts: [{ name: 'Plošča', w: p.W, h: p.H, r: p.r, feats: f }], notes: [] };
      },
    },
    fronta: {
      name: 'Fronta z ročajem', desc: 'Vrata ali čelo predala z izrezanim ročajem (podolgovata luknja) in luknjama za skodelični tečaj.',
      fields: [['W', 'Širina', 396], ['H', 'Višina', 716], ['r', 'Zaobljenje kotov', 0], ['hl', 'Dolžina ročaja', 140], ['hw', 'Širina ročaja', 30],
        ['ht', 'Odmik ročaja od zgornjega roba', 60], ['hinge', 'Luknje za tečaje ⌀35', true, 'bool'], ['hingeDepth', 'Globina za tečaj', 12.5]],
      make(p, t, tool) {
        const f = [{ type: 'rect', x: (p.W - p.hl) / 2, y: p.H - p.ht - p.hw, w: p.hl, h: p.hw, r: p.hw / 2, op: 'inside', through: true, depth: 18, name: 'Ročaj' }];
        if (p.hinge) for (const y of [100, p.H - 100]) f.push({ ...C(22.5, y, 35, 'pocket', p.hingeDepth), name: 'Tečaj' });
        return { parts: [{ name: 'Fronta', w: p.W, h: p.H, r: p.r, feats: f }], notes: p.hinge ? ['Tečaji so na levi strani (središče 22,5 mm od roba). Za desna vrata kos obrni.'] : [] };
      },
    },
    krog: {
      name: 'Okrogla plošča', desc: 'Okrogla mizna plošča, podstavek ali pokrov, po želji z luknjo na sredini.',
      fields: [['D', 'Premer', 500], ['hole', 'Luknja na sredini (0 = brez)', 0]],
      make(p, t, tool) {
        const f = p.hole > 0 ? [{ ...C(p.D / 2, p.D / 2, p.hole, holeOp(p.hole, tool), null), name: 'Sredinska luknja' }] : [];
        return { parts: [{ name: 'Okrogla plošča', w: p.D, h: p.D, round: true, feats: f }], notes: [] };
      },
    },
  };

  /* zasuk dela za 90° (v nasprotni smeri urinega kazalca), lokalne koordinate */
  function rot(s, H) {
    const P = q => ({ x: H - q.y, y: q.x });
    if (s.type === 'rect') return { ...s, x: H - (s.y + s.h), y: s.x, w: s.h, h: s.w };
    if (s.type === 'circle') { const c = P({ x: s.cx, y: s.cy }); return { ...s, cx: c.x, cy: c.y }; }
    return { ...s, pts: s.pts.map(P) };
  }
  function shift(s, dx, dy) {
    if (s.type === 'rect') return { ...s, x: s.x + dx, y: s.y + dy };
    if (s.type === 'circle') return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    return { ...s, pts: s.pts.map(q => ({ x: q.x + dx, y: q.y + dy })) };
  }

  /* Razporeditev "spodaj-levo": units {w,h}, zasedeno [{x,y,w,h}] */
  function pack(units, occupied, sheet, gap, margin, allowRot) {
    const occ = occupied.slice(), res = [];
    const order = units.map((u, i) => i).sort((a, b) => Math.max(units[b].w, units[b].h) - Math.max(units[a].w, units[a].h) || units[b].w * units[b].h - units[a].w * units[a].h);
    let overflowX = sheet.w + gap * 3;
    for (const i of order) {
      const u = units[i]; let best = null;
      for (const turn of allowRot && u.w !== u.h ? [false, true] : [false]) {
        const w = turn ? u.h : u.w, h = turn ? u.w : u.h;
        const xs = [margin, ...occ.map(o => o.x + o.w + gap)], ys = [margin, ...occ.map(o => o.y + o.h + gap)];
        for (const y of ys) for (const x of xs) {
          if (x + w > sheet.w - margin + 1e-6 || y + h > sheet.h - margin + 1e-6) continue;
          if (occ.some(o => x < o.x + o.w + gap - 1e-6 && o.x < x + w + gap - 1e-6 && y < o.y + o.h + gap - 1e-6 && o.y < y + h + gap - 1e-6)) continue;
          if (!best || y < best.y - 1e-6 || (Math.abs(y - best.y) < 1e-6 && x < best.x)) best = { x, y, turn, w, h };
        }
      }
      if (!best) { best = { x: overflowX, y: margin, turn: false, w: u.w, h: u.h, out: true }; overflowX += u.w + gap; }
      occ.push({ x: best.x, y: best.y, w: best.w, h: best.h }); res[i] = best;
    }
    return res;
  }

  /* pretvori dele v oblike na plošči */
  function build(parts, placed) {
    const shapes = [];
    parts.forEach((pt, i) => {
      const pl = placed[i]; let H = pt.h;
      let outline = pt.round ? { type: 'circle', cx: pt.w / 2, cy: pt.h / 2, r: pt.w / 2 } : { type: 'rect', x: 0, y: 0, w: pt.w, h: pt.h, r: pt.r || 0 };
      let feats = pt.feats.map(f => ({ ...f }));
      if (pl.turn) { outline = rot(outline, H); feats = feats.map(f => rot(f, H)); }
      const gid = `g${Date.now().toString(36)}${i}`;
      shapes.push({ ...shift(outline, pl.x, pl.y), name: pt.name, op: 'outside', through: true, depth: 18, group: gid, gname: pt.name, outline: true });
      feats.forEach(f => shapes.push({ ...shift(f, pl.x, pl.y), name: `${pt.name} – ${f.name || 'detajl'}`, group: gid, gname: pt.name }));
    });
    return shapes;
  }

  const make = (key, p, t, tool) => { TOOL = tool; return LIST[key].make(p, t, tool); };
  return { LIST, make, pack, build, shift };
})();
