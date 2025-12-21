# 瀏覽器遷移指南

## 🚀 無需 Node.js 的遷移方案

### 使用 Vercel API 端點遷移

我已經創建了一個 API 端點來執行遷移，可以直接從瀏覽器調用！

---

## 📋 執行步驟

### Step 1: 等待 Vercel 部署

代碼已經推送到 GitHub，Vercel 會自動部署。

**檢查部署狀態：**
1. 訪問 https://vercel.com
2. 選擇 timer 專案
3. Deployments 標籤
4. 確認最新部署狀態為 "Ready"

---

### Step 2: 調用遷移 API

**方法 A: 直接訪問 URL（最簡單）**

在瀏覽器中訪問：
```
https://timer-neon-two.vercel.app/api/migrate
```

**方法 B: 使用開發者工具**

1. 訪問任意頁面（如您的網站）
2. 打開開發者工具（F12）
3. Console 標籤
4. 輸入並執行：

```javascript
fetch('https://timer-neon-two.vercel.app/api/migrate')
  .then(res => res.json())
  .then(data => console.log('遷移結果:', data));
```

---

## 📊 預期結果

成功後會看到類似：

```json
{
  "status": "ok",
  "data": {
    "success": true,
    "report": {
      "totalSheetUsers": 50,
      "newUsers": 45,
      "existingUsers": 5,
      "finalMongoDBUsers": 50,
      "errors": []
    },
    "message": "Migration completed: 45 new users added, 5 already existed"
  }
}
```

**說明：**
- `totalSheetUsers`: Google Sheets 中的用戶總數
- `newUsers`: 新導入到 MongoDB 的用戶數
- `existingUsers`: 已存在的用戶（跳過）
- `finalMongoDBUsers`: MongoDB 中的最終用戶總數

---

## ✅ 驗證遷移結果

### 在 MongoDB Atlas 檢查

1. 訪問 https://cloud.mongodb.com/
2. rubik-timer → Browse Collections
3. timer → users
4. 應該看到所有用戶數據

**檢查字段：**
- ✅ `email` - 從 UserMap 遷移
- ✅ `userID` - 保持原有編號
- ✅ `nickname` - 從 Total 遷移
- ✅ `migratedFrom: "sheets"` - 標記為遷移數據
- ✅ `migratedAt` - 遷移時間戳

---

## ⚠️ 注意事項

### 安全性
- 這個 API 沒有認證，任何人都可以調用
- **只運行一次！** 重複運行會跳過已存在的用戶（安全）
- 建議遷移完成後可以刪除此 API

### 刪除遷移 API（可選）

遷移完成後，為了安全：

```bash
git rm docs/api/migrate.js
git commit -m "Remove migration API endpoint"
git push
```

---

## 🔄 重新遷移

如果需要重新遷移：

1. **清空 MongoDB users collection**（謹慎！）
2. 再次調用遷移 API
3. 或直接運行，會跳過已存在的用戶

---

## 📝 遷移日誌

遷移時會在 Vercel 部署日誌中記錄：
1. Vercel Dashboard → Deployments → 最新部署
2. Functions 標籤 → 查找 `/api/migrate`
3. 查看執行日誌

---

## 💡 快速測試

**檢查 API 是否可用：**
```
https://timer-neon-two.vercel.app/api/migrate
```

直接在瀏覽器打開這個 URL，應該會看到 JSON 回應！
