import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainService, validateConfig } from '../src/core.js';
import { createApi } from '../src/api.js';

test('day schedules survive reload and wait until exactly due', async () => {
  const start = Date.parse('2026-09-24T00:00:00Z');
  let now = start, saved, calls = 0;
  const config = { apiKey: 'test-key', apiSecret: 'test-secret', intervalHours: 30 * 24, intervalUnit: 'days' };
  const api = { list: async () => { calls++; return []; } };
  const first = new DomainService({ config, api, now: () => now, saveState: async state => { saved = structuredClone(state); } });
  await first.run();
  assert.equal(Date.parse(saved.nextRunAt), start + 30 * 86400000);
  const restored = new DomainService({ config: JSON.parse(JSON.stringify(first.config)), api, state: saved, now: () => now });
  now += 29 * 86400000; await restored.tick(); assert.equal(calls, 1);
  now += 86400000; await restored.tick(); assert.equal(calls, 2);
  assert.equal(restored.config.intervalUnit, 'days');
});
test('old hourly settings migrate and invalid day settings are rejected', () => {
  assert.equal(validateConfig({ intervalHours: 12 }).intervalUnit, 'hours');
  assert.equal(validateConfig({ intervalHours: 24 }).intervalUnit, 'days');
  assert.equal(validateConfig({ intervalHours: 2160, intervalUnit: 'days' }).intervalHours, 2160);
  for (const config of [{ intervalHours: 2184 }, { intervalHours: 12, intervalUnit: 'days' }, { intervalUnit: 'months' }]) assert.throws(() => validateConfig(config));
});
test('live console exposes progress before completion and redacts secrets', async () => {
  let release;
  const service = new DomainService({ config: { apiKey: 'private-key', apiSecret: 'private-secret', barkUrl: 'https://example.test/private-bark' }, api: { list: () => new Promise(resolve => { release = resolve; }) } });
  const emitted = [];
  service.on('log', entry => emitted.push(entry));
  const pending = service.run();
  assert.equal(service.running, true);
  assert.ok(service.snapshot().history.some(entry => entry.message.includes('正在查詢')));
  service.log('error', 'private-key private-secret https://example.test/private-bark\nforged line');
  const output = JSON.stringify(emitted);
  assert.ok(!output.includes('private-key')); assert.ok(!output.includes('private-secret')); assert.ok(!output.includes('private-bark'));
  assert.ok(output.includes('[REDACTED]'));
  release([]); await pending;
  assert.equal(service.running, false);
  for (let i = 0; i < 205; i++) service.log('info', 'entry ' + i);
  assert.equal(service.snapshot().history.length, 200);
});
test('API query retries are reported as console progress', async () => {
  let calls = 0;
  const entries = [];
  const api = createApi(async () => {
    if (++calls < 3) throw new Error('offline');
    return { ok: true, json: async () => ({ subdomains: [] }) };
  }, async () => {});
  await api.list({ apiKey: 'mock', apiSecret: 'mock' }, (level, message) => entries.push({ level, message }));
  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.level === 'warning'));
  assert.match(entries[1].message, /第 3 次/);
});
