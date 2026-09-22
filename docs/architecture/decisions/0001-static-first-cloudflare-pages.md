---
artifact: adr
version: "1.0"
created: 2026-09-21
status: accepted
---

# ADR-0001：靜態優先與 Cloudflare Pages

## 狀態

Accepted

- **日期：** 2026-09-21
- **決策者：** 使用者

## 背景

目前網站是 Webflow Landing page。第一個目標是完整搬遷並維持外觀與既有可用功能；後端、表單、訊息與金流都屬後續階段。

## 決策

我們先以靜態 HTML、CSS 與 JavaScript 建立 `apps/web`，並使用 Cloudflare Pages Git integration 提供 Preview。

- P0 不導入前端框架。
- P0 不建立 Worker API 或 D1。
- 第一個後端功能開始時，才建立獨立 `apps/api` Worker。
- 若未來要求同源 `/api/*` 或單一部署，再評估 Pages Function、Service Binding 或 Workers Static Assets。

## 後果

### 正面

- 降低 Webflow parity 的變因。
- 不需先引入 package manager 或 framework。
- Branch／PR 可建立獨立 Preview。

### 負面

- 日後導入框架或 Workers Static Assets 時需再做遷移審查。
- 前端與獨立 API Worker 可能需要 CORS 或自訂 API domain。

### 中性

- `main` 的 `pages.dev` 是 Pages Production deployment；正式網域切換仍是另一個 gate。

## 替代方案

### 立即採用 React／Astro

拒絕於 P0 採用。框架會增加 parity 變因，等搬遷完成後再評估。

### 立即使用 Workers Static Assets

延後。當前需求以 Pages Git Preview 為主，未來需要單一部署時再比較。

## 參考

- [系統總覽](../system-overview.md)
- [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
