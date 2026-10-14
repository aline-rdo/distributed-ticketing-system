import express from "express";
import cors from "cors";
import { pay } from "./db.js";
import { authMiddleware } from "./middleware/auth.js";
import { postJson, reportEvent } from "./http.js";
import { retainCheckoutMemory } from "./entrega-3-memory.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000" }));
app.use(express.json());
app.use(retainCheckoutMemory);

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/payment-service", authMiddleware, async (req, res) => {
  const { cart, total } = req.body || {};
  if (!Array.isArray(cart) || cart.length === 0 ||
      !cart.every((item) => item && Number.isFinite(item.price) && item.price >= 0) ||
      !Number.isFinite(total) || total <= 0) {
    return res.status(400).json({ error: "A nonempty cart with valid prices and a positive total are required" });
  }
  const userId = req.userId;
  const paymentResult = await pay(cart, total, userId);
  await reportEvent("payments", { userId, cart, total, paymentResult });
  const ticketsUrl = process.env.TICKETS_SERVICE_URL || "http://localhost:8001";
  const ticket = await postJson(`${ticketsUrl}/tickets`, { userId, cart });
  res.json({ paymentResult, ...ticket });
});

app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 500).json({ error: error.status === 400 ? "Invalid JSON body" : error.message });
});

const port = process.env.PORT || 8000;
app.listen(port, "0.0.0.0", () => console.log(`Payment service is running on port ${port}`));
