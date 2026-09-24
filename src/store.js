import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

/** 串行寫入暫存檔後 rename，避免設定與紀錄同時儲存時互相覆蓋。 */
export function createStore(directory) {
  let queue = Promise.resolve();
  return {
    async read(name, fallback) {
      try {
        return JSON.parse(await readFile(path.join(directory, name + '.json'), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw new Error(`${name} 資料無法讀取，請備份並檢查使用者資料目錄`);
      }
    },
    write(name, value) {
      const content = JSON.stringify(value, null, 2);
      const operation = queue
        .catch(() => {})
        .then(async () => {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const target = path.join(directory, name + '.json');
          await writeFile(target + '.tmp', content, { mode: 0o600 });
          await rename(target + '.tmp', target);
        });
      queue = operation;
      return operation;
    },
  };
}
