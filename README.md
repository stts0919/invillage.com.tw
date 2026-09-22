# 紅河隱園網站

本專案將現有 Webflow 網站遷移到 Cloudflare，先維持外觀與既有可用功能，再逐步改善與增加後端整合。

## 目前階段

「階段 3 — 資產輕量化」已完成，正等待開始「階段 4 — Git 與 GitHub」。尚未初始化 Git、建立 R2 或部署 Cloudflare。

## 入口

- [目前狀態](./HANDOFF.md)
- [專案規則](./AGENTS.md)
- [文件索引](./docs/README.md)
- [架構索引](./docs/architecture/README.md)
- [遷移路線圖](./docs/architecture/migration-roadmap.md)
- [協作角色](./docs/collaboration/agent-roles.md)

## 主要目錄

- `apps/web/`：Cloudflare Pages 前端。
- `imports/webflow/`：不可變的 Webflow 遷移來源。
- `assets/`：輕量化圖片與 manifest。
- `docs/`：架構、遷移、操作、整合與紀錄。
- `scripts/`：可重跑的本機工具。
- `tests/`：畫面一致性與 smoke checks。

## 硬門檻

未經使用者明確授權，不執行 Git commit／push、Cloudflare deploy、DNS 變更或 Webflow publish／unpublish。
