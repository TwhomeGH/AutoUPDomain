import { execFile } from 'node:child_process';
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const appId = 'AutoUPDomain.Local';
export function dataDirectory() {
  return process.env.AUTOUPDOMAIN_DATA_DIR || (process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'AutoUPDomain') : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'AutoUPDomain'));
}
export function command(file, args, input, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(new Error('系統工具執行失敗，請確認所需服務與權限')) : resolve(stdout.trim()));
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
export function openBrowser(url) {
  return process.platform === 'win32' ? command('rundll32.exe', ['url.dll,FileProtocolHandler', url]) : command('xdg-open', [url]);
}

export function createVault(directory) {
  let key;
  async function linuxKey(create) {
    if (key) return key;
    let stored;
    try { stored = await command('secret-tool', ['lookup', 'application', appId, 'profile', directory]); } catch { if (!create) throw new Error('無法讀取系統金鑰圈；請確認 libsecret 與登入金鑰圈已解鎖'); }
    if (!stored && create) {
      stored = randomBytes(32).toString('base64');
      await command('secret-tool', ['store', '--label=AutoUPDomain', 'application', appId, 'profile', directory], stored);
    }
    key = Buffer.from(stored || '', 'base64');
    if (key.length !== 32) { key = null; throw new Error('系統金鑰圈無效，無法解密憑證'); }
    return key;
  }
  const dpapi = (action, value) => command('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(projectRoot, 'native', 'secrets.ps1')], JSON.stringify({ action, value }));
  return {
    async encrypt(value) {
      if (process.platform === 'win32') return { type: 'dpapi', value: await dpapi('encrypt', value) };
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', await linuxKey(true), nonce);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return { type: 'libsecret-aes', value: encrypted.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    },
    async decrypt(record) {
      if (process.platform === 'win32' && record.type === 'dpapi') return dpapi('decrypt', record.value);
      if (process.platform === 'linux' && record.type === 'libsecret-aes') {
        const decipher = createDecipheriv('aes-256-gcm', await linuxKey(false), Buffer.from(record.nonce, 'base64'));
        decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(record.value, 'base64')), decipher.final()]).toString('utf8');
      }
      throw new Error('憑證格式或作業系統不相容');
    }
  };
}

export function createSystemNotifier() {
  let registered = false;
  const icon = path.join(projectRoot, 'native', 'icon.png');
  return async (title, body) => {
    if (process.platform === 'linux') return command('notify-send', ['--app-name=AutoUPDomain', '--icon=' + icon, '--', title, body]);
    if (process.platform !== 'win32') throw new Error('目前支援 Windows 與 Linux 系統通知');
    const binary = path.join(path.dirname(require.resolve('node-notifier/package.json')), 'vendor', 'snoreToast', `snoretoast-${process.arch === 'ia32' ? 'x86' : 'x64'}.exe`);
    if (!registered) {
      const shortcut = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AutoUPDomain Notifications.lnk');
      try { await access(shortcut); } catch { await command(binary, ['-install', shortcut, binary, appId]); }
      registered = true;
    }
    // SnoreToast exits 1/2/3 when hidden/dismissed/timed out: those are delivered notifications.
    await new Promise((resolve, reject) => {
      execFile(binary, ['-appID', appId, '-t', title, '-m', body, '-p', icon, '-silent'], { windowsHide: true, timeout: 20000 }, error => {
        if (!error || (!error.killed && [1, 2, 3].includes(error.code))) resolve();
        else reject(new Error('Windows 通知服務未接受通知'));
      });
    });
  };
}

export async function loginSetting(enabled) {
  if (process.platform === 'win32') {
    const directory = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const target = path.join(directory, 'AutoUPDomain.vbs');
    if (!enabled) { await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; }); return; }
    const quote = value => '"' + value + '"';
    const commandLine = `${quote(process.execPath)} ${quote(path.join(projectRoot, 'src', 'main.js'))} --no-open`;
    await mkdir(directory, { recursive: true });
    // UTF-16LE preserves non-ASCII Windows usernames and project paths in WScript.
    await writeFile(target, '\ufeffCreateObject("WScript.Shell").Run "' + commandLine.replaceAll('"', '""') + '", 0, False\r\n', 'utf16le');
  } else {
    const directory = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart');
    const target = path.join(directory, 'autoupdomain.desktop');
    if (!enabled) { await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; }); return; }
    const quote = value => '"' + value.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&') + '"';
    await mkdir(directory, { recursive: true });
    await writeFile(target, `[Desktop Entry]\nType=Application\nName=AutoUPDomain\nExec=${quote(process.execPath)} ${quote(path.join(projectRoot, 'src', 'main.js'))} --no-open\nTerminal=false\n`, { mode: 0o600 });
  }
}
