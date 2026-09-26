/**
 * queueService.js - Redis Queue Operations
 *
 * Phase 2 - Step 3: Three priority queues
 *
 * Active queues (checked by Worker in this order):
 *   taskflow:jobs:high    <- high priority jobs
 *   taskflow:jobs:normal  <- default jobs
 *   taskflow:jobs:low     <- low priority jobs
 *
 * Dead Letter Queue:
 *   taskflow:dead         <- jobs that exhausted all retries
 *
 * HOW PRIORITY WORKS:
 *   BRPOP accepts multiple queue names and checks them left to right.
 *   It returns from the FIRST non-empty queue it finds.
 *   So "high" is always checked before "normal", "normal" before "low".
 *   No extra code needed - Redis does the prioritization natively.
 */

const redisClient = require("../config/redis");

// The three priority queues - ORDER MATTERS here (used in Worker BRPOP)
const QUEUES = {
  high:   "taskflow:jobs:high",
  normal: "taskflow:jobs:normal",
  low:    "taskflow:jobs:low",
};

// Dead Letter Queue
const DLQ_NAME = "taskflow:dead";

/**
 * getQueueName(priority)
 * Returns the Redis key for the given priority level.
 * Falls back to "normal" for any unrecognised value.
 */
const getQueueName = (priority) => {
  return QUEUES[priority] || QUEUES.normal;
};

/**
 * enqueue(jobId, priority)
 * Pushes a job ID into the correct priority queue.
 * Called by the API after saving to MongoDB.
 *
 * Redis command: LPUSH taskflow:jobs:<priority> <jobId>
 */
const enqueue = async (jobId, priority = "normal") => {
  const queueName = getQueueName(priority);
  await redisClient.lpush(queueName, jobId.toString());
  console.log(`[API] Job enqueued -> ${queueName}: ${jobId}`);
};

/**
 * enqueueDead(jobId)
 * Pushes a job ID into the Dead Letter Queue.
 * Called by the Worker when all retries are exhausted.
 */
const enqueueDead = async (jobId) => {
  await redisClient.lpush(DLQ_NAME, jobId.toString());
  console.log(`[QUEUE] Job moved to DLQ -> ${DLQ_NAME}: ${jobId}`);
};

/**
 * dequeue(client)
 * Blocking pop - checks HIGH then NORMAL then LOW in order.
 * Returns the job ID string from whichever queue had something.
 *
 * Redis command: BRPOP taskflow:jobs:high taskflow:jobs:normal taskflow:jobs:low 0
 *
 * Return value: ["taskflow:jobs:high", "jobId123"] - we return both
 * so the caller knows which queue it came from (useful for logging).
 */
const dequeue = async (client) => {
  const result = await client.brpop(
    QUEUES.high,
    QUEUES.normal,
    QUEUES.low,
    0 // timeout=0 means wait forever
  );
  if (!result) return null;
  // result = ["taskflow:jobs:high", "jobId123"]
  return { queueName: result[0], jobId: result[1] };
};

/**
 * getDead()
 * Returns all job IDs currently sitting in the DLQ.
 */
const getDead = async () => {
  return await redisClient.lrange(DLQ_NAME, 0, -1);
};

/**
 * removeFromDead(jobId)
 * Removes a specific job ID from the DLQ.
 * Called when admin requeues a dead job.
 */
const removeFromDead = async (jobId) => {
  await redisClient.lrem(DLQ_NAME, 0, jobId.toString());
};

module.exports = {
  enqueue,
  enqueueDead,
  dequeue,
  getDead,
  removeFromDead,
  QUEUES,
  DLQ_NAME,
};
