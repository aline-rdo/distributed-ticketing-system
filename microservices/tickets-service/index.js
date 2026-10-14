import express from "express";
import { createTicket } from "./db.js";
import { postJson, reportEvent } from "./http.js";

const app = express();
app.use(express.json());
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/tickets", async (req, res) => {
  const { userId, cart } = req.body || {};
  if (typeof userId !== "string" || !userId.trim() ||
      !Array.isArray(cart) || cart.length === 0 ||
      !cart.every((item) => item && Number.isFinite(item.price) && item.price >= 0)) {
    return res.status(400).json({ error: "A userId and nonempty cart with valid prices are required" });
  }
  const ticketId = await createTicket(cart, userId);
  const ticketResult = "success";
  await reportEvent("tickets", { userId, ticketId, ticketResult });
  const emailUrl = process.env.EMAIL_SERVICE_URL || "http://localhost:8002";
  const { emailResult } = await postJson(`${emailUrl}/emails`, { userId, ticketId, ticketResult });
  res.json({ ticketId, ticketResult, emailResult });
});

app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 500).json({ error: error.status === 400 ? "Invalid JSON body" : error.message });
});

const port = process.env.PORT || 8001;
app.listen(port, "0.0.0.0", () => console.log(`Tickets service is running on port ${port}`));
