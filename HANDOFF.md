# 紅河隱園網站遷移 Handoff

> 本檔只保存目前狀態、下一個工作包與硬門檻。架構、流程與歷史證據由下方索引分流。
>
> 最後更新：2026-09-22

## 目前階段

「階段 5 — Preview 部署」已開始；本機交付基線已推送，現在停在 Cloudflare credential gate。

- Public repo：[stts0919/invillage.com.tw](https://github.com/stts0919/invillage.com.tw)
- Default branch：`main`
- 首個 commit：`d4d034ac1dd44efd4ca1685220da2e8526481257`
- 階段 4 文件 commit：`1a211fb1f29b668e67bd37dcc1b6384c6189b8ba`
- Phase 5 local baseline commit：`e083f47b54d8cdfb4491a9fcf6645646e8df1f5c`
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
- [Preview 發布契約](./docs/operations/preview-release.md)
- [Preview Launch Checklist](./docs/operations/preview-launch-checklist.md)
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
| Preview local contract | Pages runtime 24 items；R2 Preview 427 items；builder／verifier dry-run 通過 |
| Runtime occurrences | 1,239／1,239；139 assets；124 external rows；主管 verifier 0 failures |
| Cloudflare auth | Keychain service `invillage-cloudflare-preview` 缺失；Wrangler 尚未安裝；遠端異動 0 |
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
| 使用者 | 核准外部資源、費用與 Production 異動 |
| Codex | 主管：定義架構與驗收、拆解工作包、審核 MiniMax 產物、修正主線問題 |
| MiniMax Code | 執行使用者指派的本機工作包，提供檔案、命令、證據與剩餘風險 |
| Codex 子代理 | 只做獨立、明確、可驗證的審查；固定 GPT-5.6 Luna／`max` |

MiniMax 不受 `AGENTS.sub.md` 規範，也不得把自己的回報視為主管驗收。

## 階段 5 工作包

狀態：`Git Delivery`。`P5-M1`、`P5-M2` 已通過主管驗收；使用者已授權 Git 與 Preview Cloudflare 異動，費用與憑證 gates 仍適用。

| 工作包 | 負責 | 狀態 |
|---|---|---|
| P5-C1 | Codex | Complete：2 generic SVG＋24-item Pages runtime manifest |
| P5-C2 | Codex | Complete：occurrence schema、R2 Preview manifest、builder／verifier dry-run 通過 |
| P5-M1 | MiniMax＋Codex | Complete with supervisor correction：代理產物未過 schema；主管重建後 1,239／1,239 occurrences、0 failures |
| P5-M2 | MiniMax＋Codex | Complete：雙 build deterministic、verifier 0 failures、forbidden hits 0、form guard 1 |
| P5-M3 | MiniMax | Assigned after branch push：唯讀 public-tree／secret／ignore audit |
| P5-C3 | Codex | Blocked：Keychain entry 缺失；Wrangler devDependency 尚未授權 |

### Active assignment — P5-M3

負責：MiniMax Code

開始條件：Codex 已 push `codex/phase-5-preview`。Repo 修改：禁止。

目標：以 branch `HEAD` 為 immutable candidate，獨立檢查公開 Git tree。

任務：

1. 回報 branch、`HEAD`、tracking divergence 與 clean／dirty 狀態。
2. 統計 tracked files、總 bytes、最大 10 檔。
3. 確認 `imports/webflow/assets/images/`、`imports/webflow/assets/fonts/`、`assets/optimized/` 沒有 tracked files。
4. 只對 tracked tree 執行高信心 credential、`.env*`、本機絕對路徑與 symlink scan。
5. 執行所有新 JSON parse、Ruby syntax、Markdown local-link checks。
6. 確認 Cloudflare remote authorization flags 仍為 `false`。

驗收：

- 所有檢查以 branch `HEAD` 執行，不把工作區未提交內容當作證據。
- 若發現 secret、tracked 原始 binary、local path 或 symlink，立即停止並回報。
- 不修改檔案，不 stage／commit／push，不連網、不連 Cloudflare。
- 回報命令、exit code、finding、未驗證範圍；代理結論仍需 Codex readback。

### Codex 主管先行

1. 定義 `apps/web` 的靜態輸出、路由與 404 契約。
2. 定義被忽略 binary 的供應方式：Pages 必要資產納入部署輸出；內容圖片由 Preview R2 或可驗證還原流程提供。
3. 定義 Pages asset 與 Preview R2 URL mapping；Preview 與 Production 必須隔離。
4. 定義 Cloudflare Pages、R2、Git integration、rollback 與驗收證據。
5. 建立 2 個 generic SVG 與 6 個字型的 runtime manifest 契約。
6. 建立 runtime map schema、builder、form fail-closed transform 與 verifier。
7. 將核准規格拆成不重疊的 MiniMax 工作包。

### MiniMax 本機執行

1. 依 Codex 核准 schema 核對 139 asset IDs、HTML／CSS／JSON-LD occurrences 與 variant metadata；不自行決定 placement、R2 URL 或 allowlist。
2. 使用 Codex 提供的 script 產生 `apps/web/public/`；不得手動修改 `imports/webflow/`。
3. 保留 frozen copy、路由與互動，不自行重寫文案或重新設計。
4. 核對 24 個 Pages runtime assets；不得把整批原圖或 optimized corpus 納入 Git。
5. Preview R2 URL 未提供前不得編造 URL、產生最終部署檔或上傳。
6. 執行內部連結、資產路徑、主要響應式尺寸與 404 的 focused checks。
7. 只更新既有索引、核對表與紀錄，不建立平行計畫文件。

### MiniMax 回報格式

- 修改的檔案。
- 執行的命令。
- 通過與失敗的驗證證據。
- 尚未驗證的範圍與剩餘風險。
- 禁止自行 stage、commit、push、deploy、操作 Cloudflare／DNS 或變更 Webflow。

## 階段 5 驗收

- 乾淨 checkout 加上核准的 Preview R2 可直接部署完整靜態站；完整再生成仍需被忽略的已驗證輸入。
- HTML／CSS／JavaScript、路由、404、字型與必要資產可用。
- Preview R2 與 Production 隔離，無正式網域變更。
- 取得可重現的 branch／PR Preview URL、deploy evidence 與 rollback 路徑。
- Codex 完成獨立 diff、路徑、功能與遠端 readback；代理回報不能替代此驗收。

## 目前授權與硬門檻

- 已授權：本階段的 Git branch、stage、commit、push，以及 Preview Pages／R2 異動；每一步仍需通過 source、credential、費用與 readback gate。
- 未授權：Production R2／Pages／Worker／D1、DNS、custom domain、Webflow publish／unpublish。
- 若 account readback 顯示可能產生任何新費用，停止並逐次詢問；不得購買或升級方案。
- 不更動 frozen copy，不覆寫或刪除原始圖片，不擴大 token 權限。
