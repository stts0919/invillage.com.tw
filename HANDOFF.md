# 紅河隱園網站遷移 Handoff

> 本檔只保存目前狀態、下一個工作包與硬門檻。架構、流程與歷史證據由下方索引分流。
>
> 最後更新：2026-09-22

## 目前階段

「階段 5 — Preview 部署」已完成至 G7；G8 `Ready`，等待使用者對技術 Preview 做 Go／No-Go。Pages Git integration、隔離 Preview deployment 與遠端 route／asset／responsive／interaction／network／console smoke 全部通過。

- Public repo：[stts0919/invillage.com.tw](https://github.com/stts0919/invillage.com.tw)
- Default branch：`main`
- 首個 commit：`d4d034ac1dd44efd4ca1685220da2e8526481257`
- 階段 4 文件 commit：`1a211fb1f29b668e67bd37dcc1b6384c6189b8ba`
- Phase 5 local baseline commit：`e083f47b54d8cdfb4491a9fcf6645646e8df1f5c`
- Phase 5 R2／static candidate commit：`9b39cbe8e04074f28955a07ca03512d3555b72fe`
- Phase 5 merged main：`de578cf738466bf5b3fd82fd2f084b7c63e67c73`；[PR #1](https://github.com/stts0919/invillage.com.tw/pull/1)
- Pages technical deployment source：`1e1758cdc405bb3be9baae1beba8f8ad5747dfe1`
- Pages unique Preview source：`c0fca01ae0cb35f6b3f630d1fc769ea579c23d8b`
- Webflow 正式站仍在線上；Preview R2／Pages 已建立，Worker／D1、DNS、custom domain 均未建立或變更。
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
| Delivery manifests | Pages 16；R2 427 items／123 assets；Preview remote authorization flags true、427 objects 已上傳 |
| Preview local contract | Final `apps/web/public/` 46 files／25,529,724 bytes；8 HTML／1 CSS／12 JS／24 Pages assets；verifier 0 failures |
| Runtime occurrences | 1,239／1,239；139 assets；124 external rows；主管 verifier 0 failures |
| Cloudflare tooling | Wrangler `4.136.1` exact devDependency；private package；npm audit 0 vulnerabilities |
| Cloudflare auth | Keychain service `invillage-cloudflare-preview` 已建立；`wrangler whoami` 通過且 account match；未輸出 token |
| Cloudflare names | Pages `invillage-com-tw`、R2 `invillage-media-preview` 已建立且隔離於 Preview scope |
| Cloudflare R2 | `invillage-media-preview`：Standard／APAC／default；public origin 已啟用；427 objects／113,523,148 bytes，metadata＋公開 bytes＋SHA-256 0 failures |
| Cloudflare Pages | Git source `stts0919/invillage.com.tw`；root `apps/web`；output `public`；空 build command；production auto off；Preview include `codex/*` |
| Pages deployments | Technical main：`f5cfdffe`／success；unique Preview：`a66628b4`／success，`https://a66628b4.invillage-com-tw.pages.dev` |
| 正式環境異動 | 無正式網域、DNS、custom domain、Webflow publish／unpublish 或 Production R2／Worker／D1 異動 |

`apps/web/public/` 已形成可自管部署版本；HTML／CSS 不再依賴禁止的 Webflow CDN，內容圖片由已驗證的 Preview R2 提供。

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

狀態：`G8 Ready`。G1–G7 已通過；等待使用者決定是否進入階段 6 視覺一致性門檻。

| 工作包 | 負責 | 狀態 |
|---|---|---|
| P5-C1 | Codex | Complete：2 generic SVG＋24-item Pages runtime manifest |
| P5-C2 | Codex | Complete：occurrence schema、R2 Preview manifest、builder／verifier dry-run 通過 |
| P5-M1 | MiniMax＋Codex | Complete with supervisor correction：代理產物未過 schema；主管重建後 1,239／1,239 occurrences、0 failures |
| P5-M2 | MiniMax＋Codex | Complete：雙 build deterministic、verifier 0 failures、forbidden hits 0、form guard 1 |
| P5-M3 | MiniMax | Optional／non-blocking：主管＋Luna Max 已完成 fresh public-tree／secret／ignore audit，P0／P1 0 |
| P5-C3 | Codex | Complete：G5–G7、PR／merge、Pages Git integration、unique Preview 與 remote smoke 全部通過 |

### 下一步 — G8 Owner Go／No-Go

1. 使用者開啟 unique Preview，確認是否接受進入階段 6 視覺一致性門檻。
2. 若 Go：Codex 先定義 Webflow／Preview 比對矩陣，再拆成不重疊的 MiniMax 本機／唯讀工作包。
3. 若 No-Go：保留 immutable Preview 與 R2 keys，記錄可重現差異後回到對應 gate 修正。

## 階段 5 驗收

- 乾淨 checkout 加上核准的 Preview R2 可直接部署完整靜態站；完整再生成仍需被忽略的已驗證輸入。
- HTML／CSS／JavaScript、路由、404、字型與必要資產可用。
- Preview R2 與 Production 隔離，無正式網域變更。
- 取得可重現的 branch／PR Preview URL、deploy evidence 與 rollback 路徑。
- Codex 完成獨立 diff、路徑、功能與遠端 readback；代理回報不能替代此驗收。

## 目前授權與硬門檻

- 已授權：本階段的 Git branch、stage、commit、push，以及 Preview Pages／R2 異動；每一步仍需通過 source、credential、費用與 readback gate。
- R2 Paid 已經 active，不需要 checkout；不得重複訂閱、升級方案或變更付款設定。
- 未授權：Production R2／Pages／Worker／D1、DNS、custom domain、Webflow publish／unpublish。
- 若 account readback 顯示可能產生任何新費用，停止並逐次詢問；不得購買或升級方案。
- 不更動 frozen copy，不覆寫或刪除原始圖片，不擴大 token 權限。
