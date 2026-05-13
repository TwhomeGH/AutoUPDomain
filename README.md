# 檢查 DNSSHE 剩餘天數 並 自動續期

當前作用 確認天數 自動檢查並續期

工作流設計 每2個月檢查一次

如果剩餘天數 剩170天時 會自動嘗試續期

通知則由 BARK_API 進行通知

# 環境變數 文件 **`envExample`**

參閱 **`Docs/envExample`**

使用 Github 工作流 則手動配置 **Secrets and variables**

然後轉到 **Actions** 然後 新增 **Repository secrets** 
對應 **`Docs/envExample`** 的變數


# 依賴安裝

```bash
npm install
```


- **dayjs**
- **dotenv**
- **axios**


# DNSSHE 續期說明

它是剩餘180天時 會開啟續期入口

網頁或 API續期