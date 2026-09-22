# Webflow 匯入來源

本目錄保存不可變的 Webflow 原始來源。

## 分類

- `site/html/`：原始頁面。
- `site/css/`：原始樣式。
- `site/js/`：原始腳本。
- `assets/images/`：原始圖片。
- `assets/fonts/`：原始字型。
- `assets/static/`：正式頁引用、但未列入 Webflow asset manifest 的 generic 靜態來源。
- `manifests/`：來源、大小、checksum 與引用關係。

階段 2 已完成匯入。舊 `webflow-export/` 在逐檔驗證後移除；本目錄是目前唯一 Webflow 原始來源。

`assets/images/` 與 `assets/fonts/` 是本機封存 binary，預設由 `.gitignore` 排除；小型 generic SVG、metadata、HTML、CSS、JavaScript 與 manifests 進 Git。
