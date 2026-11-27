"""03: セルを市町村へ紐付け、セル・市町村の指標と境界線を作る。

    python3 -I pipeline/03_cities.py 27

- 市町村の紐付けは SHICODE の連結値（例 27366_27232）に頼らず、行政区域ポリゴンとセル中心の位置判定で行う
  （政令市の区は市にまとめる）。海岸ぎわでポリゴンから外れた居住セルは最寄りの市町村へ
- 府内で人が住んでいないセル（山林・埋立地など）は kind="empty" として残す
- 消灯年：2020年に推計1人以上 → 初めて1人未満になる年。秘匿（HITOKU=*）で0になった年に当たる場合は対象外
- 半減年：2020年の半分を初めて下回る年（5年刻みの間は線形補間）。秘匿年に当たる場合は対象外
- 府県境と海岸線：対象府県の外周のうち、隣接府県ポリゴンに接する部分を府県境、それ以外を海岸線とする

出力 data/interim/cells_<tag>.json, cities_<tag>.json, geo_<tag>.json
"""
import sys
from collections import defaultdict
from pathlib import Path

import h3
from shapely.geometry import LineString, MultiLineString, Point, box, mapping, shape
from shapely.ops import linemerge, unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import INTERIM, RES, YEARS, dump, load, n03_geojson, neighbors_of, prefs_from_args, tag  # noqa: E402

DESIGNATED = {"大阪市", "堺市", "京都市", "神戸市"}  # 区をまとめる政令市（近畿）


def first_below(series, threshold, hidden):
    """series が threshold を初めて下回る年（線形補間）と、その年が秘匿で対象外か。"""
    for k in range(1, len(YEARS)):
        if series[k] < threshold:
            excluded = any(h <= YEARS[k] for h in hidden)
            a, b = series[k - 1], series[k]
            y = YEARS[k - 1] + (a - threshold) / (a - b) * (YEARS[k] - YEARS[k - 1]) if a != b else YEARS[k]
            return y, excluded
    return None, False


def munis_of(prefs):
    geoms = defaultdict(list)
    for p in prefs:
        for f in load(n03_geojson(p))["features"]:
            if f["geometry"] is None:
                continue
            pr = f["properties"]
            name = pr["N03_004"] or pr["N03_003"]
            code = pr["N03_007"]
            if not code:
                continue
            if name in DESIGNATED:  # 区 → 市コード
                code = {"大阪市": "27100", "堺市": "27140", "京都市": "26100", "神戸市": "28100"}[name]
            geoms[(code, pr["N03_001"], name)].append(shape(f["geometry"]))
    keys = sorted(geoms)
    return keys, [unary_union(geoms[k]) for k in keys]


def lines_of(g):
    if g.is_empty:
        return []
    if isinstance(g, LineString):
        g = [g]
    elif isinstance(g, MultiLineString):
        g = list(g.geoms)
    else:
        g = [x for x in getattr(g, "geoms", []) if isinstance(x, LineString)]
    return [[[round(x, 5), round(y, 5)] for x, y in ln.coords] for ln in g if len(ln.coords) >= 2]


def main():
    prefs = prefs_from_args(__doc__)
    t = tag(prefs)
    raw = load(INTERIM / f"h3_{t}.json")
    keys, polys = munis_of(prefs)
    tree = STRtree(polys)
    land = unary_union(polys)

    def muni_of(lat, lng, force):
        pt = Point(lng, lat)
        for i in tree.query(pt):
            if polys[i].contains(pt):
                return int(i)
        i = int(tree.nearest(pt))
        return i if (force or polys[i].distance(pt) < 0.004) else -1

    # 府内の無居住セル
    minx, miny, maxx, maxy = land.bounds
    cand = h3.polygon_to_cells(h3.LatLngPoly([(miny, minx), (miny, maxx), (maxy, maxx), (maxy, minx)]), RES)
    empty = [c for c in cand if c not in raw and land.contains(Point(h3.cell_to_latlng(c)[::-1]))]

    cells = []
    cities = defaultdict(lambda: {"pop": [0.0] * len(YEARS), "pta": [0.0] * len(YEARS), "ptc": [0.0] * len(YEARS), "cells": 0})
    for c, v in raw.items():
        lat, lng = h3.cell_to_latlng(c)
        mi = muni_of(lat, lng, True)
        pop = v["pop"]
        lo = half = None
        lo_ex = half_ex = pop[0] < 1
        if not lo_ex:
            y, lo_ex = first_below(pop, 1.0, v["hidden"])
            lo = YEARS[next(k for k in range(len(YEARS)) if YEARS[k] >= y)] if y else None  # 5年刻みの「初めて1人未満の時点」
            y2, half_ex = first_below(pop, pop[0] / 2, v["hidden"])
            half = round(y2, 1) if y2 else None
        cells.append({"h3": c, "city": mi, "kind": "pop", "pop": pop, "pta": v["pta"], "ptc": v["ptc"],
                      "lo": -1 if lo_ex else (lo or 0), "half": -1 if half_ex else (half or 0)})
        C = cities[mi]
        C["cells"] += 1
        for k in range(len(YEARS)):
            C["pop"][k] += pop[k]
            if k:
                C["pta"][k] += v["pta"][k]; C["ptc"][k] += v["ptc"][k]
    for c in empty:
        lat, lng = h3.cell_to_latlng(c)
        cells.append({"h3": c, "city": muni_of(lat, lng, False), "kind": "empty"})

    out_cities = []
    for i, (code, pref, name) in enumerate(keys):
        C = cities.get(i)
        if not C:
            continue
        pop = C["pop"]
        peak = YEARS[max(range(len(YEARS)), key=lambda k: pop[k])]
        hy, _ = first_below(pop, pop[0] / 2, [])
        out_cities.append({
            "i": i, "code": code, "pref": pref, "name": name, "cells": C["cells"],
            "pop": pop, "pta": [None] + C["pta"][1:], "ptc": [None] + C["ptc"][1:],
            "survival": [round(p / pop[0] * 100, 2) for p in pop],
            "peak": peak, "half": round(hy, 1) if hy else None,
        })
    # 市町村インデックスを詰め直す
    remap = {c["i"]: n for n, c in enumerate(out_cities)}
    for c in cells:
        c["city"] = remap.get(c["city"], -1)
    for c in out_cities:
        del c["i"]

    # 境界線
    view = box(minx - 0.8, miny - 0.6, maxx + 0.8, maxy + 0.6)
    nb = []
    for p in neighbors_of(prefs):
        for f in load(n03_geojson(p))["features"]:
            if f["geometry"] is None:
                continue
            g = shape(f["geometry"])
            if g.intersects(view):
                nb.append(g.intersection(view))
    nb_union = unary_union(nb).simplify(0.0006) if nb else None
    boundary = land.boundary
    near = nb_union.buffer(0.003) if nb_union is not None else None
    border = boundary.intersection(near) if near is not None else LineString()
    coast = boundary.difference(near) if near is not None else boundary
    inner = unary_union([p.boundary for p in polys]).difference(boundary.buffer(0.0005))
    simp = lambda g: linemerge(g) if not g.is_empty and g.geom_type != "LineString" else g  # noqa: E731
    geo = {
        "coast": lines_of(simp(coast).simplify(0.0003)),
        "border": lines_of(simp(border).simplify(0.0003)),
        "muni": lines_of(simp(inner).simplify(0.0003)),
        "neighbors": [],
    }
    if nb_union is not None:
        gs = [nb_union] if nb_union.geom_type == "Polygon" else list(nb_union.geoms)
        for g in gs:
            if g.area < 2e-5:
                continue
            m = mapping(g)["coordinates"]
            geo["neighbors"].append([[[round(x, 5), round(y, 5)] for x, y in ring] for ring in m])

    dump(INTERIM / f"cells_{t}.json", cells)
    dump(INTERIM / f"cities_{t}.json", out_cities)
    dump(INTERIM / f"geo_{t}.json", geo)
    n_lo = sum(1 for c in cells if c.get("lo", 0) > 0 and c["lo"] <= 2050)
    n_half = sum(1 for c in cells if c.get("half", 0) > 0 and c["half"] <= 2050)
    unassigned = sum(1 for c in cells if c["kind"] == "pop" and c["city"] < 0)
    print(f"cells={len(cells)} (pop={len(raw)}, empty={len(empty)}) cities={len(out_cities)} unassigned={unassigned} "
          f"lightsOut<=2050={n_lo} half<=2050={n_half} coast_lines={len(geo['coast'])} border_lines={len(geo['border'])} neighbors={len(geo['neighbors'])}")


if __name__ == "__main__":
    main()
