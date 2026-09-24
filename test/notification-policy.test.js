import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainService, validateConfig } from '../src/core.js';

function setup(mode, { fail = false, renew = false, disabled = false } = {}) {
  const notices = [];
  let queries = 0;
  const now = Date.parse('2026-09-24T00:00:00Z');
  const service = new DomainService({
    config: {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      notificationMode: mode,
      nativeNotifications: !disabled,
    },
    now: () => now,
    api: {
      list: async () => {
        if (fail) throw new Error('查詢失敗');
        queries++;
        return [
          {
            id: 1,
            full_domain: 'example.test',
            expires_at: new Date(
              now + (renew && queries === 1 ? 10 : 200) * 86400000,
            ).toISOString(),
          },
        ];
      },
      renew: async () => {},
    },
    notify: async (title, body) => {
      notices.push({ title, body });
      return [];
    },
  });
  return { service, notices };
}

for (const mode of ['important', 'all', 'errors-only']) {
  for (const source of ['manual', 'scheduled']) {
    test(`${mode}/${source}: successful checks follow notification policy`, async () => {
      const { service, notices } = setup(mode);
      await service.run(source);
      const expected = mode === 'all' || (mode === 'important' && source === 'manual');
      assert.equal(notices.length, Number(expected));
    });
    test(`${mode}/${source}: failures notify`, async () => {
      const { service, notices } = setup(mode, { fail: true });
      await service.run(source);
      assert.equal(notices.length, 1);
      assert.match(notices[0].title, /失敗/);
    });
    test(`${mode}/${source}: renewal success follows policy without duplicate summary`, async () => {
      const { service, notices } = setup(mode, { renew: true });
      await service.run(source);
      assert.equal(service.state.domains[0].status, '已續期');
      assert.equal(notices.length, mode === 'errors-only' ? 0 : 1);
    });
  }
}

test('manual request joining scheduled check receives one summary', async () => {
  const { service, notices } = setup('important');
  let release;
  service.api.list = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = service.run('scheduled');
  assert.equal(service.run('manual'), pending);
  release([]);
  await pending;
  assert.equal(notices.length, 1);
  assert.match(notices[0].body, /共 0 個網域/);
});

test('errors-only notifies unconfirmed renewal but suppresses recovery', async () => {
  const { service, notices } = setup('errors-only');
  service.api.list = async () => [
    { id: 1, full_domain: 'example.test', expires_at: '2026-10-01T00:00:00Z' },
  ];
  await service.run('manual');
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /需處理/);
  service.api.list = async () => [];
  await service.run('scheduled');
  assert.equal(notices.length, 1);
  assert.equal(service.state.lastError, null);
});

test('all mode still respects disabled channels', async () => {
  const { service, notices } = setup('all', { disabled: true });
  await service.run();
  assert.equal(notices.length, 0);
});

test('invalid notification mode is rejected and old settings get default', () => {
  assert.equal(validateConfig({}).notificationMode, 'important');
  assert.throws(() => validateConfig({ notificationMode: 'invalid' }), /通知時機/);
});
