import SysTrayPackage from 'systray2';
import path from 'node:path';
import { projectRoot } from './platform.js';
const SysTray = SysTrayPackage.default || SysTrayPackage;
/** 托盤只是核心操作的入口，不另外持有排程或通知規則。 */
export async function createTray({ service, open, configure, quit, onError }) {
  const items = [
    { title: 'AutoUPDomain', enabled: false },
    { title: '開啟 Web UI', enabled: true },
    { title: '立即檢查', enabled: true },
    { title: '暫停排程', enabled: true },
    { title: '退出', enabled: true },
  ];
  const tray = new SysTray({
    menu: {
      icon: path.join(
        projectRoot,
        'native',
        process.platform === 'win32' ? 'icon.ico' : 'icon.png',
      ),
      title: 'AutoUPDomain',
      tooltip: 'AutoUPDomain 本地網域管家',
      items,
    },
    debug: false,
    copyDir: false,
  });
  let timeout;
  try {
    await Promise.race([
      tray.ready(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('托盤無法啟動；請確認桌面托盤服務，或使用 --no-tray')),
          10000,
        );
      }),
    ]);
  } catch (error) {
    tray.process?.kill();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  let alive = true;
  const failed = (error) => {
    alive = false;
    service.off('change', update);
    onError(error);
  };
  tray.onError(failed);
  tray.process.stdin.on('error', failed);
  tray.onExit(() => {
    alive = false;
    service.off('change', update);
  });
  await tray.onClick((action) => {
    const index = action.seq_id;
    const operations = {
      1: open,
      2: () => service.run('manual'),
      3: () => configure({ paused: !service.config.paused }),
      4: quit,
    };
    if (operations[index]) Promise.resolve().then(operations[index]).catch(onError);
  });
  function update() {
    if (!alive) return;
    items[0].title = service.running
      ? '檢查中'
      : service.config.paused
        ? '排程已暫停'
        : service.state.lastError
          ? '需要處理'
          : !service.config.apiKey || !service.config.apiSecret
            ? '等待設定'
            : '背景監看中';
    items[2].enabled = !service.running && !!service.config.apiKey && !!service.config.apiSecret;
    items[3].title = service.config.paused ? '恢復排程' : '暫停排程';
    items[3].enabled = !service.running;
    for (const index of [0, 2, 3])
      tray.sendAction({ type: 'update-item', item: items[index], seq_id: index }).catch(onError);
  }
  service.on('change', update);
  update();
  return {
    close: async () => {
      service.off('change', update);
      if (alive) {
        alive = false;
        await tray.kill(false);
      }
    },
    onExit: (callback) => tray.onExit(callback),
  };
}
