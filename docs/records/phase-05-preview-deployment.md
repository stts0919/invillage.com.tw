# 階段 5：Preview 部署

| 欄位 | 內容 |
|---|---|
| 狀態 | Complete |
| 日期 | 2026-09-22 |
| GitHub PR | [#1](https://github.com/stts0919/invillage.com.tw/pull/1) |
| Technical Pages URL | `https://invillage-com-tw.pages.dev` |
| Unique Preview URL | `https://a66628b4.invillage-com-tw.pages.dev` |

## 完成

- 建立靜態 `apps/web/public/`：8 HTML、1 CSS、12 JS、24 個 Pages runtime assets。
- 建立 Preview R2 `invillage-media-preview`，啟用 `r2.dev`，上傳 427 objects／113,523,148 bytes。
- 以 API metadata 與公開下載核對 427／427 bytes、headers、storage class 與 SHA-256，0 failures。
- 建立 Pages Git integration，只選 `stts0919/invillage.com.tw`。
- Build 設定：production branch `main`、root `apps/web`、output `public`、build command 空白。
- Branch controls：production auto=false；Preview custom include `codex/*`。
- 完成 technical main deployment `f5cfdffe` 與 unique Preview deployment `a66628b4`。
- 完成 route、404、noindex、responsive、interaction、network allowlist 與 console smoke。
- 使用者核准 G8 Go，進入階段 6。

## 驗證

- Final static verifier：0 failures；46-file output deterministic。
- Contact form synthetic submit：failure visible、success hidden、URL unchanged、Webflow form request 0。
- Remote route matrix：named routes 200、`/about/` 308、unknown／sitemap 404、robots 200。
- Desktop 1440×900、tablet 768×1024、mobile 390×844：無 Preview-only overflow 或 settled broken image。
- Public Git tree：secret、local absolute path、symlink、binary scope scans通過；Luna Max P0／P1 0。

## 邊界

- Cloudflare 將 `main` deployment 稱為 Production environment，但本專案只視為無 custom domain 的 technical deployment。
- 關閉 production auto 後，後續 `main` push 可能留下 `is_skipped=true`／idle／404 record，不代表實際部署。
- 未變更正式網域、DNS、Webflow publish／unpublish；未建立 Production R2、Worker 或 D1。

## 下一步

執行 [階段 6 一致性核對表](../migration/parity-checklist.md)，由使用者確認 Preview 可取代現有 Webflow 外觀與既有可用功能。
