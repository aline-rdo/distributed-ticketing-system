import express from "express";
import { sendEmail } from "./db.js";
import { reportEvent } from "./http.js";

const app = express();
app.use(express.json());
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/emails", async (req, res) => {
  const { userId, ticketId, ticketResult } = req.body || {};
  if (typeof userId !== "string" || !userId.trim() ||
      typeof ticketId !== "string" || !ticketId.trim() || ticketResult !== "success") {
    return res.status(400).json({ error: "A userId, ticketId and successful ticketResult are required" });
  }
  const emailResult = await sendEmail(ticketId, userId, ticketResult);
  await reportEvent("emails", { userId, ticketId, emailResult });
  res.json({ emailResult });
});

app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 500).json({ error: error.status === 400 ? "Invalid JSON body" : error.message });
});

const port = process.env.PORT || 8002;
app.listen(port, "0.0.0.0", () => console.log(`Email service is running on port ${port}`));
