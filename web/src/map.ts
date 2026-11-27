/** deck.gl の描画：隣接府県の陸 → 六角形 → 市町村境・府県境・海岸線 → 選択市町村の輪郭 → 地名。 */
import { Deck, MapView, WebMercatorViewport, type PickingInfo } from '@deck.gl/core';
import { PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Cell, Dataset } from './data';
import type { Lens } from './lenses';

export interface MapState { year: number; lens: Lens; city: number | null; cell: Cell | null }
export interface MapHandlers { onHover: (c: Cell | null, x: number, y: number, lngLat: number[] | null) => void; onClick: (c: Cell | null) => void }

const LABEL_CITIES = ['大阪市', '堺市', '豊中市', '高槻市', '枚方市', '東大阪市', '岸和田市', '河内長野市', '能勢町', '岬町'];

export class CivMap {
  private deck: Deck<MapView>;
  private labels: { name: string; pos: [number, number] }[];
  private bounds: [[number, number], [number, number]];
  onView?: () => void;
  constructor(private el: HTMLElement, private data: Dataset, h: MapHandlers) {
    const { popCells, cities } = data;
    // 地名：2020年人口で重み付けした重心
    const acc = new Map<number, [number, number, number]>();
    for (const c of popCells) {
      const w = c.pop![0];
      const a = acc.get(c.city) ?? [0, 0, 0];
      a[0] += c.lng * w; a[1] += c.lat * w; a[2] += w;
      acc.set(c.city, a);
    }
    this.labels = cities.flatMap((ct, i) => {
      const a = acc.get(i);
      return a && a[2] ? [{ name: ct.name, pos: [a[0] / a[2], a[1] / a[2]] as [number, number], i }] : [];
    }).filter((l) => LABEL_CITIES.includes(l.name));
    let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
    for (const c of data.cells) { minLng = Math.min(minLng, c.lng); maxLng = Math.max(maxLng, c.lng); minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat); }
    this.bounds = [[minLng, minLat], [maxLng, maxLat]];
    this.deck = new Deck({
      parent: el as HTMLDivElement,
      views: new MapView({ repeat: false }),
      initialViewState: this.fit(),
      controller: { dragRotate: false, touchRotate: false, doubleClickZoom: true, scrollZoom: { smooth: true, speed: 0.02 } },
      style: { position: 'absolute', inset: '0' },
      getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'crosshair'),
      onHover: (info: PickingInfo) => h.onHover((info.object as Cell) ?? null, info.x, info.y, info.coordinate ?? null),
      onClick: (info: PickingInfo) => h.onClick((info.object as Cell) ?? null),
      onViewStateChange: ({ viewState }) => { requestAnimationFrame(() => this.onView?.()); return viewState; },
      layers: [],
    });
  }
  fit() {
    const r = this.el.getBoundingClientRect();
    const pad = Math.max(8, Math.min(32, r.width * 0.04));
    const vp = new WebMercatorViewport({ width: Math.max(50, r.width), height: Math.max(50, r.height) }).fitBounds(this.bounds, { padding: pad });
    return { longitude: vp.longitude, latitude: vp.latitude, zoom: vp.zoom, minZoom: vp.zoom - 0.5, maxZoom: 13, pitch: 0, bearing: 0 };
  }
  resetView() {
    this.deck.setProps({ initialViewState: { ...this.fit(), transitionDuration: 300 } });
  }
  /** 1km = 何px か（縮尺表示用） */
  kmPx(): number {
    let vp;
    try { vp = this.deck.getViewports()[0]; } catch { return 0; }
    if (!vp) return 0;
    const [x0] = vp.project([135.5, 34.7]);
    const [x1] = vp.project([135.5 + 1 / (111.32 * Math.cos((34.7 * Math.PI) / 180)), 34.7]);
    return x1 - x0;
  }
  render(s: MapState) {
    const { data } = this;
    const area = data.meta.cell_area_km2, until = data.meta.playable_until;
    const trig = [s.year, s.lens.id];
    const lens = s.lens;
    const layers = [
      new SolidPolygonLayer({
        id: 'neighbors', data: data.geo.neighbors, getPolygon: (d: [number, number][][]) => d,
        getFillColor: [27, 29, 32], pickable: false,
      }),
      new H3HexagonLayer<Cell>({
        id: 'cells', data: data.cells, getHexagon: (c) => c.h3, coverage: 0.88, extruded: false, highPrecision: 'auto',
        pickable: true, stroked: !!lens.line, filled: true, lineWidthUnits: 'pixels',
        getFillColor: (c) => lens.fill(c, s.year, area, until),
        getLineColor: (c) => (lens.line?.(c, s.year, until) ?? [0, 0, 0, 0]),
        getLineWidth: 1,
        updateTriggers: { getFillColor: trig, getLineColor: trig },
      }),
      new PathLayer({
        id: 'muni', data: data.geo.muni, getPath: (d: [number, number][]) => d, getColor: [16, 17, 19, 150],
        getWidth: 1, widthUnits: 'pixels', pickable: false,
      }),
      new PathLayer({
        id: 'border', data: data.geo.border, getPath: (d: [number, number][]) => d, getColor: [138, 144, 153, 255],
        getWidth: 1, widthUnits: 'pixels', getDashArray: [5, 4], dashJustified: true,
        extensions: [new PathStyleExtension({ dash: true })], pickable: false,
      } as never),
      new PathLayer({
        id: 'coast', data: data.geo.coast, getPath: (d: [number, number][]) => d, getColor: [200, 204, 210, 230],
        getWidth: 1.2, widthUnits: 'pixels', pickable: false,
      }),
      new H3HexagonLayer<Cell>({
        id: 'city-sel', data: s.city == null ? [] : data.cells.filter((c) => c.city === s.city), getHexagon: (c) => c.h3,
        coverage: 1, filled: false, stroked: true, extruded: false, getLineColor: [238, 240, 243, 110], getLineWidth: 1, lineWidthUnits: 'pixels',
        updateTriggers: { data: s.city },
      }),
      new H3HexagonLayer<Cell>({
        id: 'cell-sel', data: s.cell ? [s.cell] : [], getHexagon: (c) => c.h3, coverage: 1.15, filled: false, stroked: true,
        extruded: false, getLineColor: [238, 240, 243, 255], getLineWidth: 2, lineWidthUnits: 'pixels',
      }),
      new TextLayer({
        id: 'labels', data: this.labels, getPosition: (d: { pos: [number, number] }) => d.pos, getText: (d: { name: string }) => d.name,
        getSize: 11, sizeUnits: 'pixels', fontFamily: '"IBM Plex Sans JP", sans-serif', fontWeight: 500, characterSet: 'auto',
        getColor: [238, 240, 243, 255], background: true, getBackgroundColor: [16, 17, 19, 215], backgroundPadding: [4, 2],
        getTextAnchor: 'start', getAlignmentBaseline: 'center', getPixelOffset: [8, -8], pickable: false,
      }),
    ];
    this.deck.setProps({ layers });
  }
  redraw() {
    this.deck.redraw('ui');
  }
  resize() {
    this.deck.setProps({ initialViewState: this.fit() });
  }
}
