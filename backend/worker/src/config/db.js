/**
 * db.js — MongoDB Connection (Worker)
 *
 * Identical to the API's db.js.
 * The Worker is a completely separate process — it has its own
 * database connection. They don't share anything in memory.
 */

const mongoose = require("mongoose");

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error("[WORKER] ERROR: MONGODB_URI environment variable is not set.");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log(`[WORKER] MongoDB connected → ${uri}`);
  } catch (error) {
    console.error("[WORKER] MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
