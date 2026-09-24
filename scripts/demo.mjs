import { DomainService, validateConfig } from '../src/core.js';
import { startServer } from '../src/server.js';
const service = new DomainService({
  config: { apiKey: 'demo-key', apiSecret: 'demo-secret', paused: true },
  api: {
    list: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return [
        {
          id: 1,
          full_domain: 'demo.example.test',
          expires_at: new Date(Date.now() + 300 * 86400000).toISOString(),
        },
      ];
    },
    renew: async () => {
      throw new Error('展示模式不提供續期');
    },
  },
});
await service.run();
const local = await startServer({
  service,
  configure: async (patch) => {
    service.config = validateConfig({ ...service.config, ...patch });
    service.state.nextRunAt = new Date(
      Date.now() + service.config.intervalHours * 3600000,
    ).toISOString();
    service.log('info', '展示設定已更新');
  },
  testNotification: async () => ['展示模式不傳送真實通知'],
  capabilities: { login: false, note: '展示模式：模擬資料，不連接真實 API，也不儲存憑證。' },
});
console.log(local.url);
process.on('SIGINT', () => {
  local.server.close();
  local.server.closeAllConnections();
});
