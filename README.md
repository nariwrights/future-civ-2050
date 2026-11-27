# 未来文明マップ2050（future-civ-2050）

国の将来推計人口（国土数値情報 1kmメッシュ別将来推計人口 R6国政局推計）を約1kmの六角形に集め、2020年から2050年への変化を「時間で眺める」地図。現在は大阪府（フェーズ1）。

値はすべて推計であり、確定した将来ではありません。

## 構成
- `pipeline/` … データ取得と集計（Python: h3, shapely）。都道府県コードで対象地域を指定
- `web/` … 画面（Vite + TypeScript + deck.gl）。`web/public/data/` の JSON だけを読む
- `DESIGN.md` / `SOURCES.md` … デザイン方針、出典と利用条件
- `mockups/` … フェーズ0の3案（採用はC案）

## 開発
```
cd web && npm ci && npm run dev
```
本番ビルドは `npm run build`（`web/dist`）。GitHub Pages へは `.github/workflows/pages.yml` で main への push 時に公開する（リポジトリの Settings → Pages → Source を「GitHub Actions」に設定）。

出典：国土数値情報（国土交通省）「1kmメッシュ別将来推計人口データ（R6国政局推計）」「行政区域データ」を加工して作成（CC BY 4.0）。
