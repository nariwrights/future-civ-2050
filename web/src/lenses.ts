/** レンズ定義：指標・配色・凡例。配色は単色の濃淡を基本に、増加だけ淡い青緑1色（警告色は使わない）。 */
import { type Cell, elderlyAt, halfPassed, indexAt, lightState, popAt } from './data';

export type RGBA = [number, number, number, number];
export type LensId = 'pop' | 'idx' | 'lo' | 'old';

const MONO: number[][] = [[26, 28, 31], [58, 62, 68], [118, 124, 132], [190, 195, 202], [244, 246, 248]];
const DOWN: number[][] = [[120, 126, 134], [66, 70, 76], [36, 38, 42]];
const UP: number[][] = [[120, 126, 134], [143, 208, 192]];
const LO: number[][] = [[120, 126, 134], [244, 246, 248]];
export const C = {
  sea: [16, 17, 19] as const, base: [30, 32, 36, 255] as RGBA, halfBase: [62, 66, 72, 255] as RGBA,
  empty: [31, 33, 37, 255] as RGBA, none: [29, 31, 34, 255] as RGBA, accent: [143, 208, 192, 255] as RGBA,
};

export function ramp(stops: number[][], t: number): RGBA {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, 255];
}
export const cssRamp = (stops: number[][]) => `linear-gradient(90deg,${stops.map((c) => `rgb(${c.join(',')})`).join(',')})`;

export interface LegendItem { swatch: string; label: string; outline?: boolean }
export interface Lens {
  id: LensId;
  key: string;
  name: string;
  unit: string;
  ramp?: number[][];
  ticks?: [string, number][];
  items?: LegendItem[];
  desc: (y: number) => string;
  fill: (c: Cell, y: number, area: number, until: number) => RGBA;
  line?: (c: Cell, y: number, until: number) => RGBA | null;
}

export const LENSES: Lens[] = [
  {
    id: 'pop', key: '1', name: '人口密度', unit: '人/km²', ramp: MONO,
    ticks: [['0', 0], ['1千', 0.18], ['5千', 0.41], ['2万', 0.82], ['3万', 1]],
    desc: () => 'その年の推計人口をセル面積で割った密度。単色の濃淡（平方根スケール）。',
    fill: (c, y, area) => (c.kind ? C.empty : ramp(MONO, Math.sqrt(popAt(c, y) / area / 30000))),
  },
  {
    id: 'idx', key: '2', name: '存続率', unit: '2020年=100', ramp: [...DOWN.slice().reverse(), ...UP.slice(1)],
    ticks: [['60', 0], ['80', 0.33], ['100', 0.67], ['115', 1]],
    desc: () => '2020年の人口を100とした指数（推計）。濃いほど減り、青緑は増える。',
    fill: (c, y) => {
      if (c.kind) return C.empty;
      const i = indexAt(c, y);
      if (i == null) return C.none;
      return i < 100 ? ramp(DOWN, (100 - i) / 40) : ramp(UP, (i - 100) / 15);
    },
  },
  {
    id: 'lo', key: '3', name: '消灯年', unit: '推計上の年', ramp: LO,
    ticks: [['2025', 0], ['2050', 0.56], ['2070', 1]],
    items: [
      { swatch: `rgb(${C.halfBase.slice(0, 3)})`, label: '選択年までに半減（推計上の半減年を過ぎた）' },
      { swatch: `rgb(${C.base.slice(0, 3)})`, label: 'まだ半減していない' },
      { swatch: 'transparent', label: '推計1人未満になった', outline: true },
    ],
    desc: () => '色つき＝推計人口が1人未満になる年（消灯年）。背景の明暗＝2020年の半分を下回る年（半減年）を過ぎたか。どちらも推計上の年。2020年に推計1人未満の地点と秘匿値は対象外。',
    fill: (c, y, _a, until) => {
      if (c.kind) return C.empty;
      const st = lightState(c, y, until);
      if (st === 'soon' || st === 'later') return ramp(LO, (c.lo - 2025) / 45);
      if (st === 'out') return [16, 17, 19, 255];
      return halfPassed(c, y) ? C.halfBase : C.base;
    },
    line: (c, y, until) => (lightState(c, y, until) === 'out' ? [138, 144, 153, 255] : null),
  },
  {
    id: 'old', key: '4', name: '高齢化', unit: '65歳以上 %', ramp: MONO,
    ticks: [['20%', 0], ['30%', 0.29], ['40%', 0.57], ['55%', 1]],
    desc: (y) => (y < 2025
      ? '2020年は総数のみで年齢区分なし。高齢化は2025年から表示する（推計）。'
      : '65歳以上の人口が占める割合（推計）。明るいほど割合が高い。'),
    fill: (c, y) => {
      if (c.kind) return C.empty;
      const r = elderlyAt(c.pop, c.ptc, y);
      return r == null ? C.none : ramp(MONO, (r - 20) / 35);
    },
  },
];
export const lensById = (id: LensId) => LENSES.find((l) => l.id === id)!;
