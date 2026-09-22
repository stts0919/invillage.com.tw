# 紅河隱園網站

本專案將現有 Webflow 網站遷移到 Cloudflare，先維持外觀與既有可用功能，再逐步改善與增加後端整合。

## 目前階段

「階段 6 — 一致性門檻」已開始。Webflow／Preview 的 8 routes × 3 viewports 技術比對 P0／P1 為 0，現在等待使用者完成 owner visual review。正式網域、DNS 與 Webflow 正式站未變更。

技術 Preview：<https://a66628b4.invillage-com-tw.pages.dev>

GitHub：[stts0919/invillage.com.tw](https://github.com/stts0919/invillage.com.tw)

## 入口

- [目前狀態](./HANDOFF.md)
- [專案規則](./AGENTS.md)
- [文件索引](./docs/README.md)
- [架構索引](./docs/architecture/README.md)
- [遷移路線圖](./docs/architecture/migration-roadmap.md)
- [一致性核對表](./docs/migration/parity-checklist.md)
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
