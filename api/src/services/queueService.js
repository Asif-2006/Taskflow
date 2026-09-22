/**
 * queueService.js — Redis Queue Operations
 *
 * This is the ONLY place in the codebase that knows HOW the queue works.
 * The controller doesn't know or care that we're using Redis.
 * It just calls enqueue() and dequeue().
 *
 * WHY a service file?
 *   If we ever change the queue implementation (e.g., switch from Redis Lists
 *   to Redis Streams), we only change THIS file. Nothing else changes.
 *
 * ─── The Queue ────────────────────────────────────────────────────────────────
 *
 * Data structure: Redis List
 * Queue name:     "taskflow:jobs"
 *
 * Visual:
 *
 *   LPUSH (new jobs go here)       BRPOP (worker picks up from here)
 *          ↓                                    ↓
 *   [jobId5, jobId4, jobId3, jobId2, jobId1]
 *
 *   FIFO — jobId1 was added first, so it gets processed first.
 *
 * ─── Commands used ────────────────────────────────────────────────────────────
 *
 *   LPUSH taskflow:jobs <jobId>
 *     → Pushes jobId to the LEFT (tail) of the list.
 *     → Used by: API (Step 5)
 *
 *   BRPOP taskflow:jobs 0
 *     → Blocking pop from the RIGHT (head) of the list.
 *     → If the list is empty, Redis makes the caller WAIT (sleep)
 *       until a new item appears. This is extremely efficient —
 *       the Worker process uses 0% CPU while waiting.
 *     → Used by: Worker (Step 6)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const redisClient = require("../config/redis");

// The name of our queue in Redis.
// Using a colon prefix ("taskflow:") is a Redis naming convention
// for grouping related keys (like a namespace).
const QUEUE_NAME = "taskflow:jobs";

/**
 * enqueue(jobId)
 * Adds a job ID to the back of the queue.
 * Called by the API after creating a job in MongoDB.
 *
 * Redis command: LPUSH taskflow:jobs <jobId>
 * Returns: the new length of the list
 */
const enqueue = async (jobId) => {
  await redisClient.lpush(QUEUE_NAME, jobId.toString());
  console.log(`[API] Job enqueued in Redis: ${jobId}`);
};

/**
 * dequeue()
 * Removes and returns the oldest job ID from the queue.
 * BLOCKS (waits) if the queue is empty — no busy-looping needed.
 * Called by the Worker in an infinite loop.
 *
 * Redis command: BRPOP taskflow:jobs 0
 * Returns: the job ID string, or null if interrupted
 *
 * NOTE: BRPOP returns [queueName, value] — we only want the value (index 1).
 */
const dequeue = async (client) => {
  // We accept a separate client here because BRPOP holds the connection open
  // while waiting. We don't want to block the shared client used for LPUSH.
  const result = await client.brpop(QUEUE_NAME, 0);
  if (!result) return null;
  return result[1]; // result = ["taskflow:jobs", "jobId123"]
};

module.exports = { enqueue, dequeue, QUEUE_NAME };
