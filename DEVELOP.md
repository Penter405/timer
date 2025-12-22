# Developer Guide (開發者文件) 🛠️

這份文件記錄了 **Rubik's Cube Timer** 的技術架構與設計決策。

---

## 🏗️ 系統架構

```
┌─────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│  Frontend   │────▶│  Vercel Serverless  │────▶│      MongoDB         │
│  (GitHub    │     │  Functions (/api)   │     │  (用戶 + 暫存成績)   │
│   Pages)    │     └─────────────────────┘     └──────────────────────┘
└─────────────┘              │                          │
                             │                          │
                             ▼                          │
                      ┌─────────────┐                   │
                      │ cron-job.org│───────────────────┘
                      │ (每5分鐘)   │
                      └──────┬──────┘
                             │
                             ▼
                      ┌──────────────────────┐
                      │   Google Sheets      │
                      │   (公開排行榜)       │
                      └──────────────────────┘
```

### 技術棧

| 層級 | 技術 |
|------|------|
| Frontend | Vanilla HTML/CSS/JS (SPA 架構) |
| Backend | Vercel Serverless Functions |
| Database | MongoDB Atlas (用戶資料) + Google Sheets (排行榜) |
| Auth | Google Sign-In (OAuth 2.0) |
| Cron | cron-job.org (外部定時任務) |

---

## 🗄️ 資料庫架構

### MongoDB 集合

| 集合名稱 | 用途 | 結構 |
|---------|------|------|
| `users` | 用戶資料 | `{ email, userID, nickname, createdAt }` |
| `counts` | 暱稱計數器 | `{ _id: "Penter", count: 5 }` |
| `total` | 全局計數器 | `{ _id: "userID", count: 100 }` |
| `scores` | 所有成績 | `{ userID, time, scramble, date, timestamp, syncStatus }` |
| `scores_unique` | 每用戶每時段最佳 | `{ userID, period, time, scramble, date, syncStatus }` |

### Google Sheets 結構

| 分頁名稱 | 用途 | 存取權限 |
|---------|------|---------|
| `ScoreBoard` | 所有成績記錄 | **公開讀取** |
| `ScoreBoardUnique` | 每用戶最佳成績 | **公開讀取** |
| `FrontEndScoreBoard` | 前端顯示用 (含暱稱) | **公開讀取** |
| `FrontEndScoreBoardUnique` | 前端顯示用 (含暱稱) | **公開讀取** |
| `Total` | UserID → Nickname 映射 | 私密 |

### ScoreBoard 欄位結構 (每時段 6 欄)

| 時間段 | 欄位範圍 |
|--------|---------|
| 歷史 (all) | A-F |
| 本年 (year) | G-L |
| 本月 (month) | M-R |
| 本周 (week) | S-X |
| 本日 (today) | Y-AD |

每組欄位格式：`UserID | Time(秒) | Scramble | Date | Timestamp | Status`

---

## 🔌 API 端點

### `/api/save_time` (POST)
儲存成績到 MongoDB。同時更新兩個集合：

- `scores` - 插入新成績（所有記錄）
- `scores_unique` - 原子更新每用戶每時段最佳成績（使用 `$min`）

```javascript
// Headers: Authorization: Bearer {Google ID Token}
// Request Body
{
  "time": 12345,        // 毫秒
  "scramble": "R U R' U'",
  "date": "2024-01-01T00:00:00Z"
}
```

### `/api/update_nickname` (POST)
註冊/更新用戶暱稱。

```javascript
// Request Body
{
  "token": "Google ID Token",
  "nickname": "Penter"   // 空字串 = 僅同步現有資料
}

// Response
{
  "userID": 1,
  "uniqueName": "Penter#1",
  "isNewUser": false
}
```

### `/api/sync_scores` (POST)
從 MongoDB 同步到 Google Sheets。

**由 cron-job.org 每 5 分鐘呼叫**

流程：
1. 從 MongoDB `scores` 讀取 pending → 寫入 `ScoreBoard`
2. 從 MongoDB `scores_unique` 讀取 → 寫入 `ScoreBoardUnique`
3. 加入暱稱 → 寫入 `FrontEndScoreBoard` + `FrontEndScoreBoardUnique`
4. 更新 syncStatus 為 'synced'

### `/api/get_nicknames` (POST)
批次查詢 UserID → Nickname 映射。

```javascript
// Request
{ "ids": ["1", "2", "3"] }

// Response
{ "1": "Penter#1", "2": null, "3": "Speed#2" }
```

---

## 📁 檔案結構

```
timer/
├── index.html          # 主頁面
├── style.css           # 樣式
├── script.js           # 核心計時邏輯
├── js/
│   ├── router.js       # SPA 頁面切換
│   ├── connect.js      # Google Auth、API 呼叫
│   └── scoreboard.js   # 排行榜邏輯
├── docs/
│   ├── vercel.json     # Vercel 設定
│   ├── api/
│   │   ├── save_time.js
│   │   ├── update_nickname.js
│   │   ├── sync_scores.js
│   │   ├── get_nicknames.js
│   │   └── sheetsClient.js
│   └── lib/
│       ├── apiUtils.js
│       └── mongoClient.js
└── documentation/      # 設計文件
```

---

## ⚙️ 環境變數

### Vercel 設定

```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_SHEET_ID=xxx
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
MONGODB_URI=mongodb+srv://[SCRUBBED]
```

---

## 🔄 外部定時任務 (cron-job.org)

| 任務名稱 | URL | 頻率 |
|---------|-----|------|
| Timer Sync Scores | `https://timer-neon-two.vercel.app/api/sync_scores` | 每 5 分鐘 |

### 設定項目

- **Request Method**: POST
- **Enable job**: ✅
- **Save responses in job history**: ✅
- **Notify after failure**: ✅ (1 failure)
- **Disabled after too many failures**: ✅

---

## 🚀 部署流程

### 前端 (GitHub Pages)
```bash
git push origin main  # 自動部署
```

### 後端 (Vercel)
```bash
git push origin main  # 自動部署
```

### 手動同步
```bash
curl -X POST https://timer-neon-two.vercel.app/api/sync_scores
```

---

## 🔐 安全設計

| 資料 | 公開性 |
|------|--------|
| ScoreBoard / FrontEnd 系列 | ✅ 公開 (gviz API 可讀) |
| MongoDB 用戶資料 | ❌ 私密 |
| Google Service Account | ❌ 私密 (Vercel 環境變數) |

### 認證流程
1. 用戶 Google 登入 → 取得 ID Token
2. 前端呼叫 API → `Authorization: Bearer {token}`
3. 後端驗證 Token → 取得 email
4. 用 email 查詢 MongoDB → 取得 UserID
