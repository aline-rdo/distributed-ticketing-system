import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const checkoutProto = fileURLToPath(new URL('../../proto/checkout.proto', import.meta.url));
const healthProto = fileURLToPath(new URL('../../proto/health.proto', import.meta.url));

const loaderOptions = {
  keepCase: true,
  defaults: false,
  oneofs: true,
};

const checkoutPackage = grpc.loadPackageDefinition(
  protoLoader.loadSync(checkoutProto, loaderOptions),
).cin0143.entrega1;
const healthPackage = grpc.loadPackageDefinition(
  protoLoader.loadSync(healthProto, loaderOptions),
).grpc.health.v1;

const serviceTypes = {
  TicketsService: checkoutPackage.TicketsService,
  EmailService: checkoutPackage.EmailService,
  AnalyticsService: checkoutPackage.AnalyticsService,
};

const ports = {
  payment: 18000,
  tickets: 18001,
  email: 18002,
  analytics: 18003,
};

const serviceAddresses = {
  TICKETS_SERVICE_ADDRESS: `127.0.0.1:${ports.tickets}`,
  EMAIL_SERVICE_ADDRESS: `127.0.0.1:${ports.email}`,
  ANALYTICS_SERVICE_ADDRESS: `127.0.0.1:${ports.analytics}`,
};

function serviceType(serviceName) {
  const type = serviceTypes[serviceName];
  assert.ok(type, `Unknown gRPC service: ${serviceName}`);
  return type;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = once(child, 'exit').catch(() => undefined);
  child.kill('SIGTERM');
  let killTimer;
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => {
      killTimer = setTimeout(() => resolve(false), 2000);
      killTimer.unref();
    }),
  ]);
  clearTimeout(killTimer);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function waitForHttpHealth(address, child, deadline) {
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://${address}/health`, {
        signal: AbortSignal.timeout(250),
      });
      if (response.ok) return true;
    } catch {}
    await delay(100);
  }
  return false;
}

async function waitForGrpcHealth(address, child, deadline) {
  const healthClient = new healthPackage.Health(
    address,
    grpc.credentials.createInsecure(),
  );
  try {
    while (Date.now() < deadline && child.exitCode === null) {
      const attemptDeadline = Math.min(deadline, Date.now() + 300);
      try {
        const response = await new Promise((resolve, reject) => {
          healthClient.check(
            { service: '' },
            { deadline: attemptDeadline },
            (error, value) => error ? reject(error) : resolve(value),
          );
        });
        if (response.status === 1 || response.status === 'SERVING') return true;
      } catch {}
      await delay(100);
    }
    return false;
  } finally {
    healthClient.close();
  }
}

export async function startService(t, name, env = {}) {
  assert.ok(Object.hasOwn(ports, name), `Unknown service process: ${name}`);

  const port = ports[name];
  const address = `127.0.0.1:${port}`;
  const entrypoint = fileURLToPath(
    new URL(`../../microservices/${name}-service/index.js`, import.meta.url),
  );
  let processOutput = '';
  const child = spawn(process.execPath, [entrypoint], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...serviceAddresses,
      PORT: String(port),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => { processOutput += data; });
  child.stderr.on('data', (data) => { processOutput += data; });
  child.on('error', (error) => { processOutput += `${error.stack ?? error}\n`; });

  let stopping;
  const stop = () => {
    stopping ??= stopChild(child);
    return stopping;
  };
  t.after(stop);

  const readinessDeadline = Date.now() + 10000;
  const ready = name === 'payment'
    ? await waitForHttpHealth(address, child, readinessDeadline)
    : await waitForGrpcHealth(address, child, readinessDeadline);

  if (!ready) {
    await stop();
    const interfaceName = name === 'payment'
      ? `HTTP GET /health at http://${address}`
      : `gRPC grpc.health.v1.Health/Check at ${address}`;
    assert.fail(
      `${name} service did not expose ${interfaceName} within 10 seconds.\n${processOutput}`,
    );
  }

  return { address, output: () => processOutput, stop };
}

export async function startPeer(t, serviceName, handlers) {
  const server = new grpc.Server();
  const handlerErrors = [];
  const guardedHandlers = Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [method, (call, callback) => {
      let callbackCalled = false;
      const guardedCallback = (error, value) => {
        if (callbackCalled) return;
        callbackCalled = true;
        callback(error, value);
      };
      const rejectHandler = (error) => {
        handlerErrors.push(error);
        if (!callbackCalled) {
          guardedCallback({
            code: grpc.status.INTERNAL,
            details: `Controlled ${serviceName} handler failed: ${error.message}`,
          });
        }
      };

      try {
        const result = handler(call, guardedCallback);
        if (result && typeof result.then === 'function') result.catch(rejectHandler);
      } catch (error) {
        rejectHandler(error);
      }
    }]),
  );
  server.addService(serviceType(serviceName).service, guardedHandlers);

  t.after(() => {
    server.forceShutdown();
    if (handlerErrors.length > 0) throw handlerErrors[0];
  });

  const port = await new Promise((resolve, reject) => {
    server.bindAsync(
      '127.0.0.1:0',
      grpc.ServerCredentials.createInsecure(),
      (error, boundPort) => error ? reject(error) : resolve(boundPort),
    );
  });
  return { address: `127.0.0.1:${port}` };
}

export function client(serviceName, address) {
  const Service = serviceType(serviceName);
  return new Service(address, grpc.credentials.createInsecure());
}

export function rpc(rpcClient, method, data) {
  return new Promise((resolve, reject) => {
    rpcClient[method](data, { deadline: Date.now() + 30000 }, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

export function postPayment(address, data) {
  return fetch(`http://${address}/payment-service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
}
