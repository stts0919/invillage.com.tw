---
artifact: adr
version: "1.0"
created: 2026-09-21
status: accepted
---

# ADR-0003：混合媒體配置

## 狀態

Accepted

- **日期：** 2026-09-21
- **決策者：** 使用者

## 背景

網站已有大量內容照片，也有與前端版本緊密相關的 Logo、icon 與字型。所有資產放同一位置會讓部署或媒體更新互相綁定。

## 決策

- Logo、icon 與 font 跟 `apps/web` 一起部署。
- 內容與相簿照片放 R2。
- Webflow 原檔保存於 `imports/webflow`，不覆寫。
- 輕量化輸出與 R2 mapping 放 `assets`。
- Preview 與 Production 使用不同 R2 bucket。
- `r2.dev` 只用於非敏感 Preview；Production 使用 custom domain 與明確 Cache Rules。

## 後果

### 正面

- 必要前端資產與網站版本保持一致。
- 內容照片可獨立更新與管理。
- 未來使用者上傳或後台功能可沿用 R2。

### 負面

- HTML／CSS 需要可靠的 R2 URL mapping。
- Production 需要 media custom domain、cache 與 invalidation 規則。
- 公開 bucket 的物件可被直接讀取。

### 中性

- 私有內容若出現，必須改由 Worker 或其他存取控制提供。

## 替代方案

### 全部放 Pages

最簡單且具原子部署優勢，但不利未來獨立媒體生命週期。

### 全部放 R2

資產集中，但 Logo、icon 與 font 會失去與前端部署的直接版本關聯。

## 參考

- [系統總覽](../system-overview.md)
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
