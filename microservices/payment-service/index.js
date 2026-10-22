import express from "express";
import cors from "cors";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";

import { pay } from "./db.js";
import { authMiddleware } from "./middleware/auth.js";
import { retainCheckoutMemory } from "./entrega-3-memory.js";

const checkoutPath = fileURLToPath(
  new URL("../../proto/checkout.proto", import.meta.url)
);

const loaderOptions = {
  keepCase: true,
  defaults: false,
  oneofs: true,
};

const checkout = grpc.loadPackageDefinition(
  protoLoader.loadSync(checkoutPath, loaderOptions)
).cin0143.entrega1;

const ticketsAddress =
  process.env.TICKETS_SERVICE_ADDRESS || "localhost:8001";

const analyticsAddress =
  process.env.ANALYTICS_SERVICE_ADDRESS || "localhost:8003";

const tickets = new checkout.TicketsService(
  ticketsAddress,
  grpc.credentials.createInsecure()
);

const analytics = new checkout.AnalyticsService(
  analyticsAddress,
  grpc.credentials.createInsecure()
);

// Chamadas gRPC sem deadline de aplicacao.
function callGrpc(client, method, request) {
  return new Promise((resolve, reject) => {
    client[method](request, (error, response) => {
      if (error) return reject(error);
      resolve(response);
    });
  });
}

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

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN ||
      "http://localhost:3000",
  })
);

app.use(express.json());
app.use(retainCheckoutMemory);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post(
  "/payment-service",
  authMiddleware,
  async (req, res) => {
    const { cart, total } = req.body || {};

    // Validacao antes do atraso e das chamadas externas.
    if (
      !validCart(cart) ||
      !Number.isFinite(total) ||
      total <= 0
    ) {
      return res.status(400).json({
        error: "Invalid cart or total",
      });
    }

    const userId = req.userId;

    let paymentResult;

    try {
      // Preserva os tres segundos do db.js.
      paymentResult = await pay(cart, total, userId);
    } catch (error) {
      console.error("Payment failed:", error.message);
      return res.status(500).json({
        error: "Payment processing failed",
      });
    }

    // Falha retornada pelo Analytics nao impede a compra.
    try {
      await callGrpc(analytics, "recordEvent", {
        type: "payments",
        payment: {
          userId,
          cart,
          total,
          paymentResult,
        },
      });
    } catch (error) {
      console.error(
        "Analytics reporting failed:",
        error.message
      );
    }

    // A criacao de ingresso utiliza gRPC.
    try {
      const ticket = await callGrpc(
        tickets,
        "createTicket",
        { userId, cart }
      );

      return res.json({
        paymentResult,
        ticketId: ticket.ticketId,
        ticketResult: ticket.ticketResult,
        emailResult: ticket.emailResult,
      });
    } catch (error) {
      console.error(
        "Ticket service failed:",
        error.message
      );

      return res.status(502).json({
        error: "Ticket service unavailable",
      });
    }
  }
);

app.use((error, req, res, next) => {
  console.error(error.message);

  res.status(error.status || 500).json({
    error: error.status === 400
      ? "Invalid JSON body"
      : error.message,
  });
});

const port = process.env.PORT || 8000;

app.listen(port, "0.0.0.0", () => {
  console.log(
    `Payment service is running on port ${port}`
  );
});
