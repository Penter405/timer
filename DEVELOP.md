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
