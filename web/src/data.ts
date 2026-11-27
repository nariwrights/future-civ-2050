/** cells.json / cities.json / geo.json の読み込みと、年の補間つき指標計算。 */
import { cellToLatLng } from 'h3-js';

export interface Meta {
  prefs: string[];
  years: number[];
  playable_until: number;
  h3_res: number;
  cell_area_km2: number;
  source: string;
  pref_total: number[];
}
export interface Cell {
  h3: string;
  city: number;
  kind: 0 | 1; // 0=居住, 1=府内の無居住
  pop: number[] | null;
  pta: (number | null)[] | null;
  ptc: (number | null)[] | null;
  lo: number; // 消灯年 -1=対象外 0=2070年まで推計1人以上
  half: number; // 半減年 -1=対象外 0=2070年まで半減しない
  lat: number;
  lng: number;
}
export interface City {
  code: string;
  pref: string;
  name: string;
  cells: number;
  pop: number[];
  pta: (number | null)[];
  ptc: (number | null)[];
  survival: number[];
  peak: number;
  half: number | null;
}
export interface Geo {
  coast: [number, number][][];
  border: [number, number][][];
  muni: [number, number][][];
  neighbors: [number, number][][][];
}
export interface Dataset {
  meta: Meta;
  cells: Cell[];
  popCells: Cell[];
  cities: City[];
  geo: Geo;
}

export async function loadData(base = './data/'): Promise<Dataset> {
  const [c, ci, geo] = await Promise.all(
    ['cells.json', 'cities.json', 'geo.json'].map((f) => fetch(base + f).then((r) => {
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      return r.json();
    })),
  );
  const cells: Cell[] = (c.rows as unknown[][]).map((r) => {
    const [lat, lng] = cellToLatLng(r[0] as string);
    return { h3: r[0] as string, city: r[1] as number, kind: r[2] as 0 | 1, pop: r[3] as number[] | null,
      pta: r[4] as (number | null)[] | null, ptc: r[5] as (number | null)[] | null, lo: r[6] as number, half: r[7] as number, lat, lng };
  });
  return { meta: c.meta, cells, popCells: cells.filter((x) => x.kind === 0), cities: ci.cities, geo };
}

/** 5年刻みの系列を年 y で線形補間（2020〜2070） */
export function interp(series: readonly (number | null)[], y: number): number | null {
  const t = (Math.min(2070, Math.max(2020, y)) - 2020) / 5;
  const i = Math.min(series.length - 2, Math.floor(t));
  const a = series[i], b = series[i + 1];
  if (a == null || b == null) return null;
  return a + (b - a) * (t - i);
}

export const popAt = (c: Cell, y: number) => (c.pop ? (interp(c.pop, y) as number) : 0);
export const indexAt = (c: Cell, y: number) => (c.pop && c.pop[0] >= 1 ? (popAt(c, y) / c.pop[0]) * 100 : null);

/** 65歳以上比率（%）。2020年は年齢区分が無いので 2025年未満は null */
export function elderlyAt(pop: (number | null)[] | null, ptc: (number | null)[] | null, y: number): number | null {
  if (!pop || !ptc || y < 2025) return null;
  const p = interp(pop, y), c = interp(ptc, y);
  return p && c != null && p >= 1 ? (c / p) * 100 : null;
}

/** 年齢3区分（人）。2025年未満は null */
export function ageAt(pop: (number | null)[], pta: (number | null)[], ptc: (number | null)[], y: number) {
  if (y < 2025) return null;
  const p = interp(pop, y)!, a = interp(pta, y)!, c = interp(ptc, y)!;
  return { young: a, work: Math.max(0, p - a - c), old: c, total: p };
}

export type LightState = 'none' | 'later' | 'soon' | 'out' | 'na';
/** 消灯の状態（選択年 y 時点） */
export function lightState(c: Cell, y: number, until: number): LightState {
  if (c.kind !== 0 || c.lo === -1) return 'na';
  if (c.lo === 0) return 'none';
  if (y >= c.lo) return 'out';
  return c.lo > until ? 'later' : 'soon';
}
export const halfPassed = (c: Cell, y: number) => c.half > 0 && y >= c.half;
