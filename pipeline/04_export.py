"""04: 画面が読む JSON を web/public/data/ へ書き出す。

    python3 -I pipeline/04_export.py 27

cells.json   … セルごとの全指標 × 全11時点（2020〜2070）。行は列配列で圧縮
cities.json  … 市町村ごとの時系列・存続率・ピーク年・半減年・年齢構成
geo.json     … 海岸線・府県境・市町村境・隣接府県の陸（背景描画用）
"""
import sys
from pathlib import Path

import h3

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import INTERIM, OUT, PLAYABLE_UNTIL, RES, SOURCE, YEARS, dump, load, prefs_from_args, tag  # noqa: E402


def r1(v):
    return None if v is None else round(v, 1)


def main():
    prefs = prefs_from_args(__doc__)
    t = tag(prefs)
    cells = load(INTERIM / f"cells_{t}.json")
    cities = load(INTERIM / f"cities_{t}.json")
    geo = load(INTERIM / f"geo_{t}.json")
    pop_cells = [c for c in cells if c["kind"] == "pop"]
    area = sum(h3.cell_area(c["h3"], "km^2") for c in pop_cells) / len(pop_cells)  # 対象地域の平均セル面積
    totals = [round(sum(c["pop"][k] for c in pop_cells)) for k in range(len(YEARS))]

    meta = {
        "prefs": prefs, "years": YEARS, "playable_until": PLAYABLE_UNTIL, "h3_res": RES,
        "cell_area_km2": round(area, 4), "source": SOURCE,
        "pref_total": totals,
        "notes": {
            "age_2020": "2020年は総数のみで年齢区分なし（pta/ptc は null）",
            "ptb": "15〜64歳 = pop − pta − ptc",
            "lo": "消灯年：-1=対象外（2020年に推計1人未満・秘匿）、0=2070年までは推計1人以上、それ以外は初めて推計1人未満となる5年刻みの年",
            "half": "半減年：-1=対象外、0=2070年までは半減しない、それ以外は2020年の半分を下回る年（線形補間）",
            "kind": "0=居住セル、1=府内の無居住セル",
        },
    }
    rows = []
    for c in cells:
        if c["kind"] == "pop":
            rows.append([c["h3"], c["city"], 0, [r1(v) for v in c["pop"]], [r1(v) for v in c["pta"]], [r1(v) for v in c["ptc"]], c["lo"], c["half"]])
        else:
            rows.append([c["h3"], c["city"], 1, None, None, None, -1, -1])
    dump(OUT / "cells.json", {"meta": meta, "cols": ["h3", "city", "kind", "pop", "pta", "ptc", "lo", "half"], "rows": rows})
    dump(OUT / "cities.json", {"years": YEARS, "cities": [
        {**c, "pop": [r1(v) for v in c["pop"]], "pta": [r1(v) for v in c["pta"]], "ptc": [r1(v) for v in c["ptc"]]} for c in cities]})
    dump(OUT / "geo.json", geo)
    for f in ("cells.json", "cities.json", "geo.json"):
        print(f, f"{(OUT / f).stat().st_size / 1024:.0f}KB")


if __name__ == "__main__":
    main()
