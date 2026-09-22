# 階段 2：Webflow 匯入

| 欄位 | 內容 |
|---|---|
| 狀態 | Complete |
| 日期 | 2026-09-21 |
| 方法 | Webflow Data API metadata＋正式站編譯輸出 |

## 完成

- 匯入 8 頁 HTML。
- 匯入 1 份 shared CSS。
- 匯入 12 份 JavaScript。
- 保存並驗證 211 張原始圖片。
- 下載並驗證 6 個 HarmonyOS Sans TC TTF。
- 建立站點、頁面、資產、圖片與完整 site import manifest。
- 將原始來源分類到 `imports/webflow/`。
- 移除已驗證且重複的舊 `webflow-export/` 路徑。

## 驗證

- 27 份 HTML／CSS／JavaScript／TTF 檔案的 bytes 與 SHA-256 通過。
- 圖片 211／211，總計 235,583,047 bytes。
- 字型 6／6，總計 24,671,584 bytes，皆可辨識為 TrueType。
- Asset manifest：217 筆。
- 未知路徑回傳 404。
- CMS Collection：0。

## 外部來源

來源 HTML 仍包含 Facebook Customer Chat、Google Maps embed 與 YouTube no-cookie embed。這些尚未改寫或移除。

## 未執行

- 未改寫 HTML／CSS 內的 Webflow URL。
- 未輕量化圖片。
- 未建立可部署的 `apps/web/public` 內容。
- 未初始化 Git。
- 未建立或修改 Cloudflare、DNS、Webflow 遠端狀態。

## 下一步

等待使用者指示開始「階段 3 — 資產輕量化」。
