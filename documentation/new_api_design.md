# 多層 Failover API 架構設計

## 概述

實現「屬性導向」的多層 Failover 架構，根據服務特性智慧切換，最大化免費額度利用率。

---

## 服務屬性分類

### 屬性類型定義

| 類型 | 主要限制 | 次要限制 | 適用場景 |
|------|---------|---------|---------|
| **A型** | 並發連線 | 寫入/調用量 | 短時高峰流量 |
| **B型** | 寫入/調用量 | 並發連線 | 長期穩定流量 |
| **混合型** | 兩者均衡 | - | 通用場景 |

---

## Serverless 服務比較

| 服務 | 屬性 | 並發限制 | 調用限制 | 優先級 |
|------|------|---------|---------|--------|
| Cloudflare Workers | B型 | ∞ | 10 萬次/天 | 1 |
| Vercel Functions | A型 | 1,000 | 10 萬次/月 | 2 |
| Netlify Functions | B型 | ∞ | 12.5 萬次/月 | 3 |
| AWS Lambda (Free) | A型 | 1,000 | 100 萬次/月 | 4 |

### 月度總免費額度
- Cloudflare: **~300 萬次**
- Vercel: **10 萬次**
- Netlify: **12.5 萬次**
- **合計: ~325 萬次/月**

---

## Database 服務比較

| 服務 | 屬性 | 並發限制 | 儲存/讀寫限制 | 優先級 |
|------|------|---------|-------------|--------|
| MongoDB Atlas | 混合 | 100 連線 | 512MB 儲存 | 1 |
| Supabase | A型 | 50 連線 | 200 萬次/月 | 2 |
| PlanetScale | B型 | 1,000 | 10 億行讀/月 | 3 |
| Google Sheets | A型 | 60次/分 | 15GB | 備份 |

---

## 架構圖

```
┌─────────────────────────────────────────────────────────┐
│                    Smart Load Balancer                  │
│                   (Frontend JavaScript)                 │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  1. 檢查各服務剩餘額度                           │   │
│  │  2. 根據屬性 + 剩餘額度排序                      │   │
│  │  3. 依序嘗試，遇 429 自動切換                    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Cloudflare   │ │    Vercel     │ │   Netlify     │
│   Workers     │ │   Functions   │ │   Functions   │
│               │ │               │ │               │
│  優先級: 1    │ │  優先級: 2    │ │  優先級: 3    │
│  B型 (調用)   │ │  A型 (並發)   │ │  B型 (調用)   │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
        ┌─────────────────────────────────────┐
        │         Database Layer              │
        └─────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   MongoDB     │ │   Supabase    │ │ Google Sheets │
│    Atlas      │ │  PostgreSQL   │ │   (Backup)    │
│               │ │               │ │               │
│  優先級: 1    │ │  優先級: 2    │ │  優先級: 3    │
│  混合型       │ │  A型 (並發)   │ │  A型 (速率)   │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

## 智慧切換邏輯

### 服務配置

```javascript
const SERVERLESS_CONFIG = [
  { 
    name: 'cloudflare',
    url: 'https://api.your-cf.workers.dev',
    type: 'B',
    limits: { daily: 100000, concurrent: Infinity },
    priority: 1
  },
  { 
    name: 'vercel',
    url: 'https://your-app.vercel.app/api',
    type: 'A',
    limits: { monthly: 100000, concurrent: 1000 },
    priority: 2
  },
  { 
    name: 'netlify',
    url: 'https://your-app.netlify.app/.netlify/functions',
    type: 'B',
    limits: { monthly: 125000, concurrent: Infinity },
    priority: 3
  }
];

const DATABASE_CONFIG = [
  {
    name: 'mongodb',
    type: 'mixed',
    limits: { concurrent: 100, storage: '512MB' },
    priority: 1
  },
  {
    name: 'supabase',
    type: 'A',
    limits: { concurrent: 50, monthly: 2000000 },
    priority: 2
  },
  {
    name: 'sheets',
    type: 'A',
    limits: { ratePerMin: 60 },
    priority: 3
  }
];
```

### Failover 函數

```javascript
class SmartAPIClient {
  constructor(config) {
    this.tiers = config;
    this.usage = this.loadUsage();
  }

  loadUsage() {
    return JSON.parse(localStorage.getItem('api_usage') || '{}');
  }

  saveUsage() {
    localStorage.setItem('api_usage', JSON.stringify(this.usage));
  }

  getRemainingQuota(tier) {
    const used = this.usage[tier.name] || { today: 0, month: 0 };
    if (tier.limits.daily) {
      return tier.limits.daily - used.today;
    }
    return tier.limits.monthly - used.month;
  }

  getSortedTiers() {
    return [...this.tiers].sort((a, b) => {
      const remainA = this.getRemainingQuota(a);
      const remainB = this.getRemainingQuota(b);
      // 剩餘額度多的優先
      return remainB - remainA;
    });
  }

  async fetch(path, options) {
    const sorted = this.getSortedTiers();
    
    for (const tier of sorted) {
      if (this.getRemainingQuota(tier) <= 0) {
        console.log(`[API] ${tier.name} 額度用盡，跳過`);
        continue;
      }

      try {
        const res = await fetch(`${tier.url}${path}`, {
          ...options,
          headers: {
            ...options?.headers,
            'X-Tier': tier.name
          }
        });

        if (res.ok) {
          this.trackUsage(tier.name);
          return res;
        }

        if (res.status === 429) {
          console.warn(`[API] ${tier.name} 返回 429，切換下一個...`);
          continue;
        }

        throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        console.warn(`[API] ${tier.name} 失敗:`, e.message);
      }
    }

    throw new Error('所有服務層都已耗盡或失敗');
  }

  trackUsage(tierName) {
    if (!this.usage[tierName]) {
      this.usage[tierName] = { today: 0, month: 0 };
    }
    this.usage[tierName].today++;
    this.usage[tierName].month++;
    this.saveUsage();
  }

  resetDaily() {
    Object.keys(this.usage).forEach(k => {
      this.usage[k].today = 0;
    });
    this.saveUsage();
  }

  resetMonthly() {
    Object.keys(this.usage).forEach(k => {
      this.usage[k].month = 0;
    });
    this.saveUsage();
  }
}

// 使用範例
const api = new SmartAPIClient(SERVERLESS_CONFIG);
const res = await api.fetch('/save_time', {
  method: 'POST',
  body: JSON.stringify({ time: 12345 })
});
```

---

## 實作步驟

### Phase 1: Cloudflare Workers 設定
- [ ] 建立 Cloudflare 帳號
- [ ] 設定 Workers 專案
- [ ] 遷移 save_time, get_nicknames API
- [ ] 測試 failover 到 Vercel

### Phase 2: MongoDB Atlas 設定
- [ ] 建立 MongoDB Atlas 帳號
- [ ] 設計 Schema (users, nicknames)
- [ ] 建立 Vercel 連接
- [ ] 遷移 UserMap, Total 資料

### Phase 3: Supabase 設定 (選用)
- [ ] 建立 Supabase 專案
- [ ] 設計 PostgreSQL Schema
- [ ] 建立 API 連接

### Phase 4: 前端整合
- [ ] 實作 SmartAPIClient
- [ ] 加入用量追蹤
- [ ] 測試完整 failover 流程

---

## 監控與維護

### 用量監控

```javascript
// 每日重置 (在 GAS 或前端執行)
function resetDailyUsage() {
  const usage = JSON.parse(localStorage.getItem('api_usage') || '{}');
  Object.keys(usage).forEach(k => usage[k].today = 0);
  localStorage.setItem('api_usage', JSON.stringify(usage));
}

// 每月重置
function resetMonthlyUsage() {
  localStorage.setItem('api_usage', '{}');
}
```

### 告警機制

當任一服務使用率達 80% 時，顯示警告：

```javascript
function checkUsageAlert() {
  const usage = api.usage;
  SERVERLESS_CONFIG.forEach(tier => {
    const limit = tier.limits.daily || tier.limits.monthly;
    const used = tier.limits.daily ? usage[tier.name]?.today : usage[tier.name]?.month;
    if (used / limit > 0.8) {
      console.warn(`⚠️ ${tier.name} 使用率已達 ${Math.round(used/limit*100)}%`);
    }
  });
}
```

---

## 預期效益

| 項目 | 數值 |
|------|------|
| Serverless 總額度 | ~325 萬次/月 |
| Database 總額度 | ~無限 (儲存限制內) |
| 可用性 | 99.9%+ (多層備援) |
| 成本 | $0/月 |
