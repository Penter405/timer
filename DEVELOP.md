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
                      │ (每1分鐘)   │
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

| 集合名稱 | 用途 | 結構 | 注意事項 |
|---------|------|------|----------|
| `users` | 用戶資料 | `{ email, userID, nickname }` | |
| `counts` | 暱稱計數器 | `{ _id: "Penter", count: 5 }` | 生成 Penter#5 用 |
| `total` | 全局計數器 + Flags | `{ _id: "userID", count: 100 }`<br>`{ _id: "syncFlags", nicknameUpdate: 1 }` | `syncFlags` 用於觸發名稱更新 |
| `scores` | **暫存**成績 | `{ userID, time, scramble, date }` | **Sync 後會自動刪除** |

> **Single Collection 架構**: 系統不再維護 `scores_unique` 集合。所有排行榜邏輯皆在 Sync 階段即時計算。

### Google Sheets 結構

⚠️ **所有資料皆從第 1 列 (Row 1) 開始寫入，會覆蓋原有 Header。**
⚠️ **所有數據強制儲存為文字格式 (String)。**

| 分頁名稱 | 用途 | 邏輯 | 資料來源 |
|---------|------|------|---------|
| `ScoreBoard` | 歷史記錄 | **Top 1000 Solves** (按時間排序) | MongoDB `scores` + 累計 |
| `FrontEndScoreBoard` | 前端顯示 (暱稱) | 同上 (ID 替換為 Nickname) | **複製自 `ScoreBoard`** |
| `ScoreBoardUnique` | 排行榜 | **Top 1000 Users** (每人最佳) | 讀取 Sheet -> 合併 -> 排序 |
| `FrontEndScoreBoardUnique` | 前端排行榜 (暱稱) | 同上 (ID 替換為 Nickname) | **複製自 `ScoreBoardUnique`** |

---

## 🔌 API 端點

### `/api/save_time` (POST)
儲存成績到 MongoDB `scores` 集合 (作為 Pending Data)。

### `/api/update_nickname` (POST)
1. 更新用戶暱稱。
2. **Flagging**: 設定 `total.syncFlags.nicknameUpdate = 1`。這會通知 Sync Script 下次執行時需要刷新 Frontend Sheet。

### `/api/sync_scores` (POST)
**Smart Sync Logic** (由 cron-job 每 1 分鐘觸發)

1. **Check**: 檢查 MongoDB 是否有 `pendingScores > 0` 或 `nicknameUpdate == 1`。
2. **Short Circuit**: 若兩者皆無，**立即結束** (節省 API Quota)。
3. **Triggered**:
    - **New Solve**: 執行完整 Sync (讀取 -> 合併 -> 排序 Top 1000 -> 寫入 Backend -> 複製到 Frontend -> 刪除 MongoDB Data)。
    - **New Name Only**: 僅刷新 Frontend Sheets (讀取 Backend -> 換名 -> 寫入 Frontend -> Reset Flag)。

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

## ☁️ Deployments

### Active Deployments (as seen in GitHub)
| Name | Platform | Description |
|------|----------|-------------|
| **github-pages** | GitHub Pages | Frontend (static assets) |
| **Production** | Vercel | Backend (API) - Main Branch |
| **Preview** | Vercel | Backend (API) - Pull Requests/Branches |

### Deployment Methods
- **Frontend**: Source code pushed to `main` branch. GitHub Pages is configured to serve from root.
- **Backend**: Vercel connected to `main` branch.
    - **Production**: Updates automatically on push to `main`.
    - **Preview**: Updates on pull requests or non-main branches.
- **Cron**: External service (`cron-job.org`) hits `/api/sync_scores` **every 1 minute**.

## 🔐 安全設計

| 資料 | 公開性 |
|------|--------|
| MongoDB | ❌ 私密 |
| Google Sheets (Backend) | ❌ 建議隱藏 (僅 ID) |
| Google Sheets (Frontend) | ✅ 公開 (含暱稱) |

---
*文件更新日期: 2025-12-25*
