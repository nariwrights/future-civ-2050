/* future-civ-2050 mockup core (フェーズ0専用・3案共通)
 * データ展開 / 年の補間 / 投影と六角形パス / 再生 / 当たり判定 / 書式 */
(function () {
  const D = window.__DATA__;
  const DEC = D.meta.years; // [2020,2030,2040,2050]
  const AREA = D.meta.cell_area_km2;
  const cells = D.cells.map(r => ({ lat: r[0], lng: r[1], city: r[2], p: [r[3], r[4], r[5], r[6]], lo: r[7] }));
  for (const c of cells) {
    c.kind = c.city === -2 ? 'out' : (c.p[0] < 1 && c.p[3] < 1 ? 'empty' : 'pop');
  }
  const T5 = Object.keys(D.meta.pref_total).map(Number).sort((a, b) => a - b);

  function lerp(a, b, t) { return a + (b - a) * t; }
  function interp(arr, years, y) {
    if (y <= years[0]) return arr[0];
    for (let i = 0; i < years.length - 1; i++) {
      if (y <= years[i + 1]) return lerp(arr[i], arr[i + 1], (y - years[i]) / (years[i + 1] - years[i]));
    }
    return arr[arr.length - 1];
  }
  const popAt = (c, y) => interp(c.p, DEC, y);
  const densityAt = (c, y) => popAt(c, y) / AREA;
  const indexAt = (c, y) => (c.p[0] >= 1 ? (popAt(c, y) / c.p[0]) * 100 : null);
  const totalAt = y => interp(T5.map(k => D.meta.pref_total[k]), T5, y);
  const cityPopAt = (ci, y) => { const P = D.cities[ci].pop; return interp(T5.map(k => P[k]), T5, y); };
  // 消灯の状態: 'none'(2050年以降も推計1人以上) | 'later'(2050より後に1人未満) | 'soon'(年内はまだ灯る) | 'out'(推計1人未満) | 'na'(対象外)
  function lightState(c, y) {
    if (c.kind !== 'pop' || c.lo === -1) return 'na';
    if (c.lo === 0) return 'none';
    if (c.lo > 2050) return y >= c.lo ? 'out' : 'later';
    return y >= c.lo ? 'out' : 'soon';
  }

  function makeProjection(w, h, pad) {
    pad = Object.assign({ t: 0, r: 0, b: 0, l: 0 }, pad || {});
    const core = cells.filter(c => c.kind !== 'out');
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const c of core) { minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat); minLng = Math.min(minLng, c.lng); maxLng = Math.max(maxLng, c.lng); }
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const gw = (maxLng - minLng) * k, gh = maxLat - minLat;
    const aw = w - pad.l - pad.r, ah = h - pad.t - pad.b;
    const s = Math.min(aw / gw, ah / gh);
    const ox = pad.l + (aw - gw * s) / 2, oy = pad.t + (ah - gh * s) / 2;
    const project = (lat, lng) => [ox + (lng - minLng) * k * s, oy + (maxLat - lat) * s];
    const unproject = (x, y) => [maxLat - (y - oy) / s, minLng + (x - ox) / (k * s)];
    const shape = D.meta.hex_shape.map(([dl, da]) => [dl * k * s, -da * s]);
    const r = Math.hypot(shape[0][0], shape[0][1]);
    for (const c of cells) { const [x, y] = project(c.lat, c.lng); c.x = x; c.y = y; }
    function hexPath(ctx, x, y, scale) {
      scale = scale || 1;
      ctx.moveTo(x + shape[0][0] * scale, y + shape[0][1] * scale);
      for (let i = 1; i < 6; i++) ctx.lineTo(x + shape[i][0] * scale, y + shape[i][1] * scale);
      ctx.closePath();
    }
    return { project, unproject, hexPath, r, s, bounds: { minLat, maxLat, minLng, maxLng } };
  }

  // 地名ラベル用: 2020年人口で重み付けした市町村の重心（投影後の座標）
  const LABEL_CITIES = ['大阪市', '堺市', '豊中市', '高槻市', '枚方市', '東大阪市', '岸和田市', '河内長野市', '能勢町', '岬町'];
  function labelPoints() {
    const acc = {};
    for (const c of cells) {
      if (c.city < 0 || c.kind !== 'pop') continue;
      const a = acc[c.city] || (acc[c.city] = [0, 0, 0]);
      a[0] += c.x * c.p[0]; a[1] += c.y * c.p[0]; a[2] += c.p[0];
    }
    return LABEL_CITIES.map(n => { const i = D.cities.findIndex(x => x.name === n); const a = acc[i]; return a && a[2] ? { name: n, x: a[0] / a[2], y: a[1] / a[2] } : null; }).filter(Boolean);
  }

  function hit(x, y, r) {
    let best = null, bd = r * r;
    for (const c of cells) {
      if (c.kind === 'out') continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function setupCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  // 再生: 1年あたり secPerYear 秒、5年刻みの間も連続的に進む
  function Player(opt) {
    const o = Object.assign({ from: 2020, to: 2050, secPerYear: 0.8, onYear() {}, onState() {} }, opt);
    let year = o.from, playing = false, last = 0, raf = 0;
    function tick(t) {
      if (!playing) return;
      if (last) year = Math.min(o.to, year + (t - last) / 1000 / o.secPerYear);
      last = t; o.onYear(year);
      if (year >= o.to) { pause(); return; }
      raf = requestAnimationFrame(tick);
    }
    function play() { if (year >= o.to) year = o.from; playing = true; last = 0; o.onState(true); raf = requestAnimationFrame(tick); }
    function pause() { playing = false; cancelAnimationFrame(raf); o.onState(false); }
    function set(y) { year = Math.max(o.from, Math.min(o.to, y)); o.onYear(year); }
    return { play, pause, set, speed(v) { o.secPerYear = v; }, toggle() { playing ? pause() : play(); }, get year() { return year; }, get playing() { return playing; } };
  }


  // スライダー: el 上のドラッグ/タップ/キーで年を決める。位置は CSS 変数 --t (0..1) で各案が描く
  function bindTrack(el, o) {
    o = Object.assign({ from: 2020, to: 2050, vertical: false, onInput() {}, onGrab() {}, step: 1 }, o);
    el.tabIndex = 0; el.setAttribute('role', 'slider');
    el.setAttribute('aria-valuemin', o.from); el.setAttribute('aria-valuemax', o.to);
    const fromEvent = e => {
      const r = el.getBoundingClientRect();
      const t = o.vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
      return o.from + Math.max(0, Math.min(1, t)) * (o.to - o.from);
    };
    let drag = false;
    el.addEventListener('pointerdown', e => { drag = true; el.setPointerCapture(e.pointerId); o.onGrab(); o.onInput(fromEvent(e)); el.classList.add('is-drag'); });
    el.addEventListener('pointermove', e => { if (drag) o.onInput(fromEvent(e)); });
    const end = () => { drag = false; el.classList.remove('is-drag'); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => {
      const cur = +el.getAttribute('aria-valuenow') || o.from;
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (o.vertical && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { /* 縦: 下=未来 */ }
      if (d) { e.preventDefault(); o.onGrab(); o.onInput(Math.round(cur) + (o.vertical && Math.abs(d) === 1 ? (e.key === 'ArrowDown' ? 1 : -1) : d) * o.step); }
      if (e.key === 'Home') { o.onGrab(); o.onInput(o.from); }
      if (e.key === 'End') { o.onGrab(); o.onInput(o.to); }
    });
    return y => { el.style.setProperty('--t', (y - o.from) / (o.to - o.from)); el.setAttribute('aria-valuenow', Math.round(y)); el.setAttribute('aria-valuetext', Math.round(y) + '年'); };
  }

  // 書式
  const fmt = n => Math.round(n).toLocaleString('ja-JP');
  const KD = '〇一二三四五六七八九';
  const kanjiDigits = n => String(n).split('').map(d => KD[+d]).join('');
  function kanjiNum(n) { // 1..99
    const t = Math.floor(n / 10), o = n % 10;
    return (t ? (t > 1 ? KD[t] : '') + '十' : '') + (o ? KD[o] : '');
  }
  const reiwa = y => '令和' + kanjiNum(y - 2018) + '年';
  function lerpColor(stops, t) {
    t = Math.max(0, Math.min(1, t));
    const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
    const a = stops[i], b = stops[i + 1];
    return `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(lerp(a[2], b[2], f))})`;
  }
  const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const densityT = d => Math.max(0, Math.min(1, Math.log10(d + 1) / Math.log10(30000)));

  window.FC = { D, cells, cities: D.cities, meta: D.meta, popAt, densityAt, indexAt, totalAt, cityPopAt, lightState,
    makeProjection, hit, bindTrack, labelPoints, setupCanvas, Player, fmt, kanjiDigits, kanjiNum, reiwa, lerpColor, hex2rgb, densityT,
    SOURCE: '出典：国土数値情報（国土交通省）「1kmメッシュ別将来推計人口データ（R6国政局推計）」「行政区域データ」を加工して作成（CC BY 4.0）。値は2020年国勢調査に基づく推計であり、確定した将来ではありません。' };
})();
