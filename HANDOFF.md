# 紅河隱園網站遷移 Handoff

> 本檔只保存目前狀態、下一個工作包與硬門檻。架構、流程與歷史證據由下方索引分流。
>
> 最後更新：2026-09-22

## 目前階段

「階段 5 — Preview 部署」已由使用者核准 G8 Go並封存。「階段 6 — 一致性門檻」進行中；8 routes × 3 viewports 技術 parity P0／P1 0，等待使用者 owner visual review。

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
- [Webflow／Preview 一致性核對表](./docs/migration/parity-checklist.md)
- [Preview 發布契約](./docs/operations/preview-release.md)
- [Preview Launch Checklist](./docs/operations/preview-launch-checklist.md)
- [里程碑紀錄索引](./docs/records/README.md)
- [階段 4 紀錄](./docs/records/phase-04-git-github.md)
- [階段 5 紀錄](./docs/records/phase-05-preview-deployment.md)

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
| Pages deployments | Technical main：`f5cfdffe`／success；unique Preview：`a66628b4`／success，`https://a66628b4.invillage-com-tw.pages.dev`；production auto 關閉後的 main push 僅產生 skipped／idle／404 record，未部署 |
| Phase 6 parity | Live Webflow 8／8 SHA match；24／24 matched viewport pairs 的 copy／DOM／links／font／geometry pass；median screenshot SSIM 0.996186；P0／P1 0 |
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

## 階段 6 工作包

狀態：`Technical pass / Owner review pending`。詳細 evidence 與差異白名單只維護在 [parity checklist](./docs/migration/parity-checklist.md)。

| 工作包 | 負責 | 狀態 |
|---|---|---|
| P6-C1 | Codex | Complete：live checksum、route baseline、24 matched viewport DOM／geometry／screenshot、interaction comparison |
| P6-A1 | Luna Max | Complete：intentional-delta contract audit，P0／P1 0 |
| P6-A2 | Luna Max | Complete：static generator-equivalence／DOM diff audit，P0／P1 0 |
| P6-M1 | MiniMax | Assigned：獨立本機／唯讀 parity evidence review；不連網、不改檔 |
| P6-U1 | 使用者 | Pending：檢視 unique Preview 與 checklist，決定 Phase 6 Go／No-Go |

### Active assignment — P6-M1

1. 讀 `docs/migration/parity-checklist.md`、source HTML／CSS／JS 與 `apps/web/public/`。
2. 唯讀重跑 visible copy、section／element counts、links、font-face、script ordering、24 Pages assets checksums。
3. 只回報 P0／P1 finding；若無，回報 `no blocking findings` 與可重現命令。
4. 禁止 network／browser／Cloudflare、檔案修改與 Git mutation。

## 目前授權與硬門檻

- 已授權：本階段的 Git branch、stage、commit、push，以及 Preview Pages／R2 異動；每一步仍需通過 source、credential、費用與 readback gate。
- R2 Paid 已經 active，不需要 checkout；不得重複訂閱、升級方案或變更付款設定。
- 未授權：Production R2／Pages／Worker／D1、DNS、custom domain、Webflow publish／unpublish。
- 若 account readback 顯示可能產生任何新費用，停止並逐次詢問；不得購買或升級方案。
- 不更動 frozen copy，不覆寫或刪除原始圖片，不擴大 token 權限。
