import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function startServer({
  service,
  configure,
  testNotification,
  capabilities = {},
  port = 0,
}) {
  // 只用於本機面板的授權，每次啟動更新；與網域 API 密鑰及持久化設定無關。
  const token = randomBytes(32).toString('hex');
  const assets = new Map([
    ['/', ['index.html', 'text/html']],
    ['/app.js', ['app.js', 'text/javascript']],
    ['/theme.js', ['theme.js', 'text/javascript']],
    ['/style.css', ['style.css', 'text/css']],
  ]);
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      // 即使只監聽 loopback，也拒絕其他網站的跨來源操作與 DNS rebinding。
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        return reply(403, { error: '來源不允許' });
      if (req.method === 'GET' && req.url === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET' && assets.has(req.url)) {
        const [file, type] = assets.get(req.url);
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
        return res.end(await readFile(new URL('../web/' + file, import.meta.url)));
      }
      const auth = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from('Bearer ' + token);
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected))
        return reply(401, { error: '請從系統托盤重新開啟面板' });
      if (req.method === 'GET' && req.url === '/api/state')
        return reply(200, { ...service.snapshot(), capabilities });
      if (req.method !== 'POST') return reply(404, { error: '找不到操作' });
      if (req.headers['content-type'] !== 'application/json')
        return reply(415, { error: '需要 JSON' });
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 16384) return reply(413, { error: '內容過大' });
      }
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return reply(400, { error: 'JSON 格式錯誤' });
      }
      if (req.url === '/api/run') {
        if (!service.config.apiKey || !service.config.apiSecret)
          return reply(400, { error: '請先設定 API 憑證' });
        // 立即回應，讓面板在背景檢查進行時仍能輪詢日誌。
        service.run('manual').catch((error) => service.emit('background-error', error));
        return reply(202, { ok: true });
      }
      if (req.url === '/api/settings') {
        await configure(body);
        return reply(200, { ok: true });
      }
      if (req.url === '/api/notification-test') {
        const failures = await testNotification();
        return reply(200, { ok: failures.length === 0, failures });
      }
      if (req.url === '/api/logs/clear') {
        await service.clearHistory();
        return reply(200, { ok: true });
      }
      return reply(404, { error: '找不到操作' });
    } catch (error) {
      reply(400, { error: error.message });
    }
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, url: `${origin}/#${token}` };
}
