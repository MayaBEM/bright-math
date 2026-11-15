/* Protractor Teaching Board — Bright EngMath
   Runs offline from Protractor-Teaching-Board.html. Uses PDF.js 3.11.174 (main-thread worker) and jsPDF 2.5.2. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const pdfjsLib = window.pdfjsLib;
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-3.11.174/pdf.worker.min.js';
    if (pdfjsLib.VerbosityLevel) pdfjsLib.verbosity = pdfjsLib.VerbosityLevel.ERRORS;
  }

  /* ---------------- constants ---------------- */
  const PEN_COLORS = [
    { name: 'Black', c: '#1b1f24' }, { name: 'Red', c: '#d32f2f' }, { name: 'Blue', c: '#1565c0' },
    { name: 'Green', c: '#2e7d32' }, { name: 'Orange', c: '#ef6c00' }, { name: 'Pink', c: '#c2185b' },
  ];
  const HL_COLORS = [
    { name: 'Yellow', c: '#ffd84a' }, { name: 'Green', c: '#9be38c' }, { name: 'Blue', c: '#8fd0ff' },
    { name: 'Pink', c: '#ffa6d2' }, { name: 'Orange', c: '#ffbf73' }, { name: 'Gray', c: '#c3c9d1' },
  ];
  const PEN_SIZES = [2.5, 5, 9];
  const HL_SIZES = [12, 20, 32];
  const SIZE_NAMES = ['Thin', 'Medium', 'Thick'];
  const TEXT_SIZES = [18, 28, 40];      // page units (points)
  const TEXT_SIZE_NAMES = ['Small', 'Medium', 'Large'];
  const MM = 72 / 25.4, CM = MM * 10, INCH = 72;   // real sizes in PDF points
  const RPAD = 18, RW = 72;            // ruler end margin and width (page units)
  const HL_ALPHA = 0.55;
  const MIN_ZOOM = 0.1, MAX_ZOOM = 8;
  const COLORS = {
    inner: '#c0392b', outer: '#1d4f91', mono: '#15191e', tick: '#1d2530',
    body: 'rgba(229, 238, 244, 0.52)', edge: '#27313d', arm: '#1f2a37', handle: '#d9603b',
  };

  /* ---------------- state ---------------- */
  const S = {
    doc: null,          // { name, kind, pdf, pages: [{ w, h, type, n, img }] }
    page: 0,
    ink: [],            // per page { strokes, undo, redo }
    view: { s: 1, x: 0, y: 0 },
    fitted: true,
    tool: 'pen',
    lineMode: false,
    penColor: 0, hlColor: 0, penSize: 1, hlSize: 1,
    prot: { x: 300, y: 300, r: 200, rot: 0, arm: 40, visible: false, locked: false, mode: 180, twoColor: true, reading: true, armOn: true, placed: false },
    shape: 'arrow',
    ruler: { x: 100, y: 100, rot: 0, len: 15 * CM, visible: false, placed: false },
    cover: { on: false, y: 0 },
    dirty: false,
  };

  /* ---------------- DOM ---------------- */
  const stage = $('#stage');
  const cv = { page: $('#cvPage'), ink: $('#cvInk'), live: $('#cvLiveInk'), cover: $('#cvCover'), prot: $('#cvProt'), laser: $('#cvLaser') };
  const ctx = {};
  for (const k in cv) ctx[k] = cv[k].getContext('2d');
  let W = 0, H = 0, dpr = 1;

  /* ================================================================
     Geometry helpers
     ================================================================ */
  const toPage = (sx, sy) => ({ x: (sx - S.view.x) / S.view.s, y: (sy - S.view.y) / S.view.s });
  const toScreen = (px, py) => ({ x: px * S.view.s + S.view.x, y: py * S.view.s + S.view.y });
  const curPage = () => (S.doc ? S.doc.pages[S.page] : null);
  const curInk = () => S.ink[S.page];

  /* ================================================================
     Layout / sizing
     ================================================================ */
  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    for (const k in cv) {
      cv[k].width = Math.round(W * dpr);
      cv[k].height = Math.round(H * dpr);
    }
    if (S.doc && S.fitted) fitPage(false);
    drawAll();
    scheduleSharp();
  }

  function fitPage(redraw = true) {
    const pg = curPage();
    if (!pg) return;
    const padX = 40, padTop = 28, padBottom = 84;
    const s = Math.min((W - padX * 2) / pg.w, (H - padTop - padBottom) / pg.h);
    S.view.s = clamp(s, MIN_ZOOM, MAX_ZOOM);
    S.view.x = (W - pg.w * S.view.s) / 2;
    S.view.y = padTop + (H - padTop - padBottom - pg.h * S.view.s) / 2;
    S.fitted = true;
    if (redraw) { drawAll(); scheduleSharp(); }
    updateZoomLabel();
  }

  function zoomAt(sx, sy, factor) {
    const v = S.view;
    const ns = clamp(v.s * factor, MIN_ZOOM, MAX_ZOOM);
    const k = ns / v.s;
    v.x = sx - (sx - v.x) * k;
    v.y = sy - (sy - v.y) * k;
    v.s = ns;
    S.fitted = false;
    viewChanged();
  }

  function viewChanged() {
    updateZoomLabel();
    drawAll();
    scheduleSharp();
  }

  function updateZoomLabel() {
    $('#zoomLabel').textContent = Math.round(S.view.s * 100) + '%';
  }

  /* ================================================================
     Rendering — page layer
     ================================================================ */
  const pdfPageCache = new Map(); // n -> Promise<PDFPageProxy>
  const baseCache = new Map();    // pageIndex -> { canvas, scale }
  const basePending = new Set();
  let sharp = null;               // { canvas, page, s, x, y }
  let sharpTimer = 0, sharpTask = null, sharpToken = 0;

  function getPdfPage(n) {
    if (!pdfPageCache.has(n)) pdfPageCache.set(n, S.doc.pdf.getPage(n));
    return pdfPageCache.get(n);
  }

  function ensureBase(idx) {
    const doc = S.doc;
    if (!doc || baseCache.has(idx) || basePending.has(idx)) return;
    const pg = doc.pages[idx];
    if (!pg || pg.type !== 'pdf') return;
    basePending.add(idx);
    const scale = Math.min(3, 2200 / Math.max(pg.w, pg.h));
    getPdfPage(pg.n).then((page) => {
      const c = document.createElement('canvas');
      const vp = page.getViewport({ scale });
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: cx, viewport: vp }).promise.then(() => {
        if (S.doc !== doc) return;
        baseCache.set(idx, { canvas: c, scale });
        // keep memory bounded
        if (baseCache.size > 8) {
          for (const k of baseCache.keys()) {
            if (Math.abs(k - S.page) > 2) { baseCache.delete(k); break; }
          }
        }
        if (idx === S.page) drawPageLayer();
      });
    }).catch((err) => { if (!isCancel(err)) console.warn(err); })
      .finally(() => basePending.delete(idx));
  }

  function isCancel(err) { return err && (err.name === 'RenderingCancelledException' || /cancel/i.test(err.message || '')); }

  function scheduleSharp() {
    clearTimeout(sharpTimer);
    sharpTimer = setTimeout(renderSharp, 140);
  }

  function renderSharp() {
    const pg = curPage();
    if (!pg || pg.type !== 'pdf') return;
    const base = baseCache.get(S.page);
    const v = { ...S.view };
    // the base bitmap is already sharp enough
    if (base && v.s * dpr <= base.scale * 1.02) { sharp = null; return; }
    if (sharp && sharp.page === S.page && sharp.s === v.s && sharp.x === v.x && sharp.y === v.y && sharp.w === W && sharp.h === H) return;
    if (sharpTask) { try { sharpTask.cancel(); } catch (e) { /* ignore */ } }
    const token = ++sharpToken;
    const pageIdx = S.page;
    getPdfPage(pg.n).then((page) => {
      if (token !== sharpToken) return;
      const c = document.createElement('canvas');
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      const cx = c.getContext('2d');
      const vp = page.getViewport({ scale: v.s * dpr, offsetX: v.x * dpr, offsetY: v.y * dpr });
      sharpTask = page.render({ canvasContext: cx, viewport: vp });
      return sharpTask.promise.then(() => {
        if (token !== sharpToken || pageIdx !== S.page) return;
        sharp = { canvas: c, page: pageIdx, s: v.s, x: v.x, y: v.y, w: W, h: H };
        drawPageLayer();
      });
    }).catch((err) => { if (!isCancel(err)) console.warn(err); });
  }

  function drawGrid(c, pg, s, ox, oy) {
    const step = 18; // quarter inch
    const x0 = ox, y0 = oy, w = pg.w * s, h = pg.h * s;
    c.save();
    c.beginPath();
    for (let i = 1, x = step; x < pg.w; i++, x += step) { if (i % 4) { c.moveTo(x0 + x * s, y0); c.lineTo(x0 + x * s, y0 + h); } }
    for (let i = 1, y = step; y < pg.h; i++, y += step) { if (i % 4) { c.moveTo(x0, y0 + y * s); c.lineTo(x0 + w, y0 + y * s); } }
    c.strokeStyle = '#d6e2ea'; c.lineWidth = Math.max(0.6, 0.5 * s); c.stroke();
    c.beginPath();
    for (let x = step * 4; x < pg.w; x += step * 4) { c.moveTo(x0 + x * s, y0); c.lineTo(x0 + x * s, y0 + h); }
    for (let y = step * 4; y < pg.h; y += step * 4) { c.moveTo(x0, y0 + y * s); c.lineTo(x0 + w, y0 + y * s); }
    c.strokeStyle = '#b4c8d6'; c.lineWidth = Math.max(0.8, 0.8 * s); c.stroke();
    c.restore();
  }

  function drawPageLayer() {
    const c = ctx.page;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.page.width, cv.page.height);
    const pg = curPage();
    if (!pg) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { s, x, y } = S.view;
    const w = pg.w * s, h = pg.h * s;
    c.fillStyle = '#fff'; c.fillRect(x, y, w, h);
    c.lineWidth = 1; c.strokeStyle = '#c9c0b1'; c.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    if (pg.type === 'pdf') {
      const base = baseCache.get(S.page);
      if (base) c.drawImage(base.canvas, x, y, w, h);
      else ensureBase(S.page);
      if (sharp && sharp.page === S.page) {
        const k = s / sharp.s;
        c.drawImage(sharp.canvas, x - sharp.x * k, y - sharp.y * k, sharp.w * k, sharp.h * k);
      }
    } else if (pg.type === 'image') {
      c.drawImage(pg.img, x, y, w, h);
    } else if (pg.type === 'grid') {
      drawGrid(c, pg, s, x, y);
    }
    c.restore();
  }

  /* ================================================================
     Rendering — ink
     ================================================================ */
  function strokeColor(st) { return st.c; }

  function textFont(px) { return `500 ${px}px -apple-system, "Segoe UI", "Helvetica Neue", Arial, "Noto Sans Thai", Thonburi, sans-serif`; }
  const mctx = document.createElement('canvas').getContext('2d');
  function textSize(it) {
    mctx.font = textFont(it.fs);
    const lines = (it.t || '').split('\n');
    let w = 0;
    for (const l of lines) w = Math.max(w, mctx.measureText(l).width);
    return { w: Math.max(w, it.fs * 0.5), h: lines.length * it.fs * 1.25 };
  }
  function drawText(c, it, s, ox, oy) {
    const px = it.fs * s, lh = px * 1.25;
    c.save();
    c.font = textFont(px); c.fillStyle = it.c; c.textBaseline = 'top';
    it.t.split('\n').forEach((ln, i) => c.fillText(ln, it.pts[0] * s + ox, it.pts[1] * s + oy + i * lh + (lh - px) / 2));
    c.restore();
  }
  function drawShape(c, it, s, ox, oy) {
    const x1 = it.pts[0] * s + ox, y1 = it.pts[1] * s + oy, x2 = it.pts[2] * s + ox, y2 = it.pts[3] * s + oy;
    c.save();
    c.strokeStyle = c.fillStyle = it.c;
    c.lineWidth = Math.max(0.75, it.w * s); c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    if (it.s === 'rect') c.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    else if (it.s === 'ellipse') c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, TAU);
    else if (it.s === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(3.4 * it.w, 9) * s;
      const len = Math.hypot(x2 - x1, y2 - y1), back = Math.min(hl * 0.6, len);
      c.moveTo(x1, y1); c.lineTo(x2 - Math.cos(ang) * back, y2 - Math.sin(ang) * back); c.stroke();
      c.beginPath(); c.moveTo(x2, y2);
      c.lineTo(x2 - hl * Math.cos(ang - 0.42), y2 - hl * Math.sin(ang - 0.42));
      c.lineTo(x2 - hl * Math.cos(ang + 0.42), y2 - hl * Math.sin(ang + 0.42));
      c.closePath(); c.fill();
      c.restore(); return;
    } else { c.moveTo(x1, y1); c.lineTo(x2, y2); }
    c.stroke();
    c.restore();
  }

  function drawStroke(c, st, s, ox, oy, forExport) {
    if (st.hidden) return;
    if (st.k === 'text') { drawText(c, st, s, ox, oy); return; }
    if (st.k === 'shape') { drawShape(c, st, s, ox, oy); return; }
    const p = st.pts, n = p.length / 2;
    if (!n) return;
    c.save();
    c.lineCap = st.k === 'hl' ? 'round' : 'round';
    c.lineJoin = 'round';
    c.strokeStyle = c.fillStyle = strokeColor(st);
    if (st.k === 'hl') {
      c.globalAlpha = HL_ALPHA;
      if (forExport) c.globalCompositeOperation = 'multiply';
    }
    const lw = Math.max(0.75, st.w * s);
    c.lineWidth = lw;
    if (n === 1) {
      c.beginPath(); c.arc(p[0] * s + ox, p[1] * s + oy, lw / 2, 0, TAU); c.fill();
    } else {
      c.beginPath();
      c.moveTo(p[0] * s + ox, p[1] * s + oy);
      if (n === 2 || st.line) {
        c.lineTo(p[2 * (n - 1)] * s + ox, p[2 * (n - 1) + 1] * s + oy);
      } else {
        for (let i = 1; i < n - 1; i++) {
          const x1 = p[2 * i] * s + ox, y1 = p[2 * i + 1] * s + oy;
          const x2 = p[2 * i + 2] * s + ox, y2 = p[2 * i + 3] * s + oy;
          c.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
        }
        c.lineTo(p[2 * (n - 1)] * s + ox, p[2 * (n - 1) + 1] * s + oy);
      }
      c.stroke();
    }
    c.restore();
  }

  function drawInkLayer() {
    const c = ctx.ink;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.ink.width, cv.ink.height);
    const pg = curPage();
    if (!pg) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { s, x, y } = S.view;
    c.save();
    c.beginPath(); c.rect(x, y, pg.w * s, pg.h * s); c.clip();
    for (const st of curInk().strokes) drawStroke(c, st, s, x, y);
    c.restore();
  }

  function drawLiveInk() {
    const c = ctx.live;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.live.width, cv.live.height);
    const pg = curPage();
    if (!pg) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { s, x, y } = S.view;
    if (action && (action.type === 'draw' || action.type === 'shape')) {
      c.save();
      c.beginPath(); c.rect(x, y, pg.w * s, pg.h * s); c.clip();
      drawStroke(c, action.stroke, s, x, y);
      c.restore();
    }
    if (sel.length) {
      c.save();
      c.setLineDash([6, 4]); c.lineWidth = 1.5; c.strokeStyle = '#1d4f91';
      for (const it of sel) {
        const b = itemBox(it);
        c.strokeRect(b.x * s + x - 5, b.y * s + y - 5, b.w * s + 10, b.h * s + 10);
      }
      c.restore();
    }
    if (action && action.type === 'band') {
      c.save();
      const bx = Math.min(action.x0, action.x1), by = Math.min(action.y0, action.y1);
      c.fillStyle = 'rgba(29, 79, 145, 0.08)'; c.fillRect(bx, by, Math.abs(action.x1 - action.x0), Math.abs(action.y1 - action.y0));
      c.setLineDash([6, 4]); c.lineWidth = 1.5; c.strokeStyle = '#1d4f91';
      c.strokeRect(bx, by, Math.abs(action.x1 - action.x0), Math.abs(action.y1 - action.y0));
      c.restore();
    }
  }

  /* ================================================================
     Protractor
     ================================================================ */
  function protTrig() {
    const t = -S.prot.rot * DEG;
    return { cos: Math.cos(t), sin: Math.sin(t) };
  }
  function localToPage(lx, ly) {
    const p = S.prot, { cos, sin } = protTrig();
    return { x: p.x + lx * cos - ly * sin, y: p.y + lx * sin + ly * cos };
  }
  function pageToLocal(px, py) {
    const p = S.prot, { cos, sin } = protTrig();
    const dx = px - p.x, dy = py - p.y;
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  }
  function localToScreen(lx, ly) { const q = localToPage(lx, ly); return toScreen(q.x, q.y); }

  const ROT_GAP = 40;   // screen px between straight edge and rotate handle
  // measuring arm reaches past the rim by at least 66 screen px so its handle never sits on another handle
  const armLength = (R, s) => R + Math.max(0.22 * R, 66 / s);
  function protGeom() {
    const p = S.prot, s = S.view.s, R = p.r;
    const full = p.mode === 360;
    const m = full ? 0 : 0.09 * R;
    const armLen = armLength(R, s);
    const a = p.arm * DEG;
    return {
      R, m, full, armLen,
      center: localToScreen(0, 0),
      rot: localToScreen(0, (full ? R : m) + ROT_GAP / s),
      rotBase: localToScreen(0, full ? R : m),
      size: full ? localToScreen(R * Math.SQRT1_2, R * Math.SQRT1_2) : localToScreen(R, m),
      sizeLocal: full ? { x: R * Math.SQRT1_2, y: R * Math.SQRT1_2 } : { x: R, y: m },
      arm: localToScreen(armLen * Math.cos(a), -armLen * Math.sin(a)),
    };
  }

  function readings() {
    const p = S.prot;
    const a = Math.round(p.arm) % 360;
    if (p.mode === 180) return { inner: clamp(a, 0, 180), outer: 180 - clamp(a, 0, 180) };
    return { inner: a % 360, outer: (360 - a) % 360 };
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }

  /* Draws the protractor body in page space. c is in CSS px; (ox, oy) is page origin on c; s is px per page unit. */
  function drawProtractorBody(c, P, s, ox, oy) {
    const R = P.r, full = P.mode === 360;
    const m = full ? 0 : 0.09 * R;
    const px = 1 / s;
    const innerC = P.twoColor ? COLORS.inner : COLORS.mono;
    const outerC = P.twoColor ? COLORS.outer : COLORS.mono;
    c.save();
    c.translate(P.x * s + ox, P.y * s + oy);
    c.rotate(-P.rot * DEG);
    c.scale(s, s);

    // body
    c.beginPath();
    if (full) c.arc(0, 0, R, 0, TAU);
    else { c.moveTo(-R, m); c.lineTo(-R, 0); c.arc(0, 0, R, Math.PI, 0, false); c.lineTo(R, m); c.closePath(); }
    c.fillStyle = COLORS.body; c.fill();
    c.lineWidth = 1.6 * px; c.strokeStyle = COLORS.edge; c.stroke();

    // inner window outline
    const rw = 0.38 * R;
    c.beginPath();
    if (full) c.arc(0, 0, rw, 0, TAU); else c.arc(0, 0, rw, Math.PI, 0, false);
    c.lineWidth = 1 * px; c.strokeStyle = 'rgba(39,49,61,0.45)'; c.stroke();

    // outer ticks
    const N = full ? 359 : 180;
    const tick = (r0, len, step, filter) => {
      c.beginPath();
      for (let d = 0; d <= N; d += step) {
        if (filter && !filter(d)) continue;
        const ca = Math.cos(d * DEG), sa = -Math.sin(d * DEG);
        const L = typeof len === 'function' ? len(d) : len;
        c.moveTo(ca * r0, sa * r0); c.lineTo(ca * (r0 - L), sa * (r0 - L));
      }
    };
    tick(R, (d) => (d % 10 === 0 ? 0.105 * R : d % 5 === 0 ? 0.072 * R : 0.042 * R), 1);
    c.lineWidth = Math.max(0.8, 1.05) * px; c.strokeStyle = COLORS.tick; c.stroke();
    // emphasise 10° ticks
    tick(R, 0.105 * R, 10);
    c.lineWidth = 1.6 * px; c.stroke();

    // inner ring with ticks for inner scale
    const r2 = 0.585 * R;
    c.beginPath();
    if (full) c.arc(0, 0, r2, 0, TAU); else c.arc(0, 0, r2, Math.PI, 0, false);
    c.lineWidth = 1 * px; c.strokeStyle = 'rgba(29,37,48,0.7)'; c.stroke();
    c.beginPath();
    for (let d = 0; d <= N; d += 5) {
      const ca = Math.cos(d * DEG), sa = -Math.sin(d * DEG), L = d % 10 === 0 ? 0.05 * R : 0.028 * R;
      c.moveTo(ca * r2, sa * r2); c.lineTo(ca * (r2 + L), sa * (r2 + L));
    }
    c.lineWidth = 1.1 * px; c.strokeStyle = 'rgba(29,37,48,0.8)'; c.stroke();

    // numbers
    // sized to the protractor so 3-digit numbers never touch
    const fsOuter = 0.064 * R;
    const fsInner = 0.054 * R;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const label = (d, r, text, color, fs) => {
      c.save();
      if (d % 180 === 0) {
        // 0° and 180° labels sit level, just above the zero line
        c.translate(Math.cos(d * DEG) * r, -fs * 0.72);
      } else {
        c.translate(Math.cos(d * DEG) * r, -Math.sin(d * DEG) * r);
        c.rotate((90 - d) * DEG);
      }
      c.font = `600 ${fs}px -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      c.fillStyle = color;
      c.fillText(text, 0, 0);
      c.restore();
    };
    for (let d = 0; d <= N; d += 10) {
      const outerVal = full ? (360 - d) % 360 : 180 - d;
      label(d, 0.825 * R, String(outerVal), outerC, fsOuter);
      label(d, 0.695 * R, String(d), innerC, fsInner);
    }

    // zero line (baseline) and centre mark
    c.beginPath();
    c.moveTo(-R, 0); c.lineTo(R, 0);
    c.lineWidth = 1.5 * px; c.strokeStyle = COLORS.tick; c.stroke();
    c.beginPath();
    c.moveTo(0, -0.07 * R); c.lineTo(0, full ? 0.07 * R : m * 0.75);
    c.lineWidth = 1.2 * px; c.stroke();
    c.beginPath(); c.arc(0, 0, 5 * px, 0, TAU);
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill();
    c.lineWidth = 1.6 * px; c.strokeStyle = COLORS.tick; c.stroke();
    c.beginPath(); c.arc(0, 0, 1.4 * px, 0, TAU); c.fillStyle = COLORS.tick; c.fill();

    // measuring arm (can be hidden)
    if (P.armOn === false) { c.restore(); return; }
    const a = P.arm * DEG, L = armLength(R, s);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * L, -Math.sin(a) * L);
    c.lineCap = 'round';
    c.lineWidth = 4.5 * px; c.strokeStyle = 'rgba(255,255,255,0.8)'; c.stroke();
    c.lineWidth = 2.2 * px; c.strokeStyle = COLORS.arm; c.stroke();
    c.restore();
  }

  function drawReadingBox(c, x, y, P, bounds) {
    const r = readings();
    const innerC = P.twoColor ? COLORS.inner : COLORS.mono;
    const outerC = P.twoColor ? COLORS.outer : COLORS.mono;
    const t1 = r.inner + '°', t2 = r.outer + '°';
    c.save();
    c.font = '700 21px -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    const w = Math.max(c.measureText(t1).width, c.measureText(t2).width) + 28;
    const h = 58;
    if (bounds) {
      // keep the label on screen and clear of the page bar
      x = clamp(x, w / 2 + 8, bounds.w - w / 2 - 8);
      y = clamp(y, h / 2 + 8, bounds.h - h / 2 - 80);
    }
    const bx = x - w / 2, by = y - h / 2;
    roundRect(c, bx, by, w, h, 9); c.fillStyle = '#fff'; c.fill();
    c.lineWidth = 1; c.strokeStyle = '#cfc7ba'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = innerC; c.fillText(t1, x, by + 17);
    c.fillStyle = outerC; c.fillText(t2, x, by + 41);
    c.beginPath(); c.moveTo(bx + 8, by + h / 2); c.lineTo(bx + w - 8, by + h / 2);
    c.strokeStyle = '#e6e0d6'; c.stroke();
    c.restore();
  }

  function drawProtLayer() {
    const c = ctx.prot;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.prot.width, cv.prot.height);
    if (!S.doc) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.prot.visible) drawProtractorScreen(c);
    if (S.ruler.visible) drawRulerScreen(c);
    if (S.prot.visible) drawProtReading(c);   // the reading always sits on top
  }

  function drawProtractorScreen(c) {
    const P = S.prot;
    drawProtractorBody(c, P, S.view.s, S.view.x, S.view.y);
    const g = protGeom();

    // rotate handle
    if (!P.locked) {
      c.save();
      c.beginPath(); c.moveTo(g.rotBase.x, g.rotBase.y); c.lineTo(g.rot.x, g.rot.y);
      c.lineWidth = 1.5; c.strokeStyle = COLORS.edge; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
      handleCircle(c, g.rot.x, g.rot.y, 13, '#fff', COLORS.edge);
      // rotate glyph
      c.beginPath(); c.arc(g.rot.x, g.rot.y, 6, -0.3 * Math.PI, 1.25 * Math.PI);
      c.lineWidth = 1.8; c.strokeStyle = COLORS.edge; c.stroke();
      const ex = g.rot.x + 6 * Math.cos(-0.3 * Math.PI), ey = g.rot.y + 6 * Math.sin(-0.3 * Math.PI);
      c.beginPath(); c.moveTo(ex - 4, ey - 1.5); c.lineTo(ex + 0.5, ey); c.lineTo(ex - 0.5, ey + 4.5); c.stroke();
      c.restore();

      // resize handle (square, aligned with protractor)
      c.save();
      c.translate(g.size.x, g.size.y); c.rotate(-P.rot * DEG);
      roundRect(c, -11, -11, 22, 22, 4); c.fillStyle = '#fff'; c.fill();
        c.lineWidth = 1.6; c.strokeStyle = COLORS.edge; c.stroke();
      c.beginPath(); c.moveTo(-5, -5); c.lineTo(5, 5); c.moveTo(-5, -1); c.lineTo(-5, -5); c.lineTo(-1, -5);
      c.moveTo(5, 1); c.lineTo(5, 5); c.lineTo(1, 5); c.stroke();
      c.restore();
    } else {
      // small lock badge near centre
      const b = localToScreen(0, S.prot.mode === 360 ? S.prot.r * 0.2 : -S.prot.r * 0.2);
      c.save();
      handleCircle(c, b.x, b.y, 12, COLORS.arm, '#fff');
      c.strokeStyle = '#fff'; c.lineWidth = 1.6;
      roundRect(c, b.x - 5, b.y - 1, 10, 7, 1.5); c.stroke();
      c.beginPath(); c.arc(b.x, b.y - 1, 3.2, Math.PI, 0); c.stroke();
      c.restore();
    }

    // arm handle
    if (P.armOn) handleCircle(c, g.arm.x, g.arm.y, 13, COLORS.handle, '#fff', true);


    // rotation readout while rotating
    if (action && action.type === 'rotate') {
      const txt = 'Rotation ' + formatRot(P.rot);
      c.save();
      c.font = '700 16px -apple-system, "Segoe UI", Arial, sans-serif';
      const w = c.measureText(txt).width + 22;
      const vx = g.rot.x - g.center.x, vy = g.rot.y - g.center.y, vl = Math.hypot(vx, vy) || 1;
      const lx = g.rot.x + vx / vl * 44, ly = g.rot.y + vy / vl * 40;
      const bx = lx - w / 2, by = ly - 16;
      roundRect(c, bx, by, w, 32, 8); c.fillStyle = COLORS.arm; c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(txt, lx, by + 16.5);
      c.restore();
    }
  }

  function drawProtReading(c) {
    const P = S.prot;
    if (!P.armOn || !P.reading) return;
    const g = protGeom();
    const cx = g.arm.x - g.center.x, cy = g.arm.y - g.center.y, len = Math.hypot(cx, cy) || 1;
    drawReadingBox(c, g.arm.x + (cx / len) * 52, g.arm.y + (cy / len) * 46, P, { w: W, h: H });
  }

  function formatRot(r) {
    const v = Math.round(((r % 360) + 360) % 360 * 10) / 10;
    return (Number.isInteger(v) ? v : v.toFixed(1)) + '°';
  }

  function handleCircle(c, x, y, r, fill, stroke, shadow) {
    c.save();
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill();
    c.lineWidth = 2.2; c.strokeStyle = stroke; c.stroke();
    c.restore();
  }

  function hitProt(sx, sy, pointerType) {
    const P = S.prot;
    if (!S.doc || !P.visible || S.tool === 'laser') return null;
    const g = protGeom();
    const tol = pointerType === 'touch' ? 26 : 18;
    const d = (q) => Math.hypot(q.x - sx, q.y - sy);
    if (P.armOn && d(g.arm) <= tol) return 'arm';
    if (!P.locked) {
      if (d(g.rot) <= tol) return 'rotate';
      if (d(g.size) <= tol) return 'resize';
    }
    const pp = toPage(sx, sy);
    const l = pageToLocal(pp.x, pp.y);
    // along the arm line
    const a = P.arm * DEG, ax = Math.cos(a), ay = -Math.sin(a);
    const along = l.x * ax + l.y * ay;
    const perp = Math.abs(-l.x * ay + l.y * ax) * S.view.s;
    if (P.armOn && along > P.r * 0.25 && along < g.armLen && perp < (pointerType === 'touch' ? 12 : 8)) return 'arm';
    if (!P.locked) {
      const dist = Math.hypot(l.x, l.y);
      if (P.mode === 360 ? dist <= P.r : (dist <= P.r && l.y <= 0) || (Math.abs(l.x) <= P.r && l.y >= 0 && l.y <= g.m)) return 'move';
    }
    return null;
  }

  function placeProtractorDefault() {
    const pg = curPage();
    if (!pg) return;
    const P = S.prot;
    // centre of the visible part of the page
    const vis = toPage(W / 2, H / 2);
    P.r = clamp(Math.min(pg.w, pg.h) * 0.36, 60, 1200);
    P.x = clamp(vis.x, 0, pg.w);
    P.y = clamp(vis.y + P.r * 0.35, 0, pg.h);
    P.rot = 0;
    P.placed = true;
  }

  function setProtVisible(v) {
    if (!S.doc) return;
    S.prot.visible = v;
    if (v && !S.prot.placed) placeProtractorDefault();
    syncProtUI();
    drawProtLayer();
  }

  /* ================================================================
     Ruler (real size: cm on the top edge, inches on the bottom edge)
     ================================================================ */
  function rTrig() { const t = -S.ruler.rot * DEG; return { cos: Math.cos(t), sin: Math.sin(t) }; }
  function rLocalToPage(lx, ly) { const R = S.ruler, { cos, sin } = rTrig(); return { x: R.x + lx * cos - ly * sin, y: R.y + lx * sin + ly * cos }; }
  function rPageToLocal(px, py) { const R = S.ruler, { cos, sin } = rTrig(); const dx = px - R.x, dy = py - R.y; return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }; }
  function rLocalToScreen(lx, ly) { const q = rLocalToPage(lx, ly); return toScreen(q.x, q.y); }
  function rulerGeom() {
    const R = S.ruler, s = S.view.s;
    return { rot: rLocalToScreen(R.len + RPAD + 40 / s, RW / 2), len: rLocalToScreen(R.len + RPAD, RW / 2), origin: rLocalToScreen(0, 0) };
  }

  function drawRulerBody(c, R, s, ox, oy) {
    const px = 1 / s;
    c.save();
    c.translate(R.x * s + ox, R.y * s + oy); c.rotate(-R.rot * DEG); c.scale(s, s);
    c.beginPath(); c.rect(-RPAD, 0, R.len + 2 * RPAD, RW);
    c.fillStyle = 'rgba(255, 238, 178, 0.62)'; c.fill();
    c.lineWidth = 1.6 * px; c.strokeStyle = COLORS.edge; c.stroke();
    // centimetres and millimetres on the top edge
    const showMM = MM * s >= 2.4;
    c.beginPath();
    for (let i = 0; i * MM <= R.len + 1e-6; i++) {
      if (!showMM && i % 5) continue;
      const L = i % 10 === 0 ? 17 : i % 5 === 0 ? 11.5 : 7;
      c.moveTo(i * MM, 0); c.lineTo(i * MM, L);
    }
    // inches on the bottom edge, every 1/8 inch
    const show8 = (INCH / 8) * s >= 2.4;
    for (let i = 0; i * INCH / 8 <= R.len + 1e-6; i++) {
      if (!show8 && i % 2) continue;
      const L = i % 8 === 0 ? 17 : i % 4 === 0 ? 12.5 : i % 2 === 0 ? 9 : 6;
      c.moveTo(i * INCH / 8, RW); c.lineTo(i * INCH / 8, RW - L);
    }
    c.lineWidth = 1 * px; c.strokeStyle = COLORS.tick; c.stroke();
    const fs = clamp(11 * px, 7, 14);
    c.font = `600 ${fs}px -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    c.fillStyle = COLORS.tick; c.textAlign = 'center';
    c.textBaseline = 'top';
    for (let k = 0; k * CM <= R.len + 1e-6; k++) c.fillText(String(k), k * CM, 19);
    c.textBaseline = 'bottom';
    for (let k = 0; k * INCH <= R.len + 1e-6; k++) c.fillText(String(k), k * INCH, RW - 19);
    if (CM * s >= 30) {   // unit labels only when there is room between the numbers
      c.font = `600 ${fs * 0.85}px -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      c.fillStyle = '#5a6272';
      c.textBaseline = 'top'; c.fillText('cm', CM * 0.5, 19 + fs * 0.08);
      c.textBaseline = 'bottom'; c.fillText('in', INCH * 0.5, RW - 19 - fs * 0.08);
    }
    c.restore();
  }

  function drawRulerScreen(c) {
    const R = S.ruler;
    drawRulerBody(c, R, S.view.s, S.view.x, S.view.y);
    const g = rulerGeom();
    c.save();
    c.beginPath(); c.moveTo(g.len.x, g.len.y); c.lineTo(g.rot.x, g.rot.y);
    c.lineWidth = 1.5; c.strokeStyle = COLORS.edge; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
    handleCircle(c, g.rot.x, g.rot.y, 13, '#fff', COLORS.edge);
    c.beginPath(); c.arc(g.rot.x, g.rot.y, 6, -0.3 * Math.PI, 1.25 * Math.PI);
    c.lineWidth = 1.8; c.strokeStyle = COLORS.edge; c.stroke();
    const ex = g.rot.x + 6 * Math.cos(-0.3 * Math.PI), ey = g.rot.y + 6 * Math.sin(-0.3 * Math.PI);
    c.beginPath(); c.moveTo(ex - 4, ey - 1.5); c.lineTo(ex + 0.5, ey); c.lineTo(ex - 0.5, ey + 4.5); c.stroke();
    // length handle
    c.translate(g.len.x, g.len.y); c.rotate(-R.rot * DEG);
    roundRect(c, -8, -14, 16, 28, 4); c.fillStyle = '#fff'; c.fill();
    c.lineWidth = 1.6; c.strokeStyle = COLORS.edge; c.stroke();
    c.beginPath(); c.moveTo(-3, -6); c.lineTo(-3, 6); c.moveTo(3, -6); c.lineTo(3, 6); c.stroke();
    c.restore();
    if (action && (action.type === 'rrotate' || action.type === 'rlength')) {
      const txt = action.type === 'rrotate' ? 'Rotation ' + formatRot(R.rot) : 'Length ' + (Math.round(R.len / MM) / 10) + ' cm';
      c.save();
      c.font = '700 16px -apple-system, "Segoe UI", Arial, sans-serif';
      const w = c.measureText(txt).width + 22;
      const lx = clamp(g.rot.x, w / 2 + 8, W - w / 2 - 8), ly = clamp(g.rot.y - 44, 24, H - 100);
      roundRect(c, lx - w / 2, ly - 16, w, 32, 8); c.fillStyle = COLORS.arm; c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(txt, lx, ly + 0.5);
      c.restore();
    }
  }

  function hitRuler(sx, sy, pointerType) {
    const R = S.ruler;
    if (!S.doc || !R.visible || S.tool === 'laser') return null;
    const g = rulerGeom();
    const tol = pointerType === 'touch' ? 26 : 18;
    if (Math.hypot(g.rot.x - sx, g.rot.y - sy) <= tol) return 'rrotate';
    if (Math.hypot(g.len.x - sx, g.len.y - sy) <= tol) return 'rlength';
    const pp = toPage(sx, sy), l = rPageToLocal(pp.x, pp.y);
    if (l.x >= -RPAD && l.x <= R.len + RPAD && l.y >= 0 && l.y <= RW) return 'rmove';
    return null;
  }

  /* pen strokes that start just outside a ruler edge are drawn straight along that edge */
  function rulerEdgeSnap(pp, w) {
    const R = S.ruler;
    if (!R.visible) return null;
    const l = rPageToLocal(pp.x, pp.y), zone = 18 / S.view.s;
    if (l.x < -RPAD || l.x > R.len + RPAD) return null;
    let yLine = null;
    if (l.y < 0 && l.y >= -zone) yLine = -w / 2;
    else if (l.y > RW && l.y <= RW + zone) yLine = RW + w / 2;
    if (yLine === null) return null;
    return { project: (p) => { const q = rPageToLocal(p.x, p.y); return rLocalToPage(clamp(q.x, -RPAD, R.len + RPAD), yLine); } };
  }

  function placeRulerDefault() {
    const pg = curPage();
    if (!pg) return;
    const R = S.ruler, vis = toPage(W / 2, H / 2);
    R.len = Math.max(5 * CM, Math.min(15 * CM, Math.floor((pg.w * 0.7) / CM) * CM));
    R.x = clamp(vis.x - R.len / 2, RPAD, Math.max(RPAD, pg.w - R.len - RPAD));
    R.y = clamp(vis.y - RW / 2, 0, pg.h - RW);
    R.rot = 0;
    R.placed = true;
  }

  function setRulerVisible(v) {
    if (!S.doc) return;
    S.ruler.visible = v;
    if (v && !S.ruler.placed) placeRulerDefault();
    syncToggles();
    drawProtLayer();
  }

  /* ================================================================
     Cover: hides the page below a line you drag down to reveal
     ================================================================ */
  function coverGrip() {
    const pg = curPage(), { s, x, y } = S.view;
    const top = y + S.cover.y * pg.h * s, gw = 156, gh = 34;
    return { x: x + (pg.w * s) / 2 - gw / 2, y: top - gh / 2, w: gw, h: gh, top, left: x, right: x + pg.w * s };
  }
  function drawCoverLayer() {
    const c = ctx.cover;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.cover.width, cv.cover.height);
    const pg = curPage();
    if (!pg || !S.cover.on) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { s, y } = S.view;
    const g = coverGrip(), bottom = y + pg.h * s;
    if (bottom > g.top) { c.fillStyle = '#2a3552'; c.fillRect(g.left, g.top, g.right - g.left, bottom - g.top); }
    c.beginPath(); c.moveTo(g.left, g.top); c.lineTo(g.right, g.top);
    c.lineWidth = 2; c.strokeStyle = COLORS.handle; c.stroke();
    roundRect(c, g.x, g.y, g.w, g.h, 10); c.fillStyle = COLORS.handle; c.fill();
    c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
    // up/down arrows
    const ax = g.x + 20, ay = g.y + g.h / 2;
    c.beginPath(); c.moveTo(ax - 5, ay - 3); c.lineTo(ax, ay - 8); c.lineTo(ax + 5, ay - 3);
    c.moveTo(ax - 5, ay + 3); c.lineTo(ax, ay + 8); c.lineTo(ax + 5, ay + 3);
    c.lineWidth = 2; c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
    c.fillStyle = '#fff'; c.font = '600 15px -apple-system, "Segoe UI", Arial, sans-serif';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('Drag to reveal', g.x + 36, ay + 0.5);
  }
  function hitCover(sx, sy) {
    if (!S.doc || !S.cover.on || S.tool === 'laser') return null;
    const g = coverGrip();
    if (sx >= g.x - 6 && sx <= g.x + g.w + 6 && sy >= g.y - 6 && sy <= g.y + g.h + 6) return 'cover';
    if (sx >= g.left && sx <= g.right && Math.abs(sy - g.top) <= 8) return 'cover';
    return null;
  }
  function setCover(on) {
    if (!S.doc) return;
    S.cover.on = on;
    if (on) S.cover.y = 0;
    syncToggles();
    drawCoverLayer();
  }
  function syncToggles() {
    $('#btnRuler').setAttribute('aria-pressed', String(S.ruler.visible));
    $('#btnCover').setAttribute('aria-pressed', String(S.cover.on));
  }

  function hitInstrument(sx, sy, pointerType) {
    return hitCover(sx, sy) || hitRuler(sx, sy, pointerType) || hitProt(sx, sy, pointerType);
  }

  /* ================================================================
     Laser
     ================================================================ */
  const laser = { pts: [], raf: 0, last: 0 };
  const LASER_TRAIL_MS = 260, LASER_HOLD_MS = 1100, LASER_FADE_MS = 400;

  function laserAdd(x, y) {
    const t = performance.now();
    laser.pts.push({ x, y, t });
    laser.last = t;
    if (!laser.raf) laser.raf = requestAnimationFrame(laserFrame);
  }
  function laserClear() {
    laser.pts = [];
    const c = ctx.laser; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.laser.width, cv.laser.height);
  }
  function laserFrame() {
    laser.raf = 0;
    const t = performance.now();
    const c = ctx.laser;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.laser.width, cv.laser.height);
    laser.pts = laser.pts.filter((p) => t - p.t < LASER_TRAIL_MS);
    const idle = t - laser.last;
    if (idle > LASER_HOLD_MS + LASER_FADE_MS || !laser.lastPos) { laser.pts = []; return; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fade = idle > LASER_HOLD_MS ? 1 - (idle - LASER_HOLD_MS) / LASER_FADE_MS : 1;
    // trail
    const pts = laser.pts;
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const age = (t - pts[i].t) / LASER_TRAIL_MS;
      c.beginPath(); c.moveTo(pts[i - 1].x, pts[i - 1].y); c.lineTo(pts[i].x, pts[i].y);
      c.strokeStyle = `rgba(230, 30, 30, ${(1 - age) * 0.55 * fade})`;
      c.lineWidth = 3 + 7 * (1 - age);
      c.stroke();
    }
    // dot
    const p = laser.lastPos;
    c.beginPath(); c.arc(p.x, p.y, 13, 0, TAU); c.fillStyle = `rgba(230, 30, 30, ${0.22 * fade})`; c.fill();
    c.beginPath(); c.arc(p.x, p.y, 7.5, 0, TAU); c.fillStyle = `rgba(232, 24, 24, ${fade})`; c.fill();
    c.lineWidth = 2; c.strokeStyle = `rgba(255,255,255,${0.95 * fade})`; c.stroke();
    laser.raf = requestAnimationFrame(laserFrame);
  }

  /* eraser cursor on laser canvas */
  function drawEraserCursor(sx, sy) {
    if (laser.raf) return;
    const c = ctx.laser;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.laser.width, cv.laser.height);
    if (sx == null) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.beginPath(); c.arc(sx, sy, ERASER_R, 0, TAU);
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = '#1f2a37'; c.stroke();
  }

  /* ================================================================
     Draw all
     ================================================================ */
  let rafPending = 0;
  function drawAll() {
    if (rafPending) return;
    rafPending = requestAnimationFrame(() => {
      rafPending = 0;
      drawPageLayer(); drawInkLayer(); drawLiveInk(); drawCoverLayer(); drawProtLayer();
      if (editor) positionEditor();
    });
  }
  function drawNow() { cancelAnimationFrame(rafPending); rafPending = 0; drawPageLayer(); drawInkLayer(); drawLiveInk(); drawCoverLayer(); drawProtLayer(); if (editor) positionEditor(); }

  /* ================================================================
     Ink editing
     ================================================================ */
  const ERASER_R = 14;

  function commitStroke(st) {
    const ink = curInk();
    ink.strokes.push(st);
    ink.undo.push({ t: 'add', st });
    ink.redo.length = 0;
    markDirty();
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function strokeHit(st, px, py, rad) {
    const p = st.pts, n = p.length / 2, lim = rad + st.w / 2;
    if (n === 1) return Math.hypot(p[0] - px, p[1] - py) <= lim;
    if (st.line) return distToSeg(px, py, p[0], p[1], p[2 * (n - 1)], p[2 * (n - 1) + 1]) <= lim;
    for (let i = 0; i < n - 1; i++) {
      if (distToSeg(px, py, p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3]) <= lim) return true;
    }
    return false;
  }

  function itemBox(it) {
    if (it.k === 'text') { const m = textSize(it); return { x: it.pts[0], y: it.pts[1], w: m.w, h: m.h }; }
    const p = it.pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    const pad = (it.w || 0) / 2;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }
  function itemHit(it, px, py, rad) {
    if (it.hidden) return false;
    if (it.k === 'text') { const b = itemBox(it); return px >= b.x - rad && px <= b.x + b.w + rad && py >= b.y - rad && py <= b.y + b.h + rad; }
    if (it.k === 'shape') {
      const [x1, y1, x2, y2] = it.pts, lim = rad + it.w / 2;
      if (it.s === 'rect') {
        const a = Math.min(x1, x2), b = Math.max(x1, x2), c = Math.min(y1, y2), d = Math.max(y1, y2);
        return distToSeg(px, py, a, c, b, c) <= lim || distToSeg(px, py, b, c, b, d) <= lim || distToSeg(px, py, b, d, a, d) <= lim || distToSeg(px, py, a, d, a, c) <= lim;
      }
      if (it.s === 'ellipse') {
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
        let prev = null;
        for (let i = 0; i <= 64; i++) {
          const t = (i / 64) * TAU, q = { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
          if (prev && distToSeg(px, py, prev.x, prev.y, q.x, q.y) <= lim) return true;
          prev = q;
        }
        return false;
      }
      return distToSeg(px, py, x1, y1, x2, y2) <= lim;
    }
    return strokeHit(it, px, py, rad);
  }
  function moveItem(it, dx, dy) { it.pts = it.pts.map((v, i) => r1(i % 2 ? v + dy : v + dx)); }
  function itemAt(px, py) {
    const ink = curInk(), rad = 6 / S.view.s;
    for (let i = ink.strokes.length - 1; i >= 0; i--) {
      const it = ink.strokes[i];
      if (itemHit(it, px, py, rad)) return it;
      if (it.k === 'shape' && (it.s === 'rect' || it.s === 'ellipse')) {
        const b = itemBox(it);
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return it;
      }
    }
    return null;
  }
  function deleteSelection() {
    const ink = curInk();
    if (!ink || !sel.length) return;
    const items = sel.map((st) => ({ st, i: ink.strokes.indexOf(st) })).filter((o) => o.i >= 0).sort((a, b) => b.i - a.i);
    items.forEach((o) => ink.strokes.splice(o.i, 1));
    ink.undo.push({ t: 'erase', items });
    ink.redo.length = 0;
    sel = [];
    afterInkChange();
    drawLiveInk();
  }
  function clearSelection() { if (sel.length) { sel = []; drawLiveInk(); } }

  function eraseAt(sx, sy, removed) {
    const ink = curInk();
    const pp = toPage(sx, sy);
    const rad = ERASER_R / S.view.s;
    let changed = false;
    for (let i = ink.strokes.length - 1; i >= 0; i--) {
      const st = ink.strokes[i];
      if (itemHit(st, pp.x, pp.y, rad)) {
        ink.strokes.splice(i, 1);
        removed.push({ st, i });
        changed = true;
      }
    }
    if (changed) drawInkLayer();
  }

  function undo() {
    const ink = curInk(); if (!ink) return;
    const a = ink.undo.pop(); if (!a) return;
    if (a.t === 'add') { const i = ink.strokes.lastIndexOf(a.st); if (i >= 0) ink.strokes.splice(i, 1); }
    else if (a.t === 'erase') { a.items.slice().sort((p, q) => p.i - q.i).forEach((it) => ink.strokes.splice(it.i, 0, it.st)); }
    else if (a.t === 'clear') { ink.strokes = a.strokes.slice(); }
    else if (a.t === 'move') a.items.forEach((it) => moveItem(it, -a.dx, -a.dy));
    else if (a.t === 'edit') a.it.t = a.before;
    ink.redo.push(a);
    afterInkChange();
  }
  function redo() {
    const ink = curInk(); if (!ink) return;
    const a = ink.redo.pop(); if (!a) return;
    if (a.t === 'add') ink.strokes.push(a.st);
    else if (a.t === 'erase') a.items.forEach((it) => { const i = ink.strokes.indexOf(it.st); if (i >= 0) ink.strokes.splice(i, 1); });
    else if (a.t === 'clear') ink.strokes = [];
    else if (a.t === 'move') a.items.forEach((it) => moveItem(it, a.dx, a.dy));
    else if (a.t === 'edit') a.it.t = a.after;
    ink.undo.push(a);
    afterInkChange();
  }
  function clearPage() {
    const ink = curInk(); if (!ink || !ink.strokes.length) { toast('This page has no drawings.'); return; }
    ink.undo.push({ t: 'clear', strokes: ink.strokes.slice() });
    ink.redo.length = 0;
    ink.strokes = [];
    sel = [];
    afterInkChange();
    drawLiveInk();
    toast('Page cleared.', 'Undo', undo);
  }
  function afterInkChange() {
    markDirty();
    const ink = curInk();
    if (sel.length && ink) { sel = sel.filter((it) => ink.strokes.includes(it)); drawLiveInk(); }
    drawInkLayer();
    updateUndoButtons();
    scheduleThumbInk();
  }
  function updateUndoButtons() {
    const ink = curInk();
    $('#btnUndo').disabled = !ink || !ink.undo.length;
    $('#btnRedo').disabled = !ink || !ink.redo.length;
    $('#btnClear').disabled = !ink;
  }
  function markDirty() { S.dirty = true; }

  /* ================================================================
     Pointer input
     ================================================================ */
  const pointers = new Map();
  let action = null;     // current gesture
  let spaceDown = false;
  let lastPenTime = 0;
  let hover = null;
  let sel = [];          // selected items (Select tool)
  let editor = null;     // open text box

  function localXY(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e) {
    if (!S.doc) return;
    if (e.target !== cv.laser && !e.target.matches('#stage > canvas')) return;
    closeMenus();
    if (editor && pointers.size === 0) {
      commitTextEditor();
      if (S.tool === 'text') { e.preventDefault(); return; }
    }
    const q = localXY(e);
    pointers.set(e.pointerId, { x: q.x, y: q.y, type: e.pointerType });
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (e.pointerType === 'pen') lastPenTime = performance.now();

    if (pointers.size === 2) {
      // second finger: cancel the current gesture and start pinch
      if (action && action.type === 'draw') { action = null; drawLiveInk(); }
      if (action && action.type === 'erase' && action.removed.length) finishErase();
      const [a, b] = [...pointers.values()];
      action = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...S.view } };
      return;
    }
    if (pointers.size > 2) return;
    e.preventDefault();

    const palm = e.pointerType === 'touch' && performance.now() - lastPenTime < 3000;
    if (e.button === 1 || spaceDown || S.tool === 'hand' || (palm && ['pen', 'hl', 'eraser', 'shape', 'text', 'select'].includes(S.tool))) {
      action = { type: 'pan', sx: q.x, sy: q.y, vx: S.view.x, vy: S.view.y };
      stage.classList.add('c-grabbing');
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const hit = hitInstrument(q.x, q.y, e.pointerType);
    if (hit === 'cover') {
      action = { type: 'cover', off: coverGrip().top - q.y };
      setCursorFor(hit, true);
      return;
    }
    if (hit === 'rmove' || hit === 'rrotate' || hit === 'rlength') {
      const pp = toPage(q.x, q.y), Rr = S.ruler;
      if (hit === 'rmove') action = { type: 'rmove', p0: pp, x0: Rr.x, y0: Rr.y };
      else if (hit === 'rrotate') action = { type: 'rrotate', a0: Math.atan2(-(pp.y - Rr.y), pp.x - Rr.x) / DEG, r0: Rr.rot };
      else action = { type: 'rlength' };
      setCursorFor(hit, true);
      drawProtLayer();
      return;
    }
    if (hit) {
      const pp = toPage(q.x, q.y);
      const P = S.prot;
      if (hit === 'move') action = { type: 'move', p0: pp, x0: P.x, y0: P.y };
      else if (hit === 'rotate') action = { type: 'rotate', a0: Math.atan2(-(pp.y - P.y), pp.x - P.x) / DEG, r0: P.rot };
      else if (hit === 'resize') {
        const g = protGeom();
        action = { type: 'resize', ratio: Math.hypot(g.sizeLocal.x, g.sizeLocal.y) / P.r };
      } else if (hit === 'arm') { action = { type: 'arm' }; setArmFromScreen(q.x, q.y, e.shiftKey); }
      setCursorFor(hit, true);
      drawProtLayer();
      return;
    }

    if (S.tool === 'pen' || S.tool === 'hl') {
      const pp = toPage(q.x, q.y);
      const isHl = S.tool === 'hl';
      const st = {
        k: isHl ? 'hl' : 'pen',
        c: isHl ? HL_COLORS[S.hlColor].c : PEN_COLORS[S.penColor].c,
        w: isHl ? HL_SIZES[S.hlSize] : PEN_SIZES[S.penSize],
        pts: [r1(pp.x), r1(pp.y)],
      };
      action = { type: 'draw', stroke: st, start: pp, straight: S.lineMode || e.shiftKey };
      if (action.straight) st.line = true;
      const snap = rulerEdgeSnap(pp, st.w);
      if (snap) {
        const a = snap.project(pp);
        action.ruler = snap; action.start = a; st.line = true; st.pts = [r1(a.x), r1(a.y)];
      }
      drawLiveInk();
    } else if (S.tool === 'shape') {
      const pp = toPage(q.x, q.y);
      const st = { k: 'shape', s: S.shape, c: PEN_COLORS[S.penColor].c, w: PEN_SIZES[S.penSize], pts: [r1(pp.x), r1(pp.y), r1(pp.x), r1(pp.y)] };
      action = { type: 'shape', stroke: st, start: pp };
      drawLiveInk();
    } else if (S.tool === 'text') {
      const pp = toPage(q.x, q.y), pg = curPage();
      const hitText = itemAt(pp.x, pp.y);
      if (hitText && hitText.k === 'text') openTextEditor(hitText, false);
      else {
        const fs = TEXT_SIZES[S.penSize];
        openTextEditor({ k: 'text', c: PEN_COLORS[S.penColor].c, fs, t: '', pts: [r1(clamp(pp.x, 0, pg.w - fs)), r1(clamp(pp.y - fs * 0.6, 0, pg.h - fs))] }, true);
      }
    } else if (S.tool === 'select') {
      const pp = toPage(q.x, q.y);
      const it = itemAt(pp.x, pp.y);
      if (it) {
        if (e.shiftKey) { sel = sel.includes(it) ? sel.filter((x) => x !== it) : sel.concat(it); }
        else if (!sel.includes(it)) sel = [it];
        action = { type: 'drag', p0: pp, items: sel.slice(), orig: sel.map((x) => x.pts.slice()), dx: 0, dy: 0 };
      } else {
        if (!e.shiftKey) sel = [];
        action = { type: 'band', x0: q.x, y0: q.y, x1: q.x, y1: q.y };
      }
      drawLiveInk();
    } else if (S.tool === 'eraser') {
      action = { type: 'erase', removed: [], last: q };
      eraseAt(q.x, q.y, action.removed);
      drawEraserCursor(q.x, q.y);
    } else if (S.tool === 'laser') {
      action = { type: 'laser' };
      laser.lastPos = q; laserAdd(q.x, q.y);
    }
  }

  const r1 = (v) => Math.round(v * 10) / 10;

  function setArmFromScreen(sx, sy, snap) {
    const P = S.prot;
    const pp = toPage(sx, sy);
    const l = pageToLocal(pp.x, pp.y);
    if (Math.hypot(l.x, l.y) * S.view.s < 4) return;
    let a = Math.atan2(-l.y, l.x) / DEG;
    a = (a + 360) % 360;
    if (P.mode === 180 && a > 180) a = a > 270 ? 0 : 180;
    if (snap) a = Math.round(a);
    P.arm = a;
    syncReading();
  }

  function onPointerMove(e) {
    const q = localXY(e);
    const ptr = pointers.get(e.pointerId);
    if (ptr) { ptr.x = q.x; ptr.y = q.y; }
    if (e.pointerType === 'pen') lastPenTime = performance.now();

    if (!S.doc) return;

    if (!action) {
      // hover feedback
      if (S.tool === 'laser' && (e.pointerType === 'mouse' || e.pointerType === 'pen')) {
        laser.lastPos = q; laserAdd(q.x, q.y);
      } else if (S.tool === 'eraser' && e.pointerType !== 'touch') {
        drawEraserCursor(q.x, q.y);
      }
      let h = hitInstrument(q.x, q.y, e.pointerType);
      if (!h && S.tool === 'select' && e.pointerType !== 'touch') { const pp = toPage(q.x, q.y); if (itemAt(pp.x, pp.y)) h = 'item'; }
      if (h !== hover) { hover = h; setCursorFor(h, false); }
      return;
    }

    switch (action.type) {
      case 'pinch': {
        const pts = [...pointers.values()];
        if (pts.length < 2) return;
        const [a, b] = pts;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const v0 = action.v0;
        const ns = clamp(v0.s * d / action.d0, MIN_ZOOM, MAX_ZOOM);
        const px = (action.m0.x - v0.x) / v0.s, py = (action.m0.y - v0.y) / v0.s;
        S.view.s = ns; S.view.x = m.x - px * ns; S.view.y = m.y - py * ns;
        S.fitted = false;
        viewChanged();
        break;
      }
      case 'pan':
        S.view.x = action.vx + (q.x - action.sx);
        S.view.y = action.vy + (q.y - action.sy);
        S.fitted = false;
        viewChanged();
        break;
      case 'move': {
        const pp = toPage(q.x, q.y);
        S.prot.x = action.x0 + (pp.x - action.p0.x);
        S.prot.y = action.y0 + (pp.y - action.p0.y);
        drawProtLayer();
        break;
      }
      case 'rotate': {
        const pp = toPage(q.x, q.y);
        const a = Math.atan2(-(pp.y - S.prot.y), pp.x - S.prot.x) / DEG;
        let r = action.r0 + (a - action.a0);
        r = ((r % 360) + 360) % 360;
        if (e.shiftKey) r = (Math.round(r / 15) * 15) % 360;
        S.prot.rot = r;
        drawProtLayer();
        break;
      }
      case 'resize': {
        const pp = toPage(q.x, q.y);
        const d = Math.hypot(pp.x - S.prot.x, pp.y - S.prot.y);
        S.prot.r = clamp(d / action.ratio, 70 / S.view.s, 4000);
        drawProtLayer();
        break;
      }
      case 'arm':
        setArmFromScreen(q.x, q.y, e.shiftKey);
        drawProtLayer();
        break;
      case 'cover': {
        const pg = curPage();
        S.cover.y = clamp((q.y + action.off - S.view.y) / (pg.h * S.view.s), 0, 1);
        drawCoverLayer();
        break;
      }
      case 'rmove': {
        const pp = toPage(q.x, q.y);
        S.ruler.x = action.x0 + (pp.x - action.p0.x);
        S.ruler.y = action.y0 + (pp.y - action.p0.y);
        drawProtLayer();
        break;
      }
      case 'rrotate': {
        const pp = toPage(q.x, q.y);
        const a = Math.atan2(-(pp.y - S.ruler.y), pp.x - S.ruler.x) / DEG;
        let r = ((action.r0 + (a - action.a0)) % 360 + 360) % 360;
        if (e.shiftKey) r = (Math.round(r / 15) * 15) % 360;
        S.ruler.rot = r;
        drawProtLayer();
        break;
      }
      case 'rlength': {
        const pp = toPage(q.x, q.y), l = rPageToLocal(pp.x, pp.y);
        S.ruler.len = clamp(Math.round((l.x - RPAD) / MM) * MM, 3 * CM, 100 * CM);
        drawProtLayer();
        break;
      }
      case 'shape': {
        const st = action.stroke, pp = toPage(q.x, q.y);
        let dx = pp.x - action.start.x, dy = pp.y - action.start.y;
        if (e.shiftKey) {
          if (st.s === 'rect' || st.s === 'ellipse') { const d = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * d; dy = Math.sign(dy || 1) * d; }
          else { const len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (15 * DEG)) * 15 * DEG; dx = Math.cos(ang) * len; dy = Math.sin(ang) * len; }
        }
        st.pts[2] = r1(action.start.x + dx); st.pts[3] = r1(action.start.y + dy);
        drawLiveInk();
        break;
      }
      case 'drag': {
        const pp = toPage(q.x, q.y);
        action.dx = pp.x - action.p0.x; action.dy = pp.y - action.p0.y;
        action.items.forEach((it, i) => { it.pts = action.orig[i].map((v, k) => r1(k % 2 ? v + action.dy : v + action.dx)); });
        drawInkLayer(); drawLiveInk();
        break;
      }
      case 'band':
        action.x1 = q.x; action.y1 = q.y;
        drawLiveInk();
        break;
      case 'draw': {
        const st = action.stroke;
        if (action.ruler) {
          const b = action.ruler.project(toPage(q.x, q.y));
          st.line = true;
          st.pts = [r1(action.start.x), r1(action.start.y), r1(b.x), r1(b.y)];
          drawLiveInk();
          break;
        }
        const evs = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
        const straight = S.lineMode || e.shiftKey;
        if (straight) {
          const pp = toPage(q.x, q.y);
          st.line = true;
          st.pts = [r1(action.start.x), r1(action.start.y), r1(pp.x), r1(pp.y)];
        } else {
          if (st.line) { st.line = false; st.pts = [r1(action.start.x), r1(action.start.y)]; }
          const r = stage.getBoundingClientRect();
          for (const ev of evs) {
            const pp = toPage(ev.clientX - r.left, ev.clientY - r.top);
            const n = st.pts.length;
            const lx = st.pts[n - 2], ly = st.pts[n - 1];
            if (Math.hypot(pp.x - lx, pp.y - ly) * S.view.s < 1.2) continue;
            st.pts.push(r1(pp.x), r1(pp.y));
          }
        }
        drawLiveInk();
        break;
      }
      case 'erase': {
        // sample along the movement so fast swipes still hit
        const last = action.last;
        const steps = Math.max(1, Math.ceil(Math.hypot(q.x - last.x, q.y - last.y) / (ERASER_R * 0.7)));
        for (let i = 1; i <= steps; i++) eraseAt(last.x + (q.x - last.x) * i / steps, last.y + (q.y - last.y) * i / steps, action.removed);
        action.last = q;
        drawEraserCursor(q.x, q.y);
        break;
      }
      case 'laser':
        laser.lastPos = q; laserAdd(q.x, q.y);
        break;
    }
  }

  function finishErase() {
    if (action.removed.length) {
      const ink = curInk();
      ink.undo.push({ t: 'erase', items: action.removed });
      ink.redo.length = 0;
      afterInkChange();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (!action) return;
    if (action.type === 'pinch') {
      if (pointers.size === 0) action = null;
      else {
        // continue as pan with remaining finger
        const rest = [...pointers.values()][0];
        action = { type: 'pan', sx: rest.x, sy: rest.y, vx: S.view.x, vy: S.view.y };
      }
      return;
    }
    if (pointers.size > 0) return;
    const a = action;
    action = null;
    stage.classList.remove('c-grabbing');
    if (a.type === 'draw') {
      const st = a.stroke;
      if (st.line && st.pts.length === 2) st.line = false;
      commitStroke(st);
      drawInkLayer();
      drawLiveInk();
      updateUndoButtons();
      scheduleThumbInk();
    } else if (a.type === 'shape') {
      const st = a.stroke;
      if (Math.hypot(st.pts[2] - st.pts[0], st.pts[3] - st.pts[1]) * S.view.s >= 4) { commitStroke(st); afterInkChange(); }
      drawLiveInk();
    } else if (a.type === 'drag') {
      if (Math.hypot(a.dx, a.dy) * S.view.s > 0.5) {
        const ink = curInk();
        ink.undo.push({ t: 'move', items: a.items, dx: r1(a.dx), dy: r1(a.dy) });
        ink.redo.length = 0;
        afterInkChange();
      }
      drawLiveInk();
    } else if (a.type === 'band') {
      const p0 = toPage(Math.min(a.x0, a.x1), Math.min(a.y0, a.y1)), p1 = toPage(Math.max(a.x0, a.x1), Math.max(a.y0, a.y1));
      if (p1.x - p0.x > 1 || p1.y - p0.y > 1) {
        for (const it of curInk().strokes) {
          const b = itemBox(it);
          if (b.x <= p1.x && b.x + b.w >= p0.x && b.y <= p1.y && b.y + b.h >= p0.y && !sel.includes(it)) sel.push(it);
        }
      }
      drawLiveInk();
    } else if (a.type === 'cover') {
      drawCoverLayer();
    } else if (a.type === 'rmove' || a.type === 'rrotate' || a.type === 'rlength') {
      drawProtLayer();
    } else if (a.type === 'erase') {
      action = a; finishErase(); action = null;
      if (e.pointerType === 'touch') drawEraserCursor(null);
    } else if (a.type === 'rotate' || a.type === 'move' || a.type === 'resize' || a.type === 'arm') {
      drawProtLayer();
    }
    const q = localXY(e);
    hover = hitInstrument(q.x, q.y, e.pointerType);
    setCursorFor(hover, false);
  }

  function setCursorFor(hit, active) {
    stage.classList.remove('c-move', 'c-rotate', 'c-resize', 'c-arm', 'c-cover', 'c-item');
    const map = { move: 'move', rmove: 'move', rotate: 'rotate', rrotate: 'rotate', resize: 'resize', rlength: 'resize', arm: 'arm', cover: 'cover', item: 'item' };
    if (hit && map[hit]) stage.classList.add('c-' + map[hit]);
    if (active && (hit === 'rotate' || hit === 'rrotate')) stage.classList.add('c-grabbing');
  }

  function onWheel(e) {
    if (!S.doc) return;
    e.preventDefault();
    const q = localXY(e);
    const lineMode = e.deltaMode === 1;
    const looksLikeMouseWheel = lineMode || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || looksLikeMouseWheel) {
      const dy = lineMode ? e.deltaY * 33 : e.deltaY;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022));
      zoomAt(q.x, q.y, factor);
    } else {
      S.view.x -= e.deltaX; S.view.y -= e.deltaY;
      S.fitted = false;
      viewChanged();
    }
  }

  // Safari trackpad pinch
  let gestureScale = 1;
  stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = 1; });
  stage.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    if (!S.doc) return;
    const q = localXY(e);
    zoomAt(q.x, q.y, e.scale / gestureScale);
    gestureScale = e.scale;
  });
  stage.addEventListener('gestureend', (e) => e.preventDefault());

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch' && !action) drawEraserCursor(null);
  });
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('dblclick', (e) => {
    if (!S.doc || S.tool !== 'select') return;
    const q = localXY(e), pp = toPage(q.x, q.y), it = itemAt(pp.x, pp.y);
    if (it && it.k === 'text') { sel = []; drawLiveInk(); openTextEditor(it, false); }
  });

  /* ================================================================
     Text boxes
     ================================================================ */
  function openTextEditor(it, isNew) {
    if (editor) commitTextEditor();
    const ta = document.createElement('textarea');
    ta.className = 'text-editor';
    ta.value = it.t;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Type text');
    stage.appendChild(ta);
    editor = { ta, it, isNew, before: it.t };
    if (!isNew) { it.hidden = true; drawInkLayer(); }
    positionEditor();
    ta.addEventListener('input', positionEditor);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commitTextEditor(); }
    });
    ta.addEventListener('blur', () => commitTextEditor());
    setTimeout(() => { if (editor && editor.ta === ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0);
  }
  function positionEditor() {
    if (!editor) return;
    const { ta, it } = editor;
    const q = toScreen(it.pts[0], it.pts[1]), px = it.fs * S.view.s;
    ta.style.left = q.x + 'px'; ta.style.top = q.y + 'px';
    ta.style.fontSize = px + 'px'; ta.style.lineHeight = px * 1.25 + 'px'; ta.style.color = it.c;
    mctx.font = textFont(px);
    const lines = (ta.value || '').split('\n');
    let w = 0;
    for (const l of lines) w = Math.max(w, mctx.measureText(l).width);
    ta.style.width = Math.ceil(w + px * 1.2) + 'px';
    ta.style.height = Math.ceil(lines.length * px * 1.25) + 'px';
  }
  function commitTextEditor() {
    if (!editor) return;
    const { ta, it, isNew, before } = editor;
    editor = null;
    const txt = ta.value.replace(/\s+$/, '');
    ta.remove();
    delete it.hidden;
    const ink = curInk();
    if (!ink) return;
    if (isNew) {
      if (txt) { it.t = txt; commitStroke(it); }
    } else if (!txt) {
      const i = ink.strokes.indexOf(it);
      if (i >= 0) { ink.strokes.splice(i, 1); ink.undo.push({ t: 'erase', items: [{ st: it, i }] }); ink.redo.length = 0; }
    } else if (txt !== before) {
      it.t = txt;
      ink.undo.push({ t: 'edit', it, before, after: txt });
      ink.redo.length = 0;
    }
    afterInkChange();
  }
  function cancelTextEditor() {
    if (!editor) return;
    const { ta, it } = editor;
    editor = null;
    delete it.hidden;
    ta.remove();
  }
  stage.addEventListener('contextmenu', (e) => { if (S.doc) e.preventDefault(); });

  /* ================================================================
     Documents
     ================================================================ */
  function resetDocState() {
    pdfPageCache.clear(); baseCache.clear(); basePending.clear(); sharp = null;
    S.page = 0;
    S.prot.placed = false;
    S.ruler.placed = false;
    S.cover.y = 0;
    sel = [];
    cancelTextEditor();
    S.dirty = false;
    thumbs.clear();
  }

  function newInkFor(n) { return Array.from({ length: n }, () => ({ strokes: [], undo: [], redo: [] })); }

  async function openFile(file) {
    if (!file) return;
    const name = file.name || 'document';
    const type = file.type || '';
    if (S.dirty && !confirm('Open a new file? Drawings that are not saved will be lost.')) return;
    try {
      if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
        const buf = await file.arrayBuffer();
        await openPdfData(new Uint8Array(buf), name);
      } else if (/^image\/(png|jpe?g)$/.test(type) || /\.(png|jpe?g)$/i.test(name)) {
        await openImage(file, name);
      } else if (/\.json$/i.test(name)) {
        await loadDrawingsFile(file);
      } else {
        toast('Please choose a PDF, PNG or JPG file.');
      }
    } catch (err) {
      console.warn(err);
      toast('Sorry, this file could not be opened.');
    }
  }

  async function openPdfData(data, name) {
    toast('Opening ' + name + ' …');
    const task = pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: false, useSystemFonts: true });
    const pdf = await task.promise;
    const pages = [];
    // read sizes of all pages (fast, no rendering)
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      pages.push({ w: vp.width, h: vp.height, type: 'pdf', n: i });
    }
    if (S.doc && S.doc.pdf && S.doc.pdf !== pdf) { try { S.doc.pdf.destroy(); } catch (e) { /* ignore */ } }
    setDoc({ name, kind: 'pdf', pdf, pages });
    hideToast();
  }

  function openImage(file, name) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = 842 / Math.max(img.naturalWidth, img.naturalHeight);
        setDoc({ name, kind: 'image', pages: [{ w: img.naturalWidth * k, h: img.naturalHeight * k, type: 'image', img }] });
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function blankPage(type) { return { w: 842, h: 595, type }; } // A4 landscape in points

  function newBoard(type) {
    if (S.dirty && !confirm('Start a new board? Drawings that are not saved will be lost.')) return;
    setDoc({ name: type === 'grid' ? 'Grid board' : 'Blank board', kind: 'board', pages: [blankPage(type)] });
  }

  function addPage(type) {
    if (!S.doc) { newBoard(type); return; }
    S.doc.pages.push(blankPage(type));
    S.ink.push({ strokes: [], undo: [], redo: [] });
    buildThumbs();
    goTo(S.doc.pages.length - 1);
    toast('Page ' + S.doc.pages.length + ' added.');
  }

  function setDoc(doc) {
    resetDocState();
    S.doc = doc;
    S.ink = newInkFor(doc.pages.length);
    $('#welcome').hidden = true;
    $('#pagebar').hidden = false;
    $$('.needs-doc').forEach((b) => (b.disabled = false));
    const showThumbs = doc.pages.length > 1;
    setThumbsOpen(showThumbs);
    buildThumbs();
    requestAnimationFrame(() => {
      resize();
      fitPage();
      goTo(0, true);
      if (S.prot.visible) placeProtractorDefault();
      if (S.ruler.visible) placeRulerDefault();
      drawProtLayer(); drawCoverLayer();
    });
    updatePageUI();
    updateUndoButtons();
    document.title = doc.name.replace(/\.[^.]+$/, '') + ' — Protractor Teaching Board';
  }

  function goTo(i, force) {
    if (!S.doc) return;
    i = clamp(i, 0, S.doc.pages.length - 1);
    if (i === S.page && !force) return;
    if (action && action.type === 'draw') action = null;
    if (editor) commitTextEditor();
    sel = [];
    const prev = curPage();
    S.page = i;
    sharp = null; sharpToken++;
    const pg = curPage();
    if (!prev || prev.w !== pg.w || prev.h !== pg.h || S.fitted) fitPage(false);
    ensureBase(i);
    // prefetch neighbours a moment later
    setTimeout(() => { if (S.page === i) { ensureBase(i + 1); ensureBase(i - 1); } }, 400);
    drawNow();
    scheduleSharp();
    updatePageUI();
    updateUndoButtons();
    syncThumbCurrent();
  }

  function updatePageUI() {
    const n = S.doc ? S.doc.pages.length : 1;
    $('#pageInput').value = S.page + 1;
    $('#pageTotal').textContent = '/ ' + n;
    $('#btnPrev').disabled = S.page <= 0;
    $('#btnNext').disabled = S.page >= n - 1;
    updateZoomLabel();
  }

  /* ================================================================
     Thumbnails
     ================================================================ */
  const thumbs = new Map(); // idx -> { el, canvas, base(canvas) }
  let thumbObserver = null;
  const THUMB_W = 124;
  let thumbQueue = Promise.resolve();

  function setThumbsOpen(open) {
    $('#thumbs').hidden = !open;
    $('#btnThumbs').setAttribute('aria-pressed', String(open));
    requestAnimationFrame(resize);
  }

  function buildThumbs() {
    const list = $('#thumbList');
    list.innerHTML = '';
    thumbs.clear();
    if (thumbObserver) thumbObserver.disconnect();
    if (!S.doc) return;
    thumbObserver = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) renderThumb(+en.target.dataset.idx);
    }, { root: $('#thumbs'), rootMargin: '300px 0px' });
    S.doc.pages.forEach((pg, i) => {
      const b = document.createElement('button');
      b.className = 'thumb';
      b.dataset.idx = i;
      b.setAttribute('aria-label', 'Page ' + (i + 1));
      const frame = document.createElement('div');
      frame.className = 'tframe';
      frame.style.aspectRatio = pg.w + ' / ' + pg.h;
      const c = document.createElement('canvas');
      frame.appendChild(c);
      const label = document.createElement('span');
      label.textContent = i + 1;
      b.append(frame, label);
      b.addEventListener('click', () => goTo(i));
      list.appendChild(b);
      thumbs.set(i, { el: b, canvas: c, base: null, rendering: false });
      thumbObserver.observe(b);
    });
    syncThumbCurrent();
  }

  function renderThumb(i) {
    const t = thumbs.get(i);
    if (!t || t.base || t.rendering) return;
    t.rendering = true;
    const doc = S.doc;
    thumbQueue = thumbQueue.then(async () => {
      if (S.doc !== doc) return;
      const pg = doc.pages[i];
      const k = (THUMB_W * Math.min(dpr, 2)) / pg.w;
      const c = document.createElement('canvas');
      c.width = Math.round(pg.w * k); c.height = Math.round(pg.h * k);
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      if (pg.type === 'pdf') {
        const page = await getPdfPage(pg.n);
        await page.render({ canvasContext: cx, viewport: page.getViewport({ scale: k }) }).promise;
      } else if (pg.type === 'image') cx.drawImage(pg.img, 0, 0, c.width, c.height);
      else if (pg.type === 'grid') drawGrid(cx, pg, k, 0, 0);
      t.base = c;
      paintThumb(i);
    }).catch((err) => { if (!isCancel(err)) console.warn(err); });
  }

  function paintThumb(i) {
    const t = thumbs.get(i);
    if (!t || !t.base) return;
    const pg = S.doc.pages[i];
    const c = t.canvas;
    c.width = t.base.width; c.height = t.base.height;
    const cx = c.getContext('2d');
    cx.drawImage(t.base, 0, 0);
    const k = c.width / pg.w;
    for (const st of S.ink[i].strokes) drawStroke(cx, st, k, 0, 0, true);
  }

  let thumbInkTimer = 0;
  function scheduleThumbInk() {
    clearTimeout(thumbInkTimer);
    const i = S.page;
    thumbInkTimer = setTimeout(() => paintThumb(i), 350);
  }

  function syncThumbCurrent() {
    thumbs.forEach((t, i) => {
      t.el.classList.toggle('current', i === S.page);
      if (i === S.page) t.el.setAttribute('aria-current', 'page'); else t.el.removeAttribute('aria-current');
    });
    const t = thumbs.get(S.page);
    if (t && !$('#thumbs').hidden) {
      const box = $('#thumbs');
      const top = t.el.offsetTop, bottom = top + t.el.offsetHeight;
      if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) box.scrollTop = top - 20;
    }
  }

  /* ================================================================
     Export
     ================================================================ */
  async function renderPageCanvas(idx, scale, withProt) {
    const pg = S.doc.pages[idx];
    const c = document.createElement('canvas');
    c.width = Math.round(pg.w * scale); c.height = Math.round(pg.h * scale);
    const cx = c.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
    if (pg.type === 'pdf') {
      const page = await getPdfPage(pg.n);
      await page.render({ canvasContext: cx, viewport: page.getViewport({ scale }) }).promise;
    } else if (pg.type === 'image') cx.drawImage(pg.img, 0, 0, c.width, c.height);
    else if (pg.type === 'grid') drawGrid(cx, pg, scale, 0, 0);
    for (const st of S.ink[idx].strokes) drawStroke(cx, st, scale, 0, 0, true);
    if (withProt && S.prot.visible) {
      drawProtractorBody(cx, S.prot, scale, 0, 0);
      if (S.prot.armOn && S.prot.reading) {
        const L = armLength(S.prot.r, scale), a = S.prot.arm * DEG;
        const end = localToPage(L * Math.cos(a), -L * Math.sin(a));
        const ux = end.x - S.prot.x, uy = end.y - S.prot.y, len = Math.hypot(ux, uy) || 1;
        const k = Math.max(1.5, scale * 0.8); // reading box size in the exported image
        cx.save(); cx.scale(k, k);
        drawReadingBox(cx, (end.x * scale + ux / len * 52 * k) / k, (end.y * scale + uy / len * 46 * k) / k, S.prot);
        cx.restore();
      }
    }
    if (withProt && S.ruler.visible) drawRulerBody(cx, S.ruler, scale, 0, 0);
    return c;
  }

  function baseName() { return (S.doc ? S.doc.name : 'board').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-'); }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function exportPng() {
    if (!S.doc) return;
    if (editor) commitTextEditor();
    closeMenus();
    const pg = curPage();
    const scale = Math.min(3, 3000 / Math.max(pg.w, pg.h));
    const c = await renderPageCanvas(S.page, scale, true);
    c.toBlob((b) => { download(b, `${baseName()}-page-${S.page + 1}.png`); toast('PNG saved.'); }, 'image/png');
  }

  async function exportPdf() {
    if (!S.doc) return;
    if (editor) commitTextEditor();
    closeMenus();
    const { jsPDF } = window.jspdf;
    let pdf = null;
    const n = S.doc.pages.length;
    for (let i = 0; i < n; i++) {
      toast(`Exporting page ${i + 1} of ${n} …`, null, null, true);
      const pg = S.doc.pages[i];
      const scale = Math.min(2.2, 2200 / Math.max(pg.w, pg.h));
      const c = await renderPageCanvas(i, scale, false);
      const orient = pg.w > pg.h ? 'l' : 'p';
      if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [pg.w, pg.h], orientation: orient, compress: true });
      else pdf.addPage([pg.w, pg.h], orient);
      pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pg.w, pg.h, undefined, 'FAST');
      await new Promise((r) => setTimeout(r, 0));
    }
    download(pdf.output('blob'), `${baseName()}-with-drawings.pdf`);
    toast('PDF saved.');
  }

  /* ================================================================
     Save / load drawings
     ================================================================ */
  function saveDrawings() {
    closeMenus();
    if (!S.doc) { toast('Open a page first.'); return; }
    if (editor) commitTextEditor();
    const P = S.prot, Rr = S.ruler;
    const data = {
      app: 'Protractor Teaching Board',
      format: 1,
      saved: new Date().toISOString(),
      source: { name: S.doc.name, kind: S.doc.kind, pageCount: S.doc.pages.length, pageTypes: S.doc.pages.map((p) => p.type) },
      protractor: { x: r1(P.x), y: r1(P.y), r: r1(P.r), rot: r1(P.rot), arm: r1(P.arm), mode: P.mode, twoColor: P.twoColor, reading: P.reading, armOn: P.armOn, locked: P.locked, visible: P.visible },
      ruler: { x: r1(Rr.x), y: r1(Rr.y), rot: r1(Rr.rot), len: r1(Rr.len), visible: Rr.visible },
      pages: S.ink.map((ink) => ink.strokes.map((st) => {
        const o = { k: st.k, c: st.c, w: st.w, p: st.pts };
        if (st.line) o.line = 1;
        if (st.k === 'shape') o.s = st.s;
        if (st.k === 'text') { o.t = st.t; o.fs = st.fs; }
        return o;
      })),
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    download(blob, `${baseName()}-drawings.json`);
    S.dirty = false;
    toast('Drawings saved.');
  }

  async function loadDrawingsFile(file) {
    closeMenus();
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { toast('This is not a drawings file.'); return; }
    if (!data || data.app !== 'Protractor Teaching Board' || !Array.isArray(data.pages)) { toast('This is not a drawings file.'); return; }
    const src = data.source || {};
    if (!S.doc) {
      if (src.kind === 'board') {
        setDoc({ name: src.name || 'Board', kind: 'board', pages: (src.pageTypes || ['blank']).map((t) => blankPage(t === 'grid' ? 'grid' : 'blank')) });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      } else {
        toast(`Open "${src.name}" first, then load the drawings.`);
        return;
      }
    } else if (src.name && src.name !== S.doc.name) {
      if (!confirm(`These drawings were made on "${src.name}". Load them onto "${S.doc.name}" anyway?`)) return;
    }
    // add missing blank / grid pages that were added during the lesson
    const types = src.pageTypes || [];
    for (let i = S.doc.pages.length; i < data.pages.length; i++) {
      if (types[i] === 'blank' || types[i] === 'grid') { S.doc.pages.push(blankPage(types[i])); S.ink.push({ strokes: [], undo: [], redo: [] }); }
    }
    let count = 0;
    data.pages.forEach((arr, i) => {
      if (!S.ink[i] || !Array.isArray(arr)) return;
      S.ink[i] = {
        strokes: arr.filter((o) => o && Array.isArray(o.p)).map((o) => {
          const base = { c: String(o.c || '#1b1f24'), pts: o.p.map(Number) };
          if (o.k === 'text') return Object.assign(base, { k: 'text', t: String(o.t || ''), fs: +o.fs || 24 });
          if (o.k === 'shape') return Object.assign(base, { k: 'shape', s: ['line', 'arrow', 'rect', 'ellipse'].includes(o.s) ? o.s : 'line', w: +o.w || 4 });
          return Object.assign(base, { k: o.k === 'hl' ? 'hl' : 'pen', w: +o.w || 4, line: !!o.line });
        }),
        undo: [], redo: [],
      };
      count += S.ink[i].strokes.length;
    });
    if (data.protractor) {
      const p = data.protractor;
      Object.assign(S.prot, {
        x: +p.x || S.prot.x, y: +p.y || S.prot.y, r: +p.r || S.prot.r, rot: +p.rot || 0, arm: +p.arm || 0,
        mode: p.mode === 360 ? 360 : 180, twoColor: p.twoColor !== false, reading: p.reading !== false, armOn: p.armOn !== false, locked: !!p.locked,
        visible: !!p.visible, placed: true,
      });
    }
    if (data.ruler) {
      const r = data.ruler;
      Object.assign(S.ruler, { x: +r.x || S.ruler.x, y: +r.y || S.ruler.y, rot: +r.rot || 0, len: clamp(+r.len || 15 * CM, 3 * CM, 100 * CM), visible: !!r.visible, placed: true });
    }
    buildThumbs();
    goTo(clamp(S.page, 0, S.doc.pages.length - 1), true);
    syncProtUI();
    syncToggles();
    S.dirty = false;
    toast(`Loaded ${count} drawing${count === 1 ? '' : 's'}.`);
  }

  /* ================================================================
     UI wiring
     ================================================================ */
  function setTool(t) {
    if (!['select', 'hand', 'pen', 'hl', 'shape', 'text', 'eraser', 'laser'].includes(t)) return;
    if (editor && t !== 'text') commitTextEditor();
    if (t !== 'select') clearSelection();
    S.tool = t;
    $$('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    $$('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    stage.classList.remove('c-select', 'c-pen', 'c-hl', 'c-shape', 'c-text', 'c-hand', 'c-laser', 'c-eraser');
    stage.classList.add('c-' + t);
    if (t !== 'laser') laserClear();
    if (t !== 'eraser') drawEraserCursor(null);
    buildSwatches();
    drawProtLayer();
  }

  function buildSwatches() {
    const isHl = S.tool === 'hl';
    const list = isHl ? HL_COLORS : PEN_COLORS;
    const sel = isHl ? S.hlColor : S.penColor;
    const box = $('#swatches');
    box.innerHTML = '';
    const dim = !['pen', 'hl', 'shape', 'text'].includes(S.tool);
    box.classList.toggle('dim', dim);
    list.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === sel ? ' active' : '');
      b.style.setProperty('--c', c.c);
      b.dataset.tip = (isHl ? 'Highlighter: ' : 'Color: ') + c.name;
      b.setAttribute('aria-label', b.dataset.tip);
      b.setAttribute('aria-pressed', String(i === sel));
      b.innerHTML = '<i></i>';
      b.addEventListener('click', () => {
        if (isHl) S.hlColor = i; else S.penColor = i;
        if (dim) setTool(isHl ? 'hl' : 'pen'); else buildSwatches();
      });
      box.appendChild(b);
    });
    const sizes = $('#sizes');
    sizes.innerHTML = '';
    sizes.classList.toggle('dim', dim);
    const ssel = isHl ? S.hlSize : S.penSize;
    [6, 10, 15].forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'size' + (i === ssel ? ' active' : '');
      b.dataset.tip = S.tool === 'text' ? 'Text size: ' + TEXT_SIZE_NAMES[i] : (isHl ? 'Highlighter size: ' : 'Line size: ') + SIZE_NAMES[i];
      b.setAttribute('aria-label', b.dataset.tip);
      b.setAttribute('aria-pressed', String(i === ssel));
      b.innerHTML = `<i style="width:${d}px;height:${d}px"></i>`;
      b.addEventListener('click', () => {
        if (isHl) S.hlSize = i; else S.penSize = i;
        if (dim) setTool(isHl ? 'hl' : 'pen'); else buildSwatches();
      });
      sizes.appendChild(b);
    });
  }

  function setLineMode(v) {
    S.lineMode = v;
    $('#btnLine').setAttribute('aria-pressed', String(v));
    if (S.tool !== 'pen' && S.tool !== 'hl' && v) setTool('pen');
  }

  function syncReading() {
    const r = readings();
    $('#ppInner').textContent = r.inner + '°';
    $('#ppOuter').textContent = r.outer + '°';
  }

  function syncProtUI() {
    const P = S.prot;
    $('#btnProt').setAttribute('aria-pressed', String(P.visible));
    $('#protPanel').hidden = !P.visible || !S.doc;
    $('#pp180').setAttribute('aria-pressed', String(P.mode === 180));
    $('#pp360').setAttribute('aria-pressed', String(P.mode === 360));
    $('#ppColor').setAttribute('aria-pressed', String(P.twoColor));
    $('#ppBlack').setAttribute('aria-pressed', String(!P.twoColor));
    $('#protPanel').classList.toggle('mono', !P.twoColor);
    $('#ppReadBtn').setAttribute('aria-pressed', String(P.reading));
    $('#ppReadBtn span').textContent = P.reading ? 'Hide reading' : 'Show reading';
    $('#ppReadBtn use').setAttribute('href', P.reading ? '#i-eyeoff' : '#i-eye');
    $('#ppReading').hidden = !(P.reading && P.armOn);
    $('#ppHiddenNote').hidden = P.reading && P.armOn;
    $('#ppHiddenNote').textContent = P.armOn ? 'Reading hidden' : 'Measuring arm hidden';
    $('#ppArm').setAttribute('aria-pressed', String(P.armOn));
    $('#ppArm span').textContent = P.armOn ? 'Hide measuring arm' : 'Show measuring arm';
    $('#ppLock').setAttribute('aria-pressed', String(P.locked));
    $('#ppLock span').textContent = P.locked ? 'Locked — click to unlock' : 'Lock in place';
    $('#ppLock use').setAttribute('href', P.locked ? '#i-lock' : '#i-unlock');
    syncReading();
  }

  function protSet(patch) {
    Object.assign(S.prot, patch);
    if (S.prot.mode === 180 && S.prot.arm > 180) S.prot.arm = S.prot.arm > 270 ? 0 : 180;
    syncProtUI();
    drawProtLayer();
  }

  /* menus */
  function openMenu(btn, menu) {
    const wasOpen = !menu.hidden;
    closeMenus();
    if (wasOpen) return;
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    let left = menu.classList.contains('menu-right') ? r.right - mw : r.left;
    left = clamp(left, 8, window.innerWidth - mw - 8);
    menu.style.left = left + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    hideTip();
  }
  function closeMenus() { $$('.menu').forEach((m) => (m.hidden = true)); }
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu-wrap')) closeMenus(); });

  /* tooltip */
  const tip = $('#tooltip');
  let tipTimer = 0;
  function showTip(el) {
    const text = el.dataset.tip;
    if (!text) return;
    tip.innerHTML = '';
    tip.append(document.createTextNode(text));
    if (el.dataset.key) { const k = document.createElement('kbd'); k.textContent = el.dataset.key; tip.append(k); }
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 8;
    if (el.dataset.tipPos === 'top') y = r.top - th - 8;
    if (el.dataset.tipPos === 'left') { x = r.left - tw - 8; y = r.top + r.height / 2 - th / 2; }
    tip.style.left = clamp(x, 6, window.innerWidth - tw - 6) + 'px';
    tip.style.top = clamp(y, 6, window.innerHeight - th - 6) + 'px';
  }
  function hideTip() { clearTimeout(tipTimer); tip.hidden = true; }
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || e.pointerType === 'touch') return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { if (el.matches(':hover') && $$('.menu').every((m) => m.hidden)) showTip(el); }, 350);
  });
  document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('pointerdown', hideTip, true);

  /* toast */
  let toastTimer = 0;
  function toast(msg, actionLabel, actionFn, sticky) {
    const t = $('#toast');
    t.innerHTML = '';
    t.append(document.createTextNode(msg));
    if (actionLabel) {
      const b = document.createElement('button');
      b.textContent = actionLabel;
      b.addEventListener('click', () => { actionFn(); hideToast(); });
      t.append(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(hideToast, actionLabel ? 5000 : 2400);
  }
  function hideToast() { $('#toast').hidden = true; }

  /* fullscreen */
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    const fs = d.fullscreenElement || d.webkitFullscreenElement;
    if (!fs) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  }
  function syncFullscreen() {
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    $('#btnFull use').setAttribute('href', fs ? '#i-exitfull' : '#i-full');
    $('#btnFull').dataset.tip = fs ? 'Exit fullscreen' : 'Fullscreen';
  }
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('webkitfullscreenchange', syncFullscreen);

  function toggleHelp(force) {
    const h = $('#help');
    h.hidden = force === undefined ? !h.hidden : !force;
  }

  async function openSample() {
    if (!window.SAMPLE_PDF_BASE64) { toast('Sample file is missing.'); return; }
    const bin = atob(window.SAMPLE_PDF_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await openPdfData(bytes, 'Sample - Measure the Angles.pdf');
  }

  /* buttons */
  $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
  $('#wOpen').addEventListener('click', () => $('#fileInput').click());
  $('#wSample').addEventListener('click', openSample);
  $('#wBlank').addEventListener('click', () => newBoard('blank'));
  $('#wGrid').addEventListener('click', () => newBoard('grid'));
  $('#fileInput').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
  $('#drawingsInput').addEventListener('change', (e) => { if (e.target.files[0]) loadDrawingsFile(e.target.files[0]); e.target.value = ''; });
  $('#btnNew').addEventListener('click', () => openMenu($('#btnNew'), $('#menuNew')));
  $$('[data-new]').forEach((b) => b.addEventListener('click', () => { closeMenus(); newBoard(b.dataset.new); }));
  $$('[data-add]').forEach((b) => b.addEventListener('click', () => { closeMenus(); addPage(b.dataset.add); }));
  $$('.needs-doc').forEach((b) => (b.disabled = true));
  $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#btnLine').addEventListener('click', () => setLineMode(!S.lineMode));
  $('#btnProt').addEventListener('click', () => { if (!S.doc) { toast('Open a page first.'); return; } setProtVisible(!S.prot.visible); });
  $('#btnRuler').addEventListener('click', () => { if (!S.doc) { toast('Open a page first.'); return; } setRulerVisible(!S.ruler.visible); });
  $('#btnCover').addEventListener('click', () => { if (!S.doc) { toast('Open a page first.'); return; } setCover(!S.cover.on); });
  $('#btnShape').addEventListener('click', () => openMenu($('#btnShape'), $('#menuShape')));
  function setShape(sh) {
    S.shape = sh;
    $('#btnShape use').setAttribute('href', '#i-sh-' + sh);
    $$('[data-shape]').forEach((b) => b.classList.toggle('current', b.dataset.shape === sh));
  }
  $$('[data-shape]').forEach((b) => b.addEventListener('click', () => { setShape(b.dataset.shape); closeMenus(); setTool('shape'); }));
  setShape('arrow');
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnClear').addEventListener('click', clearPage);
  $('#btnExport').addEventListener('click', () => openMenu($('#btnExport'), $('#menuExport')));
  $('#expPng').addEventListener('click', () => { if (!S.doc) { closeMenus(); toast('Open a page first.'); return; } exportPng(); });
  $('#expPdf').addEventListener('click', () => { if (!S.doc) { closeMenus(); toast('Open a page first.'); return; } exportPdf(); });
  $('#drSave').addEventListener('click', saveDrawings);
  $('#drLoad').addEventListener('click', () => { closeMenus(); $('#drawingsInput').click(); });
  $('#btnHelp').addEventListener('click', () => toggleHelp());
  $('#helpClose').addEventListener('click', () => toggleHelp(false));
  $('#btnFull').addEventListener('click', toggleFullscreen);
  $('#btnPrev').addEventListener('click', () => goTo(S.page - 1));
  $('#btnNext').addEventListener('click', () => goTo(S.page + 1));
  $('#btnZoomIn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.25));
  $('#btnZoomOut').addEventListener('click', () => zoomAt(W / 2, H / 2, 0.8));
  $('#btnFit').addEventListener('click', () => fitPage());
  $('#btnThumbs').addEventListener('click', () => setThumbsOpen($('#thumbs').hidden));
  $('#pageInput').addEventListener('change', (e) => { const n = parseInt(e.target.value, 10); if (n) goTo(n - 1); else updatePageUI(); e.target.blur(); });
  $('#pageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); });
  $('#pp180').addEventListener('click', () => protSet({ mode: 180 }));
  $('#pp360').addEventListener('click', () => protSet({ mode: 360 }));
  $('#ppColor').addEventListener('click', () => protSet({ twoColor: true }));
  $('#ppBlack').addEventListener('click', () => protSet({ twoColor: false }));
  $('#ppReadBtn').addEventListener('click', () => protSet({ reading: !S.prot.reading }));
  $('#ppArm').addEventListener('click', () => protSet({ armOn: !S.prot.armOn }));
  $('#ppLock').addEventListener('click', () => protSet({ locked: !S.prot.locked }));
  $('#ppCenter').addEventListener('click', () => { const keep = { mode: S.prot.mode }; placeProtractorDefault(); protSet(keep); });
  $('#ppHide').addEventListener('click', () => setProtVisible(false));
  $('#ppCollapse').addEventListener('click', () => {
    const p = $('#protPanel');
    p.classList.toggle('collapsed');
    $('#ppCollapse').setAttribute('aria-label', p.classList.contains('collapsed') ? 'Expand panel' : 'Collapse panel');
  });

  /* after a mouse/touch click, drop focus from buttons so Space and shortcuts never re-trigger them */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && e.detail > 0 && !btn.closest('.menu')) btn.blur();
  });

  /* keyboard */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomAt(W / 2, H / 2, 1.25); return; }
    if (mod && k === '-') { e.preventDefault(); zoomAt(W / 2, H / 2, 0.8); return; }
    if (mod && k === '0') { e.preventDefault(); fitPage(); return; }
    if (mod || e.altKey) return;
    if (k === ' ') {
      e.preventDefault();
      if (!spaceDown) { spaceDown = true; stage.classList.add('c-hand'); }
      return;
    }
    switch (k.toLowerCase()) {
      case 'p': setTool('pen'); break;
      case 'h': setTool('hl'); break;
      case 'e': setTool('eraser'); break;
      case 'l': setTool('laser'); break;
      case 'r': if (S.doc) setProtVisible(!S.prot.visible); break;
      case 'a': if (S.doc && S.prot.visible) protSet({ armOn: !S.prot.armOn }); break;
      case 'u': if (S.doc) setRulerVisible(!S.ruler.visible); break;
      case 'c': if (S.doc) setCover(!S.cover.on); break;
      case 'v': setTool('select'); break;
      case 't': setTool('text'); break;
      case 's': setTool('shape'); break;
      case 'delete': case 'backspace': if (sel.length) { e.preventDefault(); deleteSelection(); } break;
      case 'f': toggleFullscreen(); break;
      case '?': case '/': toggleHelp(); break;
      case 'escape': closeMenus(); toggleHelp(false); clearSelection(); break;
      case 'arrowright': case 'arrowdown': case 'pagedown': e.preventDefault(); goTo(S.page + 1); break;
      case 'arrowleft': case 'arrowup': case 'pageup': e.preventDefault(); goTo(S.page - 1); break;
      case '+': case '=': zoomAt(W / 2, H / 2, 1.25); break;
      case '-': case '_': zoomAt(W / 2, H / 2, 0.8); break;
      case '0': fitPage(); break;
      default: return;
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; stage.classList.remove('c-hand'); stage.classList.add('c-' + S.tool); }
  });
  window.addEventListener('blur', () => { spaceDown = false; });

  /* drag & drop */
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#dropzone').hidden = false; e.preventDefault(); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropzone').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#dropzone').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* welcome art: a small protractor drawn with the same code */
  function drawWelcomeArt() {
    const c = $('#welcomeArt');
    const r = Math.min(window.devicePixelRatio || 1, 3);
    c.width = 300 * r; c.height = 190 * r;
    const cx = c.getContext('2d');
    cx.setTransform(r, 0, 0, r, 0, 0);
    const ox = 150, oy = 172, R = 118;
    // a paper angle
    cx.strokeStyle = '#1f2a37'; cx.lineWidth = 2.5; cx.lineCap = 'round';
    cx.beginPath(); cx.moveTo(ox, oy); cx.lineTo(292, oy); cx.moveTo(ox, oy);
    cx.lineTo(ox + 140 * Math.cos(-50 * DEG), oy + 140 * Math.sin(-50 * DEG)); cx.stroke();
    const P = { x: ox, y: oy, r: R, rot: 0, arm: 50, mode: 180, twoColor: true };
    drawProtractorBody(cx, P, 1, 0, 0);
    const a = 50 * DEG, L = armLength(R, 1);
    handleCircle(cx, ox + Math.cos(a) * L, oy - Math.sin(a) * L, 9, COLORS.handle, '#fff', true);
  }

  /* resize observer */
  new ResizeObserver(() => resize()).observe(stage);

  /* debug / test hook (read-only helpers) */
  window.__ptb = {
    state: S,
    toScreen, toPage, localToScreen, readings,
    stageRect: () => stage.getBoundingClientRect(),
    protGeom,
    setProt: (o) => protSet(o),
    rLocalToScreen, rulerGeom, itemBox,
    setRuler: (o) => { Object.assign(S.ruler, o, { placed: true }); syncToggles(); drawProtLayer(); },
    selection: () => sel.slice(),
    coverGrip: () => coverGrip(),
  };

  /* init */
  setTool('pen');
  syncProtUI();
  syncToggles();
  updateUndoButtons();
  drawWelcomeArt();
  resize();
})();
