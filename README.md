# AutoUPDomain — 本地網域管家

Node.js 本地常駐排程服務，搭配輕量原生系統托盤。Web UI 使用你現有的 Edge、Chrome、Firefox 等瀏覽器，**不含 Electron、不內嵌瀏覽器**。支援 Windows / Linux 系統通知，Bark 為選配。

## 開始使用

先安裝 Node.js 22 以上版本，在專案目錄執行：

```sh
npm install
npm start
```

啟動後會出現系統托盤，並以系統預設瀏覽器開啟面板。Windows 完成依賴安裝後，也可雙擊 `Start-AutoUPDomain.vbs` 隱藏終端視窗啟動。面板可設定「登入後自動啟動」，預設關閉。

啟動時自動讀取專案根目錄 `.env` 的 `API_KEY`、`API_SECRET`、`BARK_API`，不受目前工作目錄影響。優先序為：Web 已儲存設定 > 程序環境變數 > 專案 `.env`。Bark 有網址就預設啟用，空值或 `none` 為停用；已儲存的通知開關優先。憑證齊全後會自動檢查，亦可按「立即檢查」。修改 `.env` 後需重新啟動；若已有 Web 儲存的憑證，請在 Web 更新。測試隔離可用 `--ignore-env` 忽略檔案與憑證環境變數。

- 托盤：開啟 Web UI、立即檢查、暫停／恢復排程、退出。
- 關閉瀏覽器不會停止排程。托盤「退出」會等待當前工作收尾並關閉服務。
- 預設每 1 天檢查一次（與原本 24 小時相同），可選每 1–90 天或每 1–2160 小時檢查一次，例如 7、30、60 天；剩餘天數 **小於 170 天**時嘗試續期。門檻可設 1–180 天，實際可否續期依供應商回應。
- 保存下次執行時間；重啟／睡眠恢復後，30 秒內補跑一次，不重播所有錯過的排程。
- 手動與自動檢查共用執行鎖；同一資料目錄只允許一個常駐服務。再次啟動會開啟已有服務的面板。
- 電腦關機或使用者登出期間不執行；這是使用者登入階段的背景程式，不是 Windows 系統服務。

面板右上「外觀」可選擇跟隨系統、淺色或深色，偏好保存在目前瀏覽器中。API Key、API Secret、Bark 網址預設遮蔽，可用眼睛按鈕檢視目前輸入；儲存或離開分頁會重新遮蔽。已儲存憑證不會回傳面板。

## 通知

系統通知預設啟用；Bark 可另外啟用、獨立關閉。任一通知管道失敗不會阻止另一個。一般檢查成功不打擾；續期、失敗與恢復時通知，並提供「測試已儲存的通知設定」。

**Windows：** 使用 SnoreToast 呼叫 Windows 原生 Toast。首次通知建立 `AutoUPDomain Notifications.lnk` 供系統識別通知來源，無須 Electron。勿擾模式、通知權限可能影響實際顯示。此捷徑用於通知註冊；啟動程式請使用本專案啟動器。

**Linux：** 使用 `notify-send` 呼叫桌面通知服務。托盤使用原生 AppIndicator；部分 GNOME 桌面需啟用 AppIndicator 擴充。Debian / Ubuntu 常見依賴：

```sh
sudo apt install libnotify-bin libsecret-tools libayatana-appindicator3-1
```

不同 Linux 發行版／桌面可能需要相容的 AppIndicator 套件；依實際套件庫為準。純終端環境沒有桌面通知服務，可關閉系統通知、選用 Bark。

## 不需要托盤的環境

```sh
npm run start:headless
```

只啟動服務，終端會印出含存取 token 的 Web UI 網址，使用瀏覽器開啟。Ctrl+C 結束；如需長期執行，可自行交由使用者層級的服務管理工具管理。

預設只監聽 `127.0.0.1:17843`。可用 `AUTOUPDOMAIN_PORT` 更改連接埠（`0` 自動分配），`AUTOUPDOMAIN_DATA_DIR` 指定獨立資料目錄。登入自啟動使用預設資料目錄與連接埠；自訂環境請自行管理啟動命令。無托盤模式不提供面板的自啟動選項。

## 資料與安全

預設位置：Windows `%APPDATA%/AutoUPDomain`，Linux `$XDG_CONFIG_HOME/AutoUPDomain` 或 `~/.config/AutoUPDomain`。

- `settings.json`：一般設定與加密憑證；Windows 使用 DPAPI，Linux 使用金鑰圈保管 AES-GCM 加密金鑰。
- `state.json`：網域狀態、排程與最近 200 筆紀錄。
- `service.log`：服務級啟動／執行錯誤，不記錄憑證。
- Linux 需要 `secret-tool` 與已解鎖的登入金鑰圈；安全儲存不可用時會拒絕儲存密鑰，不降級成明文。
- Web UI 使用每次啟動更新的 token，檢查 Host / Origin，API 不回傳已儲存的憑證。從托盤開啟可取得有效連結；請勿分享含 token 的網址。
- 憑證欄位留白代表保留。Bark 網址同樣當作密鑰保存；停用 Bark 不會刪除網址。

登入自啟動：Windows 使用 Startup 資料夾的 `AutoUPDomain.vbs`，Linux 使用 XDG autostart。移動專案或移除 Node.js 前，先停用自啟動；移動後可重新啟用。移除程式前亦應停用；通知註冊捷徑可自行刪除。

## 失敗處理

API 查詢有 20 秒逾時與最多三次嘗試。續期 POST 不盲目重送，而是重新查詢到期時間確認是否已延長。失敗後 1 小時再檢查；持續相同的清單查詢錯誤僅通知一次，恢復時通知。續期未確認則逐輪提醒。

避免另外用 CLI／其他電腦同時操作相同網域；常駐服務的單實例保護只涵蓋同一使用者、同一資料目錄。

## 保留單次 CLI

```sh
npm run main
```

CLI 使用 `.env` 的 `API_KEY`、`API_SECRET`、選填 `BARK_API`，範例在 `Docs/envExample`。它只執行一次，不啟動托盤；通知為選填 Bark，失敗回傳非零退出碼。GitHub Actions 已移除固定排程，保留手動執行。

## 驗證與展示

```sh
npm test
npm run demo
```

展示模式印出本地面板網址，只使用 `example.test` 模擬資料，不讀取 `.env`、不呼叫真實 API、不保存設定。Ctrl+C 結束。

```sh
node scripts/native-smoke.mjs
node scripts/native-smoke.mjs --notify
```

驗證原生托盤啟動／更新／退出；加上 `--notify` 才送出一則真實系統測試通知。API 自動測試使用模擬資料。Windows DPAPI 測試在 Windows 執行；Linux 通知與金鑰圈需於 Linux 桌面環境另行驗證。

## 執行控制台

Web UI 控制台每秒更新實際查詢、略過、續期確認、重試與通知流程，保留最近 200 筆；檢查尚未結束時也能看到進度。可篩選警告／錯誤、停止畫面更新、自動捲動或下載目前緩存的日誌。暫停控制台更新不會停止排程。憑證會遮蔽；同一份流程紀錄亦輸出到啟動終端。最近紀錄於任務完成、儲存設定及正常退出時保存。

成功檢查完成後才開始計算下次間隔；修改間隔並儲存時則從儲存時間起算。失敗後仍於 1 小時後重試。既有小時設定自動轉換顯示，排程時長不變；切換單位只改表單，需儲存才生效。

## 詳細文件

- [本地常駐使用指南](Docs/使用指南.md)：首次啟動、設定優先序、按天排程、控制台與通知。
- [疑難排解與驗證](Docs/疑難排解.md)：托盤、系統通知、金鑰圈、設定與測試方式。
