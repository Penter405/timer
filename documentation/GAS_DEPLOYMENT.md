# Google Apps Script 部署指南

## 前置條件

- 確保 Google Sheets 有 `Counts` 分頁
- 確保有 Google Cloud 專案並啟用 Google Sheets API

## 部署步驟

### 1. 準備 Google Sheets

在 Google Sheets 中創建 `Counts` 分頁：

**Row 1 (標頭列)**：
```
| team0_name | team0_count | team1_name | team1_count | ... | team12_name | team12_count |
```

共 13 個 team (TEAM_COUNT = 13)，每個 team 占 2 欄。

### 2. 創建 Google Apps Script

1. 打開你的 Google Sheet
2. 點擊 **擴充功能 → Apps Script**
3. 刪除默認的 `Code.gs` 內容
4. **複製** `documentation/CountsGAS.gs` 的全部內容並貼上
5. **修改 SHARED_SECRET**：
   ```javascript
   const SHARED_SECRET = 'your-random-secret-here'; // 改成你的密鑰
   ```
   
   生成強密鑰的方法：
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

### 3. 部署為 Web App

1. 在 Apps Script 編輯器中點擊 **部署 → 新增部署**
2. 選擇類型：**網頁應用程式**
3. 填寫設定：
   - **說明**：Name Number Allocation Service
   - **執行身分**：我
   - **具有存取權的使用者**：僅限我自己
4. 點擊 **部署**
5. **複製** Web App URL（格式：`https://script.google.com/macros/s/.../exec`）

### 4. 設定 Vercel 環境變數

前往 Vercel Dashboard → 你的專案 → Settings → Environment Variables

添加以下變數：

| 變數名 | 值 | 說明 |
|--------|-----|------|
| `GAS_WEB_APP_URL` | `https://script.google.com/macros/s/.../exec` | 從步驟 3 複製的 URL |
| `GAS_SECRET_KEY` | `your-random-secret-here` | 與 CountsGAS.gs 中的 SHARED_SECRET 相同 |

**重要**：兩個密鑰必須完全一致！

### 5. 測試 GAS 函數（可選）

在 Apps Script 編輯器中：

1. 選擇函數：`testGetNextNameNumber`
2. 點擊 **執行**
3. 查看日誌（Ctrl/Cmd + Enter）
4. 檢查 Counts sheet 是否有新數據

### 6. 測試 Web App

使用 curl 或 Postman 測試：

```bash
curl -X POST "YOUR_GAS_WEB_APP_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Penter",
    "secret": "your-random-secret-here"
  }'
```

預期響應：
```json
{
  "ok": true,
  "name_number": 1
}
```

### 7. 部署 Vercel

```bash
cd c:\Users\user\Desktop\新增資料夾
git add -A
git commit -m "Integrate GAS Web App for concurrent-safe name_number allocation"
git push origin main
```

## 驗證

### 併發測試

同時發送多個請求給同一個 username，應該得到不同的 name_number：

```bash
# 終端 1
curl -X POST "YOUR_VERCEL_API/api/update_nickname" ...

# 終端 2 (同時)
curl -X POST "YOUR_VERCEL_API/api/update_nickname" ...
```

**期望結果**：name_number 不重複

## 故障排除

### GAS 返回 UNAUTHORIZED

- 檢查 `GAS_SECRET_KEY` 是否與 `SHARED_SECRET` 一致
- 注意大小寫和空格

### GAS 返回 LOCK_TIMEOUT

- 有其他請求正在持有鎖
- 稍後重試
- 如果頻繁發生，考慮增加 `LOCK_TIMEOUT_MS`

### name_number 重複

- 檢查 LockService 是否正確使用
- 確認沒有繞過 GAS 直接寫 Counts

## 安全性

1. ✅ Shared secret 驗證
2. ✅ Web App 設為「僅限我自己」訪問
3. ✅ LockService 確保原子性
4. ✅ Vercel 處理 JWT 驗證

## 架構流程圖

```
User → Vercel API (JWT) → GAS Web App (Lock) → Counts Sheet
                              ↓
                         name_number
                              ↓
                    UserMap (uniqueName)
```
