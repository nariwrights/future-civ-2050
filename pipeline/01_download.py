"""01: 生データを data/raw/ へ取得する（gitには入れない）。

    python3 -I pipeline/01_download.py 27

- 1kmメッシュ別将来推計人口（R6国政局推計, GeoJSON）: 対象府県
- 行政区域データ N03（2024-01-01, GeoJSON入り）: 対象府県＋隣接府県（府県境と海岸線の判別用）
既にあるファイルは取り直さない。
"""
import sys
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MESH_URL, N03_URL, RAW, neighbors_of, prefs_from_args  # noqa: E402


def fetch(url: str, dest_dir: Path):
    dest_dir.mkdir(parents=True, exist_ok=True)
    zpath = dest_dir / url.rsplit("/", 1)[1]
    if not zpath.exists():
        print("download", url)
        with urllib.request.urlopen(url, timeout=120) as r, open(zpath, "wb") as f:
            f.write(r.read())
    out = dest_dir / "x"
    if not out.exists():
        with zipfile.ZipFile(zpath) as z:
            for m in z.infolist():
                target = (out / m.filename).resolve()
                if not str(target).startswith(str(out.resolve())):
                    raise RuntimeError(f"unsafe path in zip: {m.filename}")
            z.extractall(out)
    print("ok", zpath.name)


def main():
    prefs = prefs_from_args(__doc__)
    for p in prefs:
        fetch(MESH_URL.format(p=p), RAW / "mesh" / p)
        fetch(N03_URL.format(p=p), RAW / "n03" / p)
    for p in neighbors_of(prefs):
        fetch(N03_URL.format(p=p), RAW / "n03" / p)


if __name__ == "__main__":
    main()
