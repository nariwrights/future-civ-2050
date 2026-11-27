"""pipeline 共通設定。対象地域は都道府県コードで指定する（大阪府=27、近畿=25〜30、全国=01〜47）。"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
OUT = ROOT / "web" / "public" / "data"

RES = 8  # H3 解像度
YEARS = [2020] + list(range(2025, 2075, 5))  # 11時点
PLAYABLE_UNTIL = 2050  # 画面で操作できる最終年（2055〜2070はフェーズ2で開放を判断）

MESH_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/m1kr6/m1kr6-24/1km_mesh_2024_{p}_GEOJSON.zip"
N03_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2024/N03-20240101_{p}_GML.zip"

# 府県境と海岸線を区別するための隣接府県（行政区域データのみ取得）
NEIGHBORS = {
    "25": ["17", "18", "21", "24", "26"], "26": ["18", "25", "27", "28", "29"], "27": ["26", "28", "29", "30"],
    "28": ["26", "27", "31", "33", "37"], "29": ["24", "26", "27", "30"], "30": ["24", "27", "29"],
}

SOURCE = ("国土数値情報（国土交通省）「1kmメッシュ別将来推計人口データ（R6国政局推計）」「行政区域データ」を加工して作成（CC BY 4.0）。"
          "値は2020年国勢調査等に基づく推計であり、確定した将来ではない。")


def prefs_from_args(desc: str):
    ap = argparse.ArgumentParser(description=desc)
    ap.add_argument("prefs", nargs="*", default=["27"], help="都道府県コード（2桁）。既定は 27（大阪府）")
    a = ap.parse_args()
    return [p.zfill(2) for p in a.prefs]


def neighbors_of(prefs):
    return sorted({n for p in prefs for n in NEIGHBORS.get(p, [])} - set(prefs))


def mesh_geojson(p):
    return next((RAW / "mesh" / p).rglob("*.geojson"))


def n03_geojson(p):
    return next((RAW / "n03" / p).rglob("N03-*.geojson"))


def tag(prefs):
    return "-".join(prefs)


def dump(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    return path


def load(path: Path):
    return json.loads(path.read_text())
