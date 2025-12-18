# Developer Guide (Technical Architecture) 🛠️

這份文件記錄了 **Rubik's Cube Timer** 的技術架構與設計決策。

---

## 🏗️ 系統架構 Overview

```
┌─────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│  Frontend   │────▶│  Vercel Serverless  │────▶│   Google Sheets      │
│  (GitHub    │     │  Functions (/api)   │     │   (Database)         │
│   Pages)    │     └─────────────────────┘     └──────────────────────┘
└─────────────┘              │                          │
       │                     │                          │
       │                     ▼                          ▼
       │              ┌─────────────┐            ┌──────────────┐
       └─────────────▶│ Google Apps │───────────▶│   Counts     │
         (GAS呼叫)    │   Script    │            │   (nickname) │
                      └─────────────┘            └──────────────┘
```

- **Frontend**: Vanilla HTML/CSS/JS (SPA 架構，無框架)
- **Backend**: Vercel Serverless Functions (`/docs/api`)
- **Database**: Google Sheets (5 個分頁)
- **GAS**: Google Apps Script (nickname 計數 + 定時清理)

---

## 📊 Google Sheets 結構

### 分頁列表

| 分頁名稱 | 用途 | 存取權限 |
|---------|------|---------|
| `Total` | 用戶註冊表 (Email → UserID) | 私密 |
| `UserMap` | Email/UserID/Nickname 映射 (Hash Table) | 私密 |
| `Counts` | Nickname 計數器 (Hash Table) | 私密 |
| `ScoreBoard` | 所有成績記錄 (可多筆/人) | **公開讀取** |
| `ScoreBoardUnique` | 個人最佳成績 (每人每時段1筆) | **公開讀取** |

### ScoreBoard / ScoreBoardUnique 結構

每個分頁有 **5 個時間段**，每段 6 欄：
UTC +8
| 時間段 | 欄位範圍 | 清理時間 |
|--------|---------|---------|
| 歷史 (all) | A-F | 永不清理 |
| 本年 (year) | G-L | 每年 1/1 00:00 |
| 本月 (month) | M-R | 每月 1 號 00:00 |
| 本周 (week) | S-X | 每週一 00:00 |
| 本日 (today) | Y-AD | 每天 00:00 |

每組 6 欄格式：
```
| UserID | Time(秒) | Scramble | Date | Time(時間) | Status |
```

### UserMap 結構 (Hash Table)

- **8 個 buckets**，每 bucket 3 欄
- 欄位：`[Email, UserID, Nickname#Number]`
- Hash: `bucketIndex = hash(email) % 8`

---

## 🔌 API 端點

### `/api/save_time` (POST)
儲存成績到 ScoreBoard 和 ScoreBoardUnique。

**安全特性**:
- UserID 從 UserMap 查詢，**不信任前端傳入**
- 自動註冊未存在的用戶

**功能**:
- 同時寫入 5 個時間段
- 1000 row 限制（超過則替換最慢成績）
- ScoreBoardUnique 只保留個人最佳

```javascript
// Request
{
  "time": 12345,      // 毫秒
  "scramble": "R U R' U'",
  "date": "2024-01-01T00:00:00Z"
}
// Headers: Authorization: Bearer {Google ID Token}
```

### `/api/update_nickname` (POST)
註冊/更新用戶暱稱。

**流程**:
1. Vercel 驗證 JWT Token
2. 呼叫 GAS 取得 name_number
3. 更新 UserMap

```javascript
// Request
{
  "token": "Google ID Token",
  "nickname": "Penter"  // 空字串 = 僅同步
}
```

### `/api/get_nicknames` (POST)
批次查詢 UserID → Nickname 映射。

```javascript
// Request
{ "ids": ["1", "2", "3"] }

// Response
{ "1": "Penter#1", "2": null, "3": "Speed#2" }
```

---

## 📁 關鍵檔案

### Frontend (`/js`)

| 檔案 | 功能 |
|------|------|
| `script.js` | 核心計時邏輯、WCA 狀態機 (Idle/Inspect/Ready/Running) |
| `router.js` | SPA 頁面切換、導覽列狀態 |
| `connect.js` | Google Auth、API 呼叫封裝、自動 UserID 同步 |
| `scoreboard.js` | 排行榜讀取與渲染、時間段/唯一模式篩選 |

### Backend (`/docs/api`)

| 檔案 | 功能 |
|------|------|
| `save_time.js` | 成績儲存 (多時間段 + 1000 row 限制) |
| `update_nickname.js` | 暱稱註冊/更新 (呼叫 GAS) |
| `get_nicknames.js` | UserID → Nickname 批次查詢 |
| `sheetsClient.js` | Google Sheets API 客戶端 |

### Shared (`/docs/lib`)

| 檔案 | 功能 |
|------|------|
| `apiUtils.js` | CORS、JWT 驗證、通用工具函數 |

### GAS (`documentation/CountsGAS.gs`)

| 函數 | 功能 |
|------|------|
| `doPost()` | Web App 入口 (name_number 分配) |
| `setupTriggers()` | 初始化定時清理觸發器 (冪等) |
| `cleanupToday/Week/Month/Year()` | 各時間段清理函數 |

---

## 🔐 安全設計

### 認證流程

```
1. 用戶 Google 登入 → 取得 ID Token
2. 前端呼叫 API → Authorization: Bearer {token}
3. 後端驗證 Token → 取得 email (來自 Google，安全)
4. 用 email 查詢 UserMap → 取得 UserID (後端控制，安全)
```

### 資料隔離

| 資料 | 公開性 |
|------|--------|
| ScoreBoard (成績) | ✅ 公開 (gviz API 可讀) |
| UserMap (Email/ID 映射) | ❌ 私密 (需 Service Account) |
| Service Account 金鑰 | ❌ 私密 (Vercel 環境變數) |

---

## ⚙️ 環境變數

### Vercel 設定

```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_SHEET_ID=xxx
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
GAS_WEB_APP_URL=https://script.google.com/macros/s/xxx/exec
GAS_SECRET_KEY=[SCRUBBED]
```

---

## 🚀 部署流程

### 前端
```bash
git push origin main  # 自動部署到 GitHub Pages
```

### 後端
```bash
git push origin main  # 自動部署到 Vercel
```

### GAS (手動)
1. 複製 `CountsGAS.gs` 內容到 Google Apps Script
2. 執行 `setupTriggers()` 初始化定時器
3. 部署為 Web App (設定執行身分)

---

## 🔮 未來規劃

### 雙 Database 架構

| Database | 存放內容 |
|----------|---------|
| **MongoDB** | UserMap, Total, Counts (私密資料) |
| **Google Sheets** | ScoreBoard (公開排行榜) |

優點：
- 隱藏用戶 Email
- 提升查詢效能
- 更好的擴展性
