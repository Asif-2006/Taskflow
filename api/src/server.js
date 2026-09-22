/**
 * API Entry Point — server.js
 *
 * Boot order:
 *   1. Load environment variables (.env)
 *   2. Connect to MongoDB
 *   3. Connect to Redis (client is initialized on require)
 *   4. Mount routes
 *   5. Start Express HTTP server
 */

require("dotenv").config();

const express = require("express");
const connectDB = require("./config/db");

// Requiring the redis module immediately opens the connection.
// We don't need the return value here — the connection is established
// as a side effect, and the shared client is used inside queueService.js
require("./config/redis");

const jobRoutes = require("./routes/jobRoutes");

const app = express();
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "taskflow-api",
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/jobs", jobRoutes);

// ─── Boot sequence ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB(); // MongoDB first

  // Redis connects automatically when required above.
  // Express starts only after MongoDB is confirmed ready.
  app.listen(PORT, () => {
    console.log(`[API] TaskFlow API server running on port ${PORT}`);
    console.log(`[API] Health check  → http://localhost:${PORT}/health`);
    console.log(`[API] Jobs endpoint → http://localhost:${PORT}/api/jobs`);
  });
};

start();
