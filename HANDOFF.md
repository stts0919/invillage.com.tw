# 紅河隱園網站遷移 Handoff

> 本檔只保存目前狀態、最新證據、待決策與下一步。完整架構與歷史請讀下方索引。
>
> 最後更新：2026-09-22

## 目前階段

「階段 3 — 資產輕量化」已完成，正等待使用者指示開始「階段 4 — Git 與 GitHub」。

- 使用者已核准架構基線。
- 已建立 3 份 Accepted ADR。
- 已由 3 位 GPT-5.6 Luna／`max` 子代理做唯讀交叉 review，主要 findings 已整合。
- 已建立分類資料夾、母／子索引與協作角色文件。
- 已刪除 `prompts/` 四份舊模板。
- 已匯入並驗證 8 頁 HTML、1 CSS、12 JavaScript、211 圖片與 6 字型。
- 舊 `webflow-export/` 已在逐檔 SHA-256 驗證後移除。
- 使用者已接受樣本品質。
- 已完成 139 個 live asset 全量批次、客觀 QA、人工 spot review 與獨立子代理稽核。
- 尚未初始化 Git、建立 R2 或部署。

## 架構與文件入口

- [文件母索引](./docs/README.md)
- [架構子索引](./docs/architecture/README.md)
- [系統總覽](./docs/architecture/system-overview.md)
- [Repo 結構](./docs/architecture/repository-layout.md)
- [文件治理](./docs/architecture/documentation-model.md)
- [遷移路線圖](./docs/architecture/migration-roadmap.md)
- [ADR 索引](./docs/architecture/decisions/README.md)
- [協作角色](./docs/collaboration/agent-roles.md)
- [階段 1 紀錄](./docs/records/phase-01-repository-skeleton.md)
- [階段 2 紀錄](./docs/records/phase-02-webflow-import.md)
- [Webflow 匯入盤點](./docs/migration/webflow-inventory.md)
- [資產輕量化流程](./docs/migration/asset-pipeline.md)
- [樣本報告](./docs/migration/asset-sample-report.md)
- [全量報告](./docs/migration/asset-live-report.md)
- [階段 3 紀錄](./docs/records/phase-03-asset-optimization.md)

## 已確認方向

- 目標：把目前 Webflow Landing page 搬到 Cloudflare，完成一致性驗證後再逐步改善。
- 前端：Cloudflare Pages。
- 媒體：Logo、icon、font 跟 Pages；內容與相簿照片放 R2。
- 後端預留：Cloudflare Worker＋D1，P0 不啟用。
- 後續整合：LINE Messaging API 或 Messenger Platform、Resend、金流。
- Git／GitHub、Preview、Candidate、Production 依遷移路線圖分階段處理。
- 任務順序以「完整匯入後再輕量化」為準。
- 不做 CMS；內容先由 Agent 修改 repo。

## 已驗證現況

| 項目 | 現況 |
|---|---|
| Workspace | repository root |
| Git | 尚未初始化 |
| Webflow | 正式站仍在 Webflow |
| Asset manifest | 217 筆：211 圖片＋6 TTF |
| 本機圖片 | 211／211，235,583,047 bytes，大小核對通過 |
| 本機字型 | 6／6，24,671,584 bytes，TrueType 驗證通過 |
| HTML／CSS／JS | 8／1／12，bytes 與 SHA-256 驗證通過 |
| Placement | Pages 16／R2 123／Archive 72 |
| Optimization live | 139／139 assets、428 outputs、420／420 lossy metrics 通過 |
| Delivery manifests | Pages 16；R2 427 items／123 assets；皆未授權遠端寫入 |
| Production mutation | 本輪沒有 |

Webflow asset 已完整保存於 `imports/webflow/`；來源 HTML／CSS 仍含 Webflow URL，尚不是自管部署版。

## 協作分工

| 角色 | 責任 |
|---|---|
| 使用者 | 最終決策、Git、Cloudflare 控制台、DNS、捕夢網與外部服務授權 |
| Codex | 主管：架構、複雜任務拆解、驗收標準、整合與獨立驗證 |
| MiniMax Code | 執行使用者指派的有限任務，回報檔案、命令、證據與剩餘風險 |
| Codex 子代理 | 只處理獨立、明確、可驗證工作；固定 GPT-5.6 Luna／`max` |

MiniMax 不受 `AGENTS.sub.md` 規範；穩定角色契約已建立於 `docs/collaboration/agent-roles.md`。

## 現有產物

- `AGENTS.md`：Codex 專案規則。
- `AGENTS.sub.md`：Codex 子代理規則。
- `imports/webflow/manifests/webflow-assets.json`：217 筆 Webflow 資產。
- `imports/webflow/manifests/image-inventory.json`：圖片使用盤點。
- `imports/webflow/manifests/download-verification.json`：211 個本機圖片驗證。
- `imports/webflow/manifests/site-import.json`：HTML、CSS、JavaScript、字型與整合總表。
- `scripts/assets/build_image_inventory.rb`：重建圖片盤點。
- `scripts/assets/verify_webflow_image_downloads.rb`：驗證圖片下載。
- `scripts/assets/classify_images.rb`：重建 Pages／R2／Archive placement。
- `scripts/assets/optimize_images.rb`：限定 ID／manifest 的 fail-closed optimizer。
- `scripts/assets/verify_optimization_sample.rb`：樣本 decode、checksum、SSIM 與 PSNR gate。
- `assets/manifests/asset-classification.json`：211 張資產分類。
- `assets/manifests/optimization-sample.json`：8 張樣本輸出紀錄。
- `assets/manifests/optimization-qa.json`：樣本品質驗證。
- `assets/manifests/r2-upload-sample.json`：未授權上傳的 sample key mapping。
- `assets/manifests/optimization-live.json`：139 個 live asset 全量紀錄。
- `assets/manifests/optimization-live-qa.json`：428 outputs 與 420 lossy metrics QA。
- `assets/manifests/pages-assets-live.json`：16 個 Pages asset mapping。
- `assets/manifests/r2-upload-live.json`：427 個 R2 object mapping，`uploadAuthorized=false`。

## 已移除

`prompts/` 內四份舊 Codex 模板已依使用者指示刪除。長期規格回歸對應 docs，不再維護 prompt 檔。

## 下一步

1. 使用者指示開始「階段 4 — Git 與 GitHub」。
2. 建立 `.gitignore`，排除原始與 generated binary。
3. 規劃首個 Git commit 與 GitHub repo；commit／push 仍由使用者執行。
4. 不建立 R2 遠端資源，直到後續部署階段另行授權。

## 硬門檻

階段 4 開始前：

- 不初始化 Git 或建立 GitHub repo。
- 不建立 Pages、Worker、D1 或 R2 遠端資源。
- 不 deploy、不改 DNS、不 unpublish Webflow。
- 不購買方案、不產生新費用。
