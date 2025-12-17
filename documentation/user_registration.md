# 新用戶註冊流程文檔

## 概述

本文檔說明了 Rubik's Cube Timer 中新用戶註冊和身份驗證的完整流程。

## 架構：Web → Vercel → Google Sheets

根據 `APIturn.py` 中的 `option_3_vercel` 定義：

```python
def option_3_vercel():
    web.call(vercel, "IO")
    vercel.call(sheet, "IO")
```

## 新用戶定義

**新用戶**：Email 經過 hash 後在 `UserMap` 表中查詢不到對應記錄的用戶。

## 註冊流程

### 1. 用戶登入 Google

```
用戶點擊 Google 登入按鈕
    ↓
Google 返回 JWT Token（包含 email）
    ↓
前端調用 syncNickname()
```

### 2. 前端請求 (connect.js)

```javascript
fetch('https://timer-neon-two.vercel.app/api/update_nickname', {
    method: 'POST',
    body: JSON.stringify({
        token: googleIdToken,
        nickname: ""  // 空字串 = 註冊/同步模式
    })
})
```

### 3. 後端處理 (update_nickname.js)

#### Step 1: 驗證並提取 Email
```javascript
// 從 JWT token 解析 email
const payload = parseJwt(token);
const email = payload.email;
```

#### Step 2: 計算 Hash Bucket
```javascript
// Email hash 到對應的 bucket
const hash = hashFunction(email);
const bucketIndex = hash % bucketSize;
```

#### Step 3: 查詢 UserMap
```javascript
// 讀取對應 bucket 的數據（3列：Email, UserID, Nickname）
const userRowIdx = rows.findIndex(r => r[0] === email);
```

#### Step 4: 新用戶註冊
如果 `userRowIdx === -1`（查詢不到），則為新用戶：

```javascript
// 1. 在 Total 表註冊，獲得唯一 ID
await sheets.spreadsheets.values.append({
    range: 'Total!A:A',
    values: [[email]]
});
// 返回的行號即為 userID

// 2. 在 UserMap 儲存（nickname 為空）
await sheets.spreadsheets.values.update({
    range: `UserMap!...`,
    values: [[email, userID, ""]]  // nickname 留空
});
```

### 4. 後端響應

```json
{
    "success": true,
    "userID": "123",
    "uniqueName": "",          // 空字串，因為還沒設定暱稱
    "isNewUser": true,         // 標記為新用戶
    "message": "新用戶註冊成功"
}
```

### 5. 前端處理響應

```javascript
if (data.isNewUser) {
    console.log('🎉 新用戶註冊！User ID:', data.userID);
}

if (data.uniqueName) {
    // 有暱稱：顯示 "你好 SpeedCuber#123"
    greetingEl.textContent = `你好 ${data.uniqueName}`;
} else if (data.userID) {
    // 沒暱稱：顯示 "你好 #123"
    greetingEl.textContent = `你好 #${data.userID}`;
}
```

## 設定暱稱流程

### 1. 用戶輸入暱稱並點擊上傳

```javascript
fetch('https://timer-neon-two.vercel.app/api/update_nickname', {
    method: 'POST',
    body: JSON.stringify({
        token: googleIdToken,
        nickname: "SpeedCuber"  // 用戶輸入的暱稱
    })
})
```

### 2. 後端更新 UserMap

```javascript
// 查找用戶（已存在）
const userRowIdx = rows.findIndex(r => r[0] === email);
const userID = rows[userRowIdx][1];

// 生成唯一暱稱
const uniqueName = `${nickname}#${userID}`;

// 更新 UserMap 第三列
await sheets.spreadsheets.values.update({
    values: [[email, userID, uniqueName]]
});
```

### 3. 響應

```json
{
    "success": true,
    "userID": "123",
    "uniqueName": "SpeedCuber#123",
    "isNewUser": false,
    "message": "資料更新成功"
}
```

## Google Sheets 結構

### Total 表
```
| A (Email)           |
|---------------------|
| user1@gmail.com     | ← Row 1 = UserID 1
| user2@gmail.com     | ← Row 2 = UserID 2
| user3@gmail.com     | ← Row 3 = UserID 3
```

### UserMap 表（Hash Table）
```
Bucket 0          | Bucket 1          | Bucket 2          |
Email|ID |Nick    | Email|ID |Nick    | Email|ID |Nick    |
-----|---|--------|------|---|--------|------|---|--------|
u1@  |1  |Speed#1 | u2@  |2  |Fast#2  | u3@  |3  |       | ← 暱稱留空
```

### ScoreBoard 表
```
| UserID | Time  | Scramble | Date     | Time     | Status   |
|--------|-------|----------|----------|----------|----------|
| 1      | 12.34 | R U R'   | 2025/... | 10:30:00 | Verified |
```

## 關鍵特性

### ✅ 即時註冊
- Google 登入後**立即**在 Total 表註冊
- 無需等待用戶設定暱稱

### ✅ 延遲命名
- 暱稱欄位可以**留空**
- 用戶可以稍後在設定頁面填寫

### ✅ Hash Table 優化
- O(1) 查詢效率
- 自動負載均衡（動態 bucket 大小）

### ✅ 前端體驗
- `isNewUser` 標記支持新用戶歡迎訊息
- Emoji 增強的成功/失敗提示
- 自動清空輸入框

## API 安全

### CORS 保護
```javascript
const allowedOrigins = [
    'https://penter405.github.io',
    'http://localhost:8080'
];
```

### JWT 驗證
```javascript
// 後端解析並驗證 Google ID Token
const payload = parseJwt(token);
if (!payload || !payload.email) {
    return res.status(401).json({ error: 'Invalid token' });
}
```

### 前端無法直接訪問 Sheets
- ✅ 所有 Sheet 操作都在 Vercel 後端執行
- ✅ Google Service Account 密鑰安全存儲在環境變數
- ❌ 前端僅讀取公開的 ScoreBoard（通過 gviz API）

## 測試流程

1. **新用戶測試**
   - 使用新的 Google 帳號登入
   - 檢查 Console 是否顯示 "🎉 新用戶註冊！"
   - 驗證問候語顯示 "你好 #[數字]"
   - 檢查 Total 表是否新增一列

2. **暱稱設定測試**
   - 前往設定頁面輸入暱稱
   - 點擊上傳後檢查是否顯示 "✅ 上傳成功！"
   - 驗證問候語更新為 "你好 [暱稱]#[數字]"
   - 檢查 UserMap 表對應行的第三列是否更新

3. **舊用戶測試**
   - 登出後重新登入
   - 驗證系統自動載入暱稱
   - 檢查 Console 無 "新用戶" 訊息

## 故障排除

### 問題：登入後無反應
- 檢查瀏覽器 Console 是否有 CORS 錯誤
- 確認 Vercel 環境變數設定正確

### 問題：暱稱無法上傳
- 確認已登入 Google
- 檢查 Network 標籤查看 API 請求狀態
- 驗證 JWT token 是否有效

### 問題：UserID 重複
- 檢查 Total 表是否有併發寫入問題
- 考慮實施樂觀鎖定機制

## 未來優化

- [ ] 實施 MongoDB 作為高速緩存（option_4_mongo_hybrid）
- [ ] 添加 Cloudflare Workers 作為主要 API（option_2_cloudflare）
- [ ] 支持暱稱修改歷史記錄
- [ ] 實施 rate limiting 防止 API 濫用
