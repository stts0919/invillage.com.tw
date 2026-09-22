# Scripts

本目錄只保存可重跑、有明確輸入輸出與失敗狀態的工具。

- `assets/`：資產盤點、下載驗證與輕量化。
- `migration/`：Webflow 匯入與路徑映射。
- `verification/`：parity、smoke 與 manifest 檢查。
- `deployment/`：未來部署輔助工具；未授權不得直接部署。

階段 5 使用 `migration/build_pages_runtime_manifest.rb` 驗證並產生 24 個 Pages deployment assets 的 runtime manifest；它不複製檔案，也不執行遠端異動。

`assets/build_r2_preview_manifest.rb` 由已核准的 R2 delivery manifest 加入 MIME、cache 與 Preview URL 欄位；預設所有遠端授權都是 `false`。

`migration/build_static_site.rb` 只產生本機靜態站；`verification/verify_static_site.rb` 驗證 route files、Pages assets、R2 keys、local references 與 forbidden network dependencies。

`verification/verify_runtime_occurrences.rb` 驗證 MiniMax 的 occurrence inventory 結構、classification、來源 coverage 與 summary；代理回報不得取代此檢查。

`migration/build_runtime_occurrences.rb` 以相同來源重建 occurrence inventory；若代理產物無法通過 verifier，主管可用它重建後再驗收。

`deployment/upload_r2_preview.mjs` 預設只驗證 427 個本機檔案、SHA-256、headers 與 Preview URL；遠端模式還要求 `--apply`、明確 commit SHA、明確且吻合的 account ID、乾淨 tracked tree、Keychain runtime token 與 `INVILLAGE_R2_PREVIEW_WRITE=authorized`。它固定只寫入 `invillage-media-preview`。

`verification/verify_r2_preview.mjs` 要求乾淨且吻合的 source commit，先讀回 target bucket 的 exact `r2.dev` origin，再以 R2 API 核對完整 key／bytes／storage class／HTTP metadata，最後從該 origin 下載全部物件核對 bytes 與 SHA-256；不保存下載副本。

一次性 command 不建立成 script；同一問題重複出現且解法穩定時才收錄。
