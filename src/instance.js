import net from 'node:net';
import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

// 使用由作業系統管理的 socket／named pipe；程序死亡後會釋放，不靠過期 PID 猜測。
export async function acquireInstance(directory, getUrl) {
  const name = createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0, 24);
  const address =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\AutoUPDomain-${name}`
      : path.join(directory, 'instance.sock');
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.end(getUrl() || '');
  });
  const listen = () =>
    new Promise((resolve, reject) => {
      const error = (err) => {
        server.off('listening', ready);
        reject(err);
      };
      const ready = () => {
        server.off('error', error);
        resolve();
      };
      server.once('error', error);
      server.once('listening', ready);
      server.listen(address);
    });
  try {
    await listen();
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    try {
      const url = await new Promise((resolve, reject) => {
        const socket = net.connect(address);
        let value = '';
        socket.setTimeout(2000, () => socket.destroy(new Error('現有程式未回應')));
        socket.on('data', (chunk) => {
          value += chunk;
        });
        socket.on('end', () => resolve(value));
        socket.on('error', reject);
      });
      return { existing: true, url };
    } catch (connectionError) {
      if (process.platform === 'win32' || connectionError.code !== 'ECONNREFUSED')
        throw connectionError;
      // Linux 可能留下已死亡程序的 socket 路徑；僅在確認連線被拒絕後清理。
      await unlink(address);
      await listen();
    }
  }
  return { existing: false, close: () => new Promise((resolve) => server.close(resolve)) };
}
