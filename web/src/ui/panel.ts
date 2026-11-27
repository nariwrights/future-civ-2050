/** 右パネル：市町村未選択時は全市町村の小さな多重折れ線（コード順、順位づけなし）、選択時は時系列パネル。 */
import { ageAt, type Cell, type City, type Dataset, indexAt, interp, popAt } from '../data';
import { esc, fmt, halfLabel, loLabel } from '../format';

const W = 240;

function sparkPath(series: number[], w: number, h: number, lo: number, hi: number, from: number, to: number) {
  let d = '';
  for (let y = from; y <= to; y += 5) {
    const v = series[(y - 2020) / 5];
    const x = ((y - 2020) / 50) * w, yy = h - ((v - lo) / (hi - lo)) * h;
    d += (d ? 'L' : 'M') + x.toFixed(1) + ' ' + yy.toFixed(1);
  }
  return d;
}

export class Panel {
  private grid: HTMLElement;
  private detail: HTMLElement;
  constructor(private root: HTMLElement, private data: Dataset, private onSelect: (city: number | null) => void) {
    root.innerHTML = `
      <button class="close" type="button" aria-label="閉じる">閉じる</button>
      <div class="p-all">
        <div class="lbl"><span>市町村</span><span>2020年＝100</span></div>
        <h2>大阪府 全${data.cities.length}市町村</h2>
        <p class="sub">人口の推移（推計）。並びは市町村コード順で、順位ではない。タップで詳細。</p>
        <div class="grid" role="list"></div>
        <p class="axis"><span>2020</span><span>2050</span><span class="lk">2070</span></p>
      </div>
      <div class="p-one" hidden></div>`;
    this.grid = root.querySelector('.grid')!;
    this.detail = root.querySelector('.p-one')!;
    this.buildGrid();
  }
  private buildGrid() {
    const { cities, meta } = this.data;
    const h = 22, until = meta.playable_until;
    this.grid.innerHTML = cities.map((c, i) => {
      const s = c.survival, lo = 30, hi = 115;
      return `<button class="sp" role="listitem" data-i="${i}" aria-label="${esc(c.name)}">
        <span class="nm">${esc(c.name)}</span><span class="v" data-v></span>
        <svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none">
          <rect class="lkz" x="${((until - 2020) / 50) * W}" y="0" width="${W - ((until - 2020) / 50) * W}" height="${h}"/>
          <line class="ref" x1="0" x2="${W}" y1="${h - ((100 - lo) / (hi - lo)) * h}" y2="${h - ((100 - lo) / (hi - lo)) * h}"/>
          <path class="ln" d="${sparkPath(s, W, h, lo, hi, 2020, until)}"/>
          <path class="ln2" d="${sparkPath(s, W, h, lo, hi, until, 2070)}"/>
          <line class="nd" x1="0" x2="0" y1="0" y2="${h}"/>
        </svg></button>`;
    }).join('');
    this.grid.querySelectorAll<HTMLButtonElement>('.sp').forEach((b) => (b.onclick = () => this.onSelect(+b.dataset.i!)));
  }
  update(year: number, city: number | null, cell: Cell | null) {
    const all = this.root.querySelector<HTMLElement>('.p-all')!;
    all.hidden = city != null;
    this.detail.hidden = city == null;
    if (city == null) {
      const x = ((year - 2020) / 50) * W;
      this.grid.querySelectorAll<HTMLElement>('.sp').forEach((b) => {
        const c = this.data.cities[+b.dataset.i!];
        b.querySelector('.nd')!.setAttribute('x1', String(x));
        b.querySelector('.nd')!.setAttribute('x2', String(x));
        b.querySelector('[data-v]')!.textContent = (interp(c.survival, year) as number).toFixed(0);
      });
      return;
    }
    this.renderCity(this.data.cities[city], year, cell && cell.city === city ? cell : null);
  }
  private renderCity(c: City, year: number, cell: Cell | null) {
    const until = this.data.meta.playable_until;
    const H = 130, max = Math.max(...c.pop) * 1.03, min = Math.min(...c.pop) * 0.95;
    const X = (y: number) => ((y - 2020) / 50) * W, Y = (v: number) => H - 16 - ((v - min) / (max - min)) * (H - 26);
    let solid = '', dashed = '', upto = '';
    for (let y = 2020; y <= 2070; y += 1) {
      const p = `${X(y).toFixed(1)} ${Y(interp(c.pop, y)!).toFixed(1)}`;
      if (y <= until) solid += (solid ? 'L' : 'M') + p;
      if (y >= until) dashed += (dashed ? 'L' : 'M') + p;
      if (y <= year) upto += (upto ? 'L' : 'M') + p;
    }
    upto += `L${X(year).toFixed(1)} ${Y(interp(c.pop, year)!).toFixed(1)}`;
    const v0 = c.pop[0], vy = interp(c.pop, year)!;
    const age = ageAt(c.pop, c.pta, c.ptc, year);
    const ageHtml = age
      ? (() => {
          const t = age.total, a = (age.young / t) * 100, w = (age.work / t) * 100, o = (age.old / t) * 100;
          return `<div class="age" role="img" aria-label="年齢構成 0〜14歳${a.toFixed(1)}% 15〜64歳${w.toFixed(1)}% 65歳以上${o.toFixed(1)}%">
            <i style="width:${a}%"></i><i style="width:${w}%"></i><i style="width:${o}%"></i></div>
            <dl class="agel"><dt><b class="k1"></b>0〜14歳</dt><dd>${a.toFixed(1)}%</dd><dt><b class="k2"></b>15〜64歳</dt><dd>${w.toFixed(1)}%</dd><dt><b class="k3"></b>65歳以上</dt><dd>${o.toFixed(1)}%</dd></dl>`;
        })()
      : '<p class="na">2020年は総数のみで年齢区分なし（2025年から表示）</p>';
    const cellHtml = cell
      ? `<div class="cellbox"><div class="lbl"><span>選択した六角形</span><span>約${this.data.meta.cell_area_km2}km²</span></div>
          <dl><dt>${Math.floor(year)}年の推計人口</dt><dd>${popAt(cell, year) < 1 ? '推計1人未満' : fmt(popAt(cell, year)) + '人'}</dd>
          <dt>2020年＝100</dt><dd>${indexAt(cell, year)?.toFixed(1) ?? '—'}</dd>
          <dt>消灯年</dt><dd>${loLabel(cell.lo)}</dd>
          <dt>半減年</dt><dd>${halfLabel(cell.half)}</dd></dl></div>`
      : '';
    this.detail.innerHTML = `
      <button class="back" type="button">← 全市町村</button>
      <div class="lbl"><span>市町村</span><span>${esc(c.code)}</span></div>
      <h2>${esc(c.name)}</h2>
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(c.name)}の推計人口の推移">
        <rect class="lkz" x="${X(until)}" y="0" width="${W - X(until)}" height="${H - 16}"/>
        <path class="ln" d="${solid}"/><path class="ln2" d="${dashed}"/><path class="up" d="${upto}"/>
        <line class="nd" x1="${X(year)}" x2="${X(year)}" y1="0" y2="${H - 16}"/>
        <line class="ax" x1="0" x2="${W}" y1="${H - 16}" y2="${H - 16}"/>
        <text x="0" y="${H - 3}">2020</text><text x="${X(until)}" y="${H - 3}" text-anchor="middle">${until}</text><text x="${W}" y="${H - 3}" text-anchor="end">2070</text>
      </svg>
      <dl class="kv">
        <dt>2020年（実績ベース）</dt><dd>${fmt(v0)}人</dd>
        <dt>${Math.floor(year)}年（推計）</dt><dd>${fmt(vy)}人</dd>
        <dt>存続率（2020年＝100）</dt><dd>${((vy / v0) * 100).toFixed(1)}</dd>
        <dt>ピーク年（2020〜2070）</dt><dd>${c.peak}年</dd>
        <dt>半減年</dt><dd>${halfLabel(c.half)}</dd>
      </dl>
      <div class="lbl" style="margin-top:14px"><span>年齢構成 ${Math.floor(year)}年</span></div>
      ${ageHtml}
      ${cellHtml}
      <p class="hint">値はすべて推計で、確定した将来ではない。半減年・消灯年は推計上の年。</p>`;
    this.detail.querySelector<HTMLButtonElement>('.back')!.onclick = () => this.onSelect(null);
  }
}
