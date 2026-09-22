# 資產處理

本目錄保存可重建的資產產物，不保存唯一原始檔。

- `optimized/`：圖片輕量化輸出。
- `manifests/`：原圖、輸出、checksum、R2 key 與 URL mapping。

階段 5 使用 `manifests/runtime-occurrences.schema.json` 約束 HTML／CSS／JSON-LD 的 runtime 資產出現位置；環境 URL 與上傳授權不寫入這份 inventory。

- `manifests/runtime-occurrences.json`：1,239 筆來源 occurrence、139 個 live assets 與 124 筆 external rows；主管 verifier 已通過。
- `manifests/pages-runtime-assets.json`：24 個 Pages deployment assets；本機複製狀態與遠端授權分開管理。
- `manifests/r2-upload-preview.json`：427 個 Preview R2 objects 與 HTTP metadata；三個 authorization flags 只在使用者接受 Preview remote scope 後設為 `true`，實際遠端狀態仍以 launch checklist 與 provider readback 為準。

所有轉檔必須保留原圖、透明度與 fallback，並先以小批次驗證。

`optimized/` 是本機 generated binary，預設不進 Git；`manifests/` 保存可審查的處理與 delivery 證據。
