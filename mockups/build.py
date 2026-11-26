"""mockups/src/*.html に core.js とデータを埋め込み、mockups/ 直下に単一HTMLを書き出す。
python3 -I mockups/build.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
data = json.loads((HERE / "data/osaka_h3r8_2020-2050.json").read_text())
compact = {"meta": data["meta"], "cities": data["cities"], "cells": [r[1:] for r in data["cells"]]}
payload = "window.__DATA__=" + json.dumps(compact, ensure_ascii=False, separators=(",", ":")) + ";\n"
core = (HERE / "src/core.js").read_text()
for src in sorted((HERE / "src").glob("*.html")):
    html = src.read_text().replace("<!--CORE-->", "<script>\n" + payload + core + "\n</script>")
    (HERE / src.name).write_text(html)
    print(src.name, f"{len(html)/1024:.0f}KB")
