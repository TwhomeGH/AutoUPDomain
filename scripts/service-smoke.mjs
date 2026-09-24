import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve('output/service-restart');
await mkdir(directory, { recursive: true });
async function launch() {
  const child = spawn(process.execPath, ['src/main.js', '--no-open', '--no-tray', '--ignore-env'], { windowsHide: true, env: { ...process.env, AUTOUPDOMAIN_DATA_DIR: directory, AUTOUPDOMAIN_PORT: '0' } });
  const url = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Service startup timed out')); }, 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error('Service exited: ' + code)); });
    child.stdout.on('data', chunk => { text += chunk; const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  const parsed = new URL(url);
  return {
    child,
    async request(endpoint, body) {
      const response = await fetch(parsed.origin + '/api/' + endpoint, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + parsed.hash.slice(1), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    stop: () => new Promise(resolve => { child.once('exit', resolve); child.kill(); })
  };
}
let instance = await launch();
try {
  await instance.request('settings', { paused: true, apiKey: 'isolated-test-key', apiSecret: 'isolated-test-secret', intervalHours: 12 });
  const raw = await readFile(path.join(directory, 'settings.json'), 'utf8');
  if (raw.includes('isolated-test-secret')) throw new Error('Plaintext credential found');
  await instance.stop(); instance = await launch();
  const state = await instance.request('state');
  if (!state.settings.paused || !state.hasApiKey || !state.hasApiSecret || state.settings.intervalHours !== 12) throw new Error('Settings not restored');
  if (state.lastRunAt !== null) throw new Error('Paused instance unexpectedly called API');
  console.log('PASS pure Node service starts, encrypts credentials, restores settings after restart, keeps paused without calling API');
} finally { await instance.stop(); }
