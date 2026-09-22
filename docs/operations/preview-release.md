# Preview 發布契約

| 欄位 | 內容 |
|---|---|
| 狀態 | Complete |
| 日期 | 2026-09-22 |
| 階段 | 5 — Preview 部署 |
| 架構負責 | Codex |
| 決策者 | 使用者 |
| 遠端異動 | Preview 已授權；R2 bucket／public `r2.dev`／427 objects 與 Pages Git integration／unique Preview 已完成並驗證 |

## 目標

建立可審查、可回復的 Cloudflare Preview，供階段 6 比對 Webflow。Preview 不使用正式網域，也不建立 Worker、D1、CMS 或新的表單後端。

## 已接受決策

| 主題 | 提議 |
|---|---|
| 前端 | 保留靜態 HTML、CSS、JavaScript；不加入框架或 runtime dependency |
| 產物 | 本機 Ruby script 從核准輸入產生 `apps/web/public/`，部署產物進 Git |
| Pages | Git integration；root `apps/web`；output `public`；不執行 build command |
| 路由 | 根目錄 HTML，保留 `/about` 等無尾斜線網址；頂層 `404.html` 處理未知路徑 |
| 必要資產 | 16 個 Pages 圖片、2 個 Webflow generic SVG、6 個 HarmonyOS TTF 跟前端進 Git |
| 內容圖片 | Preview R2，使用 content-hash immutable keys；Production bucket 不建立 |
| R2 公開方式 | 僅 Preview 使用 `r2.dev`；不綁正式或已購買網域 |
| 表單 | 保留外觀，但攔截提交且不送出資料；不得顯示假成功 |
| 第三方 | 只保留核准 allowlist；Webflow CDN、Webflow form API 與遠端 jQuery/webfont runtime 禁止 |

## 靜態輸出契約

~~~text
apps/web/public/
├── index.html
├── about.html
├── spaces.html
├── plan.html
├── contact.html
├── style.html
├── utilities.html
├── 404.html
├── robots.txt
├── css/
│   └── invillage.webflow.shared.6118f57c7.css
├── js/
│   └── <12 imported runtime files>
└── assets/
    ├── brand/
    ├── icons/
    ├── fonts/
    └── vendor/
~~~

### Route matrix

| URL | 檔案 | 預期狀態 |
|---|---|---:|
| `/` | `index.html` | 200 |
| `/about` | `about.html` | 200 |
| `/spaces` | `spaces.html` | 200 |
| `/plan` | `plan.html` | 200 |
| `/contact` | `contact.html` | 200 |
| `/style` | `style.html` | 200 |
| `/utilities` | `utilities.html` | 200 |
| `/404` | `404.html` | 200 |
| 任意未知路徑 | 頂層 `404.html` | 404 |
| `/robots.txt` | `robots.txt` | 200 |
| `/sitemap.xml` | 無檔案 | 404，除非後續另行核准 |

Cloudflare Pages 會把 `about.html` 對應到 `/about`，也會使用頂層 `404.html` 回應未知路徑。直接請求 `/404` 應將同一檔案當一般 route 回傳 200；未知路徑則必須回傳同一內容與 404 status。兩種情況都列入實測。禁止加入 SPA catch-all rewrite。

## 本機產生流程

Codex 先建立無外部 dependency 的 `scripts/migration/build_static_site.rb`；它不得修改 `imports/webflow/`。

輸入：

- `imports/webflow/site/` 的 8 頁 HTML、CSS 與 12 個 JavaScript。
- `imports/webflow/manifests/` 的頁面與 URL 來源資料。
- `assets/manifests/pages-assets-live.json`。
- `assets/manifests/r2-upload-live.json`、`optimization-live.json` 與 runtime asset map。
- 本機已驗證的圖片、字型與 optimized outputs。
- 經核准的 Preview R2 base URL。

輸出：

- 可直接部署的 `apps/web/public/`。
- 每個 Webflow asset URL 對應 Pages path 或 Preview R2 URL。
- 不含未替換的 R2 URL placeholder。
- 不含 `cdn.prod.website-files.com`、`d3e54v103j8qbb.cloudfront.net` 或 `ajax.googleapis.com` 的網路資產依賴。

產生結果進 Git，因此 Cloudflare Pages 不需要 Ruby、Node package 或圖片轉檔工具。乾淨 checkout 加上已驗證的 Preview R2 可直接部署，但無法只靠 Git 完整重跑圖片與字型產生流程。Builder 找不到被忽略的核准輸入時必須 fail closed；「可部署」不得誤寫成「可由 Git 完整重建」。

## 資產契約

### Pages

- 複製 `pages-assets-live.json` 的 16 個檔案：2 brand PNG、5 icon PNG、9 SVG。
- 將 6 個 HarmonyOS TTF 放在 `public/assets/fonts/`，並改寫 CSS `@font-face`。
- 下載並保存 404 illustration 與 YouTube placeholder 兩個 Webflow generic SVG，記錄來源 URL、bytes 與 SHA-256，再部署到 `public/assets/vendor/`。
- CSS 改寫後移除對應 HTML 的舊 SRI；未改內容的 JavaScript 可保留 checksum 證據。
- 不把 211 張原圖或 428 個 optimized corpus 整批複製到 Pages。

六個 TTF 共 24,671,584 bytes。階段 5 先以原 TTF 完成 parity；WOFF2 conversion 需要另行核准工具與版本，放到後續效能批次。

Codex 需建立 `assets/manifests/pages-runtime-assets.json`，完整列出 16 個既有 Pages 圖片、2 個 generic SVG 與 6 個字型，共 24 個 deployment assets。每筆至少包含 `sourceUrl` 或 `localPath`、`targetPath`、`contentType`、bytes 與 SHA-256。現有 `pages-assets-live.json` 保留為階段 3 證據，不手動竄改。

### Preview R2

- Bucket：`invillage-media-preview`；若名稱不可用，停止並回報，不自行改名。
- 上傳來源為 `assets/manifests/r2-upload-live.json` 的 427 個 unique keys／123 assets，共 113,523,148 bytes。
- Key 保持 `media/content/<asset-id>-<sha256-12>.<ext>`，不得覆寫同 key 的不同內容。
- 每個 object 設正確 `Content-Type` 與 `Cache-Control: public, max-age=31536000, immutable`。
- Preview 只啟用 `r2.dev`；它是公開、限流且不提供 Cache/WAF 的開發 URL。
- 圖片以一般 `<img>` 載入時不先新增 CORS；若日後由 JavaScript 讀取或畫入 canvas，再另訂 CORS。

初次 parity 使用 JPEG／PNG／WebP fallback 與 responsive `srcset`。65 個 AVIF 可先上傳，但不得在未驗證 `<picture>` 不會破壞 Webflow layout 前改變 HTML 結構；AVIF 啟用列入 parity 後的效能批次。

Codex 需由 `r2-upload-live.json` 產生 `assets/manifests/r2-upload-preview.json`，加入可驗證的 headers：

| 副檔名 | `Content-Type` |
|---|---|
| `.avif` | `image/avif` |
| `.jpg` | `image/jpeg` |
| `.png` | `image/png` |
| `.webp` | `image/webp` |

所有項目使用同一個 immutable `Cache-Control`。遠端 readback 必須比對 key、bytes、`Content-Type` 與 `Cache-Control`；環境 manifest 建立前不得上傳。

### Runtime mapping

Runtime map 必須以 asset ID 為 key，至少包含：

- 原始 Webflow URL 與出現位置。
- placement：Pages 或 R2。
- target path 或 R2 key。
- format、width、height、bytes、SHA-256。
- fallback 與 `srcset` 候選。
- Preview base URL 是否已填入。

R2 manifest 沒有獨立 width 欄位；runtime map 必須同時讀取 `optimization-live.json`，不能只替換 host。

## 外部依賴 allowlist

Parity 階段可保留：

- `fonts.googleapis.com`、`fonts.gstatic.com`：Space Mono。
- `connect.facebook.net`、Facebook、Instagram：只為 parity 暫時保留既有 client-side Messenger embed 與外部連結；P0 不新增 server-side Messenger integration。
- Google Maps iframe。
- `youtube-nocookie.com` iframe。
- 使用者既有的 Google Drive、短網址與外部網站連結。

以下不得成為 Preview network dependency：

- `cdn.prod.website-files.com`
- `d3e54v103j8qbb.cloudfront.net`
- `ajax.googleapis.com`
- `webflow.com/api/`

HTML 內的來源註解、`data-wf-*` 與本機 Webflow runtime 可先保留；驗收看實際 network request，不以字串出現取代網路證據。

## Contact form

`contact.html` 保留既有欄位與版面。P0 沒有後端，因此提交時必須：

1. `preventDefault()`，不產生 query string，也不呼叫 Webflow API。
2. 不把姓名、電話、Email 或訊息送往任何遠端。
3. 顯示既有 failure state，不顯示 success state。
4. 在後續 Worker＋Resend 表單方案核准前，不得宣稱表單可用。

## Cloudflare Pages 契約

| 設定 | 值 |
|---|---|
| Project name | `invillage-com-tw`；不可用時停止回報 |
| Git repository | `stts0919/invillage.com.tw` |
| Production branch | `main` |
| Root directory | `apps/web` |
| Build command | 留空 |
| Build output | `public` |
| Preview branches | 僅 `codex/*` |
| Custom domain | 不設定 |
| Worker／Functions bindings | 無 |

Pages 可能在連接 Git 時先建立 `main` deployment。Cloudflare 稱它為 Production deployment，但在本專案中，未通過階段 8 前只算技術部署，不是正式 Candidate 或 Production；不得綁正式網域。完成 Git integration 後，先關閉 `main` 自動部署，直到階段 8 另行核准。

Preview 驗收使用同 repo 非 `main` branch 的 unique hash URL；branch alias 只供最新版本導覽。Preview URL 預設公開並帶 `X-Robots-Tag: noindex`。

## Rollback

- Preview hash URL 是 immutable evidence，但 Cloudflare 不允許把 Preview deployment 當成 Production rollback target。
- Preview 有問題時停止 branch alias 更新，保留上一個 hash URL，修正後建立新 deployment。
- R2 使用 immutable keys；不覆寫、不刪除。回復網站只需讓 HTML 指回上一批 keys。
- `main` 的 Pages rollback 僅在階段 8 以後使用；Production 網域切換仍屬階段 10。

## 執行順序

1. 使用者核准本契約與架構決策。（已完成）
2. Codex 建立 runtime map schema、兩份 deployment manifests、builder 與 verifier；可用明確的測試 base URL 驗證轉換，但不產生最終部署檔。
3. MiniMax 執行核准的本機 inventory／manifest 機械檢查並回報證據。
4. Codex 獨立審核 schema、mapping 與 scripts。
5. Codex 先做 Cloudflare read-only account／plan／name preflight，再把四類外部異動列成一份明確授權清單。
6. 使用者核准建立 Preview bucket、啟用 public `r2.dev`、上傳 427 objects、建立 Pages Git integration 與 Preview deployment。（授權與執行均已完成；credential、entitlement、費用、名稱與 readback gates 通過）
7. Codex 建立 bucket 並讀回 public base URL，才用該 URL 產生最終 `apps/web/public/`。（已完成並由 static verifier 通過）
8. Codex 上傳 R2、核對 keys／bytes／headers／decode，再建立 Pages Preview。（Complete：R2 427／427、Pages technical main＋unique Preview、remote smoke 0 failures）
9. Codex 完成 route、network、desktop／mobile、互動、console 與 404 驗收。
10. 階段 5 完成後，進入階段 6 視覺一致性門檻。

## 工作包責任

| 工作包 | 負責 | 邊界 |
|---|---|---|
| P5-C1 | Codex | 取得 2 個 generic SVG，建立 provenance 與 24-item Pages runtime manifest |
| P5-C2 | Codex | 建立 runtime map schema、R2 Preview manifest、builder、form fail-closed transform 與 verifier |
| P5-M1 | MiniMax | 依 `runtime-occurrences.schema.json` 建立 `runtime-occurrences.json`，核對 139 asset IDs 與 HTML／CSS／JSON-LD occurrences；不決定 placement 或 URL |
| P5-M2 | MiniMax | 使用測試 media base 在 `/tmp` 產生兩份輸出，驗證 determinism 與 focused checks；不得寫入 repo、手改 `imports/webflow/` 或操作遠端資源 |
| P5-C3 | Codex | 審核並修正輸出；獨立執行 local／remote readback 與 browser QA |
| P5-U1 | 使用者 | 核准公開 R2、上傳、Git integration、Preview deploy 與任何可能費用 |

## 完成證據

- Builder／verifier focused checks 通過，`imports/webflow/` checksum 不變。
- 8 個 route、`robots.txt` 與 unknown-route status matrix 通過。
- Pages 必要資產、font、CSS、JS、favicon 全部 200。
- R2 remote keys 與 manifest 的 key、bytes、Content-Type 一致；抽樣檔案可 decode。
- Preview network 沒有未核准 Webflow CDN／form API request。
- nav、slider、tabs、FAQ、Maps、YouTube、Messenger 與 contact form fail-closed 行為均有證據。
- desktop／mobile screenshot parity 由 Codex 獨立驗證。
- 有 unique Preview URL、commit SHA、deployment ID 與前一版本 URL。

## 已核准決策

1. 6 個 TTF 先原樣進 Git，WOFF2 延後。
2. Preview R2 使用完整 427 objects，包括尚未啟用的 65 個 AVIF。
3. 上述第三方 allowlist 暫時保留。
4. Contact form 依 fail-closed 契約處理。
5. Pages project 使用 `invillage-com-tw`；R2 bucket 使用 `invillage-media-preview`。

## Preview 遠端執行狀態

1. Complete：建立 Preview R2 bucket；readback 為 Standard／APAC／default。
2. Complete：啟用 public `r2.dev` 並讀回相同 origin。
3. Complete：上傳與完整核對 427 objects；API metadata 與公開 bytes／SHA-256 均 0 failures。
4. Complete：Pages Git integration 只選 `stts0919/invillage.com.tw`；technical main deployment `f5cfdffe`、unique Preview `a66628b4` 均 success；production auto disabled、Preview branches 僅 `codex/*`。

Credential、account、R2 Paid entitlement、費用與名稱 gate 已通過；Pages project 與 R2 bucket target names 均可用。先前 R2 API 的 `10042 / NotEntitled` 是短暫同步延遲，後續 Dashboard、REST API 與 Wrangler 已一致通過。Source、artifact 與每個遠端 readback gate 仍須逐項通過。任何新費用、方案購買／升級、Production、DNS、custom domain 與 Webflow 異動仍未授權。

## 官方參考

- [Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Pages serving and 404 behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Pages branch controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)
- [Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)
- [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [R2 upload objects](https://developers.cloudflare.com/r2/objects/upload-objects/)
