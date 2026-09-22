# 資產處理

本目錄保存可重建的資產產物，不保存唯一原始檔。

- `optimized/`：圖片輕量化輸出。
- `manifests/`：原圖、輸出、checksum、R2 key 與 URL mapping。

所有轉檔必須保留原圖、透明度與 fallback，並先以小批次驗證。

`optimized/` 是本機 generated binary，預設不進 Git；`manifests/` 保存可審查的處理與 delivery 證據。
