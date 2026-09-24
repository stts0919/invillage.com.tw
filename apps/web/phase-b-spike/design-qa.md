# P7-S2 空間頁設計驗收（本機）

- Source visual truth：`docs/preview/spaces-redesign-2026-09-24/owner-selected-mobile.png`（853×1844 px；使用者選定）。
- 目前實作：`apps/web/phase-b-spike/src/pages/spaces.astro`、`src/components/SpacesExplorer.tsx`、`src/styles/site.css`。
- 主管首輪 390×844 px 截圖保存在本機 Codex 任務的 visualizations，未納入公開 Git。
- 比較基準：原圖以 `sips` 等比例近似縮至 390×844 px，儲於同目錄 `reference-normalized-390.jpg`；均不含裝置外框，CSS viewport 390×844，Browser 截圖 DPR 1。比較狀態為預設「客房／401」。
- Full-view：固定深綠導覽、單張實景、下方深綠資訊區、左右箭頭與水平六房縮圖的構圖方向相符；原圖是合成示意，實作使用真實 401 橫幅照片，因此床與窗無法同時完整呈現，此差異屬素材限制，不得用合成圖替代。
- Focused regions：逐項檢視頂部頁名／分類、主圖裁切與清晰度、下緣房名／預覽文字／箭頭、縮圖列、品牌色與字體。瀏覽器 320／390／768／1440 無水平溢出；390 公共空間切換與鍵盤 End 到第十公共空間成功，console 無 error/warn；實際停用 JS、Safari／真機／慢網仍未測。

## 歷次發現

1. P2／主圖清晰度，已修：首輪 fresh 390×844 DPR 1 主圖槽位 390×641 CSS px，但 `sizes="100vw"` 選 w640；現改為 `(max-width: 48rem) max(54rem, 114svh), 100vw`。主管 Browser fresh 320／390 DPR 1 皆選 w1280、390 DPR 2 選 w1920；同 DPR 1 截圖 `before-repair-390-room.jpg` 與 `after-repair-390-dpr1-room.jpg` 已檢視。照片本身仍受橫幅視角限制，不把來源尺寸改善誇稱成新攝影。
2. P2／手機小字，已修：320px 分類控制由 12→14px、摘要由 14→15px，分類可點擊高度 44px；320 頁名右緣約 94px、分類左緣約 158px，320／390 無水平溢出。主管修後截圖為 `after-repair-320-room.jpg`、`after-repair-390-dpr1-room.jpg`。
3. P2／可見切換箭頭，已修：owner 選圖與桌機延伸圖均為細長直線箭頭、無可見圓框；工程師把兩個圓框按鈕換成細線 SVG。主管 Browser 390×844 驗到按鈕各 44×44px、border 0、透明背景、SVG 36px，點下一張仍切到 room-2；桌機 CSS viewport 1440×900 驗到按鈕 64×52px、SVG 56px。修後截圖見 `after-arrows-390-room.jpg`、`after-arrows-desktop.jpg`。
4. 本機試版已驗／字體：`/spaces` 的房名大標使用官方 Source Han Serif TW 裁字 WOFF2（28,000 bytes），分類與選中縮圖短標使用源石 TC Bold 裁字 WOFF2（13,372 bytes）；Header、長文、首頁與方案仍 HarmonyOS Sans TC。主管獨立核來源與輸出 SHA、字檔主要名稱／OFL／字集、隔離 build／verifier，並在 Browser 320／390／768／1440 驗版面及切換。owner 已接受這組字體方向，並要求 `1F`／`2F` 等樓層前綴後加半形空格；兩份字檔與授權文本目前受 Git ignore 排除，乾淨 checkout 無法供應，亦未做 Safari／真機驗證。不能把 SC 或 justfont 桌面檔接入。
5. 已決／實景裁切：合成參考圖中的完整床景不是現有橫幅照片能提供的視角。P7-S3 已由工程師和主管各自核對原舊站第一個 401 tab pane 的五張照片：現用房圖、同房廣角、IoT 床邊與兩張浴室照，均1920×1280；廣角中心直幅 cover 反而幾乎裁掉床，未找到可證的直式401主圖。owner 已接受現有真實照片的手機裁切；頁面保持現圖，不再等待直式素材。
6. **已取代／慢速照片探索**：owner 原希望手機橫幅實景慢速右移，後明確暫停影片與照片動畫，並改指定 P7-P2「查看完整照片」臨時視窗。P7-P1 暫停前的部分 React／CSS 平移程式未經主管驗收；工程師在新需求內只能精確移除自己的 P7-P1 部分，不得整檔回退其他變更。主管改版前 Browser 基線：390×844 viewport、401 主圖容器390×641.44px、img currentSrc 顯示約962×641、`object-position:25% 50%`、無 animation，螢幕／頁面寬均390px，console0錯；截圖保存在本任務 `p7-p1-supervisor-qa/before-390-room.png`。P7-P1 不再驗收為目標效果。
7. P7-F3 樓層空格已整合：工程師交付七筆 `label`／六筆 `panelHeading` 的單空格與六筆 provenance label 同步，主管獨立核對16筆對照0錯。首頁嚴格查圖仍用舊字串而使初次完整建置失敗，主管只修 `index.astro` 該查圖鍵後，Node24六頁隔離 build、Astro check 與兩項 verifier 通過。
8. P7-P2 全圖視窗本機已驗：手機主畫面四角全圖按鈕取代左右箭頭，modal 圖片 `object-fit:contain`、X／Esc 關閉與焦點回復、同分類前後照片與底下選中同步，桌機換48×48短半透明箭頭。主管 Browser 320／390／768／1440 無溢出、390初始無modal圖預載、開啟／關閉／客房與公共空間循環／桌機切換 console0錯。首輪 dialog 底色90%遮住 blur，主管微調成透明18%，blur支援時 backdrop變46%深色，不支援時維持74%深色；390新截圖可見原頁被柔化，完整照片清晰，改後隔離 build/verifier重過。Safari／真機及全16張遠端圖失敗注入未驗；正式站未動。

## 比較歷程

- Pass 1（本檔建立時）：上述 P2 尚未修；主管已把兩項 focused repair 交工程師。版型方向通過初查，尚未達設計簽收。
- Pass 2：工程師修兩項 P2 後，主管重跑 Node24 build／Astro check、兩項靜態 verifier 全過；Browser 用 fresh 320／390 和 DPR 1／2 驗證主圖候選、字級、無溢出，並走 room-1→room-2→space-1，console 0 error/warn。與 owner 選圖同次比較仍見圓框箭頭漂移；已派第三輪 focused repair，故仍 blocked。
- Pass 3：工程師修箭頭後，主管再次重跑 Node24 build／Astro check（14 檔 0 問題）與兩項 verifier 全過；Browser 390×844 room-1 截圖與正規化 owner 原圖同次檢視，箭頭位置／線形接近且維持具名按鈕與可點擊區；點下一張得 room-2、0 alert／console error/warn。桌機 DOM `innerWidth=1440`、無水平溢出，但 Browser 匯出截圖是 1373×900，不能稱為像素級 1440 對照。版面、原色、單景節奏、縮圖與互動已無新增可修的 P0/P1/P2；字體試版與真實照片裁切仍待 owner／授權及素材決定，因此本整體設計簽收仍 blocked。
- Owner decision：已接受現有真實照片裁切，也已批准只在 `/spaces` 試用自託管開源字體與隔離裁字工具。此決策關閉照片 gate；字體試版交付與驗收結果見 Pass 4。
- Pass 4：P7-F2 字體本機試版已交付，主管獨立 Browser 320／390／768／1440、字檔 name／OFL／cmap 與隔離 build／兩項 verifier 均通過；截圖保存在本任務的 `p7-f2-supervisor-qa/` 視覺驗收目錄。owner 已接受這組字體方向，P7-F3 樓層標示空格已派工程師；仍須決定可重建／可部署的字檔供應方式。Safari 真機未驗，正式站未動。

## P7-G 多圖探索：待實作與驗收

- 已選的主視覺、分類切換、房型縮圖、原文與單一 Messenger CTA 保留。owner 新要求是：點選任一客房（例如 `201 景觀通鋪房`）或公共空間後，在選擇區下方展示**同一空間**可證實的多張實景照；不得混用其他空間、合成示意或 Webflow CDN。此區為既有視覺系統的延伸，不使用生成圖片作正式媒體。
- 版面方向：沿用 forest 背景及 76rem 內容軸，照片不可貼滿 viewport。手機至少保留約 1.25–1.5rem 頁邊，照片間有清楚留白；桌機用節奏有變化的寬圖／雙圖排列，不重複一條等寬卡片列。真實橫向照片盡量以原生比例顯示，不用另一個狹窄直幅裁切。實際數量以 P7-G0 逐空間來源盤點為準，不能為了湊多張重複或冒充。
- 動畫限定 GSAP ScrollTrigger 於照片進入視窗時輕量顯現：位移不超過 24px、淡入約 0.5–0.7s、每張一次；不 pin、不 scrub、不做自動平移或影片處理。`prefers-reduced-motion` 與無 JS 時，照片必須直接可見。選擇變更後正確清理舊 trigger，避免滯留動畫。
- 效能／可用性：只渲染目前選定空間的圖；其他空間的全相簿不預下載；各張使用既有 640／1280／1920 響應圖、合理 `sizes`、延遲載入和實景 alt。全圖視窗的左右鍵在相簿引入後應切換**目前空間照片**，不跨房型；既有桌機主視覺箭頭仍切換空間。所有變更以原始圖／優化圖／Preview R2 manifest 逐檔驗證，source-to-dist verifier 不得降低未知 URL 或錯誤歸屬的檢查。
- P7-H2 先行局部驗收：結尾標題在 1024／1440px 為單行（高度等於一行 line-height），390px 為兩行，無水平溢出；P7-F4 的 201 縮圖與完整標題、主照片載入、390px console0錯亦已驗。相簿導入後需重跑 affected checks，以上舊證據不自動涵蓋新 build。
- P7-G1 首輪主管聚焦驗收（2026-09-24）：同一來源快照的 Node24 Astro check 14檔0問題、隔離六頁 build、dist 與 Preview provenance verifier exit0；Browser 390px 選201得4張正確ID，公共空間1F大廳5張、2F會談室4張，201相簿按第二張開 dialog、下一張仍留201、Esc關閉焦點回原按鈕，console0錯。桌機1440px 圖片有112px左右邊距、40px圖間距且可見寬圖＋雙圖節奏；1024/1440結尾標題單行規則仍在。然而**手機P1未過**：當相簿剛好4張（201、2F會談室）時，桌機 `.spaces-gallery-item:last-child:nth-child(4){grid-column:span 12}` 優先權覆蓋手機單欄規則，導致隱式12欄；390px前3張寬86px、第4張350px，320px前3張僅16px、第4張280px。已把可重現症狀與最小CSS修法交工程師；修後需新隔離 build 和320/390實際畫面重驗。此輪不宣告相簿完成或發布Go。
- P7-G1 手機縮欄修後主管重驗：工程師在手機 CSS 中以同權重覆蓋 `last-child:nth-child(4)`；主管保留修前後不同 source SHA 的證據，修後新隔離六頁 build、dist／Preview provenance verifier exit0。Browser 390px 的201四張各350px、320px四張各280px，兩側均20px、間距24px；2F會談室320px四張也各280px，無水平溢出／console錯。桌機1440px仍有112px左右邊距、40px間距及寬圖＋雙圖排版；單頁唯一Messenger CTA與404零CTA由隔離dist verifier核對。此項P1已關閉，但慢網下重新選當前空間未取消待處理切換的P2競態，以及兩項靜態驗證器對 CSS `url(//unknown.r2.dev/...)` 均誤判PASS 的來源契約缺口已另交工程師；新設計方向若改頁面必須重驗，不把局部PASS當正式發布Go。

## P7-G2 相簿版型試稿（2026-09-24）

- 使用者新指示優先於先前「僅淡入、照片不動」限制：重評相簿排版，使用 GSAP 給照片短暫且小幅的立體浮起感；主視覺、原文與實景照片來源不改。
- 現況實測：舊版 390×844 相簿為五張等寬單欄，1280×720 首張重複主視覺且佔 1152×768；此為本輪組版問題，而非照片來源錯誤。
- 本機試稿截圖：`docs/preview/spaces-redesign-2026-09-24/gallery-v1-mobile.png`（390×844 CSS px／PNG px、DPR 1，201 四張相簿）、`gallery-v1-desktop.png`（1280×720 CSS px／PNG px、瀏覽器 DPR 2 但截圖輸出已按 CSS px 正規化，401 五張相簿）。兩張均未後製或合成。手機與桌機是**不同房型狀態**，不做彼此像素級比較。
- 試稿變更：桌機 7／5 → 5／7 欄鏡射，第五張置中；手機全寬與 90% 寬左右錯位；照片保留原比例，以 6px stone 裝裱、微圓角及水灰色 8px 實色背板建立厚度。原 Stage、主圖裁切、文案、R2 圖片排序、Modal 控制及唯一 Messenger CTA 未重設計。
- GSAP：原 ScrollTrigger 一次性淡入保留；新浮起效果只作用於內層框，滑鼠與鍵盤焦點約上移 5px／前移 10px／旋轉不超過 0.8°，離開後復位；不做無限動畫或觸控 hover。`prefers-reduced-motion` 靜止及切換清理已在程式中處理，實機切換仍未測。
- 本輪 Browser 證據：390px 四張相簿寬 315／350／315／350px，頁面寬 390px；1280px 首兩張約 656／458px，滑鼠 hover 為 3D transform、離開回 identity，鍵盤焦點有可見 outline 與同樣浮起；選 201 第二張開 Modal、Escape 關閉後焦點回照片按鈕。六頁隔離 build、Astro check 14 檔 0 問題、兩項 dist／provenance verifier 於此試稿通過。
- 五項保真面：字體與文案未修改；間距／排列為本輪試稿；色彩只沿用已存在 forest／stone／water；照片仍為來源驗證過的 R2 真實橫圖並保留比例；文字內容及 CTA 未新增／改寫。此為**試稿自查**，不是與新設計稿的正式比對。
- 設計 QA 缺口：目前尚無使用者選定的**相簿**來源視覺稿；既有 `owner-selected-mobile.png` 只定義主視覺，不能拿來聲稱新相簿吻合。Open Design 尚未安裝連線，官方下載頁已依使用者同意開啟；未執行生成，也沒有雲端費用。待相簿來源稿、同狀態截圖、320／768px 與 reduced-motion 實測後才能作正式 design-qa；正式站、Safari／真機仍未驗。

## P7-G3 競態與來源驗證聚焦修復（2026-09-25）

- 受控解碼測試頁只在本機攔住 402 的 `decode()`：修前點 402、再點目前的 401，放行舊請求後錯誤切到 402 且中途持續顯示載入中；修後重選 401 時載入狀態立即清除，放行舊請求仍留 401、無 alert，下一次正常點 402 可成功切換。測試用注入器與服務不屬網站 source／dist。
- 精確隔離輸出負例：CSS `url(//unknown.r2.dev/unmapped.jpg)` 修前兩驗證器都 exit 0；修後均 exit 1。另一份 HTML 負例 `src="//unknown.r2.dev/unmapped.jpg"` 及 entity 編碼的 `&#47;&#47;` 形式也使兩驗證器 exit 1。正常六頁隔離輸出仍使兩驗證器 exit 0；未降低既有 URL、SHA、alt 與歸屬檢查。
- 新建置 Browser：320px 的 201 四張相簿寬 252／280／252／280px、768px 為 655／728／655／728px；兩者 document/body 寬均與 viewport 相同、單頁唯一 Messenger CTA，照片懶載入後可見，console 無 error／warn；404 頁有標題與回首頁連結。截圖為本輪視覺證據目錄 `p7g3-320.png`、`p7g3-768.png`，不是新設計來源稿。
- Reduced motion：程式使用 `gsap.matchMedia('(prefers-reduced-motion: no-preference)')`，CSS 的 reduce 分支強制照片可見且無 transform；本輪瀏覽器無媒體偏好覆寫能力，**未完成 reduce 模式實際執行／切換測試**。相簿設計仍待 owner 視覺稿及簽收，`final result` 維持 blocked；本機修復不代表發布 Go。

## P7-G4 相簿邊角、介紹與結尾 CTA 回修（2026-09-25）

- 來源：owner 指出 `p7g3-768.png` 的相簿邊角太圓，並要求手機才折疊「完整介紹」、桌機直接顯示，結尾 CTA 標題用宋體且收掉上方過量留白。只改 `SpacesExplorer.tsx` 和 `site.css`；照片、原文、路由及 CTA 連結不變。
- 768px 同狀態對照：相簿石色裝裱由 6px 收至 4px，外框／背板圓角由約 7px 收至 2px，照片本身變為方角；新截圖為本任務視覺證據 `p7g4-768-gallery.png`。舊截圖只作問題參照，不拿它當必須逐像素複製的設計稿。
- 手機 ≤768px：`<details>` 預設關閉、摘要旁為「＋」，點擊／Enter 可展開為「－」且再點可關；390px 截圖 `p7g4-390-details.png`。桌機 >768px 隱藏折疊控制、直接顯示同一段原文；切換 401→402 時內容同步更新。兩份標記依媒體查詢互斥，未新增可見文案。
- 結尾：使用既有 `Invillage Editorial Pilot` 宋體試版，不引入新字檔；Intro 與 CTA 改為連續石色區塊並用細線分隔，手機標題平衡成「預訂紅河隱園／一日莊園主人」兩行、桌機維持單行。原文結束到標題的間距，390px 由約 128px 降為 49px，1280px 由約 195px 降為 78px。截圖 `p7g4-390-cta.png`、`p7g4-1280-cta.png`；Browser `document.fonts.check` 通過，但本輪未獨立重讀字檔 glyph cmap。
- 新隔離六頁 build、Astro check 14檔0問題、兩項 dist／provenance verifier 均 exit0；Browser 320／390／768／1024／1280px 無水平溢出，390px disclosure、1024／1280px CTA 單行、桌機直接介紹及404可用，console error／warn 0。這是工程師本機證據，仍待主管獨立驗收；Safari／真機、reduce 模式實際切換與 owner 最終視覺簽收未完成，沒有 Preview／Production 發布證據。

## P7-G4b 結尾宋體字形補齊（2026-09-25）

- 主管指出 G4 的結尾標題有 10 字不在原 `Invillage Editorial Pilot` WOFF2 子集；工程師用 fontTools `getBestCmap()` 獨立確認舊字檔確實缺「預、訂、紅、河、隱、一、日、莊、主、人」，不能以 CSS `font-family` 或 Browser `document.fonts.check()` 代替字形驗證。
- `build-font-pilot.py` 現從實際 `spaces.astro` 的 `spaces-contact-heading` 擷取固定標題，並支援 `--only editorial` 聚焦重建；`font-pilot.json` 同步記錄 159 字／新 character SHA。Adobe TW 原檔及兩份 OFL 的來源 SHA 不變，源石 TC 站用子集仍為原 13,372 bytes／SHA `a1dc6055...`，HarmonyOS 正文與其他頁不變。
- 新宋體 optimized／public／隔離 dist 三份均為 29,900 bytes、SHA-256 `4efb33c3045bf2beda72e13a83a58ae4c4865a307ce34f9bafb1f2837b9dc397`；fontTools 讀回完整標題缺字 0、cmap 159、靜態 700、WOFF2、完整 OFL nameID13。舊的兩份產物只移至本機暫存備份，未覆寫原始字型；原站無新增 dependency。
- 新隔離六頁 build、Node24 Astro check14檔0問題、Hero媒體及兩項 dist／Preview provenance verifier exit0。Browser 390px 標題仍平衡兩行、1280px 仍單行，頁寬無溢出、console error／warn 0；前後對照截圖在本任務視覺證據目錄 `p7g4-390-cta.png` → `p7g4b-390-font.png`，桌機新截圖 `p7g4b-1280-font.png`。這只補字形，不取代 owner／主管的 Preview 簽收、乾淨 checkout 字檔供應或 Safari／真機檢查。

final result: blocked
