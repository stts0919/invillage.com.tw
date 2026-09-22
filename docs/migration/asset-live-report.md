# 資產輕量化全量報告

| 欄位 | 內容 |
|---|---|
| 狀態 | Complete |
| 日期 | 2026-09-22 |
| 遠端上傳 | 未授權、未執行 |

## 範圍

| Placement | Asset 數量 | 處理 |
|---|---:|---|
| Pages | 16 | Brand、icon、SVG |
| R2 | 123 | 正式站內容圖片 |
| Archive | 72 | 未被正式頁引用，不轉檔、不上傳 |

完整批次選取 139／139 個 live asset，成功 139，失敗 0。

## 輸出

| 項目 | 結果 |
|---|---:|
| Live source bytes | 185,538,853 |
| Generated output files | 428 |
| Generated output bytes | 109,149,577 |
| R2 manifest items | 427／123 assets |
| R2 manifest bytes | 113,523,148 |
| Pages manifest items | 16／16 assets |
| Pages manifest bytes | 179,057 |

R2 bytes 包含 6 個保留原始來源的 fallback，因此高於 generated output bytes。

## 品質驗證

| 項目 | 結果 |
|---|---:|
| Verified outputs | 428／428 |
| Lossy metrics | 420 |
| SSIM pass | 420／420 |
| PSNR pass | 420／420 |
| 最低 SSIM | 0.980025 |
| 最低 PSNR | 41.372441 dB |
| QA failures | 0 |
| 原圖 mismatch | 0 |
| Orphan／stale output | 0 |

Codex 另抽查最低通過值、4:4:4、4:2:2、opaque PNG、WebP 與 quality-pruned 情境，未見明顯色偏、banding、halo 或文字色邊。

## 品質保護

- 4:2:2 JPEG 不產生 AVIF，保留同 chroma JPEG srcset。
- 4:4:4 JPEG 只產生 640 AVIF，較大尺寸保留 4:4:4 JPEG。
- 4:2:0 JPEG 使用 CRF 24 AVIF。
- Opaque PNG／WebP 使用 CRF 28 AVIF。
- Transparent PNG 使用 lossless PNG，RGBA frame checksum 相同。
- SVG 原樣保留。
- 輸出不比來源小時跳過。
- 4 個未達品質門檻的生成變體已刪除並保留 skip 證據。
- 需要 native fallback 且轉檔沒有更小時，R2 manifest 使用原始 JPEG／WebP。

## Delivery manifests

- `assets/manifests/pages-assets-live.json`：16 筆，`copyAuthorized=false`。
- `assets/manifests/r2-upload-live.json`：427 筆，`uploadAuthorized=false`。

沒有複製到 `apps/web/public`、建立 R2 bucket 或上傳任何檔案。

## 後續

階段 4 建立 Git／GitHub 前，需先建立 `.gitignore`，避免原始與 generated binary 進入 repo。
