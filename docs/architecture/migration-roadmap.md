# 遷移路線圖

| 欄位 | 內容 |
|---|---|
| 狀態 | 已核准 |
| 原則 | 一個階段，一個可驗收結果 |

## 階段 0 — 架構

- [x] 盤點現況與目標。
- [x] 使用者修改並核准架構初稿。
- [x] 將接受的決策寫成 ADR。

## 階段 1 — Repo 骨架

- [x] 建立核准的資料夾與索引。
- [x] 精簡 `AGENTS.md`、`AGENTS.sub.md`、`HANDOFF.md`。
- [x] 不建立 `prompts/`；長期任務規格放入對應 docs。

驗收：所有索引可導覽，沒有重複事實來源。

## 階段 2 — Webflow 匯入

- [x] 抓取 HTML、CSS、JavaScript 與字型。
- [x] 分類圖片、manifest 與頁面來源。
- [x] 建立 inventory 與 checksum。

此順序依使用者最新指示，以「完整匯入後再輕量化」為準；舊 prompt 的「先輕量化再抓站」不再具權威性。

驗收：Webflow 來源完整、不可變且可追溯。

## 階段 3 — 資產輕量化

- [x] 小批次產生輕量化版本。
- [x] 保留透明度、尺寸、格式與 fallback。
- [x] 產生 sample R2 key 與 URL mapping，不上傳 Production。
- [x] 使用者確認樣本品質。
- [x] 執行完整 live asset 批次。

驗收：每個輸出可解碼，manifest 完整，原圖未覆寫，且使用者接受樣本品質。

## 階段 4 — Git 與 GitHub

- [x] 建立 `.gitignore`，排除原始與生成二進位。
- [x] 初始化 `main`，建立 public GitHub repo。
- [x] 完成首個 commit／push，並核對本機與遠端 SHA。

驗收：public repo 不含 secret、大型原圖或無法重建的暫存產物；default branch 為 `main`，本機與遠端 SHA 一致。

## 階段 5 — Preview 部署

- 建立 Pages Git integration。
- 建立 Preview R2 bucket。
- 取得 branch／PR Preview URL。

驗收：符合 [系統總覽](./system-overview.md) 的環境隔離，沒有正式網域變更。

## 階段 6 — 一致性門檻

- 比對 Webflow 與 Preview 的 desktop／mobile。
- 驗證路由、連結、圖片、字型、表單狀態、console 與 404。
- 未達一致前，不開始重新設計。

驗收：使用者確認 Preview 可取代原站外觀與既有可用功能。

## 階段 7 — 更新計畫

- 建立網站改善 roadmap。
- 將內容、SEO、效能、UX 與功能拆成獨立批次。

## 階段 8 — Candidate 發布

- 用 `main` 對應的 `*.pages.dev` 提供公開驗收；Cloudflare 視它為 Pages Production deployment，但此時不使用正式網域。
- 完成 smoke、rollback 與 owner QA。

## 階段 9 — 逐步優化

- 逐批執行已核准的改善。
- 每批保留 Preview、驗證與 rollback。

## 階段 10 — 正式切換

- 綁定正式網域與 Production R2 media domain。
- 驗證 DNS、TLS、cache、404、表單與監控。
- 確認 rollback 後才取代 Webflow。
- Webflow unpublish／取消訂閱另行確認。

## 階段 11 — 後端與整合

- 依需求建立 Worker API 與 D1。
- 再加入 Resend、LINE、Messenger 與金流。
- 每個整合建立安全、webhook、idempotency 與資料保存決策。

## 已確認決策

1. 使用 `apps/web`；第一個後端功能開始時才建立 `apps/api`。
2. P0 採靜態 HTML、CSS 與 JavaScript。
3. 小型必要資產放 Pages，內容照片放 R2。
4. Webflow 遷移來源放 `imports/webflow`。
5. 原始與 generated binary 留在本機工作目錄，由 `.gitignore` 排除。

## 待使用者決定

1. Candidate 是否只使用 `pages.dev`。
2. Production media domain 是否預留 `media.invillage.com.tw`。

## 階段 1 核准門檻（已通過）

使用者核准以下項目後才開始建立完整 skeleton：

- repo tree；
- 文件分類；
- Webflow import 位置；
- Pages／R2 分工；
- 環境與發布階段。

此門檻已通過；目前有效 gate 以 `HANDOFF.md` 為準。
