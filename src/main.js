import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { DomainService, defaults, validateConfig } from './core.js';
import { createApi, createNotifier } from './api.js';
import { createStore } from './store.js';
import { startServer } from './server.js';
import {
  createVault,
  createSystemNotifier,
  dataDirectory,
  openBrowser,
  loginSetting,
} from './platform.js';
import { loadConfig } from './config.js';
import { fileURLToPath } from 'node:url';
import { acquireInstance } from './instance.js';

let local,
  service,
  tray,
  instance,
  timer,
  stopping = false,
  configuring = false;
const directory = path.resolve(dataDirectory());
const noOpen = process.argv.includes('--no-open');
const canLogin =
  !process.argv.includes('--no-tray') &&
  !process.env.AUTOUPDOMAIN_DATA_DIR &&
  !process.env.AUTOUPDOMAIN_PORT;
async function report(error) {
  const detail = service ? service.redact(error.message) : error.message;
  console.error(detail);
  if (service) {
    service.log('error', detail);
    service.state.lastError = detail;
    service.emit('change');
  }
  await appendFile(path.join(directory, 'service.log'), `${new Date().toISOString()} ${detail}\n`, {
    mode: 0o600,
  }).catch(() => {});
}
const background = (promise) => promise.catch(report);
// 正常退出先停止排程，再等待工作與狀態保存完成，最後釋放托盤及單實例鎖。
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  if (service) {
    service.config.paused = true;
    service.log('info', '服務準備停止，等待執行中任務結束');
  }
  await service?.pending?.catch(() => {});
  if (service) await service.persist().catch(() => {});
  if (tray) await tray.close().catch(() => {});
  if (local)
    await new Promise((resolve) => {
      local.server.close(resolve);
      local.server.closeAllConnections();
    });
  if (instance && !instance.existing) await instance.close();
}
async function start() {
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('目前支援 Windows 與 Linux');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  instance = await acquireInstance(directory, () => local?.url);
  if (instance.existing) {
    console.log('AutoUPDomain 已在執行。');
    if (instance.url && !noOpen) await openBrowser(instance.url);
    return;
  }
  const store = createStore(directory),
    vault = createVault(directory);
  const { secrets, ...settings } = await store.read('settings', {});
  const credentials = secrets ? JSON.parse(await vault.decrypt(secrets)) : {};
  const config = await loadConfig({
    envFile: fileURLToPath(new URL('../.env', import.meta.url)),
    settings,
    credentials,
    ignoreEnv: process.argv.includes('--ignore-env'),
  });
  const notify = createNotifier(createSystemNotifier());
  service = new DomainService({
    config,
    state: await store.read('state', {}),
    api: createApi(),
    notify,
    saveState: (state) => store.write('state', state),
  });
  service.on('log', (entry) => console.log(`[${entry.time}] [${entry.level}] ${entry.message}`));
  service.log('info', '本地服務已啟動');
  service.on('background-error', (error) => background(Promise.reject(error)));
  // 更新設定期間禁止開始檢查；先驗證及寫入磁碟，再替換記憶體設定。
  async function configure(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch))
      throw new Error('設定格式錯誤');
    if (service.running || configuring) throw new Error('正在執行操作，請稍後再試');
    for (const key of Object.keys(patch))
      if (!Object.hasOwn(defaults, key)) throw new Error('不支援的設定欄位');
    configuring = true;
    service.configuring = true;
    const previous = service.config;
    try {
      const merged = { ...previous, ...patch };
      if (Object.hasOwn(patch, 'intervalHours') && !Object.hasOwn(patch, 'intervalUnit'))
        delete merged.intervalUnit;
      const config = validateConfig(merged);
      if (config.launchAtLogin && !canLogin)
        throw new Error('自訂資料目錄、連接埠或無托盤模式請自行管理自動啟動');
      const { apiKey, apiSecret, barkUrl, ...publicSettings } = config;
      const secrets =
        apiKey || apiSecret || barkUrl
          ? await vault.encrypt(JSON.stringify({ apiKey, apiSecret, barkUrl }))
          : undefined;
      if (config.launchAtLogin !== previous.launchAtLogin) await loginSetting(config.launchAtLogin);
      // 若寫檔失敗，回復已變更的登入啟動項目，避免系統設定與檔案不一致。
      try {
        await store.write('settings', { ...publicSettings, secrets });
      } catch (error) {
        if (config.launchAtLogin !== previous.launchAtLogin)
          await loginSetting(previous.launchAtLogin);
        throw error;
      }
      service.config = config;
      if (config.intervalHours !== previous.intervalHours)
        service.state.nextRunAt = new Date(
          Date.now() + config.intervalHours * 3600000,
        ).toISOString();
      service.log(
        'info',
        `設定已更新：每 ${config.intervalUnit === 'days' ? config.intervalHours / 24 + ' 天' : config.intervalHours + ' 小時'}檢查，排程${config.paused ? '已暫停' : '已啟用'}`,
      );
      await service.persist();
    } finally {
      configuring = false;
      service.configuring = false;
    }
  }
  const port = Number(process.env.AUTOUPDOMAIN_PORT || 17843);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('本地連接埠無效');
  local = await startServer({
    service,
    configure,
    port,
    capabilities: {
      login: canLogin,
      note:
        process.platform === 'win32'
          ? '使用 Windows 系統通知；通知顯示仍取決於系統權限及勿擾設定。'
          : '系統通知需要 notify-send；安全儲存需要 libsecret 與已解鎖的登入金鑰圈。',
    },
    testNotification: async () => {
      if (!service.config.nativeNotifications && !service.config.barkEnabled)
        return ['請先啟用至少一個通知管道'];
      service.log('info', '開始測試通知管道');
      const failures = await notify(
        'AutoUPDomain 測試通知',
        '本地網域管家已準備好通知你。',
        service.config,
      );
      if (!failures.length) service.log('success', '測試通知已交付通知管道');
      for (const failure of failures) service.log('warning', failure);
      await service.persist();
      return failures;
    },
  });
  console.log(`AutoUPDomain Web UI: ${local.url}`);
  console.log(`資料目錄: ${directory}`);
  if (!process.argv.includes('--no-tray')) {
    try {
      const { createTray } = await import('./tray.js');
      tray = await createTray({
        service,
        open: () => openBrowser(local.url),
        configure,
        quit: stop,
        onError: (error) => background(Promise.reject(error)),
      });
      tray.onExit(() => {
        if (!stopping)
          background(report(new Error('系統托盤已結束，背景服務仍在執行，可使用原 Web UI 網址')));
      });
    } catch {
      await report(new Error('系統托盤無法啟動；Web UI 服務仍可使用，請確認桌面托盤支援'));
    }
  }
  timer = setInterval(() => background(service.tick()), 30000);
  if (!noOpen) background(openBrowser(local.url));
  background(service.tick());
}
process.on('SIGINT', () => background(stop()));
process.on('SIGTERM', () => background(stop()));
start().catch(async (error) => {
  await report(error);
  await stop();
  process.exitCode = 1;
});
