import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainService, validateConfig } from '../src/core.js';
import { createApi, createNotifier } from '../src/api.js';
const now = Date.parse('2026-09-23T00:00:00Z');
const domain = (days) => ({
  id: 1,
  full_domain: 'example.test',
  expires_at: new Date(now + days * 86400000).toISOString(),
});
const config = { apiKey: 'mock-key', apiSecret: 'mock-secret' };
const make = (options) => new DomainService({ config, now: () => now, ...options });

test('manual and scheduled runs share one operation; renewal is confirmed after timeout', async () => {
  let lists = 0,
    renews = 0,
    notices = 0,
    saved;
  const service = make({
    api: {
      list: async () => [domain(++lists === 1 ? 100 : 365)],
      renew: async () => {
        renews++;
        throw new Error('timeout');
      },
    },
    notify: async () => {
      notices++;
      return [];
    },
    saveState: async (state) => {
      saved = structuredClone(state);
    },
  });
  const first = service.run();
  assert.equal(first, service.run());
  await first;
  assert.equal(renews, 1);
  assert.equal(notices, 1);
  assert.equal(saved.domains[0].remainingDays, 365);
  assert.equal(service.running, false);
  assert.equal(saved.nextRunAt, '2026-09-24T00:00:00.000Z');
});
test('170 day boundary does not renew; healthy scheduled checks do not notify', async () => {
  const service = make({
    api: { list: async () => [domain(170)], renew: () => assert.fail('unexpected renewal') },
    notify: () => assert.fail('unexpected notification'),
  });
  await service.run('scheduled');
  assert.equal(service.state.lastError, null);
});
test('unconfirmed renewal produces failure and retries a later cycle, not the POST', async () => {
  let renews = 0;
  const service = make({
    api: {
      list: async () => [domain(100)],
      renew: async () => {
        renews++;
      },
    },
  });
  await service.run();
  assert.equal(renews, 1);
  assert.equal(service.state.domains[0].status, '續期未確認');
  assert.ok(service.state.lastError);
  assert.equal(service.state.nextRunAt, '2026-09-23T01:00:00.000Z');
});
test('restart catches up once; pause prevents automatic but allows manual checks', async () => {
  let calls = 0;
  const service = make({
    state: { nextRunAt: '2026-09-01T00:00:00Z' },
    api: {
      list: async () => {
        calls++;
        return [];
      },
    },
  });
  await service.tick();
  await service.tick();
  assert.equal(calls, 1);
  service.config.paused = true;
  service.state.nextRunAt = null;
  await service.tick();
  assert.equal(calls, 1);
  await service.run();
  assert.equal(calls, 2);
});
test('missing credentials and configuration lock never call API', async () => {
  const service = make({ config: {}, api: { list: () => assert.fail() } });
  await service.tick();
  assert.equal(service.state.lastRunAt, null);
  service.configuring = true;
  await assert.rejects(service.run());
});
test('same query failure is deduplicated; recovery notifies', async () => {
  let fail = true,
    notices = 0;
  const service = make({
    api: {
      list: async () => {
        if (fail) throw new Error('offline');
        return [];
      },
    },
    notify: async () => {
      notices++;
      return [];
    },
  });
  await service.run('scheduled');
  await service.run('scheduled');
  assert.equal(notices, 1);
  fail = false;
  await service.run('scheduled');
  assert.equal(notices, 2);
  assert.equal(service.state.lastError, null);
});
test('native and Bark channels are independent; errors never expose secret URL', async () => {
  let barkCalls = 0;
  const notify = createNotifier(
    async () => {
      throw new Error('native unavailable');
    },
    async () => {
      barkCalls++;
      return { ok: true, json: async () => ({ code: 200 }) };
    },
  );
  const failures = await notify('title', 'body', {
    nativeNotifications: true,
    barkEnabled: true,
    barkUrl: 'https://example.test/secret',
  });
  assert.equal(barkCalls, 1);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].startsWith('系統通知'));
  await notify('title', 'body', { nativeNotifications: false, barkEnabled: false });
  assert.equal(barkCalls, 1);
});
test('API retries query transport failures, never renewal POST; auth failure does not retry', async () => {
  let calls = 0;
  const api = createApi(
    async () => {
      calls++;
      throw new Error('secret');
    },
    async () => {},
  );
  await assert.rejects(api.list(config), /API 連線/);
  assert.equal(calls, 3);
  await assert.rejects(api.renew(1, config), /API 連線/);
  assert.equal(calls, 4);
  calls = 0;
  const forbidden = createApi(
    async () => {
      calls++;
      return { ok: false, status: 401 };
    },
    async () => {},
  );
  await assert.rejects(forbidden.list(config), /401/);
  assert.equal(calls, 1);
});
test('API rejects malformed and business-error responses', async () => {
  for (const data of [
    { success: false },
    { subdomains: null },
    { subdomains: [{ id: 1, full_domain: 'x', expires_at: 'bad' }] },
  ]) {
    const api = createApi(
      async () => ({ ok: true, json: async () => data }),
      async () => {},
    );
    await assert.rejects(api.list(config));
  }
});
test('settings validate ranges and secrets never appear in snapshots', () => {
  for (const bad of [
    { intervalHours: 0 },
    { renewBeforeDays: 181 },
    { paused: 'false' },
    { barkEnabled: true, barkUrl: 'http://example.test' },
  ])
    assert.throws(() => validateConfig(bad));
  const service = make({ api: {} });
  assert.ok(!JSON.stringify(service.snapshot()).includes('mock-secret'));
  assert.ok(!JSON.stringify(service.snapshot()).includes('mock-key'));
});
