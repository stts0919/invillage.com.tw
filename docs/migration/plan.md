# Webflow 匯入計畫

| 欄位 | 內容 |
|---|---|
| 狀態 | Complete |
| 階段 | 2 — Webflow 匯入 |
| 方法 | Webflow Data API metadata＋正式站編譯輸出 |

## 方法

- Webflow Data API 保存站點、頁面與資產 metadata。
- 正式站抓取 HTML、CSS 與 JavaScript，作為 parity 來源。
- Webflow asset 原檔依 manifest 保存到 `imports/webflow/assets/`。
- 匯入檔維持原樣；部署版在 `apps/web` 另行整理。

不使用 Designer DOM 取代編譯後網站，也不在本階段改寫 Webflow URL、壓縮圖片或建立 Cloudflare 資源。

## 執行清單

- [x] 確認站點、8 頁、217 筆資產與 0 個 CMS Collection。
- [x] 下載 8 頁 HTML。
- [x] 下載 1 份 CSS 與 12 份 runtime JavaScript。
- [x] 保存 211 張原圖。
- [x] 下載 6 個 HarmonyOS Sans TC TTF。
- [x] 建立站點、頁面、圖片與完整 import manifest。
- [x] 移除已驗證且重複的舊 `webflow-export/` 路徑。
- [x] 更新 Handoff 與里程碑紀錄。

## 驗收

- 所有本機檔案存在且可讀。
- 圖片與舊來源逐檔 SHA-256 相同。
- 字型 bytes 與 Webflow manifest 相同，且可辨識為 TrueType。
- HTML、CSS、JavaScript 皆記錄來源 URL、bytes 與 SHA-256。
- 未改變 Webflow 遠端狀態。
