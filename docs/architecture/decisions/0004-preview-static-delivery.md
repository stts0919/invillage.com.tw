---
artifact: adr
version: "1.0"
created: 2026-09-22
status: accepted
---

# ADR-0004：Preview 靜態產物與隔離交付

## 狀態

Accepted

- **日期：** 2026-09-22
- **決策者：** 使用者
- **架構負責：** Codex

## 背景

Webflow 來源包含 8 頁 HTML、共享 CSS、12 個 JavaScript、Pages 必要資產、6 個字型與 123 個內容圖片資產。原圖、字型來源與 optimized outputs 留在本機且不進 Git；Cloudflare Pages 必須能由乾淨 checkout 直接部署，Preview 媒體也不能使用未來的 Production bucket 或正式網域。

遷移第一目標是視覺與互動一致，不是導入框架、後端或新的表單功能。現有 contact form 依賴 Webflow API，若直接搬到靜態站，可能失敗或把個資放入 query string。

## 決策

我們採用以下 Preview 交付方式：

1. 本機無外部 dependency 的 Ruby script 從核准輸入產生 `apps/web/public/`；部署產物進 Git，Cloudflare 不執行 application build。
2. 頁面使用根目錄 HTML，保留 `/about`、`/spaces` 等無尾斜線 route；頂層 `404.html` 同時支援 direct `/404` 與 unknown-route 404。
3. Cloudflare Pages 使用 Git integration，root 為 `apps/web`、output 為 `public`、production branch 為 `main`；Preview 只接受 `codex/*`，不綁 custom domain。
4. 16 個既有 Pages 圖片、2 個 Webflow generic SVG 與 6 個 HarmonyOS TTF 跟部署產物進 Git。TTF 先保留原格式，WOFF2 延後到效能批次。
5. 123 個內容圖片資產放入獨立 Preview R2 bucket `invillage-media-preview`，使用 427 個 content-hash immutable keys；Preview 僅使用 public `r2.dev`，Production bucket 不建立。
6. 初次 parity 使用 JPEG／PNG／WebP fallback 與 responsive `srcset`。65 個 AVIF 可先上傳，但在驗證 `<picture>` 不影響 Webflow layout 前不啟用。
7. 暫時保留 Space Mono、既有 client-side Messenger、Google Maps、YouTube 與外部連結；禁止 Webflow CDN、Webflow form API 與遠端 jQuery／webfont runtime 成為 Preview network dependency。
8. Contact form 保留外觀，但在瀏覽器端 fail closed：不送出資料、不產生 query string、不顯示假成功。
9. Cloudflare bucket、public exposure、objects upload、Git integration 與 Preview deploy 仍需後續明確授權；本 ADR 不授權遠端異動或費用。

## 後果

### 正面

- Cloudflare Pages 可由 tracked deployment artifact 直接部署，不依賴未鎖定的雲端 build toolchain。
- Preview 與 Production 的 R2、網域與部署授權保持隔離。
- Immutable media keys 讓 HTML rollback 不需要覆寫或刪除 R2 objects。
- 原始 Webflow 檔案保持不可變，產物與來源可用 manifest、bytes 與 SHA-256 追溯。
- Contact form 在沒有後端時不會外傳個資或冒充成功。

### 負面

- Git 會新增約 24.7 MB 的 TTF deployment copies。
- 乾淨 checkout 可以部署，但若缺少被忽略的本機輸入，無法完整重跑 asset generation。
- `r2.dev` 是公開、限流且沒有 Cache／WAF 的開發 URL，不適合 Production。
- 初次 parity 不啟用 AVIF，因此尚未取得所有可能的傳輸量改善。

### 中性

- Cloudflare 可能把 `main` 的第一次 Pages deployment 稱為 Production deployment；在本專案中，它在階段 8 前只算技術部署，且不綁正式網域。
- 既有第三方 client embeds 先保留；日後是否移除或替換屬獨立決策。

## 考慮過的替代方案

### Cloudflare Direct Upload

它適合本機預建輸出，但 Direct Upload project 不能之後切換成 Git integration。專案已決定用 branch／PR Preview，因此不採用。

### 所有媒體都放 Pages

實作較簡單，但會讓大量內容圖片跟前端 commit 與部署綁定，也不符合已接受的混合媒體 ADR。

### Pages Function 或 Worker 代理 R2

它可以提供同源 `/media/*`，但會在 P0 引入 runtime、binding 與新的 rollback 面，超出靜態遷移範圍。

### Cloudflare build 時重新產生全部資產

原圖、字型來源與 optimized outputs 不在 Git，且 encoder toolchain 未鎖定。雲端重建無法保證相同 SHA-256，因此不採用。

## 參考資料

- [Preview 發布契約](../../operations/preview-release.md)
- [ADR-0001：靜態優先與 Cloudflare Pages](./0001-static-first-cloudflare-pages.md)
- [ADR-0003：混合媒體配置](./0003-hybrid-media-placement.md)
- [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [Cloudflare Pages serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
