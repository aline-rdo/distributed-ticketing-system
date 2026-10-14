import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import {
  client,
  postPayment,
  rpc,
  startPeer,
  startService,
} from './helpers.mjs';

const firstCheckout = {
  cart: [{ id: 17, name: 'Sexta', price: 125 }],
  total: 131.25,
};
const secondCheckout = {
  cart: [{ id: 29, name: 'Sábado', price: 42.5 }],
  total: 44.625,
};

function managedClient(t, serviceName, address) {
  const rpcClient = client(serviceName, address);
  t.after(() => rpcClient.close());
  return rpcClient;
}

async function waitForOutput(service, expected) {
  const deadline = Date.now() + 1000;
  while (!service.output().includes(expected) && Date.now() < deadline) {
    await delay(20);
  }
  assert.ok(service.output().includes(expected), `missing log ${JSON.stringify(expected)}`);
}

test('the evaluator exchanges protobuf messages with a controlled gRPC peer', { timeout: 90000 }, async (t) => {
  const peer = await startPeer(t, 'TicketsService', {
    createTicket(call, callback) {
      assert.deepEqual(call.request, {
        userId: 'helper-check',
        cart: [{ id: 7, name: 'Peer', price: 10.5 }],
      });
      callback(null, {
        ticketId: 'peer-ticket',
        ticketResult: 'success',
        emailResult: 'success',
      });
    },
  });
  const tickets = managedClient(t, 'TicketsService', peer.address);

  assert.deepEqual(await rpc(tickets, 'createTicket', {
    userId: 'helper-check',
    cart: [{ id: 7, name: 'Peer', price: 10.5 }],
  }), {
    ticketId: 'peer-ticket',
    ticketResult: 'success',
    emailResult: 'success',
  });
});

test('two complete checkouts preserve results, values, events, and the three delays', { timeout: 90000 }, async (t) => {
  const analytics = await startService(t, 'analytics');
  const email = await startService(t, 'email', {
    ANALYTICS_SERVICE_ADDRESS: analytics.address,
  });
  const tickets = await startService(t, 'tickets', {
    ANALYTICS_SERVICE_ADDRESS: analytics.address,
    EMAIL_SERVICE_ADDRESS: email.address,
  });
  const payment = await startService(t, 'payment', {
    ANALYTICS_SERVICE_ADDRESS: analytics.address,
    TICKETS_SERVICE_ADDRESS: tickets.address,
  });

  for (const checkout of [firstCheckout, secondCheckout]) {
    const startedAt = performance.now();
    const response = await postPayment(payment.address, checkout);
    const duration = performance.now() - startedAt;

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.paymentResult, 'success');
    assert.equal(result.ticketResult, 'success');
    assert.equal(result.emailResult, 'success');
    assert.match(result.ticketId, /^[0-9a-f-]{36}$/);
    assert.ok(duration >= 8900, `complete checkout finished in ${duration} ms`);

    await waitForOutput(analytics, `made a payment of €${checkout.total}`);
    await waitForOutput(analytics, `created ticket ${result.ticketId}`);
    await waitForOutput(analytics, `received email for ticket ${result.ticketId}`);
  }
});
