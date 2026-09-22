# 前端網站

本目錄是 Cloudflare Pages 前端。P0 先保留靜態 HTML、CSS 與 JavaScript，不先加入框架或 build dependency。

## 目錄

- `public/`：可直接部署的靜態網站。
- `public/assets/brand/`：Logo 與品牌資產。
- `public/assets/fonts/`：前端必要字型。
- `public/assets/icons/`：小型 UI 圖示。

Webflow 原始檔不得直接放入本目錄；先保存於 `imports/webflow/`，完成映射與驗證後再整理進來。
