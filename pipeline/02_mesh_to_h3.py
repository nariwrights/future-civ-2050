"""02: 1kmメッシュを H3 解像度8 の六角形へ集計する（全11時点）。

    python3 -I pipeline/02_mesh_to_h3.py 27

集計方法：1kmメッシュ（約1.06km²）は H3 r8（約0.74km²）より大きいので、
各メッシュ矩形に中心が入る H3 セル群へ値を等分配する（中心が入るセルが無い小メッシュは中心セルへ）。
合計は保存される。値は小数のまま持つ。

出力 data/interim/h3_<tag>.json
  { h3: { "pop":[11], "pta":[11], "ptc":[11], "hidden":[年...] } }
  - pop: 総数（2020年は PTN_2020、2025年以降は PT00_20XX）
  - pta: 0〜14歳、ptc: 65歳以上。2020年は年齢区分が無いので null
  - hidden: HITOKU が "*"（値が合算先へ寄せられて0になっている）年
"""
import sys
from collections import defaultdict
from pathlib import Path

import h3

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import INTERIM, RES, YEARS, dump, load, mesh_geojson, prefs_from_args, tag  # noqa: E402


def val(p, key):
    v = p.get(key)
    return float(v) if v is not None else 0.0


def main():
    prefs = prefs_from_args(__doc__)
    acc = defaultdict(lambda: {"pop": [0.0] * len(YEARS), "pta": [0.0] * len(YEARS), "ptc": [0.0] * len(YEARS), "hidden": set()})
    n_mesh = 0
    for p in prefs:
        for f in load(mesh_geojson(p))["features"]:
            n_mesh += 1
            pr = f["properties"]
            ring = f["geometry"]["coordinates"][0]
            cells = list(h3.polygon_to_cells(h3.LatLngPoly([(la, ln) for ln, la in ring]), RES))
            if not cells:
                lngs = [c[0] for c in ring]; lats = [c[1] for c in ring]
                cells = [h3.latlng_to_cell((min(lats) + max(lats)) / 2, (min(lngs) + max(lngs)) / 2, RES)]
            share = 1.0 / len(cells)
            for c in cells:
                a = acc[c]
                for k, y in enumerate(YEARS):
                    if y == 2020:
                        a["pop"][k] += val(pr, "PTN_2020") * share
                    else:
                        a["pop"][k] += val(pr, f"PT00_{y}") * share
                        a["pta"][k] += val(pr, f"PTA_{y}") * share
                        a["ptc"][k] += val(pr, f"PTC_{y}") * share
                        if pr.get(f"HITOKU{y}") == "*":
                            a["hidden"].add(y)
    out = {}
    for c, a in acc.items():
        out[c] = {
            "pop": a["pop"],
            "pta": [None] + a["pta"][1:],
            "ptc": [None] + a["ptc"][1:],
            "hidden": sorted(a["hidden"]),
        }
    path = dump(INTERIM / f"h3_{tag(prefs)}.json", out)
    tot = [round(sum(v["pop"][k] for v in out.values())) for k in range(len(YEARS))]
    print(f"meshes={n_mesh} cells={len(out)} totals={dict(zip(YEARS, tot))} -> {path.relative_to(path.parents[2])}")


if __name__ == "__main__":
    main()
