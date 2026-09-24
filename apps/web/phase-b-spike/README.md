# Phase B 新版前端：本機 V1 候選

| 欄位 | 內容 |
|---|---|
| 狀態 | 六頁公開 Preview 候選；正式內容審核與正式網域切換另行處理，實際部署狀態見 `HANDOFF.md` |
| 日期 | 2026-09-23 |
| 範圍 | 本目錄的 Astro 靜態站；產品方向以 `docs/architecture/website-update-roadmap.md` 為準 |

## 隔離方式

- 試作原始碼、專用 `package.json`、lockfile 與 `dist/` 只放在本目錄；既有 `apps/web/public/` 保留為 Phase 6 通過的靜態基線。
- 使用者已在精確套件清單與影響說明後同意繼續此範圍；本目錄新增專用 manifest／lockfile，不修改 repo 根目錄的 package 檔。
- 本機 V1 產生 `/`、`/spaces`、`/plan`、`/about`、`/contact`、`/404` 六頁：首頁 Hero、固定導覽、空間頁 React island、首頁 GSAP reveal。所有輸出與檢查都限制在本目錄。
- `imports/webflow/` 保持不可變；舊站可見文案與價格不機械改寫。Messenger 先採候選 `https://m.me/invillagewulai`，登入後桌機與手機 App 尚待驗收。

## 建議的精確依賴

版本依 2026-09-23 的套件發布資訊提出；實際安裝前仍須重核 peer dependencies 與 lockfile。

| Manifest 類別 | 套件與建議固定版本 | 用途與瀏覽器影響 | 可行替代 |
|---|---|---|---|
| dependencies | `astro@7.3.4` | 靜態 HTML 建置；Astro 模板本身不增加瀏覽器框架 JS | 現有手寫 HTML／Ruby builder |
| dependencies | `@astrojs/react@6.0.6` | 只編譯／hydration `/spaces` React island | Astro 元件＋原生 JS |
| dependencies | `react@19.3.0`、`react-dom@19.3.0` | 僅 `/spaces` hydration 才進入瀏覽器 | 原生 tab／button 與狀態程式 |
| dependencies | `gsap@3.15.0` | 首頁 scroll reveal 的 core 與套件內 ScrollTrigger 會進入該頁瀏覽器 JS | CSS 或 IntersectionObserver |
| devDependencies | `typescript@6.0.3`、`@astrojs/check@0.9.10` | `.astro`／`.ts`／`.tsx` 型別與診斷，建置時使用 | 只做 JS，但會失去本輪型別驗證目標 |
| devDependencies | `@types/react@19.3.0`、`@types/react-dom@19.3.0` | React TSX 型別，無瀏覽器輸出 | 不使用 React TSX |

`@gsap/react` 本切片不需要：GSAP reveal 放在 Astro 頁面的 client script，不在 React island 內。ScrollTrigger 需明確從 `gsap/ScrollTrigger` 匯入並註冊，沒有第二個 npm 套件。純靜態輸出不使用 `@astrojs/cloudflare`、Worker、D1、Motion 或新的測試套件。

Astro build 預設輸出 `dist/`，而現有 Pages project 仍使用無 build command 的 `apps/web/public/`；本切片不改 Cloudflare 設定。`astro build` 不執行完整型別檢查，因此本輪先跑 `astro check` 再 build。Astro 7 本身接受 Node 22.12，但本輪 lockfile 的 `undici@8.11.0` 要求 Node 至少 22.19；終端機預設 `22.14.0` 不符合，試作檢查／建置使用本機已配置的 Node 24.19.0，並在本目錄 `.node-version` 固定版本，不變更系統 Node。正式 Pages build root 也須固定符合版本並在隔離 Preview 驗證。

### Bundle 與維護門檻

- 本機 Preview 實測：首頁 JS 傳輸 44,394 bytes；空間頁三個 JS 合計 70,630 bytes；共用 CSS 傳輸 3,850 bytes。這是本機 Chrome 的傳輸讀數，不代表 Cloudflare 壓縮率或正式站效能。
- 若單一 reveal 的成本不成比例，正式採納前仍可改用 CSS／IntersectionObserver；完整 Core Web Vitals 與行動網路尚未量測。
- 固定版本與 lockfile；核對 Astro／React peer dependencies、Node engine、授權與上游維護狀態。對完整 lockfile（含 dev dependencies）執行 `npm audit`，審查安裝腳本與 advisory；不得用 audit ignore 或跳過 type check 換取綠燈。
- GSAP 官方 Standard License 允許一般商業網站使用；本專案只自託管其程式碼，不依賴 Webflow CDN。套件授權及條款在實際安裝前再核對一次。

## 可沿用的本機來源

| 用途 | 現有來源與驗證值 |
|---|---|
| Frozen 首頁標題／說明 | `apps/web/public/index.html`；SHA-256 `b51271ab39ee638c4a5fc553a91b6c13e34720416465d4ddaba45dbb2fdadb56` |
| Frozen 空間標籤 | `apps/web/public/spaces.html`；SHA-256 `ae7a932b4a6ddb26f3d1902360ff18662e2a731ed4c441e22ded5c59f4387dee` |
| 字型／顏色基線 | `apps/web/public/css/invillage.webflow.shared.6118f57c7.css`；SHA-256 `899a5bc20a1dae8988ead7fc6ef3e63a8de605fb0355765906f3bee3feacb126`；Regular font `650743525c7e04100a5379c4.ttf` |
| Logo | `apps/web/public/assets/brand/650741963cc37e5fe08d25bf.png`；1,135×301；SHA-256 `35289ea8c8a054903a3a02e6c36e46793a72b7a71bf32cbb9691d271c4ad27db` |
| Hero 靜態照片樣本 | `assets/optimized/651d47f406ef2b6efb8390da/651d47f406ef2b6efb8390da-fallback-w1280.jpg`；1,280×854；SHA-256 `52b0b32056fcfb77946efd494fad4e8b0d339cb276fbd1d3c95a2bbfe3d13cae` |
| `/spaces` 照片樣本 | `assets/optimized/651eb5fab873a24649ff0253/651eb5fab873a24649ff0253-fallback-w640.jpg`；640×426；SHA-256 `d08a9d89620d881832dae205a1533b778625c2b0db091dddfbb9fc13fef5b63c` |

資產進入試作時只複製必要的 deployment copy，不將完整原圖與 428 個 optimized corpus 複製進新輸出。`scripts/prepare-assets.mjs` 直接讀 `reference/legacy-slice.json` 指向的 7 個本機樣本；`scripts/verify-hero-media.mjs` 直接讀 `assets/manifests/hero-video-candidate-002.json` 核對 4 個 Hero 衍生檔。既有 Pages／R2 runtime manifests 是舊版交付基線，不是這兩支 V1 腳本的直接輸入。

`node scripts/prepare-assets.mjs` 可在本目錄建立 7 個經 SHA-256 驗證的本機樣本檔；它只寫入本目錄且由本目錄 `.gitignore` 排除的 `public/assets/`，重跑時比對既有檔案，不覆寫不同內容。

### 技術切片的版面盤點

- 第一屏只使用既有首頁 H1、緊接的兩段原文、Logo、四個導覽連結，以及使用者指定的單一「立刻洽詢」。沒有額外 eyebrow、價格、第二個 Messenger CTA 或新的可見文案。
- 既有色彩基線：深綠 `#1a3937`、水灰藍 `#778f91`、岩壁灰 `#eff2ef`、青草綠 `#a1ce95`、黑與白；字型基線為 HarmonyOS Sans TC Regular／Bold。這些是來源 CSS 的值，不代表第一版視覺稿已獲核准。
- 桌機第一屏為固定導覽加滿版 Hero，文字置左；390 px 手機版需讓文字、CTA、導覽操作與 poster 直接可見。原片前數秒已有置中內嵌標題，疊字位置要等候畫面驗收。
- Hero 正常網路可自動播放；`prefers-reduced-motion`、`saveData` 或明顯慢速連線時先顯示 poster，後兩者仍可由使用者主動播放。影片載入失敗時也回到 poster。
- `/spaces` 本機 V1 已呈現 6 間客房的鍵盤可操作 tab 與 10 處公共空間；可見文案由 `reference/spaces-content.json` 對原站 SHA 擷取，保留分段與面板標題。首兩間房使用有 SHA 對照的本機圖片，其他照片暫用 Preview R2。
- `reference/image-alts.json` 的 16 項替代文字依本機 640px 樣本視覺核對，供首頁與空間頁共用。`/404` 依本輪全站繁中方向改為簡短功能文案；原站英文仍保留在 `reference/legacy-slice.json` 供追溯。

## Hero 影片候選（公開 Preview 授權）

使用者已改提供新來源 `assets/Hero_InVillage.mov`；V1 只引用 `assets/manifests/hero-video-candidate-002.json` 對應的完整約 49.6 秒影片與 poster。`node scripts/verify-hero-media.mjs` 在 build 前核對四個選用檔案的 bytes／SHA-256；Preview 分支只追蹤這四個壓縮後的網頁用衍生檔，Vite 將其放入 `dist/`，不覆寫來源或提交原始 MOV。原先 candidate-001 已停用。本機已驗證 390／1440 px 播放、循環、暫停、reduced motion、saveData、autoplay rejection 與 media error 的 poster fallback；手機裁切／影片取景仍待使用者視覺確認。owner 已確認此媒體可用於公開 Preview，實際部署狀態見 `HANDOFF.md`。

## 本機重建與驗證

終端機預設 Node 22.14.0 不符合本 lockfile；請使用 `.node-version` 的 Node 24.19.0 或其他符合 `>=22.19.0` 的版本。公開 Preview 分支只追蹤建置需要的 Hero 壓縮衍生檔、已選用的 `public/assets/` 網頁資產與對應 manifest；原始 MOV、原圖及未選照片仍不進 Git。從本目錄執行 `npm ci`、`npm run build`、`node scripts/verify-v1-dist.mjs` 可檢查並產生六頁 `dist/`。`scripts/prepare-assets.mjs` 仍是共享開發工作區的來源複製工具，不是此 Preview 分支的建置步驟；完整 provenance 交叉核對還需要本機被忽略的原圖／優化 corpus，應在具有這些來源的工作區執行。這些本機命令不會更新 Cloudflare Pages，部署及遠端驗收狀態以 `HANDOFF.md` 為準。

建置後以 Node 24 執行 `node scripts/verify-v1-dist.mjs`；用 `--dist /path/to/dist` 可檢查獨立輸出副本。它只讀六頁、站內連結與本機資產、每個 `<img>` 的 `alt` 屬性（裝飾圖可留空）、同頁重複的 `id`、可見開發佔位文字、本機 `noindex` 和 candidate-002 媒體 SHA；任何不符都以非零狀態結束。Preview R2 圖片只列唯一 URL 數量與來源域名，**不發網路請求**。這支腳本假設 Astro 產生的靜態 HTML 結構，不解析執行後動態新增的連結；通過不代表 `dist/` 與目前 source 同步，也不代表外部圖片、Browser 互動、視覺或 Production 已驗收。`noindex` 檢查只適用本機候選，正式版不可直接沿用。

圖片來源對照存於 `reference/v1-preview-media-provenance.json`。以 Node 24 執行 `node scripts/verify-v1-preview-media-provenance.mjs`，會從目前 `dist/` 的 R2 圖片引用重算用途與重複使用情形、精確比對 Preview 上傳及分類 manifest，並逐檔核對本機 optimized／原圖的 bytes 與 SHA；資料不同即非零退出。`--print` 只在 stdout 印出待審閱的最新 JSON，不寫檔。乾淨 checkout 必須先安全還原被 Git 排除的本機圖片。這份資料不讀取 R2，也不是 Production 圖片位置或快取策略的決定。

P7-G1 的相簿來源集中於 `reference/spaces-gallery.json`：依原 Webflow 16 個 tab 的順序記錄 80 個照片位置，其中 201 房的整棟夜景與 2F 會談室的入口走廊共 2 張標為 `hold`，保留來源但不進畫面。先執行 `node scripts/verify-spaces-gallery-source.mjs`，逐一核對原 HTML 順序、79 張原圖與 258 個優化變體的本機 bytes／SHA、Preview R2 映射；再以 `node scripts/verify-v1-preview-media-provenance.mjs --dist /path/to/isolated-output` 驗證六頁輸出、目前選中相簿的 SSR、全部無 JS fallback、互動 props 和未知 R2 URL 門檻。相簿只渲染目前選中空間、其餘相簿不預下載；GSAP ScrollTrigger 只做進入視窗時的輕量顯現，減少動態及無 JS 時照片直接可見。上述檢查都不連線到 R2，也不代表圖片授權或正式部署通過。

### C5 乾淨 checkout 媒體門檻

以下是 2026-09-23 共享工作區的歷史盤點，並非此 Preview 分支的最終交付狀態。Preview 分支以精確 `git add -f` 追蹤必要的網頁用衍生檔；`dist/`、`node_modules/` 與其他原圖／優化 corpus 仍被 ignore。

| 類別 | 檔數／bytes | 必須確認 |
|---|---:|---|
| 舊站 Pages 的 Logo、favicon、兩款字型原件 | 4／8,212,269 | 已追蹤，按 `legacy-slice.json` SHA 可重建四個 ignored 複本。 |
| B1 Hero 靜態圖與兩張客房樣本圖 | 3／409,204 | `assets/optimized/` 被 ignore；缺少時 `prepare-assets.mjs` 無法重建。 |
| candidate-002 兩支 MP4 與兩張 poster | 4／13,868,165 | `assets/optimized/` 被 ignore；缺少時 `verify-hero-media.mjs`／build 失敗。 |
| 原始 `Hero_InVillage.mov` | 1／62,752,153 | 被 ignore；現成衍生檔的 build 不直接讀它，但重做影片要另行供應。 |
| 現有 Preview R2 內容圖 | 16 個 URL／7,229,999 optimized bytes | 目前 HTML build 只引用 URL；本機來源對照驗證需要這 16 個 ignored 檔。對應 ignored 原圖共 24,309,964 bytes。 |
| MiniMax 內頁圖片候選 | 5／1,509,112 | `public/assets/secondary/` 被 ignore，未選用且現有頁面／`dist/` 未引用；未來 build 後須重新核對，不能算正式用圖。 |

`prepare-assets.mjs` 以四個 tracked 原件及三張 ignored 樣本圖產生七個 ignored `public/assets/` 複本，共 8,621,473 bytes。本機現有 `dist/` 為 23 檔／22,940,646 bytes，最大檔為桌機 Hero 10,332,066 bytes；這是候選圖建立前的 build snapshot，不是下一次部署大小。

可證偽的前置檢查：在 repo 根目錄以 `git ls-files --error-unmatch` 核四個 `legacy-slice.json` 品牌／字型路徑，並以 `git check-ignore -v -- assets/Hero_InVillage.mov assets/optimized/hero-video/candidate-002/hero-desktop.mp4 apps/web/phase-b-spike/public/assets/images/hero-still.jpg` 確認 ignore 規則。媒體經核准供應後，先在本切片跑只讀的 `node scripts/verify-hero-media.mjs`；再由核准的建置流程執行 `prepare-assets.mjs` 並產生新 `dist/`，接著跑 `node scripts/verify-v1-preview-media-provenance.mjs` 與 `node scripts/verify-v1-dist.mjs`。任何缺檔或 SHA 不符都不得發布。Production 是否把選定媒體隨 Pages 輸出，或改用隔離的 Production R2，仍由使用者在 Proposed ADR-0005 中選擇。

### C6 舊站／V1 HTML metadata 對照

以下只讀比對 [舊站 `apps/web/public/`](../public/) 的八頁 HTML 與本機 `dist/` 的六頁 HTML；`無` 表示該 HTML 沒有該欄位，不推論線上 HTTP header 或搜尋引擎索引狀態。新版共用 [SiteLayout](./src/layouts/SiteLayout.astro) 固定輸出本機 `noindex`，description 雖可傳入，六頁目前都未提供。

| Route／來源 | title：舊 → V1 | description：舊 → V1 | robots／canonical：舊 → V1 | OG：舊 → V1 | Twitter：舊 → V1 | `lang`／H1 數：舊 → V1 |
|---|---|---|---|---|---|---|
| `/`：[舊](../public/index.html)／[V1](./dist/index.html) | 首頁長標題 → 同舊 | 有（原文見下）→ 無 | 無／無 → `noindex`／無 | title、description、type=`website` → 無 | card=`summary_large_image`、title、description → 無 | `zh-TW`／1 → `zh-TW`／1 |
| `/spaces`：[舊](../public/spaces.html)／[V1](./dist/spaces.html) | `空間介紹` → 同舊 | 無 → 無 | 無／無 → `noindex`／無 | title=`空間介紹` → 無 | title=`空間介紹` → 無 | `zh-TW`／1 → `zh-TW`／1 |
| `/plan`：[舊](../public/plan.html)／[V1](./dist/plan.html) | `訂房方案` → 同舊 | 無 → 無 | 無／無 → `noindex`／無 | title=`訂房方案` → 無 | title=`訂房方案` → 無 | `zh-TW`／2 → `zh-TW`／1 |
| `/about`：[舊](../public/about.html)／[V1](./dist/about.html) | `關於我們` → 同舊 | 無 → 無 | 無／無 → `noindex`／無 | title=`關於我們` → 無 | title=`關於我們` → 無 | `zh-TW`／2 → `zh-TW`／1 |
| `/contact`：[舊](../public/contact.html)／[V1](./dist/contact.html) | `聯絡我們` → 同舊 | 無 → 無 | 無／無 → `noindex`／無 | title=`聯絡我們` → 無 | title=`聯絡我們` → 無 | `zh-TW`／3 → `zh-TW`／1 |
| `/404`：[舊](../public/404.html)／[V1](./dist/404.html) | `Not Found` → `找不到頁面｜紅河隱園` | 無 → 無 | 無／無 → `noindex`／無 | title=`Not Found` → 無 | 無 → 無 | `zh-TW`／0 → `zh-TW`／1 |
| `/style`：[舊](../public/style.html)／V1 無路由 | `Style` → 無路由 | 無 → 無路由 | 無／無 → 無路由 | title=`Style` → 無路由 | title=`Style` → 無路由 | `zh-TW`／2 → 無路由 |
| `/utilities`：[舊](../public/utilities.html)／V1 無路由 | `Utilities` → 無路由 | 無 → 無路由 | 無／無 → 無路由 | title=`Utilities` → 無路由 | title=`Utilities` → 無路由 | `zh-TW`／0 → 無路由 |

舊首頁完整 title 是「紅河隱園 Invillage｜新北烏來｜團體住宿包棟/企業團建活動/商業攝影場地之首選」；唯一的舊 meta description 是「新北烏來紅河谷智慧莊園 (FB私訊洽詢)，室內200坪、室外1,000坪超大空間。6間特色客房可容納至少22人，配備開放式客廳、中島廚房、多功能會議室、戶外庭院/陽台。距捷運新店站20分鐘，提供包場住宿、團隊活動、會議訓練服務。」此為舊值紀錄，**不是**新版已核准文案。舊版額外 H1：`/plan` 為「體驗當一次莊園的主人」、`/about` 為「淨零排放&智慧科技」、`/contact` 為「服務洽詢」「交通位置」；`/style` 的兩個 H1 是「發現自然之美，感受科技之悅，只在紅河隱園。」與「空間介紹」。新版六頁各有一個 H1。

舊站首頁的 OG／Twitter title 是較短的「紅河隱園 Invillage｜新北烏來」，兩者的 description 均同舊首頁 meta description；其餘有值的 OG／Twitter title 與各頁 `<title>` 相同。舊站與 V1 的 `og:image`、`og:url`、`twitter:image` 都是無。正式發布前，使用者須決定 canonical 網域與索引政策、`/style`／`/utilities` 保留或處置、404 索引方式，以及首頁舊描述／分享欄位是否沿用；不可把本機 `noindex` 直接放到正式站。本輪沒有填入新文案或 canonical。

2026-09-23 19:02 台北時間本機 snapshot 的 focused checks：Node 24.19.0 執行 `node_modules/astro/bin/astro.mjs check` 為 14 files／0 errors／0 warnings／0 hints，`build` 輸出六頁；`curl` 對五個主要 route 回 200、未知路徑回 404；本機 Browser 對五個主要頁在 390／768／1440 px 無水平溢出，且各只有一個 Messenger CTA；本機 headless Chrome 逐頁捲動解碼圖片 37 次核對，0 失敗、0 page／console errors；空間頁 6 tab 的 Home／ArrowRight 鍵盤切換通過。`dist/` 為 ignored generated output，這些都只是當日本機候選證據，不代表 Webflow、Cloudflare Preview 或 Production 通過。

正式站仍有獨立缺口：`/spaces` 與首頁的內容圖片引用 Preview R2；共用 layout 固定 `noindex`，六頁尚無正式 meta description／canonical／OG；次頁的 frozen 文案與方案取捨尚待 owner 審核，Messenger 登入後桌機／手機 App 路徑尚待 owner 實測。公開 Preview 保留這些已標示的試版限制，不得把它當正式網域發布證據。

## 官方依據

- [Astro TypeScript 與檢查](https://docs.astro.build/en/guides/typescript/)、[React integration](https://docs.astro.build/en/guides/integrations-guide/react/)
- [Cloudflare Pages 建置設定](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)、[Standard License](https://gsap.com/standard-license/)
- [npm 發布資訊](https://www.npmjs.com/package/astro)；其他套件版本需在實際安裝前再次核對
