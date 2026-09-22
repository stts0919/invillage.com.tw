# Webflow 匯入盤點

| 項目 | 結果 |
|---|---:|
| Site ID | `65009115380adfba3ebe2328` |
| 最近發布 | 2026-01-23T17:09:14.639Z |
| 靜態頁面 | 8 |
| CMS Collection | 0 |
| HTML | 8 |
| CSS | 1 |
| JavaScript | 12 |
| 圖片 | 211／235,583,047 bytes |
| TTF | 6／24,671,584 bytes |

## 頁面

| 路徑 | 本機檔案 | 抓取狀態 |
|---|---|---:|
| `/` | `site/html/index.html` | 200 |
| `/about` | `site/html/about.html` | 200 |
| `/spaces` | `site/html/spaces.html` | 200 |
| `/plan` | `site/html/plan.html` | 200 |
| `/contact` | `site/html/contact.html` | 200 |
| `/style` | `site/html/style.html` | 200 |
| `/utilities` | `site/html/utilities.html` | 200 |
| `/404` | `site/html/404.html` | 200 |

不存在的路徑回傳 404；直接開啟 `/404` 回傳 200。

## Runtime

- Webflow shared CSS：1 份。
- Webflow runtime／chunk：10 份。
- jQuery 3.5.1：1 份。
- WebFont Loader 1.6.26：1 份。

完整來源 URL、bytes 與 SHA-256 見 `imports/webflow/manifests/site-import.json`。

## 外部整合

HTML 仍包含：

- Facebook Customer Chat SDK。
- Google Maps embed。
- YouTube no-cookie embed。

這些是來源快照的一部分，尚未決定未來替代方式。

## HTTP 觀察

- `robots.txt`：200，內容為空。
- `sitemap.xml`：404。
- 未知路徑：404。

## Manifest

- `webflow-site.json`：站點 metadata。
- `webflow-pages.json`：頁面 metadata 與本機對照。
- `webflow-assets.json`：217 筆資產來源。
- `image-inventory.json`：圖片引用盤點。
- `download-verification.json`：圖片本機驗證。
- `site-import.json`：HTML、CSS、JavaScript、字型與外部整合總表。

## 限制

- 匯入 HTML／CSS 仍引用 Webflow hosted URLs，尚不可直接視為自管部署版。
- `style` 與 `utilities` 仍是公開來源頁。
- 圖片尚未輕量化。
- 表單尚未建立自管後端。
