import { DomainService } from '../src/core.js';
import { createTray } from '../src/tray.js';
import { createSystemNotifier } from '../src/platform.js';
const service = new DomainService({ config: {}, api: {} });
const errors = [];
const tray = await createTray({ service, open: async () => {}, configure: async () => {}, quit: async () => {}, onError: error => errors.push(error.message) });
console.log('PASS native tray started');
try {
  service.config.paused = true; service.emit('change');
  if (process.argv.includes('--notify')) {
    await createSystemNotifier()('AutoUPDomain 測試通知', '本地服務通知測試，不需要 Electron 或 Bark。');
    console.log('PASS notification command accepted (visual appearance requires human confirmation)');
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  if (errors.length) throw new Error(errors.join('; '));
} finally { await tray.close(); }
console.log('PASS native tray updated and stopped');
