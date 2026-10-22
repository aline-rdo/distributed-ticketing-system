import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import { createTicket } from "./db.js";

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

const validText = (value) =>
  typeof value === "string" && value.trim().length > 0;

const validCart = (cart) =>
  Array.isArray(cart) &&
  cart.length > 0 &&
  cart.every(
    (item) =>
      item &&
      Object.hasOwn(item, "price") &&
      Number.isFinite(item.price) &&
      item.price >= 0
  );

const invalidArgument = (message) => ({
  code: grpc.status.INVALID_ARGUMENT,
  details: message,
});

const emailAddress =
  process.env.EMAIL_SERVICE_ADDRESS || "localhost:8002";

const analyticsAddress =
  process.env.ANALYTICS_SERVICE_ADDRESS || "localhost:8003";

const email = new checkout.EmailService(
  emailAddress,
  grpc.credentials.createInsecure()
);

const analytics = new checkout.AnalyticsService(
  analyticsAddress,
  grpc.credentials.createInsecure()
);

function callGrpc(client, method, request) {
  return new Promise((resolve, reject) => {
    // Sem deadline de aplicação.
    client[method](request, (error, response) => {
      if (error) return reject(error);
      resolve(response);
    });
  });
}

async function createTicketHandler(call, callback) {
  const { userId, cart } = call.request;

  // Valida antes de qualquer atraso ou chamada externa.
  if (!validText(userId) || !validCart(cart)) {
    return callback(
      invalidArgument("Invalid ticket request")
    );
  }

  let ticketId;

  try {
    // Preserva o UUID e o atraso de 3 segundos do db.js.
    ticketId = await createTicket(cart, userId);
  } catch (error) {
    console.error("Ticket creation failed:", error);
    return callback({
      code: grpc.status.INTERNAL,
      details: "Ticket creation failed",
    });
  }

  const ticketResult = "success";

  // Analytics pode falhar sem impedir a criação do ingresso.
  try {
    await callGrpc(analytics, "recordEvent", {
      type: "tickets",
      ticket: {
        userId,
        ticketId,
        ticketResult,
      },
    });
  } catch (error) {
    console.error(
      "Analytics reporting failed:",
      error.message
    );
  }

  // Uma falha do serviço de e-mail deve ser propagada.
  try {
    const { emailResult } = await callGrpc(
      email,
      "sendEmail",
      {
        userId,
        ticketId,
        ticketResult,
      }
    );

    callback(null, {
      ticketId,
      ticketResult,
      emailResult,
    });
  } catch (error) {
    console.error("Email service failed:", error.message);
    callback(error);
  }
}

const server = new grpc.Server();

server.addService(
  checkout.TicketsService.service,
  { createTicket: createTicketHandler }
);

server.addService(
  health.Health.service,
  {
    check(call, callback) {
      callback(null, { status: "SERVING" });
    },
  }
);

const port = process.env.PORT || 8001;

server.bindAsync(
  `0.0.0.0:${port}`,
  grpc.ServerCredentials.createInsecure(),
  (error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }

    console.log(
      `Tickets gRPC service running on port ${port}`
    );
  }
);
