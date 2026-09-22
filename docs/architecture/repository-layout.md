# 專案結構

| 欄位 | 內容 |
|---|---|
| 狀態 | 已核准 |
| 原則 | 英文路徑、中文內容、未使用的模組不先建立 |

## 結構

`[近期]` 表示核准後建立；`[後續]` 表示有真實需求時才建立。

~~~text
invillage.com.tw/
├── README.md                              [近期] 人類入口
├── AGENTS.md                              [現有] Codex 主管規則
├── AGENTS.sub.md                          [現有] 子代理規則
├── HANDOFF.md                             [現有] 現況與下一步
├── .gitignore                             [Git 階段]
├── .editorconfig                          [Git 階段]
│
├── apps/
│   ├── web/                               [近期] Cloudflare Pages 前端
│   │   ├── public/
│   │   │   ├── index.html
│   │   │   ├── about/
│   │   │   ├── spaces/
│   │   │   ├── plan/
│   │   │   ├── contact/
│   │   │   ├── css/
│   │   │   ├── js/
│   │   │   └── assets/
│   │   │       ├── brand/
│   │   │       ├── fonts/
│   │   │       └── icons/
│   │   └── README.md
│   │
│   └── api/                               [後續] Cloudflare Worker API
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   └── integrations/
│       │       ├── line/
│       │       ├── messenger/
│       │       └── resend/
│       ├── migrations/                    D1 migrations
│       ├── tests/
│       ├── wrangler.jsonc
│       └── README.md
│
├── imports/
│   └── webflow/                           [近期] 不可變遷移來源
│       ├── site/
│       │   ├── html/
│       │   ├── css/
│       │   └── js/
│       ├── assets/
│       │   ├── images/
│       │   └── fonts/
│       ├── manifests/
│       └── README.md
│
├── assets/
│   ├── optimized/                         [近期] 可重建，預設不進 Git
│   ├── manifests/                         [近期] 轉檔與 R2 mapping
│   └── README.md
│
├── docs/
│   ├── README.md
│   ├── architecture/
│   ├── migration/
│   ├── operations/
│   ├── integrations/
│   ├── collaboration/
│   └── records/
│
├── scripts/
│   ├── README.md
│   ├── assets/
│   ├── migration/
│   ├── verification/
│   └── deployment/                        [後續]
│
└── tests/
│   ├── parity/
│   └── smoke/
~~~

不先建立：

- `packages/`：等真正出現跨 app 共用程式碼。
- `apps/api/`：等第一個後端功能。
- D1 migrations：等資料模型核准。
- Provider integration folder：等對應功能開始。

## 路徑責任

| 路徑 | 責任 |
|---|---|
| `apps/web/` | 可部署前端，不放原始 Webflow 封存檔 |
| `apps/api/` | 未來 Worker API、D1 與 provider integration |
| `imports/webflow/` | 原始 Webflow 來源，只讀保存 |
| `assets/optimized/` | 可重建的圖片產物 |
| `assets/manifests/` | 原圖、輸出、R2 key 與 checksum 對照 |
| `docs/` | 長期文件與索引 |
| `scripts/` | 可重跑工具，不放一次性 command dump |
| `tests/parity/` | 原站與 Preview 一致性 |
| `tests/smoke/` | 路由、資產、404 與基本可用性 |

## 現有檔案搬遷對照

此表只供下一輪使用，本輪不搬檔。

| 現有路徑 | 提議路徑 | 處理 |
|---|---|---|
| `webflow-export/images/original/` | `imports/webflow/assets/images/` | 保留 ID，不改內容 |
| Manifest 中 6 個 TTF | `imports/webflow/assets/fonts/` | 先下載並核對 checksum |
| `webflow-export/manifests/` | `imports/webflow/manifests/` | 合併並保留來源欄位 |
| 未來 HTML／CSS／JS | `imports/webflow/site/` | 原樣保存 |
| 輕量化輸出 | `assets/optimized/` | 不覆寫原圖 |
| 轉檔與 R2 mapping | `assets/manifests/` | 進 Git |
| 部署用檔案 | `apps/web/public/` | 從 import 整理 |
| Brand／font／icon | `apps/web/public/assets/` | 跟前端部署 |
| 內容照片 | R2 | 由 manifest 管理 key 與 URL |

## 命名

- 資料夾與一般檔名使用英文小寫 kebab-case。
- `README.md`、`AGENTS.md`、`AGENTS.sub.md`、`HANDOFF.md` 保留標準大寫。
- Webflow 原檔保留 asset ID，以便回查。
- Production media key 提議使用 `media/<category>/<asset-id>-<short-hash>.<ext>`。
- 不在同一輪同時搬檔、改名與轉檔。
