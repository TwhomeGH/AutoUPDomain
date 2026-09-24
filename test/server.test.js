import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DomainService } from '../src/core.js';
import { startServer } from '../src/server.js';
import { createStore } from '../src/store.js';

test('local server requires token and same origin, serves UI, accepts authorized actions', async (t) => {
  let settings;
  const service = new DomainService({ config: {}, api: {} });
  const local = await startServer({
    service,
    configure: async (value) => {
      settings = value;
    },
    testNotification: async () => [],
  });
  t.after(
    () =>
      new Promise((resolve) => {
        local.server.close(resolve);
        local.server.closeAllConnections();
      }),
  );
  const headers = {
    Authorization: 'Bearer ' + new URL(local.url).hash.slice(1),
    'Content-Type': 'application/json',
  };
  const page = await fetch(local.origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AUTOUPDOMAIN/);
  assert.equal((await fetch(local.origin + '/api/state')).status, 401);
  assert.equal(
    (
      await fetch(local.origin + '/api/state', {
        headers: { ...headers, Origin: 'https://evil.test' },
      })
    ).status,
    403,
  );
  const badHostStatus = await new Promise((resolve, reject) => {
    http
      .get(
        local.origin + '/api/state',
        { headers: { ...headers, Host: 'evil.test' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      )
      .on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(local.origin + '/api/state', { headers })).status, 200);
  assert.equal(
    (await fetch(local.origin + '/api/settings', { method: 'POST', headers, body: '{bad' })).status,
    400,
  );
  assert.equal(
    (
      await fetch(local.origin + '/api/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify({ paused: true }),
      })
    ).status,
    200,
  );
  assert.deepEqual(settings, { paused: true });
  assert.equal(
    (await fetch(local.origin + '/api/run', { method: 'POST', headers, body: '{}' })).status,
    400,
  );
  assert.equal(
    (await fetch(local.origin + '/api/notification-test', { method: 'POST', headers, body: '{}' }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(local.origin + '/api/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify({ x: 'a'.repeat(17000) }),
      })
    ).status,
    413,
  );
});
test('store serializes atomic writes and survives restart', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autoupdomain-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  assert.deepEqual(await store.read('state', {}), {});
  await Promise.all([store.write('state', { run: 1 }), store.write('state', { run: 2 })]);
  assert.deepEqual(await createStore(directory).read('state'), { run: 2 });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')), {
    run: 2,
  });
});
