import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const cart = [{ id: 1, name: 'Friday', price: 125 }];
const ports = { payment: 18000, tickets: 18001, email: 18002, analytics: 18003 };
const url = (service) => `http://127.0.0.1:${ports[service]}`;
const post = (service, path, body) => fetch(`${url(service)}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
});

async function start(service) {
  const child = spawn(process.execPath, [`microservices/${service}-service/index.js`], {
    env: { ...process.env, PORT: String(ports[service]),
      TICKETS_SERVICE_URL: url('tickets'), EMAIL_SERVICE_URL: url('email'),
      ANALYTICS_SERVICE_URL: url('analytics') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  };
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${url(service)}/health`, { signal: AbortSignal.timeout(200) });
      if (response.ok) return { stop, output: () => output };
    } catch {}
    if (child.exitCode !== null) break;
    await delay(100);
  }
  await stop();
  assert.fail(`${service} did not expose a healthy HTTP endpoint: ${output}`);
}

test('HTTP checkout and failure behavior', { timeout: 90000 }, async (t) => {
  const services = {};
  t.after(async () => { await Promise.all(Object.values(services).map((s) => s.stop())); });
  for (const name of ['analytics', 'email', 'tickets', 'payment']) services[name] = await start(name);

  await t.test('checkout returns the completed ticket and email and records all events', async () => {
    const response = await post('payment', '/payment-service', { cart, total: 131.25 });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.paymentResult, 'success');
    assert.equal(result.ticketResult, 'success');
    assert.equal(result.emailResult, 'success');
    assert.match(result.ticketId, /^[0-9a-f-]{36}$/);
    const output = services.analytics.output();
    assert.match(output, /made a payment of.*131.25/);
    assert.ok(output.includes(`created ticket ${result.ticketId}`));
    assert.ok(output.includes(`received email for ticket ${result.ticketId}`));
  });

  await t.test('rejects invalid checkout before processing', async () => {
    for (const body of [null, {}, { cart: [], total: 0 }, { cart, total: -1 },
      { cart, total: '131.25' }, { cart: [null], total: 10 }, { cart: [{ price: -1 }], total: 10 }]) {
      const response = await post('payment', '/payment-service', body);
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    const response = await fetch(`${url('payment')}/payment-service`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(response.status, 400);
  });

  await t.test('validates the internal HTTP contracts', async () => {
    for (const [service, path, body] of [
      ['tickets', '/tickets', { cart }],
      ['email', '/emails', { userId: 'user', ticketId: 'id', ticketResult: 'failed' }],
      ['analytics', '/events', { type: 'unknown', data: {} }],
      ['analytics', '/events', { type: 'payments', data: {} }],
    ]) assert.equal((await post(service, path, body)).status, 400);
  });

  await t.test('analytics outage does not fail checkout', async () => {
    await services.analytics.stop();
    const response = await post('payment', '/payment-service', { cart, total: 131.25 });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).emailResult, 'success');
    assert.match(services.payment.output(), /Analytics reporting failed/);
  });

  await t.test('email outage propagates as a failed checkout', async () => {
    await services.email.stop();
    const response = await post('payment', '/payment-service', { cart, total: 131.25 });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /tickets/i);
  });
});
