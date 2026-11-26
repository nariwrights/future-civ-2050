"""フェーズ0（モック専用）: 大阪府 1kmメッシュ将来推計人口 → H3解像度8 集計。

本実装の pipeline/01〜04 ではない。モック3案が読む 1 本の JSON を作るだけ。

使い方:
    python3 -I pipeline/phase0_mock_data.py data/raw mockups/data/osaka_h3r8_2020-2050.json

入力（data/raw/ 以下、git管理外）
  ex/1km_mesh_2024_27_GEOJSON/1km_mesh_2024_27.geojson  … 国土数値情報 R6国政局推計 1kmメッシュ（大阪府）
  n03/N03-20240101_27.geojson                           … 国土数値情報 行政区域（大阪府, 2024-01-01）

集計方法
  1kmメッシュ(約1.06km²)はH3 r8(約0.74km²)より大きいので「メッシュ中心→1セル」だと穴あきになる。
  そこで各メッシュ矩形に中心が入るH3セル群へ人口を等分配する（中心が入るセルが無い小メッシュは中心セルへ）。
  合計人口は保存される。
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import h3
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

RES = 8
YEARS_OUT = [2020, 2030, 2040, 2050]
YEARS_ALL = [2020] + list(range(2025, 2075, 5))
SEA_RING = 3  # 府外側に残すリング数


def pop_of(p, y):
    return float((p.get("PTN_2020") if y == 2020 else p.get(f"PT00_{y}")) or 0.0)


def main(raw: Path, out: Path):
    mesh = json.loads((raw / "ex/1km_mesh_2024_27_GEOJSON/1km_mesh_2024_27.geojson").read_text())["features"]
    n03 = json.loads((raw / "n03/N03-20240101_27.geojson").read_text())["features"]

    # 市町村ポリゴン（大阪市・堺市は区をまとめて市単位に）
    muni_geoms = defaultdict(list)
    for f in n03:
        p = f["properties"]
        if f["geometry"] is None:
            continue
        name = p["N03_004"] or p["N03_003"]
        code = p["N03_007"]
        if name in ("大阪市", "堺市"):
            code = code[:3] + ("00" if name == "大阪市" else "40")
        muni_geoms[(code, name)].append(shape(f["geometry"]))
    munis = sorted(muni_geoms)
    muni_union = [unary_union(muni_geoms[m]) for m in munis]
    tree = STRtree(muni_union)
    land = unary_union(muni_union)

    def muni_index(lat, lng, inhabited=False):
        pt = Point(lng, lat)
        for i in tree.query(pt):
            if muni_union[i].contains(pt):
                return int(i)
        # 海岸線ぎわ: 最寄りの市町村
        i = tree.nearest(pt)
        return int(i) if (inhabited or muni_union[i].distance(pt) < 0.004) else -1

    # メッシュ → H3（中心が入るセルへ等分配）
    cell_pop = defaultdict(lambda: [0.0] * len(YEARS_ALL))
    cell_hidden = defaultdict(set)
    for f in mesh:
        p = f["properties"]
        ring = f["geometry"]["coordinates"][0]
        poly = h3.LatLngPoly([(lat, lng) for lng, lat in ring])
        cells = list(h3.polygon_to_cells(poly, RES))
        if not cells:
            lngs = [c[0] for c in ring]; lats = [c[1] for c in ring]
            cells = [h3.latlng_to_cell((min(lats) + max(lats)) / 2, (min(lngs) + max(lngs)) / 2, RES)]
        share = 1.0 / len(cells)
        for c in cells:
            for k, y in enumerate(YEARS_ALL):
                cell_pop[c][k] += pop_of(p, y) * share
                if y != 2020 and p.get(f"HITOKU{y}") == "*":
                    cell_hidden[c].add(y)

    # 府内の無人セル（山林・埋立地など）と府外リング
    inhabited = set(cell_pop)
    minx, miny, maxx, maxy = land.bounds
    bbox = h3.LatLngPoly([(miny, minx), (miny, maxx), (maxy, maxx), (maxy, minx)])
    land_cells = {c for c in h3.polygon_to_cells(bbox, RES) if land.contains(Point(h3.cell_to_latlng(c)[::-1]))}
    empty_land = land_cells - inhabited
    core = inhabited | land_cells
    outside = set()
    for c in core:
        outside |= set(h3.grid_disk(c, SEA_RING))
    outside -= core

    area = h3.cell_area(next(iter(inhabited)), "km^2")

    rows = []
    muni_ts = defaultdict(lambda: [0.0] * len(YEARS_ALL))
    lights_out_count = 0
    for c in sorted(core):
        lat, lng = h3.cell_to_latlng(c)
        mi = muni_index(lat, lng, c in cell_pop)
        ps = cell_pop.get(c, [0.0] * len(YEARS_ALL))
        if mi >= 0:
            for k in range(len(YEARS_ALL)):
                muni_ts[mi][k] += ps[k]
        # 消灯年: 2020年に推計1人以上 → 初めて1人未満になる年（秘匿で0になった年は対象外）
        lo = None
        excluded = ps[0] < 1
        if not excluded:
            for k, y in enumerate(YEARS_ALL[1:], start=1):
                if ps[k] < 1:
                    if y in cell_hidden.get(c, ()):
                        excluded = True
                    else:
                        lo = y
                    break
        if lo:
            lights_out_count += 1
        lo_code = -1 if excluded else (lo or 0)  # -1=対象外, 0=2070年以降
        vals = [round(ps[YEARS_ALL.index(y)], 1) for y in YEARS_OUT]
        rows.append([c, round(lat, 5), round(lng, 5), mi, *vals, lo_code])
    for c in sorted(outside):
        lat, lng = h3.cell_to_latlng(c)
        rows.append([c, round(lat, 5), round(lng, 5), -2, 0, 0, 0, 0, -1])

    # 1セルの六角形の形（中心からのオフセット: 経度・緯度度）
    sample = next(iter(inhabited))
    slat, slng = h3.cell_to_latlng(sample)
    hex_shape = [[round(lng - slng, 6), round(lat - slat, 6)] for lat, lng in h3.cell_to_boundary(sample)]

    totals = {y: round(sum(v[YEARS_ALL.index(y)] for v in cell_pop.values())) for y in YEARS_ALL}
    cities = []
    for i, (code, name) in enumerate(munis):
        ts = muni_ts[i]
        cities.append({"code": code, "name": name, "pop": {str(y): round(ts[YEARS_ALL.index(y)]) for y in YEARS_ALL}})

    out.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "meta": {
            "source": "国土数値情報（国土交通省）「1kmメッシュ別将来推計人口データ（R6国政局推計）」大阪府、「行政区域データ」(2024) を加工して作成。CC BY 4.0",
            "note": "推計値であり確定した未来ではない。人口は小数のまま集計し、表示時に四捨五入。",
            "h3_res": RES,
            "cell_area_km2": round(area, 4),
            "years": YEARS_OUT,
            "columns": ["h3", "lat", "lng", "city", *[f"p{y}" for y in YEARS_OUT], "lightsOut"],
            "city_codes": {"-2": "府外（海・隣県）", "-1": "市町村未判定"},
            "lightsOut_codes": {"-1": "対象外（2020年に推計1人未満 or 秘匿）", "0": "2070年以降"},
            "pref_total": {str(y): totals[y] for y in YEARS_ALL},
            "hex_shape": hex_shape,
            "counts": {"inhabited": len(inhabited), "empty_land": len(empty_land), "outside": len(outside), "lights_out_by_2070": lights_out_count},
        },
        "cities": cities,
        "cells": rows,
    }
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps(doc["meta"]["counts"]), json.dumps(doc["meta"]["pref_total"]), f"{out.stat().st_size/1024:.0f}KB")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
