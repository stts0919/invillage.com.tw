# 資產輕量化流程

| 欄位 | 內容 |
|---|---|
| 狀態 | Complete |
| 日期 | 2026-09-22 |
| 原始來源 | `imports/webflow/assets/images/` |
| 輸出 | `assets/optimized/` |
| 分類 | `assets/manifests/asset-classification.json` |

## Placement

| Placement | 數量 | 原始 bytes | 用途 |
|---|---:|---:|---|
| Pages | 16 | 185,738 | 2 個品牌 PNG、5 個 PNG icon、9 個 SVG |
| R2 | 123 | 185,353,115 | 121 JPEG、1 opaque PNG、1 WebP |
| Archive | 72 | 50,044,194 | 目前正式頁未引用，只保留原始來源 |

Archive 資產本階段不轉檔、不上傳。Placement 只依目前正式站引用判斷，頁面內容改變後必須重建。

## 不可變條件

- 不覆寫或刪除原圖。
- 不放大圖片。
- 透明 PNG 不得丟失 alpha。
- SVG 不重新 rasterize。
- 輸出若不比對應 fallback 小，標記 skipped。
- 每個輸出必須可解碼並寫入 bytes、dimensions、SHA-256。
- 小批次通過使用者品質確認前，不執行全量。

## 格式策略

### R2 內容圖片

| 來源 | 輸出 |
|---|---|
| JPEG | 同尺寸 JPEG srcset；4:2:0 另產 AVIF，4:4:4 只產 640 AVIF，4:2:2 不產 AVIF |
| Opaque PNG | AVIF 640／1280／1920＋lossless PNG fallback |
| WebP | 保留原 WebP；AVIF 只有更小時才保留 |

候選參數：

- 照片 AVIF：`libsvtav1`、preset 9、CRF 24、`yuv420p`。
- Opaque PNG／WebP AVIF：preset 9、CRF 28。
- JPEG fallback：`mjpeg`、`q:v 1`，保留來源 4:2:0／4:2:2／4:4:4 pixel format。
- Resize：Lanczos，不超過原始寬度。

### Pages 必要資產

| 來源 | 輸出 |
|---|---|
| Transparent PNG | lossless PNG，frame checksum 必須相同 |
| Opaque PNG | lossless PNG；較大時保留原檔 |
| SVG | 原檔保留 |

候選 PNG 參數：compression level 9、mixed prediction。

## 輸出結構

~~~text
assets/
├── optimized/
│   └── <asset-id>/
│       ├── <asset-id>-w640.avif
│       ├── <asset-id>-w1280.avif
│       ├── <asset-id>-w1920.avif
│       ├── <asset-id>-fallback-w1920.jpg
│       └── <asset-id>-lossless.png
└── manifests/
    ├── asset-classification.json
    ├── optimization-batch-001.json
    ├── optimization-sample.json
    ├── optimization-live.json
    ├── optimization-live-qa.json
    ├── pages-assets-live.json
    └── r2-upload-live.json
~~~

不存在或不比原檔小的輸出不建立。

## R2 Key

內容圖片使用 immutable key：

`media/content/<asset-id>-<output-sha256-12>.<ext>`

Pages 資產不列入 R2 upload manifest。

## Sample gate

第一批涵蓋：

- 最大且正式站正在使用的 JPEG。
- 亮部、暗部、室內與建築細節照片。
- Opaque PNG 截圖。
- Transparent brand PNG。
- Transparent icon PNG。
- SVG。
- 既有 WebP。

## QA

- 原圖 SHA-256 不變。
- 所有輸出 decode pass。
- Width、height、aspect ratio 符合規格。
- Lossless PNG frame checksum 與原圖一致。
- AVIF 與 JPEG sample 產生同尺寸 reference；SSIM 目標至少 0.98，未達則人工 review 或提高品質。
- 人工檢查 100% crop：天空漸層、樹葉、建築線條、室內暗部、文字與透明邊緣。
- 記錄單檔與批次 saved bytes／percent。

## 本階段不做

- 不上傳 R2。
- 不改寫 HTML／CSS。
- 不複製資產到 `apps/web/public`。
- 不處理字型。
- 不刪除 Archive 資產。

完整結果見 [資產輕量化全量報告](./asset-live-report.md)。
