---
artifact: adr
version: "1.0"
created: 2026-09-21
status: accepted
---

# ADR-0002：單一 Repo 與延後建立模組

## 狀態

Accepted

- **日期：** 2026-09-21
- **決策者：** 使用者

## 背景

專案目前簡單，但未來可能增加 Worker、D1、第三方整合與金流。過早建立空白模組會增加維護成本；完全平鋪則會在功能增加後難以分類。

## 決策

我們使用單一 repo：

- `apps/web`：Cloudflare Pages 前端。
- `apps/api`：第一個後端功能開始時才建立。
- `imports/webflow`：不可變遷移來源。
- `assets`：可重建資產與 manifest。
- `docs`、`scripts`、`tests`：文件、工具與驗證。

沒有跨 app 共用程式碼前，不建立 `packages`。

## 後果

### 正面

- 前後端與文件共享版本歷史。
- 現在維持簡單，未來仍有清楚邊界。
- 原始匯入、部署產物與生成資產分離。

### 負面

- 建立新 app 時需補對應 build、test 與 deployment 設定。
- 原始 binary 必須透過 `.gitignore` 或 repo 外封存管理。

### 中性

- 目前不建立 `apps/api`、`packages` 或 D1 migration。

## 替代方案

### 所有檔案平鋪根目錄

拒絕。短期較少目錄，但會混合匯入來源、部署檔與未來 API。

### 前端與後端分開 repo

暫不採用。現階段規模不足以抵銷多 repo 的同步成本。

## 參考

- [專案結構](../repository-layout.md)
