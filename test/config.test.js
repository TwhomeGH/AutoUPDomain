import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

test('loads project env; saved settings and credentials override environment defaults', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autoupdomain-env-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, '.env');
  await writeFile(
    envFile,
    'API_KEY=file-key\nAPI_SECRET="file-secret"\nBARK_API=https://example.test/mock-bark\n',
  );
  const fromFile = await loadConfig({ envFile, environment: {} });
  assert.equal(fromFile.apiKey, 'file-key');
  assert.equal(fromFile.apiSecret, 'file-secret');
  assert.equal(fromFile.barkEnabled, true);
  const overridden = await loadConfig({
    envFile,
    environment: { API_KEY: 'process-key' },
    settings: { barkEnabled: false },
    credentials: { apiSecret: 'saved-secret' },
  });
  assert.equal(overridden.apiKey, 'process-key');
  assert.equal(overridden.apiSecret, 'saved-secret');
  assert.equal(overridden.barkEnabled, false);
  const disabled = await loadConfig({ envFile, environment: { BARK_API: 'NoNe' } });
  assert.equal(disabled.barkEnabled, false);
  assert.equal(disabled.barkUrl, '');
  const isolated = await loadConfig({ envFile, ignoreEnv: true });
  assert.equal(isolated.apiKey, '');
  assert.equal(isolated.barkEnabled, false);
});
test('missing env file still allows fresh configuration', async () => {
  const config = await loadConfig({
    envFile: path.join(os.tmpdir(), 'autoupdomain-not-existing', '.env'),
    environment: {},
  });
  assert.equal(config.apiKey, '');
  assert.equal(config.nativeNotifications, true);
});
