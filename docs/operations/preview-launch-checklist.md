---
artifact: launch-checklist
version: "1.0"
created: 2026-09-22
status: active
---

# Preview Launch Checklist

## Launch Overview

| 欄位 | 內容 |
|---|---|
| 交付 | Webflow 自管靜態站的 Cloudflare branch Preview |
| 日期 | 未設定；依 gate 完成事件推進 |
| 類型 | 公開 Preview，無正式網域 |
| Launch owner | Codex |
| Go／No-Go | 使用者 |

### Stakeholders

| 角色 | 負責 |
|---|---|
| 使用者 | 外部授權、費用與最終 Go／No-Go |
| Codex | 架構、scripts、驗收、Git／Cloudflare 主線 |
| MiniMax Code | 指定的本機 dry-run 與 evidence |

## Gate Sequence

| Gate | 結果 | Owner | 狀態 |
|---|---|---|---|
| P5-G1 | 架構、ADR、manifests、builder、verifier | Codex | Complete |
| P5-G2 | MiniMax 隔離 dry-run 與 determinism evidence | MiniMax＋Codex | Complete |
| P5-G3 | Git 與 Preview Cloudflare 異動授權 | 使用者 | Complete |
| P5-G3b | Project-local Wrangler v4 dependency | Codex | Complete：4.136.1 exact，audit 0 |
| P5-G4 | Preview token／account／plan／name readback | Codex | Partial：Keychain／token／account／Pages name 通過；R2 API `10042 / NotEntitled` |
| P5-G5 | Preview R2 建立、public URL、427 objects readback | Codex | Blocked：需先明確核准 R2 subscription checkout |
| P5-G6 | Final static artifact、local browser QA、Git merge | Codex | Blocked by G5 |
| P5-G7 | Pages Git integration、branch Preview、remote smoke | Codex＋使用者 | Blocked by G6 |
| P5-G8 | Preview technical Go／No-Go | 使用者 | Blocked by G7 |

## Engineering Readiness

| 項目 | Owner | Due | 狀態 | 證據／限制 |
|---|---|---|---|---|
| Preview contract／ADR accepted | 使用者 | G1 | Complete | `preview-release.md`、ADR-0004 |
| 24-item Pages runtime manifest | Codex | G1 | Complete | 24,852,679 bytes |
| 427-item R2 Preview manifest | Codex | G1 | Complete | 113,523,148 bytes；remote flags false |
| Occurrence inventory | Codex | G1 | Complete | 1,239／1,239；139 assets；0 failures |
| Static builder／verifier | Codex | G1 | Complete | 兩次 deterministic dry-run；0 failures |
| Independent dry-run | MiniMax＋Codex | G2 | Complete | 主管 fresh rerun：deterministic、0 failures、repo delta 0 |
| Wrangler v4 local dev dependency | Codex | G3b | Complete | Exact `4.136.1`；private package；audit 0 vulnerabilities |
| Git branch／commit／push／merge | Codex | G3／G6 | Authorized | 大改使用 `codex/phase-5-preview` |
| Final `apps/web/public/` | Codex | G5 | Blocked | 需要實際 `r2.dev` base URL |

## QA & Testing

| 項目 | Owner | Due | 狀態 | 驗收 |
|---|---|---|---|---|
| Import checksum | Codex | G1 | Complete | 8 HTML、1 CSS、12 JS、211 images、6 fonts；0 failures |
| Build determinism | Codex＋MiniMax | G2 | Complete | relative path＋SHA-256 清單完全一致 |
| Static verifier | Codex＋MiniMax | G2 | Complete | 8／1／12／24／362／123；0 failures |
| Local browser smoke | Codex | G6 | Pending | routes、assets、console、form guard |
| Remote route matrix | Codex | G7 | Pending | 8 routes、robots 200、unknown 404 |
| Responsive QA | Codex | G7 | Pending | 1440×900、768×1024、390×844 |
| Interaction QA | Codex | G7 | Pending | nav、sliders、tabs、FAQ、Maps、YouTube、Messenger |
| Network allowlist | Codex | G7 | Pending | forbidden Webflow CDN／form API requests = 0 |
| Owner UAT | 使用者 | G8 | Pending | Preview 可進入階段 6 parity |

## Design & UX

| 項目 | Owner | Due | 狀態 | 限制 |
|---|---|---|---|---|
| Frozen copy unchanged | Codex | G6 | Pending | 不重寫使用者／Webflow 可見文案 |
| Existing layout preserved | Codex | G7 | Pending | parity 優先，不重新設計 |
| Contact form fail closed | Codex | G6 | Script ready | 不送資料、不顯示假成功 |
| Accessibility debt | 使用者＋Codex | Phase 9 | Deferred | 現有空 `alt` 與 iframe title 不在本輪擴寫 |

## Marketing & Communications

本輪不做公告、社群、Email 或正式網域導流。Preview URL 只提供內部驗收；此分類為 N/A。

## Customer Support

本輪沒有新客服流程。Contact form 明確不可宣稱可用；既有 Facebook／Messenger 僅作 parity 保留。

## Legal & Compliance

| 項目 | Owner | Due | 狀態 |
|---|---|---|---|
| Public Preview 不含 secret／私人資料 | Codex | G7 | Pending readback |
| Existing public contact copy unchanged | Codex | G6 | Pending diff check |
| Third-party embeds retained per accepted allowlist | Codex | G7 | Pending network QA |
| Terms／Privacy placeholder links | 使用者 | Phase 9 | Existing debt；不阻塞 parity |

## Operations & Infrastructure

### Authentication

- Preview token 存入 macOS Keychain service `invillage-cloudflare-preview`；token 不進 shell argument、文件、log 或 Git。
- Token 僅限指定 Cloudflare account，提議 account permissions：Cloudflare Pages Edit、Workers R2 Storage Write、Account Settings Read；另加 Wrangler 身分核對需要的 User Details Read／User Memberships Read。不得給 DNS／Zone permission。
- 若 token 缺失或 permission 不足，停止；不自行擴權。Wrangler OAuth 只作使用者核准的 fallback。
- 本 repo 沒有 Worker，也不為了通用 preflight 建立假的 `wrangler.jsonc`。

### Tooling

- Cloudflare 官方建議 project-local Wrangler。G3b 已核准並鎖定 root devDependency `wrangler@4.136.1` 與 lockfile。
- 禁止使用未鎖版的 `npx wrangler`。
- `wrangler pages project create` 會建立 Direct Upload project，本專案禁止使用；Pages 必須由 Dashboard 的 Git integration 建立。
- Wrangler 僅用於 `whoami`、R2 bucket／object 操作與 readback。

### Cost Preflight

- 本批資料約 0.114 GB、427 個 writes；低於官方每月 10 GB Standard storage 與 100 萬 Class A free tier。
- Pages 不使用 Functions，static asset requests 免費且不限量。
- 上述只代表增量估算；目前帳號尚未啟用 R2，因此無法讀回 R2 當月既有用量。啟用 subscription 屬新的 checkout，必須由使用者逐次明確核准；若畫面顯示非零費用或方案升級，立即停止。

## Analytics & Monitoring

本輪不新增 analytics、cookie 或監控服務。技術證據使用 Cloudflare deployment status、HTTP status、network log、console 與截圖；正式監控延後到 Production 計畫。

## Git and Promotion Plan

1. 使用者核准 G3 後，Codex 把目前工作移到 `codex/phase-5-preview`。
2. Commit A：架構、manifests、scripts、MiniMax evidence；不含正式 `apps/web/public/`。
3. G5 取得實際 Preview media base URL 後，Codex 產生並驗證 final artifact。
4. Commit B：`apps/web/public/` 與 final Preview URL mapping。
5. 本機 browser QA 通過後，push branch、建立 PR 並由 Codex 審核 diff。
6. 使用者核准後 fast-forward merge 到 `main`；此時正式站仍是 Webflow。
7. 建立 Pages Git integration，讓 `main` 先形成無 custom domain 的技術 deployment。
8. 從 `main` 建立 `codex/phase-5-remote-qa`，用 empty commit 觸發內容相同的 unique branch Preview。
9. 遠端 smoke 只對 unique hash Preview 執行；`main` 的 `*.pages.dev` 在階段 8 前不視為 Candidate。

## Go／No-Go Criteria

### Must Have

- [ ] P5-M2 主管 readback 通過。
- [ ] Git tree 無 secret、大型原始圖片或未核准檔案。
- [ ] Cloudflare account、plan、names、token scope 與費用 preflight 通過。
- [ ] Preview R2 427 keys／bytes／headers readback 通過。
- [ ] Final static verifier 0 failures。
- [ ] Unique Pages Preview route／asset／network／console smoke 通過。
- [ ] Production R2、DNS、custom domain、Webflow 均未變更。

### Should Have

- [ ] Desktop／tablet／mobile screenshots 齊全。
- [ ] 前一個 immutable Preview URL 可供比較。

### Nice to Have

- [ ] AVIF `<picture>` 實驗；不阻塞 parity。
- [ ] WOFF2 conversion；延後 Phase 9。

## Rollback Plan

### Trigger Conditions

- R2 keys、headers 或 decode 不符合 manifest。
- Preview 有 broken route、missing asset、未核准 network request 或 console blocker。
- Contact form 外傳資料或顯示假成功。

### Steps

1. 停止 branch push／alias 更新，不 merge 到 `main`。
2. 保留上一個 unique hash Preview 作證據；修正後產生新 deployment。
3. R2 immutable objects 不覆寫、不批量刪除；HTML mapping 指回已驗證 keys。
4. 若 `main` 技術 deployment 已建立，使用 Git revert 或新的修正 commit；不動正式網域。

### Owner／Estimate

- Owner：Codex；使用者決定 Go／No-Go。
- Preview HTML rollback 目標：15 分鐘內；R2 不做破壞性 rollback。

## Check-in Schedule

| Checkpoint | 時機 | 參與者 |
|---|---|---|
| Local gate | P5-M2 回報後 | Codex、使用者、MiniMax |
| External authorization | G3 preflight 清單完成後 | 使用者、Codex |
| Remote go／no-go | G7 evidence 完成後 | 使用者、Codex |
| Phase 6 handoff | G8 通過後 | 使用者、Codex、MiniMax |

## Open Issues

| Issue | Owner | 狀態 | 影響 |
|---|---|---|---|
| Preview token 與 account readback | Codex | Complete | Keychain injection、`wrangler whoami`、account match 均通過；token 未輸出 |
| R2 subscription 尚未啟用 | 使用者＋Codex | Blocked：需明確授權 checkout | R2 API `10042 / NotEntitled`；不得自動購買或接受方案 |
| Project／bucket 名稱可用性 | Codex | Pages name available；R2 pending entitlement | R2 啟用後先 list，再決定是否建立 |
| Account 當月 R2 用量未知 | Codex | Blocked by entitlement | 啟用後先讀回；若可能產生費用則停止 |
| Public branch tree 尚未獨立 audit | MiniMax | Assigned P5-M3 | Git evidence gate |

## Official References

- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [Cloudflare Wrangler install](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [Cloudflare R2 error codes](https://developers.cloudflare.com/r2/api/error-codes/)
- [Cloudflare R2 get started](https://developers.cloudflare.com/r2/get-started/)
