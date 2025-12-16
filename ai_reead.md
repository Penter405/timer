## 💥 高風險爆炸清單（修改前必須檢查）

### A️⃣ 資料結構（Schema）相關

* 改 JSON key 名稱（如 `time` → `result.time`）
* 改資料巢狀層級
* 改型別（number → string / object）
* 新增欄位但舊端仍假設固定欄位
* 刪除欄位但前端 / Apps Script 還在讀

➡️ **影響**：Apps Script exception / 前端 JS crash

---

### B️⃣ 傳輸格式（HTTP / Content-Type）

* `application/json` 但 Apps Script 還用 `e.parameter`
* 從 form-data 改成 JSON（或反之）
* 忘記設定 `Content-Type`
* POST 改成 GET（或反之）

➡️ **影響**：Google Web App 收到 undefined

---

### C️⃣ Google Apps Script（Sheet 擴充功能）

* 修改 `doPost(e)` 但沒重新部署 Web App
* 新增 `SpreadsheetApp / UrlFetchApp` scope 沒重新授權
* Sheet 名稱 / 欄位 index 改了
* 假設 `e.postData` 一定存在
* 沒處理空資料 / 異常資料

➡️ **影響**：403 / 500 / silent failure

---

### D️⃣ Vercel Serverless Function

* 忘記包 `try / catch`
* 使用 `fs.writeFile`（Vercel 是 read-only）
* 使用不支援的 Node API
* 長時間 blocking code（timeout）
* 假設 `process.env.X` 一定存在
* 改了 env key 名但沒同步到 Vercel Dashboard

➡️ **影響**：500 / Function crash

---

### E️⃣ Vercel 專案結構

* 改 HTML 位置但沒對齊 Root Directory
* `/api` 不在 Vercel 專案 root
* 檔名大小寫錯誤（Linux case-sensitive）
* API 檔案副檔名錯誤（`.js` / `.ts`）

➡️ **影響**：404 / Cannot GET /api

---

### F️⃣ 前端 Fetch 邏輯

* 假設回傳結構沒變
* 沒處理非 200 response
* 直接 `res.json()` 未檢查 `res.ok`
* CORS 假設錯誤來源
* 使用相對路徑但實際是跨域

➡️ **影響**：前端炸，但 API 其實活著

---

### G️⃣ 部署與版本問題

* GitHub code 已改，但 Vercel 沒 redeploy
* README / 測試網址指向舊 deploy
* 同時存在 GitHub Pages + Vercel，混用 URL
* 以為 GitHub Pages 會「轉發」請求給 Vercel

➡️ **影響**：看似亂炸，其實在打舊版本

---

### H️⃣ 權限與安全

* Apps Script Web App 存取權限被重設
* Service Account scope 不足
* Google Sheet 權限被移除
* Token 過期但沒處理 refresh

➡️ **影響**：403 / 無錯誤但無資料

---

### I️⃣ 觀測性不足（Debug 困難）

* 沒有 log（Vercel / Apps Script）
* Error 被 swallow
* 回傳成功但實際寫入失敗

➡️ **影響**：看起來「全部正常」，實際全壞

---

### 🔒 強制原則

> **凡是「資料怎麼存」的修改，必須假設：**
>
> * 前端
> * Vercel API
> * Google Apps Script
>   **三邊都可能一起炸**

未同步修改 = 高風險行為。


### ⚠️ 系統整合修改建議（請嚴格遵守）

#### 1️⃣ 修改「資料結構」＝ 修改「API 契約」

* 任何 **payload schema** 變更（key 名、巢狀結構、型別）

  * **必須同步更新**：

    * Vercel Serverless Function
    * Google Apps Script（`doPost(e)`）
    * 前端 `fetch` 後的解析邏輯
* 禁止只改其中一端。

---

#### 2️⃣ Apps Script 與傳輸格式強制對齊

* 若 `Content-Type: application/json`

  * Apps Script **必須**使用：

    ```js
    JSON.parse(e.postData.contents)
    ```
  * **禁止使用** `e.parameter`
* 若使用 `form-data` / query

  * 才能使用 `e.parameter`

---

#### 3️⃣ Apps Script 變更後的必要步驟

* 只要動到以下任一項：

  * 使用的欄位
  * Spreadsheet 操作
  * scope / library
* **必須重新部署 Web App**

  * Deploy → Manage deployments → Redeploy
* 並確認存取權限未被重設。

---

#### 4️⃣ Vercel Function 防炸標準

* 所有 `/api/*.js` **必須包 try/catch**
* 錯誤需 `console.error(err)` 並回傳 JSON
* 禁止：

  * 本地檔案寫入（`fs` write）
  * 假設 env 一定存在（需檢查 `process.env`）

---

#### 5️⃣ 環境變數不可「順手改名」

* 若 code 中有修改 `process.env.*`

  * **必須同步更新 Vercel Project → Environment Variables**
* 未對齊視為重大錯誤。

---

#### 6️⃣ 部署邏輯分離原則

* GitHub Pages：**只負責前端顯示**
* Vercel：**只負責 API / 中介**
* Google Apps Script：**只負責資料寫入**
* 禁止假設三者會自動同步設定。

---

#### 7️⃣ 修改後的強制驗證流程

* 不經前端，**直接測 API**

  ```
  https://xxx.vercel.app/api/endpoint
  ```
* 再直接測 Apps Script Web App
* 最後才測整條鏈

---

#### 8️⃣ 回溯安全機制

* 任何「資料儲存方式」改動前

  * 先保留舊 schema 的 fallback
  * 或提供 migration mode
* 禁止一次性破壞相容性。

---

**目標：**

* 修改資料層 ≠ 破壞整個部署
* AI 修改必須是「跨服務一致性修改」


# Google Sheet 資料結構說明（Schema）

> ⚠️ **重要原則**
>
> * 所有寫入 Google Sheet 的欄位 **一律以字串 `'value'` 形式寫入**
> * 禁止讓 Google Sheet 自動處理日期、時間、數字格式
> * 本文件為 **系統唯一資料契約（Single Source of Truth）**

---

## Sheet: `'ScoreBoard'`

### 單位

* `'row'` 為一筆紀錄

### 欄位內容（依 column 順序）

1. `'ID'`

   * 對應 `'Total'` sheet 中的 row index
2. `'秒數'`

   * 計時結果（字串形式，例如 `'12.345'`）
3. `'打亂'`

   * scramble 字串（完整保留）
4. `'日期'`

   * 格式範例：`'2025-01-16'`
5. `'時間'`

   * 格式範例：`'14:32:10'`
6. `'預留欄位'`

   * 尚未確定用途（保留，禁止刪除）

---

## Sheet: `'UserMap'`

### 單位

* **3 個 column 為一組**
* 以 `'row'` 寫入 / 讀取

### Hash 規則

1. 將 `'email'` 進行 hash → 得到 `'big_hash'`
2. `'big_hash % total_column_groups'` → 得到 `'hash_number'`
3. 依 `'hash_number'` 對應到某一組 **3 個 column**

---

### 每組 3 個 column 內容（固定順序）

1. `'email'`

   * 原始 email（字串）
   * 用途：**防止 hash 碰撞**
2. `'ID'`

   * 對應 `'Total'` sheet 的 row
3. `'username#name_number'`

   * 使用者顯示名稱
   * 初次註冊時可為 `''`（空字串）

---

## Sheet: `'Counts'`

### 單位

* **2 個 column 為一組**
* 以 `'username'` 進行 hash 分配（規則同 `'UserMap'`）

### Hash 規則

* `'username' → big_hash → hash_number → 對應 column group`

### 每組 2 個 column 內容

1. `'username'`
2. `'name_number'`

> 用途：
>
> * 快速檢查某 username 已被使用的次數
> * 產生唯一的 `'username#name_number'`

---

## Sheet: `'Total'`

### 單位

* `'row'` 為一個帳號
* **僅使用第一個 column**

### 欄位內容

1. `'email'`

### 規則

* `'row index'` 即為該使用者的 `'ID'`
* `'ID'` 為全系統唯一識別碼

---

## 新使用者註冊流程（Google 帳號）

當系統偵測到新的 Google 帳號 sign up：

1. ✅ 在 `'Total'` sheet 新增一 row

   * 寫入 `'email'`
   * 取得對應 `'ID'`

2. ✅ 在 `'UserMap'` sheet：

   * 根據 `'email'` 計算 hash
   * 定位對應的 3-column group
   * 寫入：

     * `'email'`
     * `'ID'`
     * `'username#name_number'` → `''`（暫時空白）

> ⚠️ `'Counts'` 於設定 username 時才會使用

---

## 禁止事項（AI / 開發者必須遵守）

* ❌ 禁止變更 column 順序
* ❌ 禁止刪除預留欄位
* ❌ 禁止讓 Google Sheet 自動轉型資料
* ❌ 禁止單邊修改 schema 未同步所有服務

---

**此文件修改即代表資料契約變更，
必須同步更新：**

* Vercel API
* Google Apps Script
* 前端資料解析


現在的 App Script:
```
// --------- 設定 ---------
const SHEET_ID = "1RlcaqvG1fiSXPhQBoidYVk3dwsi1bojO6Y9FnF1ZYoY/edit?gid=0#gid=0";  // <-- 換成你的 Google Sheet ID
const SHEET_NAME = "Sheet1";       // 工作表名稱

// --------- GET API：讀取所有紀錄 ---------
function doGet(e) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    
    // 將資料轉成 JSON（跳過表頭）
    const result = data.slice(1).map(row => ({
      at: row[0],
      ms: row[1],
      scramble: row[2]
    }));

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// --------- POST API：新增紀錄 ---------
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    
    // 解析前端傳送的 JSON
    const body = JSON.parse(e.postData.contents);

    // 在表格新增一列
    sheet.appendRow([
      body.at,       // ISO 字串時間
      body.ms,       // 計時毫秒數
      body.scramble  // 亂序字串
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({status: "ok"}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

```

```
export default async function handler(req, res) {
  // === CORS headers（一定要在最前面）===
  res.setHeader("Access-Control-Allow-Origin", "https://penter405.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // === 回 preflight ===
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // === 真正的 API ===
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 你的原本邏輯
  const { nickname } = req.body;

  return res.status(200).json({ status: "ok" });
}

```