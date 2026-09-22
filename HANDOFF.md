# 紅河隱園網站遷移 Handoff

> 本檔只保存目前狀態、下一個工作包與硬門檻。架構、流程與歷史證據由下方索引分流。
>
> 最後更新：2026-09-22

## 目前階段

「階段 4 — Git 與 GitHub」已完成，正等待使用者指示開始「階段 5 — Preview 部署」。

- Public repo：[stts0919/invillage.com.tw](https://github.com/stts0919/invillage.com.tw)
- Default branch：`main`
- 首個 commit：`d4d034ac1dd44efd4ca1685220da2e8526481257`
- Webflow 正式站仍在線上；尚未建立 Cloudflare Pages、R2、Worker 或 D1。
- 本機檔案仍是 source of truth；`imports/webflow/` 是不可變遷移來源。

## 文件入口

- [文件母索引](./docs/README.md)
- [系統總覽](./docs/architecture/system-overview.md)
- [Repo 結構](./docs/architecture/repository-layout.md)
- [遷移路線圖](./docs/architecture/migration-roadmap.md)
- [ADR 索引](./docs/architecture/decisions/README.md)
- [協作角色](./docs/collaboration/agent-roles.md)
- [Webflow 匯入盤點](./docs/migration/webflow-inventory.md)
- [資產輕量化流程](./docs/migration/asset-pipeline.md)
- [里程碑紀錄索引](./docs/records/README.md)
- [階段 4 紀錄](./docs/records/phase-04-git-github.md)

## 已驗證現況

| 項目 | 現況 |
|---|---|
| GitHub | Public；`main`；首個 commit 已推送並核對 remote SHA |
| 首次追蹤內容 | 84 個檔案；2,478,758 bytes；credential pattern 0 |
| Git 排除內容 | 原圖 211、TTF 6、optimized outputs 428；均保留在本機 |
| Webflow 程式 | HTML 8／CSS 1／JavaScript 12；bytes 與 SHA-256 通過 |
| Asset manifest | 217 筆：圖片 211＋TTF 6 |
| Placement | Pages 16／R2 123／Archive 72 |
| Optimization | 139／139 assets；428 outputs；420／420 lossy metrics 通過 |
| Delivery manifests | Pages 16；R2 427 items／123 assets；遠端寫入未授權 |
| Production mutation | 無 |

來源 HTML／CSS 仍含 Webflow URL，`apps/web/` 尚未形成可自管部署版本。

## 已確認方向

- 前端採靜態 HTML、CSS 與 JavaScript，部署到 Cloudflare Pages。
- Logo、icon 與 font 跟 Pages；內容與相簿照片放 R2。
- P0 不啟用 Worker、D1、CMS、登入、付款或訊息整合。
- 先通過 Webflow／Preview 一致性門檻，再開始重新設計或功能擴充。
- 原始與 generated binary 留在本機工作目錄，由 `.gitignore` 排除。

## 協作分工

| 角色 | 本階段責任 |
|---|---|
| 使用者 | 決定是否開始階段 5，核准外部資源、費用與 Production 異動 |
| Codex | 主管：定義架構與驗收、拆解工作包、審核 MiniMax 產物、修正主線問題 |
| MiniMax Code | 執行使用者指派的本機工作包，提供檔案、命令、證據與剩餘風險 |
| Codex 子代理 | 只做獨立、明確、可驗證的審查；固定 GPT-5.6 Luna／`max` |

MiniMax 不受 `AGENTS.sub.md` 規範，也不得把自己的回報視為主管驗收。

## 階段 5 工作包

狀態：`Ready`，尚未開始。使用者說「開始階段 5」後才執行。

### Codex 主管先行

1. 定義 `apps/web` 的靜態輸出、路由與 404 契約。
2. 定義被忽略 binary 的供應方式：Pages 必要資產納入部署輸出；內容圖片由 Preview R2 或可驗證還原流程提供。
3. 定義 Pages asset 與 Preview R2 URL mapping；Preview 與 Production 必須隔離。
4. 定義 Cloudflare Pages、R2、Git integration、rollback 與驗收證據。
5. 將核准規格拆成不重疊的 MiniMax 工作包。

### MiniMax 本機執行

1. 依 Codex 核准規格把 Webflow 靜態頁整合進 `apps/web/`；不得修改 `imports/webflow/`。
2. 保留 frozen copy、路由與互動，不自行重寫文案或重新設計。
3. 依 `assets/manifests/pages-assets-live.json` 處理 16 個 Pages asset；不得把整批原圖或 optimized corpus 納入 Git。
4. 依核准 mapping 改寫本機資產路徑；Preview R2 URL 未提供前不得編造 URL 或上傳。
5. 建立或執行內部連結、資產路徑、主要響應式尺寸與 404 的 focused checks。
6. 只更新既有索引、核對表與紀錄，不建立平行計畫文件。

### MiniMax 回報格式

- 修改的檔案。
- 執行的命令。
- 通過與失敗的驗證證據。
- 尚未驗證的範圍與剩餘風險。
- 禁止自行 stage、commit、push、deploy、操作 Cloudflare／DNS 或變更 Webflow。

## 階段 5 驗收

- `apps/web` 可由乾淨 checkout，加上核准的 Preview R2 或可驗證資產還原流程，提供完整靜態站。
- HTML／CSS／JavaScript、路由、404、字型與必要資產可用。
- Preview R2 與 Production 隔離，無正式網域變更。
- 取得可重現的 branch／PR Preview URL、deploy evidence 與 rollback 路徑。
- Codex 完成獨立 diff、路徑、功能與遠端 readback；代理回報不能替代此驗收。

## 硬門檻

使用者另行明確授權前：

- 不建立或修改 Cloudflare Pages、R2、Worker、D1、DNS 或 Production binding。
- 不 deploy、不上傳 R2、不發布或取消發布 Webflow。
- 不購買方案、不產生新費用。
- 不更動 frozen copy、不覆寫或刪除原始圖片。
