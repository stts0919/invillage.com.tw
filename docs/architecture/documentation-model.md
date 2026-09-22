# 文件治理

| 欄位 | 內容 |
|---|---|
| 狀態 | 已核准 |
| 模型 | 母索引 → 子索引 → 單一主題 |

## 入口責任

| 文件 | 只負責 |
|---|---|
| `README.md` | 專案介紹、快速開始、重要索引 |
| `AGENTS.md` | Codex 權限、工作規則與驗證邊界 |
| `AGENTS.sub.md` | Codex 子代理規則，不規範 MiniMax |
| `HANDOFF.md` | 當前階段、最新證據、阻塞與下一步 |
| `docs/README.md` | 長期文件母索引 |
| 子目錄 `README.md` | 該分類的子索引 |
| `docs/records/*.md` | 已完成 milestone 的事實記錄 |
| `docs/architecture/decisions/*.md` | Proposed 或 Accepted ADR |

## 協作契約

核准架構後，穩定角色規則放在 `docs/collaboration/agent-roles.md`；`HANDOFF.md` 只連結該規則並列出目前任務分工。

- 使用者：最終決策、Git、Cloudflare 控制台、DNS 與外部服務授權。
- Codex：主管角色，負責架構、複雜任務拆解、驗收標準、整合與獨立驗證。
- MiniMax Code：執行使用者指派的有限任務，回報修改檔案、命令、證據與剩餘風險，不自行擴張範圍。
- `AGENTS.sub.md` 只規範 Codex 內部子代理，不規範 MiniMax。

## 預計分類

~~~text
docs/
├── README.md
├── architecture/
│   ├── README.md
│   ├── system-overview.md
│   ├── repository-layout.md
│   ├── documentation-model.md
│   ├── migration-roadmap.md
│   └── decisions/
│       ├── README.md
│       └── 0001-static-first.md
├── migration/
│   ├── README.md
│   ├── plan.md
│   ├── webflow-inventory.md
│   ├── asset-pipeline.md
│   └── parity-checklist.md
├── operations/
│   ├── README.md
│   ├── environments.md
│   ├── preview-release.md
│   ├── production-release.md
│   └── rollback.md
├── integrations/
│   ├── README.md
│   ├── line.md
│   ├── messenger.md
│   └── resend.md
├── collaboration/
│   ├── README.md
│   └── agent-roles.md
└── records/
    ├── README.md
    └── phase-01-webflow-migration.md
~~~

## 防膨脹規則

- 索引只寫一句摘要與連結，不複製子文件。
- 一份文件只處理一個主題。
- `HANDOFF.md` 完成 milestone 後，把歷史移到 `docs/records/`。
- ADR Accepted 後只更新狀態，或以新 ADR 取代。
- 操作步驟放 `operations/`；架構理由放 ADR。
- 文件超過單一責任或已難以快速掃描時，拆成子文件。

## 任務規格

- 不建立 `prompts/`；四份舊 Codex 模板已於 2026-09-21 刪除。
- 長期有效的需求寫入對應主題文件，例如 `docs/migration/asset-pipeline.md`。
- 一次性派工只存在當前任務，不另建 prompt 檔。
- 任務回報格式由 `AGENTS.md` 與協作契約統一規範。
