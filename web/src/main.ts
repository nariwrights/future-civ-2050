import './style.css';
import { type Cell, halfPassed, indexAt, lightState, loadData, popAt, interp } from './data';
import { LENSES, cssRamp, lensById, type LensId } from './lenses';
import { CivMap } from './map';
import { Player, Tween } from './timeline';
import { esc, fmt, halfLabel, loLabel, yearParts } from './format';
import { Ruler } from './ui/ruler';
import { Panel } from './ui/panel';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const mobile = matchMedia('(max-width: 720px)');

async function main() {
  const data = await loadData();
  const { meta } = data;
  const until = meta.playable_until;
  $('loading').remove();
  $('src').textContent = '出典：' + meta.source;
  $('ncell').textContent = ` ／ ${fmt(data.popCells.length)}`;
  $('scope').textContent = `大阪府 · 六角形 約${meta.cell_area_km2.toFixed(2)}km² · 1kmメッシュ推計（R6国政局推計）`;

  const q = new URLSearchParams(location.search);
  const state = {
    year: Math.min(until, Math.max(2020, +(q.get('year') ?? 2020) || 2020)),
    lens: lensById((q.get('lens') as LensId) || 'pop') ?? LENSES[0],
    city: null as number | null,
    cell: null as Cell | null,
  };

  // レンズ選択と凡例
  $('lenses').innerHTML = '<div class="lbl"><span>レンズ</span></div>' + LENSES.map((l) =>
    `<button type="button" data-lens="${l.id}" aria-pressed="false"><kbd>${l.key}</kbd>${l.name}<small>${l.unit}</small></button>`).join('');
  const lensBtns = [...document.querySelectorAll<HTMLButtonElement>('#lenses button')];
  lensBtns.forEach((b) => (b.onclick = () => setLens(b.dataset.lens as LensId)));
  function renderLegend() {
    const L = state.lens;
    const ticks = (L.ticks ?? []).map(([s, t], i, a) =>
      `<span style="left:${t * 100}%;transform:translateX(${i === 0 ? 0 : i === a.length - 1 ? '-100%' : '-50%'})">${s}</span>`).join('');
    const items = (L.items ?? []).map((it) =>
      `<li><i style="background:${it.swatch}${it.outline ? ';border:1px dashed #8a9099' : ''}"></i>${esc(it.label)}</li>`).join('');
    $('legend').innerHTML = `<div class="lbl"><span>${esc(L.name)}</span><span>${esc(L.unit)}</span></div>
      <div class="ramp" style="background:${cssRamp(L.ramp!)}"></div><div class="ticks">${ticks}</div>
      ${items ? `<ul class="items">${items}</ul>` : ''}<p>${esc(L.desc(state.year))}</p>`;
  }
  function setLens(id: LensId) {
    state.lens = lensById(id);
    lensBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lens === id)));
    renderLegend();
    draw();
  }

  // 地図
  const view = $('view');
  const map = new CivMap(view, data, {
    onHover: (c, x, y, ll) => {
      if (ll) $('coord').textContent = `${ll[1].toFixed(4)}N ${ll[0].toFixed(4)}E`;
      if (mobile.matches) return;
      showTip(c && c.city >= 0 ? c : null, x, y);
    },
    onClick: (c) => {
      if (c && c.city >= 0) { state.city = c.city; state.cell = c.kind === 0 ? c : null; openPanel(true); }
      else { state.cell = null; }
      showTip(null, 0, 0);
      draw();
    },
  });
  $('reset').onclick = () => map.resetView();
  map.onView = () => updateScale();
  function updateScale() {
    const px = map.kmPx() * 10;
    if (px > 0) ($('scale').firstElementChild as HTMLElement).style.width = `${px}px`;
  }

  function showTip(c: Cell | null, x: number, y: number) {
    const tip = $('tip');
    if (!c) { tip.classList.remove('on'); return; }
    const city = data.cities[c.city];
    const p = popAt(c, state.year), ix = indexAt(c, state.year);
    tip.innerHTML = `<b>${esc(city.name)}</b>` + (c.kind === 0
      ? `<span>${Math.floor(state.year)}年 ${p < 1 ? '推計1人未満' : fmt(p) + '人'}${ix != null ? `　2020年＝100で ${ix.toFixed(0)}` : ''}</span><span>消灯年 ${loLabel(c.lo)}</span><span>半減年 ${halfLabel(c.half)}</span>`
      : '<span>人が住んでいない区域</span>');
    const w = view.clientWidth;
    tip.style.left = `${Math.min(w - 250, x + 16)}px`;
    tip.style.top = `${Math.max(8, y - 20)}px`;
    tip.classList.add('on');
  }

  // 右パネル（スマホではシート）
  const panel = new Panel($('panel'), data, (ci) => {
    state.city = ci;
    if (ci == null || (state.cell && state.cell.city !== ci)) state.cell = null;
    draw();
  });
  function openPanel(open: boolean) {
    document.body.classList.toggle('sheet-open', open);
    $('listBtn').setAttribute('aria-expanded', String(open));
    setTimeout(() => map.redraw(), 260);
  }
  $('listBtn').onclick = () => openPanel(!document.body.classList.contains('sheet-open'));
  $('panel').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.close')) openPanel(false);
  });

  // 計器
  const tween = new Tween(meta.pref_total[0], (v) => ($('tot').textContent = fmt(v)));
  const ruler = new Ruler($('ruler'), { totals: meta.pref_total, until, onInput: (y) => setYear(y), onGrab: () => player.pause() });
  const t0 = meta.pref_total[0];
  function readouts() {
    const y = state.year, { int, frac } = yearParts(y);
    $('yr').innerHTML = `${int}<small>.${frac}</small>`;
    $('kind').textContent = y < 2021 ? '実績ベース' : '推計';
    const t = interp(meta.pref_total, y)!;
    tween.to(t, player.playing);
    $('ix').textContent = ((t / t0) * 100).toFixed(1);
    $('dlt').textContent = `2020年比 ${t - t0 >= 0 ? '+' : '−'}${fmt(Math.abs(t - t0))}人`;
    let lo = 0, hf = 0;
    for (const c of data.popCells) { if (lightState(c, y, until) === 'out') lo++; if (halfPassed(c, y)) hf++; }
    $('lo').textContent = fmt(lo);
    $('hf').textContent = fmt(hf);
  }
  function draw() {
    map.render(state);
    panel.update(state.year, state.city, state.cell);
  }
  let lastLegendYear = state.year;
  function setYear(y: number) {
    state.year = Math.min(until, Math.max(2020, y));
    ruler.set(state.year);
    readouts();
    if ((lastLegendYear < 2025) !== (state.year < 2025)) renderLegend();
    lastLegendYear = state.year;
    draw();
  }
  const player = new Player(2020, until, 0.8, setYear, (on) => {
    $('ri').innerHTML = on ? '<path d="M1 0h3v11H1zM7 0h3v11H7z"/>' : '<path d="M1 0l10 5.5L1 11z"/>';
    $('rl').textContent = on ? '一時停止' : '再生';
    $('run').setAttribute('aria-label', on ? '一時停止' : '再生');
    $('state').textContent = on ? '再生中' : '待機';
    $('dot').classList.toggle('on', on);
  });
  player.year = state.year;
  $('run').onclick = () => { player.year = state.year; player.toggle(); };
  document.querySelectorAll<HTMLButtonElement>('.spd button').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('.spd button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    player.secPerYear = +b.dataset.s!;
  }));
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input,textarea')) return;
    const l = LENSES.find((x) => x.key === e.key);
    if (l) setLens(l.id);
    if (e.key === ' ' && (t === document.body || t.closest('.view'))) { e.preventDefault(); $('run').click(); }
    if (e.key === 'Escape') { state.city = null; state.cell = null; openPanel(false); draw(); }
  });
  new ResizeObserver(() => { map.resize(); setTimeout(updateScale, 50); }).observe(view);

  setLens(state.lens.id);
  setYear(state.year);
  tween.to(interp(meta.pref_total, state.year)!, true);
  const sel = q.get('city');
  if (sel) { const i = data.cities.findIndex((c) => c.name === sel); if (i >= 0) { state.city = i; openPanel(true); draw(); } }
  setTimeout(updateScale, 300);
  if (q.has('play')) $('run').click();
}

main().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'データを読み込めませんでした。時間をおいて再読み込みしてください。';
});
