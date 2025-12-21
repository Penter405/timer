# MongoDB 數據查看指南

## 🔍 查看 MongoDB Atlas 數據

### 方法 1: Web 介面（最簡單）

#### 登入 MongoDB Atlas
1. 訪問：https://cloud.mongodb.com/
2. 使用 Google 帳號登入

#### 瀏覽數據
1. 找到 **rubik-timer** cluster
2. 點擊 **"Browse Collections"** 按鈕
3. 展開 **timer** 數據庫

---

## 📊 數據庫結構

### `users` Collection（用戶資料）

**替代了 Google Sheets 的：**
- UserMap（email → userID 映射）
- Counts（暱稱計數）
- Total（userID → nickname）

**文檔結構：**
```json
{
  "_id": ObjectId("..."),
  "email": "user@example.com",
  "userID": 1,
  "nickname": "PlayerName#1",
  "encryptedNickname": "MTpQbGF5ZXJOYW1lIzE=",
  "createdAt": ISODate("2025-12-21T..."),
  "updatedAt": ISODate("2025-12-21T...")
}
```

**字段說明：**
- `email`: 用戶 Gmail 地址（敏感，不公開）
- `userID`: 唯一用戶編號（公開，從1開始）
- `nickname`: 完整暱稱（可能含 #數字）
- `encryptedNickname`: Base64 加密暱稱（給 Sheet 用）
- `createdAt`: 註冊時間
- `updatedAt`: 最後更新時間

---

### `scores` Collection（成績記錄）

**文檔結構：**
```json
{
  "_id": ObjectId("..."),
  "userID": 1,
  "email": "user@example.com",
  "time": 12.345,
  "scramble": "R U R' U' R U' R'",
  "date": "2025-12-21",
  "timestamp": "14:30:25",
  "period": "all",
  "createdAt": ISODate("2025-12-21T...")
}
```

**字段說明：**
- `userID`: 對應用戶編號
- `email`: 用戶 email（備份用）
- `time`: 成績秒數
- `scramble`: 打亂公式
- `date`: 日期
- `timestamp`: 時間
- `period`: 時段（all, today, week, month, year）
- `createdAt`: 記錄時間

---

## 🔍 常用查詢操作

### 在 MongoDB Atlas Web 介面

#### 1. 查看所有用戶
- 點擊 `users` collection
- 看到所有用戶列表

#### 2. 搜尋特定用戶
在 Filter 輸入框：
```json
{ "email": "user@example.com" }
```

或按 userID：
```json
{ "userID": 1 }
```

#### 3. 查看某用戶的所有成績
在 `scores` collection 的 Filter：
```json
{ "userID": 1 }
```

#### 4. 查看最快成績（前10名）
1. Filter: `{}`（全部）
2. Sort: `{ "time": 1 }`（升序）
3. Limit: 10

#### 5. 查看今天的成績
```json
{ "date": "2025-12-21" }
```

---

## 🛠️ 方法 2: MongoDB Compass（桌面應用）

### 安裝 Compass
1. 下載：https://www.mongodb.com/products/compass
2. 安裝應用程式

### 連接到 Cluster
1. 打開 Compass
2. 使用連接字串：
   ```
   mongodb+srv://[SCRUBBED]
   ```
3. 點擊 Connect

### 優點
- 更強大的查詢功能
- 可視化圖表
- Schema 分析
- 索引管理

---

## 📈 數據統計查詢

### 用戶總數
```javascript
db.users.countDocuments({})
```

### 成績總數
```javascript
db.scores.countDocuments({})
```

### 平均成績
```javascript
db.scores.aggregate([
  { $group: { _id: null, avgTime: { $avg: "$time" } } }
])
```

### 每個用戶的成績數
```javascript
db.scores.aggregate([
  { $group: { _id: "$userID", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
])
```

---

## 🔐 數據安全

### 敏感數據（只在 MongoDB）
- ✅ `users.email` - 永不公開
- ✅ `scores.email` - 僅備份用

### 公開數據（同步到 Sheets）
- ✅ `userID` - 匿名編號
- ✅ `encryptedNickname` - 加密暱稱
- ✅ `time`, `scramble`, `date` - 成績數據

---

## 📝 數據遷移記錄

### 從 Google Sheets 遷移

**原有分頁：**
- UserMap → `users` collection
- Counts → 暱稱計數整合到 `users`
- Total → `users` collection
- ScoreBoard → `scores` collection

**遷移工具：**
使用 `migrate_sheets_to_mongo.js` 腳本

**執行方法：**
```bash
node migrate_sheets_to_mongo.js
```

---

## ⚡ 快速參考

### 查看最新10筆成績
```javascript
db.scores.find().sort({ createdAt: -1 }).limit(10)
```

### 查看特定暱稱的用戶
```javascript
db.users.find({ nickname: /^PlayerName/ })
```

### 刪除測試數據（小心！）
```javascript
// 刪除特定用戶
db.users.deleteOne({ email: "test@example.com" })

// 刪除該用戶的成績
db.scores.deleteMany({ email: "test@example.com" })
```

---

## 🎯 最佳實踐

1. **不要直接修改 email** - 這是唯一身份標識
2. **不要刪除 userID** - 會破壞關聯
3. **備份後再刪除** - 重要數據務必先備份
4. **使用 Filter 預覽** - 刪除前先 find() 確認

---

## 📞 常見問題

### Q: 如何導出數據？
A: MongoDB Atlas → Collections → Export Collection → JSON/CSV

### Q: 如何備份整個數據庫？
A: Cluster → ... → Create Backup

### Q: 如何還原數據？
A: 使用 mongorestore 或從備份還原

### Q: 忘記密碼怎麼辦？
A: MongoDB Atlas → Database Access → 重設密碼
