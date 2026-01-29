# Git Pull 指令教學

這份文件記錄了如何從 GitHub 下載程式碼到本地端。

## 方法 1: 一般更新 (保留本地修改)
如果你只是想把 GitHub 上的新東西抓下來，跟本地的合併：

```bash
git pull origin main
```

*(如果有衝突 Conflict，需要手動解決)*

---

## 方法 2: 強制覆蓋 (放棄本地修改)
如果你想**完全放棄**本地目前的修改，直接讓電腦裡的檔案變成跟 GitHub 上的一模一樣：

### 1. 確保連結正確
```bash
git remote -v

```
#### 如果沒看到 origin，請執行:
```
git remote add origin https://github.com/Penter405/timer.git
```
### 2. 下載最新資料
```bash
git fetch --all
```

### 3. 強制重置 (危險指令，會刪除本地未存檔的修改)
```bash
git reset --hard origin/main
```
