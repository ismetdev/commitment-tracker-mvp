// server.js
// Express entry point. Serves the static frontend from /public and exposes
// the JSON API (added slice by slice). For now: static serving + a health check.

const express = require("express");
const db = require("./db"); // initializes the DB/schema on require

const app = express();
const PORT = 3000;

// Parse JSON request bodies (used by API routes in later slices).
app.use(express.json());

// Serve the frontend.
app.use(express.static("public"));

// Simple health check so we can confirm the server + DB are alive.
app.get("/api/health", (req, res) => {
  const row = db.prepare("SELECT 1 AS ok").get();
  res.json({ ok: row.ok === 1, time: new Date().toISOString() });
});

// --- API routes -------------------------------------------------------------
app.use("/api/commitments", require("./routes/commitments"));
app.use("/api/monthly", require("./routes/monthly"));
app.use("/api/debts", require("./routes/debts"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/backup", require("./routes/backup"));
app.use("/api/reset", require("./routes/reset"));

app.listen(PORT, () => {
  console.log(`Commitment Tracker running at http://localhost:${PORT}`);
});