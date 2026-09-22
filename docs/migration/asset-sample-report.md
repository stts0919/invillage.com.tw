# 資產輕量化樣本報告

| 欄位 | 內容 |
|---|---|
| 狀態 | 等待使用者品質確認 |
| 日期 | 2026-09-22 |
| 批次 | `optimization-batch-001` |
| 遠端上傳 | 未授權、未執行 |

## 樣本

共 8 張：

- 3 張 JPEG：4:2:0、4:2:2、4:4:4。
- 1 張 opaque PNG。
- 2 張 transparent PNG。
- 1 張 SVG。
- 1 張 WebP。

原始總量為 11,826,136 bytes。

## 最終候選參數

- 4:2:0 照片 AVIF：`libsvtav1`、preset 9、CRF 24、`yuv420p`。
- Opaque PNG／WebP AVIF：preset 9、CRF 28。
- JPEG srcset：`mjpeg`、`q:v 1`，保留來源 chroma pixel format。
- Width：640／1280／1920，不放大並去除重複尺寸。
- 4:4:4 JPEG：只產生 640 AVIF；較大尺寸保留 4:4:4 JPEG。
- 4:2:2 JPEG：不產 AVIF，避免高解析 chroma SSIM 不穩。
- PNG：lossless compression level 9＋mixed prediction。
- SVG：原檔保留。

## 自動驗證

| 項目 | 結果 |
|---|---:|
| 選取圖片 | 8 |
| 成功圖片 | 8 |
| 產出檔案 | 20 |
| Lossy metrics | 17 |
| SSIM 通過 | 17／17 |
| PSNR 通過 | 17／17 |
| 最低 SSIM | 0.983576 |
| 最低 PSNR | 41.504233 dB |
| 解碼失敗 | 0 |
| 原圖變更 | 0 |

Lossless PNG 的 RGBA frame checksum 與原圖完全一致。

## 代表性結果

| 樣本 | 原始 | 候選輸出 | 節省 |
|---|---:|---:|---:|
| 最大 JPEG／1920 AVIF | 3,987,518 | 961,827 | 75.9% |
| 最大 JPEG／1920 JPEG | 3,987,518 | 997,665 | 75.0% |
| 4:2:2 JPEG／1920 JPEG | 2,500,207 | 1,539,799 | 38.4% |
| 4:4:4 JPEG／1920 JPEG | 2,080,838 | 735,722 | 64.6% |
| Opaque PNG／lossless PNG | 3,094,958 | 2,487,947 | 19.6% |
| Opaque PNG／1838 AVIF | 3,094,958 | 158,658 | 94.9% |
| Transparent brand PNG | 103,010 | 101,484 | 1.5% |
| Transparent icon PNG | 13,403 | 12,341 | 7.9% |
| WebP／640 AVIF | 43,424 | 26,527 | 38.9% |

## 安全跳過

- 4:2:2 JPEG 的所有 AVIF：因 chroma 品質風險跳過。
- 4:4:4 JPEG 的 1280／1920 AVIF：因 chroma 品質風險跳過。
- WebP 的 1000 AVIF：輸出不比原 WebP 小，已刪除並記錄 skip。
- SVG：不 rasterize。

## 人工檢查

Codex 已檢查整圖與 100% crop：

- 天空漸層與樹葉細節沒有明顯 banding。
- 建築直線與磚牆沒有明顯 halo。
- 室內暗部與綠色牆面沒有明顯色偏。
- Opaque PNG 文字邊緣沒有明顯 chroma bleed。
- WebP 藍紫漸層沒有明顯破壞。
- Transparent PNG 由 frame checksum 證明像素與 alpha 不變。

仍需使用者決定是否接受此品質，才能執行完整 live asset 批次。

## 產物

- `assets/manifests/optimization-batch-001.json`
- `assets/manifests/optimization-sample.json`
- `assets/manifests/optimization-qa.json`
- `assets/manifests/r2-upload-sample.json`

R2 sample manifest 有 19 筆，`uploadAuthorized=false`；沒有建立 bucket 或上傳。
