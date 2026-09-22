# Webflow／Preview 一致性核對表

| 欄位 | 內容 |
|---|---|
| 階段 | 6 — 一致性門檻 |
| 狀態 | Technical pass；Owner visual review pending |
| 日期 | 2026-09-22 |
| Webflow | `https://www.invillage.com.tw` |
| Preview | `https://a66628b4.invillage-com-tw.pages.dev` |
| Viewports | 1440×900、768×1024、390×844 |

## 驗收原則

- P0：PII 外傳、假成功、錯誤 bucket／環境、主要 route 或 critical asset 不可用。
- P1：Preview-only 跑版、文案／連結／互動差異、可見破圖、console blocker、forbidden network request。
- Webflow 與 Preview 共同存在的既有問題記為 debt，不算 migration regression。
- 截圖 SSIM 只作診斷；image-heavy slider 另以相同 active slide、DOM geometry 與人工 side-by-side 裁決。

## 核准的差異白名單

| 類別 | 核准差異 |
|---|---|
| Assets | Webflow CDN URL 改為 Pages 相對路徑或 Preview R2 content-hash URL；`srcset` 改為核准 fallback variants |
| Form | Preview contact form `preventDefault`／`stopImmediatePropagation`，顯示 failure、不顯示 success、不傳資料 |
| SEO | Preview 200 responses 使用 `X-Robots-Tag: noindex` |
| Routing | `/about/`：Webflow 301、Pages 308；兩者都導向 `/about` 且 canonical route 200 |
| Vendor JS | 本機 Webflow bundle 可保留 dormant URL 字串；實際 forbidden request 仍為 blocker |
| Markup | 移除 Webflow CDN preconnect；local CSS／JS 移除舊 SRI／crossorigin；contact 只新增 form guard |

## 技術比對結果

- 正式 Webflow 8／8 HTML 的 bytes 與 SHA-256 仍等於 Phase 2 immutable import。
- 8 routes × 3 viewports = 24 pairs：visible copy、title、description、headings、links、element counts、font、body class、`data-wf-page` 全部相同。
- Matched viewport `scrollHeight` 最大差異 2 px；除 `/style` 既有 debt 外，兩站均無水平 overflow。
- Live／Preview 的 room tab、slider next、FAQ、mobile menu state transitions 完全相同；console issues 0。
- 24 screenshot pairs：median SSIM 0.996186；18 pairs ≥ 0.98；6 pairs = 1.0。低分 pair 均為 optimized image pixels／slider capture，人工檢視未見 layout 或 copy 差異。
- Static diff：8／8 generator-equivalence；shared CSS、12 JS、24 Pages assets checksum 通過；P0／P1 0。

## Route × viewport matrix

| Route | 1440×900 | 768×1024 | 390×844 | Height delta（D／T／M） | 重點 |
|---|---|---|---|---:|---|
| `/` | Pass | Pass | Pass | 0／0／-1 px | hero、slider、nav、CTA |
| `/about` | Pass | Pass | Pass | 0／0／-1 px | sections、location slider、links |
| `/spaces` | Pass | Pass | Pass | -1／+2／-1 px | 2 tab sets、16 sliders |
| `/plan` | Pass | Pass | Pass | 0／+1／0 px | plan anchors、6 sliders |
| `/contact` | Pass | Pass | Pass | 0／0／0 px | fields、Maps、6 FAQ、form guard |
| `/style` | Pass with shared debt | Pass with shared debt | Pass with shared debt | 0／+1／0 px | slider、typography；tablet/mobile overflow 兩站共同存在 |
| `/utilities` | Pass | Pass | Pass | 0／0／0 px | YouTube no-cookie、animation |
| `/404` | Pass | Pass | Pass | 0／0／0 px | `/404` 200；unknown path 404 |

## Screenshot diagnostics

| Route／viewport | SSIM | 判定 |
|---|---:|---|
| `/style` tablet | 0.906782 | optimized hero pixels；DOM／geometry／copy exact，人工 side-by-side pass |
| `/` tablet | 0.949513 | optimized hero pixels；active slide 0、layout exact |
| `/style` desktop | 0.959616 | optimized hero pixels；layout exact |
| `/contact` mobile | 0.965291 | content image encoding variance；layout exact |
| `/` desktop | 0.973545 | optimized hero pixels；active slide 0、layout exact |
| `/style` mobile | 0.979860 | optimized hero pixels；layout exact |
| 其餘 18 pairs | ≥ 0.98 | Pass |

截圖、side-by-side 與 diff artifacts 保存在本輪 task-local 暫存目錄，不納入 Git。

## 既有 debt（不阻塞 Phase 6）

- `/style` 在 tablet／mobile 有水平 overflow；Webflow 與 Preview 都存在且 geometry相同。
- 既有圖片多數 `alt=""`，Maps／YouTube iframe title 不完整；延後 Phase 9。
- Preview form 刻意 fail-closed；正式表單後端需另行核准 Worker／Resend 方案。
- Image encoding 為階段 3 已核准的輕量化輸出，不要求 pixel-identical bytes。

## Owner review

- [ ] 開啟 unique Preview，抽查 desktop／tablet／mobile。
- [ ] 確認 image encoding variance 可接受。
- [ ] 確認 `/style` 共同 overflow 作為既有 debt 延後處理。
- [ ] 確認可進入階段 7 更新計畫；未確認前不重新設計。
