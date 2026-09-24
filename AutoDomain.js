import 'dotenv/config';
import { DomainService } from './src/core.js';
import { createApi, createNotifier } from './src/api.js';

// Single-run CLI compatibility; dotenv reads .env from the working directory.
const barkUrl =
  process.env.BARK_API && process.env.BARK_API.toLowerCase() !== 'none' ? process.env.BARK_API : '';
const service = new DomainService({
  config: {
    apiKey: process.env.API_KEY || '',
    apiSecret: process.env.API_SECRET || '',
    barkUrl,
    barkEnabled: !!barkUrl,
    nativeNotifications: false,
  },
  api: createApi(),
  notify: createNotifier(async () => {}),
});
await service.run();
for (const item of service.state.history.toReversed())
  console.log(`[${item.level}] ${item.message}`);
for (const domain of service.state.domains)
  console.log(`${domain.full_domain} 剩餘 ${domain.remainingDays} 天 · ${domain.expires_at}`);
if (service.state.lastError) process.exitCode = 1;
