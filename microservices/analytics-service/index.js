import express from "express";

const app = express();
app.use(express.json());
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/events", (req, res) => {
  const { type, data } = req.body || {};
  if (!data || typeof data.userId !== "string" || !data.userId.trim()) {
    return res.status(400).json({ error: "Event data with a userId is required" });
  }
  const { userId, total, paymentResult, ticketId, ticketResult, emailResult } = data;
  if (type === "payments" && Number.isFinite(total) && total > 0 && paymentResult === "success") {
    console.log(`Analytics - User ${userId} made a payment of €${total}. Payment result: ${paymentResult}`);
  } else if (type === "tickets" && typeof ticketId === "string" && ticketId.trim() && ticketResult === "success") {
    console.log(`Analytics - User ${userId} created ticket ${ticketId}. Ticket result: ${ticketResult}`);
  } else if (type === "emails" && typeof ticketId === "string" && ticketId.trim() && emailResult === "success") {
    console.log(`Analytics - User ${userId} received email for ticket ${ticketId}. Email result: ${emailResult}`);
  } else {
    return res.status(400).json({ error: "Unknown event type or invalid event data" });
  }
  res.status(201).json({ status: "recorded" });
});

app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 500).json({ error: error.status === 400 ? "Invalid JSON body" : error.message });
});

const port = process.env.PORT || 8003;
app.listen(port, "0.0.0.0", () => console.log(`Analytics service is running on port ${port}`));
