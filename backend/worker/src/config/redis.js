/**
 * redis.js — Redis Connection (Worker)
 *
 * The Worker needs TWO Redis connections:
 *
 *   1. "subscriber" — used exclusively for BRPOP (blocking pop).
 *      BRPOP holds this connection open while waiting for jobs.
 *      This connection cannot be used for anything else while blocking.
 *
 *   2. (future) a second client for non-blocking commands if needed.
 *
 * WHY can't we reuse one connection for everything?
 *   When BRPOP is waiting, the connection is "locked" — Redis won't
 *   accept any other commands on it until BRPOP returns.
 *   So we dedicate one connection purely for listening.
 */

const Redis = require("ioredis");

const createRedisClient = () => {
  const client = new Redis(process.env.REDIS_URL || "redis://redis:6379", {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      console.log(`[WORKER] Redis reconnecting... attempt ${times}`);
      return delay;
    },
  });

  client.on("connect", () => {
    console.log(`[WORKER] Redis connected → ${process.env.REDIS_URL}`);
  });

  client.on("error", (err) => {
    console.error("[WORKER] Redis error:", err.message);
  });

  return client;
};

module.exports = { createRedisClient };
