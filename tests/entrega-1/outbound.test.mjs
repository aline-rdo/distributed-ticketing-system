import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import grpc from '@grpc/grpc-js';

import {
  client,
  postPayment,
  rpc,
  startPeer,
  startService,
} from './helpers.mjs';

const fullCart = [{
  id: 17,
  name: 'Sexta',
  price: 125,
  image: '/day1.jpeg',
  date: '11 de setembro de 2026',
  category: 'Música',
  location: 'Recife',
  description: 'Festival no Marco Zero',
}];

const otherCart = [{
  id: 29,
  name: 'Sábado',
  price: 42.5,
  image: '/day2.jpeg',
  date: '12 de setembro de 2026',
  category: 'Teatro',
  location: 'Olinda',
  description: 'Apresentação no teatro',
}];

function managedClient(t, serviceName, address) {
  const rpcClient = client(serviceName, address);
  t.after(() => rpcClient.close());
  return rpcClient;
}

function unavailable(details) {
  return { code: grpc.status.UNAVAILABLE, details };
}

async function expectInvalid(call, message) {
  const startedAt = performance.now();
  await assert.rejects(call, { code: grpc.status.INVALID_ARGUMENT });
  assert.ok(performance.now() - startedAt < 2900, message);
}

async function waitForOutput(service, expected) {
  const deadline = Date.now() + 1000;
  while (!service.output().includes(expected) && Date.now() < deadline) {
    await delay(20);
  }
  assert.ok(service.output().includes(expected), `missing log ${JSON.stringify(expected)}`);
}

test('payment sends the complete cart and total to gRPC peers without application deadlines', { timeout: 90000 }, async (t) => {
  const ticketRequests = [];
  const paymentEvents = [];
  const tickets = await startPeer(t, 'TicketsService', {
    createTicket(call, callback) {
      assert.equal(call.getDeadline(), Infinity);
      ticketRequests.push(call.request);
      callback(null, {
        ticketId: ticketRequests.length === 1
          ? 'ticket-from-grpc-peer'
          : 'ticket-from-second-fixture',
        ticketResult: 'success',
        emailResult: 'success',
      });
    },
  });
  const analytics = await startPeer(t, 'AnalyticsService', {
    recordEvent(call, callback) {
      assert.equal(call.getDeadline(), Infinity);
      paymentEvents.push(call.request);
      callback(null, { status: 'recorded' });
    },
  });
  const payment = await startService(t, 'payment', {
    TICKETS_SERVICE_ADDRESS: tickets.address,
    ANALYTICS_SERVICE_ADDRESS: analytics.address,
  });

  const fixtures = [
    { cart: fullCart, total: 131.25, ticketId: 'ticket-from-grpc-peer' },
    { cart: otherCart, total: 44.625, ticketId: 'ticket-from-second-fixture' },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const startedAt = performance.now();
    const response = await postPayment(payment.address, {
      cart: fixture.cart,
      total: fixture.total,
    });
    const duration = performance.now() - startedAt;
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      paymentResult: 'success',
      ticketId: fixture.ticketId,
      ticketResult: 'success',
      emailResult: 'success',
    });
    assert.ok(duration >= 2900, `payment operation finished in ${duration} ms`);

    assert.match(ticketRequests[index].userId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(ticketRequests[index].cart, fixture.cart);
    assert.deepEqual(paymentEvents[index], {
      type: 'payments',
      payment: {
        userId: ticketRequests[index].userId,
        cart: fixture.cart,
        total: fixture.total,
        paymentResult: 'success',
      },
      data: 'payment',
    });
  }
});

test('payment rejects invalid HTTP input before delays or outbound calls', { timeout: 90000 }, async (t) => {
  let ticketCalls = 0;
  let analyticsCalls = 0;
  const tickets = await startPeer(t, 'TicketsService', {
    createTicket(call, callback) {
      ticketCalls += 1;
      callback(null, {
        ticketId: 'unexpected', ticketResult: 'success', emailResult: 'success',
      });
    },
  });
  const analytics = await startPeer(t, 'AnalyticsService', {
    recordEvent(call, callback) {
      analyticsCalls += 1;
      callback(null, { status: 'recorded' });
    },
  });
  const payment = await startService(t, 'payment', {
    TICKETS_SERVICE_ADDRESS: tickets.address,
    ANALYTICS_SERVICE_ADDRESS: analytics.address,
  });

  const invalidBodies = [
    { cart: [], total: 10 },
    { cart: [{ id: 1, name: 'Negative', price: -1 }], total: 10 },
    { cart: [{ id: 1, name: 'Missing price' }], total: 10 },
    { cart: fullCart, total: 0 },
    { cart: fullCart, total: '131.25' },
  ];
  for (const body of invalidBodies) {
    const startedAt = performance.now();
    const response = await postPayment(payment.address, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok(
      performance.now() - startedAt < 2900,
      `invalid payment performed simulated work for ${JSON.stringify(body)}`,
    );
  }
  assert.equal(ticketCalls, 0);
  assert.equal(analyticsCalls, 0);
});

test('payment tolerates analytics UNAVAILABLE but maps ticket UNAVAILABLE to HTTP 502', { timeout: 90000 }, async (t) => {
  let failAnalytics = true;
  let failTickets = false;
  let analyticsCalls = 0;
  let ticketCalls = 0;
  const analytics = await startPeer(t, 'AnalyticsService', {
    recordEvent(call, callback) {
      assert.equal(call.getDeadline(), Infinity);
      analyticsCalls += 1;
      callback(failAnalytics ? unavailable('analytics unavailable') : null, { status: 'recorded' });
    },
  });
  const tickets = await startPeer(t, 'TicketsService', {
    createTicket(call, callback) {
      assert.equal(call.getDeadline(), Infinity);
      ticketCalls += 1;
      if (failTickets) callback(unavailable('tickets unavailable'));
      else callback(null, {
        ticketId: 'ticket-after-analytics-failure',
        ticketResult: 'success',
        emailResult: 'success',
      });
    },
  });
  const payment = await startService(t, 'payment', {
    TICKETS_SERVICE_ADDRESS: tickets.address,
    ANALYTICS_SERVICE_ADDRESS: analytics.address,
  });

  let response = await postPayment(payment.address, { cart: otherCart, total: 44.625 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ticketId, 'ticket-after-analytics-failure');
  assert.equal(analyticsCalls, 1);
  assert.equal(ticketCalls, 1);

  failAnalytics = false;
  failTickets = true;
  response = await postPayment(payment.address, { cart: otherCart, total: 44.625 });
  assert.equal(response.status, 502);
  assert.equal(analyticsCalls, 2);
  assert.equal(ticketCalls, 2);
});

test('tickets validates input and preserves its UUID, userId, cart, email result, and events', { timeout: 90000 }, async (t) => {
  let failAnalytics = false;
  let failEmail = false;
  const emailRequests = [];
  const ticketEvents = [];
  const email = await startPeer(t, 'EmailService', {
    sendEmail(call, callback) {
      assert.equal(call.getDeadline(), Infinity);
      emailRequests.push(call.request);
      if (failEmail) callback(unavailable('email unavailable'));
      else callback(null, {
        emailResult: failAnalytics ? 'delivered-after-analytics-failure' : 'success',
      });
    },
  });
  const analytics = await startPeer(t, 'AnalyticsService', {
    recordEvent(call, callback) {
      assert.equal(call.getDeadline(), Infinity);
      ticketEvents.push(call.request);
      if (failAnalytics) callback(unavailable('analytics unavailable'));
      else callback(null, { status: 'recorded' });
    },
  });
  const service = await startService(t, 'tickets', {
    EMAIL_SERVICE_ADDRESS: email.address,
    ANALYTICS_SERVICE_ADDRESS: analytics.address,
  });
  const tickets = managedClient(t, 'TicketsService', service.address);

  for (const [request, label] of [
    [{ userId: '', cart: fullCart }, 'empty userId'],
    [{ userId: 'aluno', cart: [] }, 'empty cart'],
    [{ userId: 'aluno', cart: [{ id: 1, name: 'Negative', price: -1 }] }, 'negative price'],
    [{ userId: 'aluno', cart: [{ id: 1, name: 'Missing price' }] }, 'missing price'],
  ]) {
    await expectInvalid(rpc(tickets, 'createTicket', request), `${label} reached simulated work`);
  }
  assert.equal(emailRequests.length, 0);
  assert.equal(ticketEvents.length, 0);

  let startedAt = performance.now();
  const result = await rpc(tickets, 'createTicket', { userId: 'aluno-17', cart: fullCart });
  assert.ok(performance.now() - startedAt >= 2900, 'ticket creation skipped its three-second delay');
  assert.match(result.ticketId, /^[0-9a-f-]{36}$/);
  assert.equal(result.ticketResult, 'success');
  assert.equal(result.emailResult, 'success');
  assert.deepEqual(emailRequests[0], {
    userId: 'aluno-17',
    ticketId: result.ticketId,
    ticketResult: 'success',
  });
  assert.deepEqual(ticketEvents[0], {
    type: 'tickets',
    ticket: {
      userId: 'aluno-17',
      ticketId: result.ticketId,
      ticketResult: 'success',
    },
    data: 'ticket',
  });

  failAnalytics = true;
  startedAt = performance.now();
  const tolerated = await rpc(tickets, 'createTicket', { userId: 'aluno-29', cart: otherCart });
  assert.ok(performance.now() - startedAt >= 2900, 'ticket creation skipped its delay');
  assert.equal(tolerated.emailResult, 'delivered-after-analytics-failure');
  assert.equal(emailRequests[1].userId, 'aluno-29');
  assert.equal(emailRequests[1].ticketId, tolerated.ticketId);
  assert.deepEqual(ticketEvents[1].ticket, {
    userId: 'aluno-29',
    ticketId: tolerated.ticketId,
    ticketResult: 'success',
  });

  failAnalytics = false;
  failEmail = true;
  startedAt = performance.now();
  await assert.rejects(
    rpc(tickets, 'createTicket', { userId: 'aluno-failure', cart: fullCart }),
    { code: grpc.status.UNAVAILABLE },
  );
  assert.ok(performance.now() - startedAt >= 2900, 'email failure bypassed ticket creation');
});

test('email validates input, reports real values without a deadline, and tolerates analytics failure', { timeout: 90000 }, async (t) => {
  let failAnalytics = false;
  const emailEvents = [];
  const analytics = await startPeer(t, 'AnalyticsService', {
    recordEvent(call, callback) {
      assert.equal(call.getDeadline(), Infinity);
      emailEvents.push(call.request);
      if (failAnalytics) callback(unavailable('analytics unavailable'));
      else callback(null, { status: 'recorded' });
    },
  });
  const service = await startService(t, 'email', {
    ANALYTICS_SERVICE_ADDRESS: analytics.address,
  });
  const email = managedClient(t, 'EmailService', service.address);

  for (const [request, label] of [
    [{ userId: '', ticketId: 'abc', ticketResult: 'success' }, 'empty userId'],
    [{ userId: 'aluno', ticketId: '', ticketResult: 'success' }, 'empty ticketId'],
    [{ userId: 'aluno', ticketId: 'abc', ticketResult: 'failed' }, 'failed ticket'],
  ]) {
    await expectInvalid(rpc(email, 'sendEmail', request), `${label} reached simulated work`);
  }
  assert.equal(emailEvents.length, 0);

  let startedAt = performance.now();
  assert.deepEqual(await rpc(email, 'sendEmail', {
    userId: 'aluno', ticketId: 'ticket-real-1', ticketResult: 'success',
  }), { emailResult: 'success' });
  assert.ok(performance.now() - startedAt >= 2900, 'email skipped its three-second delay');
  assert.deepEqual(emailEvents[0], {
    type: 'emails',
    email: { userId: 'aluno', ticketId: 'ticket-real-1', emailResult: 'success' },
    data: 'email',
  });

  failAnalytics = true;
  startedAt = performance.now();
  assert.deepEqual(await rpc(email, 'sendEmail', {
    userId: 'outage-user', ticketId: 'ticket-real-2', ticketResult: 'success',
  }), { emailResult: 'success' });
  assert.ok(performance.now() - startedAt >= 2900, 'email skipped its delay during analytics failure');
  assert.deepEqual(emailEvents[1].email, {
    userId: 'outage-user', ticketId: 'ticket-real-2', emailResult: 'success',
  });
});

test('analytics accepts all event variants, logs received values, and rejects invalid oneofs', { timeout: 90000 }, async (t) => {
  const service = await startService(t, 'analytics');
  const analytics = managedClient(t, 'AnalyticsService', service.address);

  assert.deepEqual(await rpc(analytics, 'recordEvent', {
    type: 'payments',
    payment: { userId: 'user-pay', cart: fullCart, total: 131.25, paymentResult: 'success' },
  }), { status: 'recorded' });
  assert.deepEqual(await rpc(analytics, 'recordEvent', {
    type: 'tickets',
    ticket: { userId: 'user-ticket', ticketId: 'ticket-123', ticketResult: 'success' },
  }), { status: 'recorded' });
  assert.deepEqual(await rpc(analytics, 'recordEvent', {
    type: 'emails',
    email: { userId: 'user-email', ticketId: 'ticket-456', emailResult: 'success' },
  }), { status: 'recorded' });

  await waitForOutput(service, 'User user-pay made a payment of €131.25');
  await waitForOutput(service, 'User user-ticket created ticket ticket-123');
  await waitForOutput(service, 'User user-email received email for ticket ticket-456');

  for (const request of [
    { type: 'unknown', payment: { userId: 'user', total: 10, paymentResult: 'success' } },
    { type: 'payments', ticket: { userId: 'user', ticketId: 'id', ticketResult: 'success' } },
    { type: 'payments', payment: { userId: '', total: 10, paymentResult: 'success' } },
    { type: 'payments', payment: { userId: 'user', total: 0, paymentResult: 'success' } },
    { type: 'emails', email: { userId: 'user', ticketId: '', emailResult: 'success' } },
    { type: 'emails' },
  ]) {
    await assert.rejects(
      rpc(analytics, 'recordEvent', request),
      { code: grpc.status.INVALID_ARGUMENT },
      JSON.stringify(request),
    );
  }
});
