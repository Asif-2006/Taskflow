/**
 * redis.js — Redis Connection (API)
 *
 * We use the "ioredis" library to connect to Redis.
 *
 * WHY ioredis and not the official "redis" npm package?
 *   ioredis has a very important feature for queues: BRPOP (blocking pop).
 *   It also handles reconnections automatically and has great Promise support.
 *
 * HOW the connection works:
 *   new Redis(url) opens a persistent TCP connection to Redis.
 *   Once connected, all commands go through this same connection.
 *   You only create this client ONCE and reuse it everywhere.
 */

const Redis = require("ioredis");

const redisClient = new Redis(process.env.REDIS_URL || "redis://redis:6379", {
  // Automatically retry connecting if Redis is temporarily unavailable.
  // This matters during Docker startup when Redis might not be ready yet.
  maxRetriesPerRequest: null,    // keep retrying commands (important for BRPOP)
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000); // wait up to 2s between retries
    console.log(`[API] Redis reconnecting... attempt ${times} (delay: ${delay}ms)`);
    return delay;
  },
});

redisClient.on("connect", () => {
  console.log(`[API] Redis connected → ${process.env.REDIS_URL}`);
});

redisClient.on("error", (err) => {
  console.error("[API] Redis error:", err.message);
});

module.exports = redisClient;
