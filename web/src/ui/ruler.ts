/** 計器スライダー：1年ごとの目盛り＋府人口の推移線。2055〜2070は元データにあるが「未開放」の斜線。 */
import { interp } from '../data';

export interface RulerOpts {
  totals: number[];
  until: number;
  onInput: (y: number) => void;
  onGrab: () => void;
}

export class Ruler {
  private svg: SVGSVGElement;
  private needle: HTMLElement;
  private label: HTMLElement;
  private y = 2020;
  constructor(private el: HTMLElement, private o: RulerOpts) {
    el.innerHTML = '<svg aria-hidden="true"></svg><div class="needle"><span></span></div>';
    this.svg = el.querySelector('svg')!;
    this.needle = el.querySelector('.needle')!;
    this.label = this.needle.querySelector('span')!;
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', '年');
    el.setAttribute('aria-valuemin', '2020');
    el.setAttribute('aria-valuemax', String(o.until));
    const fromEvent = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return Math.min(o.until, 2020 + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 50);
    };
    let drag = false;
    el.addEventListener('pointerdown', (e) => { drag = true; el.setPointerCapture(e.pointerId); el.classList.add('is-drag'); o.onGrab(); o.onInput(fromEvent(e)); });
    el.addEventListener('pointermove', (e) => { if (drag) o.onInput(fromEvent(e)); });
    const end = () => { drag = false; el.classList.remove('is-drag'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const d = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 } as Record<string, number>)[e.key];
      let v: number | null = null;
      if (d) v = Math.round(this.y) + d;
      if (e.key === 'Home') v = 2020;
      if (e.key === 'End') v = o.until;
      if (v != null) { e.preventDefault(); o.onGrab(); o.onInput(Math.max(2020, Math.min(o.until, v))); }
    });
    new ResizeObserver(() => this.build()).observe(el);
  }
  build() {
    const r = this.el.getBoundingClientRect(), W = r.width, H = r.height;
    if (!W || !H) return;
    const { totals, until } = this.o;
    const narrow = W < 420, base = H - 28, top = 18, X = (y: number) => ((y - 2020) / 50) * W;
    const vMin = 5.6e6, vMax = 9.0e6, Y = (v: number) => base - ((v - vMin) / (vMax - vMin)) * (base - top);
    let d = '', d2 = '';
    for (let y = 2020; y <= 2070; y += 0.5) {
      const p = `${X(y).toFixed(1)} ${Y(interp(totals, y)!).toFixed(1)}`;
      if (y <= until) d += (d ? 'L' : 'M') + p;
      if (y >= until) d2 += (d2 ? 'L' : 'M') + p;
    }
    let s = `<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#2a2c30" stroke-width="2"/></pattern></defs>`;
    s += `<rect x="${X(until)}" y="${top}" width="${W - X(until)}" height="${base - top}" fill="url(#hatch)"/>`;
    s += `<text class="lock" x="${(X(until) + W) / 2}" y="${narrow ? base - 6 : top + 14}" text-anchor="middle">${narrow ? '未開放' : '未開放　2055–2070（フェーズ2）'}</text>`;
    s += `<path d="${d} L${X(until)} ${base} L0 ${base}Z" fill="rgba(200,204,210,.07)"/>`;
    s += `<path d="${d}" fill="none" stroke="#c8ccd2" stroke-width="1.2"/><path d="${d2}" fill="none" stroke="#5d636b" stroke-width="1" stroke-dasharray="3 3"/>`;
    s += `<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="#3a3d42"/>`;
    for (let y = 2020; y <= 2070; y++) {
      const major = y % 10 === 0, mid = y % 5 === 0, x = X(y), locked = y > until;
      if (narrow && !mid) continue;
      s += `<line x1="${x}" x2="${x}" y1="${base}" y2="${base + (major ? 10 : mid ? 7 : 4)}" stroke="${locked ? '#3a3d42' : '#8a9099'}"/>`;
      if (major || (!narrow && mid)) s += `<text class="${locked ? 'tk lk' : 'tk'}${major ? ' mj' : ''}" x="${x}" y="${base + 22}" text-anchor="middle">${narrow ? "'" + String(y).slice(2) : y}</text>`;
    }
    s += `<text class="cap" x="2" y="${top - 6}">府の推計人口の推移</text>`;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.innerHTML = s;
    this.set(this.y);
  }
  set(y: number) {
    this.y = y;
    this.needle.style.left = `${((y - 2020) / 50) * 100}%`;
    this.label.textContent = y.toFixed(1);
    this.el.setAttribute('aria-valuenow', String(Math.round(y)));
    this.el.setAttribute('aria-valuetext', `${Math.floor(y)}年`);
  }
}
