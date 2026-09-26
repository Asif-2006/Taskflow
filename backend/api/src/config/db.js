/**
 * db.js — MongoDB Connection (API)
 *
 * This module handles connecting to MongoDB using Mongoose.
 *
 * WHY a separate file?
 *   We don't want connection logic scattered in server.js.
 *   This keeps it clean and reusable.
 *
 * HOW it works:
 *   mongoose.connect() opens a persistent connection to MongoDB.
 *   Once connected, all Mongoose models (like Job) use this connection automatically.
 *   You only call this ONCE when the server starts.
 */

const mongoose = require("mongoose");

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error("[API] ERROR: MONGODB_URI environment variable is not set.");
    process.exit(1); // Exit immediately — can't run without a database
  }

  try {
    await mongoose.connect(uri);
    console.log(`[API] MongoDB connected → ${uri}`);
  } catch (error) {
    console.error("[API] MongoDB connection failed:", error.message);
    process.exit(1); // If we can't connect on startup, fail fast
  }
};

module.exports = connectDB;
