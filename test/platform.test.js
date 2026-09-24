import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVault } from '../src/platform.js';
import { acquireInstance } from '../src/instance.js';

test('OS socket prevents duplicate instances and releases on close', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autoupdomain-instance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await acquireInstance(directory, () => 'http://127.0.0.1:1234/#mock-token');
  assert.equal(first.existing, false);
  const second = await acquireInstance(directory, () => 'unexpected');
  assert.equal(second.existing, true);
  assert.match(second.url, /mock-token/);
  await first.close();
  const third = await acquireInstance(directory, () => '');
  assert.equal(third.existing, false);
  await third.close();
});
test(
  'Windows DPAPI encrypts and reloads credentials without plaintext disk storage',
  { skip: process.platform !== 'win32' },
  async () => {
    const vault = createVault('unused-on-windows');
    const encrypted = await vault.encrypt('mock-secret-測試');
    assert.equal(encrypted.type, 'dpapi');
    assert.ok(!JSON.stringify(encrypted).includes('mock-secret'));
    assert.equal(await createVault('unused-on-windows').decrypt(encrypted), 'mock-secret-測試');
  },
);
