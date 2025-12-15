# Developer Guide (Technical Architecture) 🛠️

這份文件記錄了 **Rubik's Cube Timer** 的技術架構與設計決策，特別是為了在 Serverless 與 Google Sheets 限制下達成高性能所採用的特殊實作。

## 🏗️ 系統架構 Overview

*   **Frontend**: Vanilla HTML/CSS/JS (SPA 架構，無框架)。
*   **Backend**: Vercel Serverless Functions (`/api`).
*   **Database**: Google Sheets (作為 NoSQL-like 資料庫)。

## 🧠 核心技術設計

### 1. 資料庫設計 (Google Sheets as DB)
我們將 Google Sheets 用作資料庫，但為了避開它的限制，採取了特殊架構：
*   **Sheet1 (Logs)**: 儲存所有成績。僅作為 Log 使用 (Append Only)。
    *   **欄位優化**：移除了冗餘的 Nickname 欄位，僅儲存 `Email` 作為 Foreign Key。
    *   **強制純文字**：為了防止 Google Sheets 自動格式化 (例如把 `12.345` 轉成數字或時間)，所有寫入欄位皆加上單引號前綴 `'` (例如 `'12.345`)。前端讀取時會自動去除。

*   **Counts & UserMap (Identity System)**: 
    *   這兩個分頁實作了 **Column-Based Chaining Hash Table**。

### 2. Backend: Chaining Hash Table (`api/update_nickname.js`)
為了解決在 Excel/Sheets 中搜尋大量資料效率低落 (O(N)) 的問題，我們實作了 O(1) 的雜湊表：
*   **Bucket Logic**: 
    *   自動偵測 Sheet 的總欄數 (Columns)。
    *   `BucketID = Hash(Key) % (TotalColumns / 2)`。
    *   資料分散存儲在不同的欄位 (Columns) 中，而非單一列表。
*   **Auto-Scaling**: 
    *   程式會動態讀取 Metadata，如果你在 Google Sheet 手動新增欄位，Hash Table 會自動擴容利用新空間。
*   **API Efficiency**:
    *   使用 `batchGet` 和 `batchUpdate`，改名操作僅需 1 次讀取 + 1 次寫入請求。

### 3. Frontend: Hybrid Lookup (`js/scoreboard.js`)
為了減輕後端負擔並加快讀取速度，記分板採取 **前端查表** 策略：
1.  **Read**: 透過 Google Visualization API (`gviz`) 直接讀取公開的 `Sheet1` (成績) 和 `UserMap` (Hash Table)。此操作**不經過 Vercel**，節省 Serverless 額度。
2.  **Map**: 前端下載完整的 `UserMap` 後，在瀏覽器記憶體中解析 Hash Table，建立 `Email -> Nickname` 的 Map。
3.  **Render**: 渲染排行榜時，O(1) 查詢 Map 替換 Email 為暱稱。
    *   若無暱稱，Fallback 顯示 "Unnamed"。

### 4. 關鍵檔案說明
*   `script.js`: 核心計時邏輯、WCA 狀態機 (Idle/Inspect/Ready/Running)。
*   `js/router.js`: 處理 SPA頁面切換、導覽列狀態、以及全域 `window.loggedIn` 狀態管理。
*   `js/connect.js`: Google Auth 整合、API 呼叫封裝 (與 Router 共享 Global State)。
*   `js/scoreboard.js`: 排行榜讀取與渲染邏輯。
*   `docs/api/save_time.js`: 成績上傳 API (處理強制純文字邏輯)。
*   `docs/api/update_nickname.js`: 暱稱系統 API (Hash Table 核心)。

### 5. Frontend UX State Machine
為了確保隱私與清晰的使用者狀態，我們定義了嚴格的 UI 狀態機：
*   **未登入 (Guest)**: 
    *   問候語 (Greeting): 空白。
    *   設定頁 Input: 空白。
*   **已登入 (No Nickname on Device)**: 
    *   問候語: "你好"。
    *   設定頁 Input: 空白。
    *   **背景同步 (Cloud Sync)**: 系統會自動從 Google Sheet `UserMap` 撈取是否已存在對應的暱稱。若找到，自動更新為 "已登入 (With Nickname)" 狀態並寫入 LocalStorage。
*   **已登入 (With Nickname)**: 
    *   問候語: "你好 {Nickname}#{ID}"。
    *   設定頁 Input: 空白 (不自動填入舊名)。
*   **登出 (Logout)**: 
    *   觸發 `handleLogout`，強制清除 LocalStorage、Greeting 和 Input 內容。

## 🚀 如何運行 (How to Run)

### 前端
直接開啟 `index.html` 即可運行 (需使用 Live Server 或部署到 GitHub Pages 以正常運作 Router 和 Module)。

### 後端 (Vercel)
需設定以下環境變數 (`.env`)：
*   `GOOGLE_CLIENT_ID`: GCP OAuth Client ID.
*   `GOOGLE_SHEET_ID`: 目標 Google Sheet 的 ID.
*   `GOOGLE_APPLICATION_CREDENTIALS_JSON`: Service Account 的完整 JSON Key (單行字串)。

### Google Sheets 設定
試算表必須包含以下分頁 (Case Sensitive)：
1.  `Sheet1`: 儲存成績 (公開檢視)。
2.  `Counts`: 儲存暱稱計數 (Hash Table Bucket)。
3.  `UserMap`: 儲存 Email 對應 (Hash Table Bucket)。

## 🔮 未來架構：Hybrid Database (Plan B)

為了能同時擁有 **MongoDB 的高效能** 與 **Google Sheets 的易用備份**，且預防單一平台 (Vercel) 資源耗盡，我們設計了以下架構。

### System Flowchart

> [!IMPORTANT]
> **API Guard (保全)** 是整個架構的核心。絕對**不能**讓前端直接連線資料庫，否則帳號密碼會直接外洩。

```mermaid
graph TD
    User((User 👤))
    Frontend[Web Frontend 💻]
    
    subgraph "The Guard (Backend API)"
        LB{Load Balancer ⚖️}
        CF[Cloudflare Primary ⚡]
        Vercel[Vercel Backup 🛡️]
    end
    
    subgraph "Database Layer (Hybrid)"
        Mongo[(MongoDB Atlas 🍃)]
        Sheets[Google Sheets 📊]
    end

    %% Normal Flow
    User -->|Interact| Frontend
    Frontend -->|API Request| LB
    
    %% Failover Logic
    LB -->|Priority 1| CF
    LB -.->|Failover| Vercel
    

    IO= Write(I)..read(O)
    CF -->|I| Mongo

    %% Write Flow (Dual Write)
    CF -->|1. Write (Fast)| Mongo
    CF -->|2. Write (Backup)| Sheets
    Vercel -->|1. Write (Fast)| Mongo
    Vercel -->|2. Write (Backup)| Sheets
    
    %% Read Flow (Fallback Logic)
    CF -->|1. Read (Cache)| Mongo
    Mongo -.->|If Full/Empty| CF
    CF -.->|2. Fallback Read| Sheets
    
    Vercel -->|1. Read (Cache)| Mongo
    Mongo -.->|If Full/Empty| Vercel
    Vercel -.->|2. Fallback Read| Sheets
    
    %% Danger Zone Visual
    Frontend -.->|❌ DIRECT CONNECT (DANGER)| Mongo
    style Frontend stroke:#f00,stroke-width:2px
    style Mongo stroke:#0f0,stroke-width:2px
    style CF stroke:#00f,stroke-width:2px
    style Vercel stroke:#888,stroke-width:1px
    
    %% Apply Red to Mandatory API Paths
    linkStyle 1,2,3,4,6,7,8,9,10,12,13,15 stroke:#ff0000,stroke-width:2px,color:red;
```

### 架構說明
1.  **Safety First**: 所有資料庫存取都**必須**經過後端 API (Cloudflare 或 Vercel)。圖中 `❌ DIRECT CONNECT` 代表如果繞過 API 直接連，就是資安自殺行為。
2.  **High Availability (HA)**: 
    *   **Load Balancer (Client-side)**: 前端可以寫一個簡單的邏輯，預設打 Cloudflare (每天 10萬次免費)。
    *   **Failover**: 如果 Cloudflare 回傳 5xx 錯誤或掛掉，前端自動重試打 Vercel (作為備援)。
3.  **Hybrid Storage**:
    *   **Google Sheets**: 作為 **Cold Backup** (也不怕 Mongo 爆空間，因為 Sheets 有 15GB)。

## 6. Deployment & Security (CORS) 🛡️

### CORS 與 Vercel 設定決策
在開發過程中，我們遇到了一個關鍵的架構選擇：**如何處理跨域資源共享 (CORS)**。

#### 1. Zero Config (推薦方案 ✅)
Vercel 預設採用 **Zero Configuration** 模式。
*   **路由**: 自動將 `/api/function` 對應到 `api/function.js`。
*   **優點**: 最穩定，不會發生 404 錯誤。
*   **缺點**: 預設不處理 CORS。
*   **解決方案**: 我們必須在**每個 Serverless Function 的程式碼中**手動處理 `OPTIONS` 請求與 Headers (如 `api/update_nickname.js`)。

#### 2. `vercel.json` (不推薦 ❌)
我們一度嘗試使用 `vercel.json` 全域設定 Header：
```json
{ "headers": [ { "source": "/api/(.*)", "headers": [ { "key": "Access-Control-Allow-Origin", "value": "*" } ] } ] }
```
*   **問題**: 
    1.  **路由衝突**: 複雜的 source 對應反而導致 Vercel 找不到檔案 (404 Not Found)。
    2.  **安全衝突**: 瀏覽器規定 `Access-Control-Allow-Credentials: true` 時，Origin 不能為 `*`。靜態設定檔難以實現「動態回應 Origin」的需求。

### 結論
我們最終移除 `vercel.json`，回歸 **Zero Config**，並在程式碼層級實現安全的動態 CORS：
```javascript
// Dynamic Origin Echoing
const allowedOrigins = ['https://penter405.github.io', 'http://localhost:8080'];
if (allowedOrigins.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
}
res.setHeader('Access-Control-Allow-Credentials', true);
```
這確保了既能正常路由，又能通過嚴格的瀏覽器 CORS 檢查。
