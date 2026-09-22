# 系統總覽

| 欄位 | 內容 |
|---|---|
| 狀態 | 已核准 |
| 日期 | 2026-09-21 |
| 決策者 | 使用者 |
| 架構負責 | Codex |
| 協作執行 | MiniMax Code |
| 本輪範圍 | 只設計架構，不搬檔、不初始化 Git、不部署 |

## 目標

1. 先把 Webflow 網站原樣搬到 Cloudflare，取得可驗證的 Preview。
2. 日後增加 Worker API、D1、R2、LINE、Messenger、Resend 與金流時，降低重構幅度；重大平台變更仍需遷移審查。

原則：

- 靜態優先：P0 不先建立後端或前端框架。
- 單一 repo：前端、未來 API、文件與工具放在同一個 GitHub repo。
- 延後抽象：沒有共用程式碼前，不建立 `packages/`。
- 原始資料不可變：Webflow 原檔只分類與保存。
- 產物可重建：輕量化檔案由 script 與 manifest 重建。
- 環境隔離：Preview 與 Production 不共用可寫入資源。

## P0 邊界

~~~text
Browser
├── Cloudflare Pages
│   ├── HTML
│   ├── CSS
│   ├── JavaScript
│   ├── brand assets
│   └── fonts
└── Cloudflare R2
    └── content and gallery images
~~~

P0 不啟用 Worker API、D1、LINE、Messenger 或 Resend。原網站聯絡表單先標為待替換功能，不用假後端冒充可用。

## 後續邊界

~~~text
Browser
├── Cloudflare Pages
├── API endpoint ────────────────> Cloudflare Worker
│                                  ├── D1
│                                  ├── R2 private operations
│                                  ├── LINE Messaging API
│                                  ├── Messenger Platform
│                                  └── Resend
└── R2 media domain
~~~

Provider secret、webhook 驗證與寄信操作只存在 Worker；瀏覽器不得持有第三方秘密。

API 預設採獨立 Worker endpoint，例如 Production 的 `api.invillage.com.tw`。若日後要求同源 `/api/*`，必須另選 Pages Function＋Service Binding，或重新評估 Workers Static Assets；Pages 不會自動把 `/api/*` 轉送到獨立 Worker。

## 已接受決策

| 主題 | 提議 | 狀態 |
|---|---|---|
| Repo | 單一 repo，使用 `apps/` 區分前端與未來 API | Accepted |
| 前端 | 先保留靜態 HTML／CSS／JS，完成 parity 後再評估框架 | Accepted |
| 部署 | Cloudflare Pages Git integration，branch／PR 建立 Preview | Accepted |
| API | 第一個後端功能開始時才建立 `apps/api/` | Accepted |
| Database | D1 預留，P0 不建立 schema 或 database | Accepted |
| Media | Logo、icon、font 跟 Pages；內容照片放 R2 | Accepted |
| R2 | Preview 與 Production 使用不同 bucket | Accepted |

## 選擇理由

### 靜態 HTML 先行

第一個成功條件是與 Webflow 現況一致，不是重做網站。完成 Preview parity 後，再依互動與維護需求選 React、Astro 或其他方案。

### Pages 先行

目前需求以靜態網站與 Git Preview 為主。Pages 可為 branch 與同一 repository 的 pull request 建立 Preview；fork PR 不保證建立 Preview，URL 預設公開。若驗收內容敏感，需使用 branch controls 與 Cloudflare Access。

未來若前端與 Worker 需要單一部署，再評估 Workers Static Assets。切換前必須重新驗證 routing、headers、redirects、preview、rollback 與 parity。

### 混合媒體

- Logo、icon 與 font 跟 Pages 一起部署，保持版本一致。
- 內容照片放 R2，方便獨立生命週期與未來內容更新。
- `r2.dev` 是公開、限流的非正式環境 URL，沒有 Cache、WAF 或 Access，只能用於不含敏感資料的 Preview。
- Production 使用同一 Cloudflare 帳號與 zone 下的 media custom domain，另設 Cache Rules、TTL 與 invalidation。
- 公開 bucket 的物件可被直接讀取；私有內容必須經 Worker 或其他存取控制。

## 環境

| 環境 | 用途 | 網址／資源 |
|---|---|---|
| Local | 開發與靜態 parity | localhost；不連 Production binding 寫入 |
| Preview | branch／同 repo PR 自動部署 | 公開 Pages Preview URL；Preview R2 |
| Candidate | `main` 的人工驗收階段 | Cloudflare 視為 Pages Production deployment，但尚未綁正式網域 |
| Production | 正式取代 Webflow | 正式網域；Production R2／Worker／D1 |

規則：

- Preview 與 Candidate 不得使用 Production R2、D1、Worker service binding 或 provider secret。
- `main`／`pages.dev` Candidate 模型只適用目前的靜態 P0；後端啟用前必須另設 staging project 或環境，不能沿用 Production binding 做候選驗收。
- D1 啟用時，各環境使用明確且不同的 database ID；migration apply、list 與 readback 各自設 gate。
- Candidate 通過 parity 與 smoke gate，才規劃正式網域切換。
- DNS、Production deploy 與 Webflow unpublish 分別取得授權。

## 參考資料

- [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [Cloudflare Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Cloudflare Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare R2 cache](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [Cloudflare D1 environments](https://developers.cloudflare.com/d1/configuration/environments/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
