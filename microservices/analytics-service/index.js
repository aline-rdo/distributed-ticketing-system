import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";

const checkoutPath = fileURLToPath(
  new URL("../../proto/checkout.proto", import.meta.url)
);

const healthPath = fileURLToPath(
  new URL("../../proto/health.proto", import.meta.url)
);

const loaderOptions = {
  keepCase: true,
  defaults: false,
  oneofs: true,
};

const checkout = grpc.loadPackageDefinition(
  protoLoader.loadSync(checkoutPath, loaderOptions)
).cin0143.entrega1;

const health = grpc.loadPackageDefinition(
  protoLoader.loadSync(healthPath, loaderOptions)
).grpc.health.v1;

const invalidArgument = (message) => ({
  code: grpc.status.INVALID_ARGUMENT,
  details: message,
});

const validText = (value) =>
  typeof value === "string" && value.trim().length > 0;

function validCart(cart) {
  return Array.isArray(cart) &&
    cart.length > 0 &&
    cart.every((item) =>
      item &&
      Object.hasOwn(item, "price") &&
      Number.isFinite(item.price) &&
      item.price >= 0
    );
}

function recordEvent(call, callback) {
  const request = call.request;

  const fields = {
    payments: "payment",
    tickets: "ticket",
    emails: "email",
  };

  const field = fields[request.type];
  const event = field ? request[field] : undefined;

  if (!field || request.data !== field || !event ||
      !validText(event.userId)) {
    return callback(invalidArgument("Invalid event"));
  }

  if (request.type === "payments") {
    if (!Number.isFinite(event.total) ||
        event.total <= 0 ||
        event.paymentResult !== "success" ||
        !validCart(event.cart)) {
      return callback(invalidArgument("Invalid payment event"));
    }

    console.log(
      `Analytics - User ${event.userId} made a payment of €${event.total}. Payment result: ${event.paymentResult}`
    );
  } else if (request.type === "tickets") {
    if (!validText(event.ticketId) ||
        event.ticketResult !== "success") {
      return callback(invalidArgument("Invalid ticket event"));
    }

    console.log(
      `Analytics - User ${event.userId} created ticket ${event.ticketId}. Ticket result: ${event.ticketResult}`
    );
  } else {
    if (!validText(event.ticketId) ||
        event.emailResult !== "success") {
      return callback(invalidArgument("Invalid email event"));
    }

    console.log(
      `Analytics - User ${event.userId} received email for ticket ${event.ticketId}. Email result: ${event.emailResult}`
    );
  }

  callback(null, { status: "recorded" });
}

const server = new grpc.Server();

server.addService(
  checkout.AnalyticsService.service,
  { recordEvent }
);

server.addService(
  health.Health.service,
  {
    check(call, callback) {
      callback(null, { status: "SERVING" });
    },
  }
);

const port = process.env.PORT || 8003;

server.bindAsync(
  `0.0.0.0:${port}`,
  grpc.ServerCredentials.createInsecure(),
  (error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }

    console.log(
      `Analytics gRPC service running on port ${port}`
    );
  }
);
