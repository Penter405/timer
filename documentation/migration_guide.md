# 數據遷移指南

## 🎯 目標

將 Google Sheets 中的數據遷移到 MongoDB：
- UserMap → MongoDB users
- Counts → 整合到 users
- Total → MongoDB users
- ScoreBoard → 保持同步（已自動）

---

## 📋 遷移步驟

### 前置條件

1. ✅ MongoDB Atlas 已設置
2. ✅ Vercel 環境變數已配置
3. ✅ `.env.local` 已填寫正確

### 執行遷移

**如果有 Node.js：**
```bash
cd c:\Users\ba\OneDrive\桌面\timer
node migrate_sheets_to_mongo.js
```

**如果沒有 Node.js：**
遷移會在用戶首次登入時自動進行（新用戶自動註冊）

---

## 🔍 遷移內容

### UserMap → users
```
Email | UserID | UniqueName
→
{
  email,
  userID,
  nickname,
  encryptedNickname
}
```

### Total → users
```
Row# | Nickname
→
合併到 users.nickname
```

### 自動處理
- ✅ 去除重複
- ✅ 暱稱正規化
- ✅ 加密生成
- ✅ 時間戳記

---

## ✅ 驗證

遷移後檢查：
1. MongoDB Atlas → timer → users
2. 確認數據量符合
3. 檢查 email, userID, nickname 正確

---

## 📊 數據對照

| Google Sheets | MongoDB | 說明 |
|--------------|---------|------|
| UserMap (Email) | users.email | 主鍵 |
| UserMap (UserID) | users.userID | 唯一編號 |
| UserMap (UniqueName) | users.nickname | 暱稱 |
| Total (Nickname) | users.nickname | 合併 |
| Counts | 自動計算 | 不需要了 |

---

## 🚀 完成後

1. ✅ UserMap, Counts, Total 可以保留（備份）
2. ✅ 或刪除（已不需要）
3. ✅ ScoreBoard 繼續使用（公開排行榜）
