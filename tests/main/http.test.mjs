import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';

for (const service of ['payment', 'tickets', 'email']) {
  const { postJson } = await import(`../../microservices/${service}-service/http.js`);
  test(`${service} HTTP client rejects failed and stalled downstream responses`, async (t) => {
    const server = createServer((req, res) => {
      if (req.url === '/failed') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end('{"error":"Unavailable"}');
      }
      // /stalled deliberately never responds; the client must abort it.
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(postJson(`${base}/failed`, {}), { status: 502 });
    await assert.rejects(postJson(`${base}/stalled`, {}, 100), (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.cause.name, 'TimeoutError');
      return true;
    });
  });
}
