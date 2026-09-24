/**
 * worker.js - The Worker Process (Phase 2: Retries + DLQ + Priorities + Weighted Concurrency)
 *
 * DISTRIBUTED DESIGN:
 *   Run multiple independent worker CONTAINERS using:
 *     docker-compose up --scale worker=3
 *
 *   Each container:
 *     - Is a completely separate Node.js process (separate machine in prod)
 *     - Has its own slot pool (3 HIGH + 2 NORMAL + 1 LOW = 6 slots)
 *     - Has its own Redis connections (6 BRPOP connections per container)
 *     - Shares the same Redis queues and MongoDB as all other workers
 *
 *   Redis BRPOP is atomic — only ONE worker across ALL containers can
 *   receive any given job. No duplicates. No race conditions.
 *
 *   With 3 worker containers: 18 parallel job processors total
 *   If one container crashes: the other two continue unaffected
 *
 * WEIGHTED SLOT POOL (per container):
 *   HIGH slots   (3): BRPOP high -> normal -> low
 *   NORMAL slots (2): BRPOP normal -> low
 *   LOW slots    (1): BRPOP low
 *
 * WORKER IDENTITY:
 *   Each container gets a unique Docker hostname (e.g. "a3f2c1b4").
 *   All log lines are prefixed with [workerID] so you can trace
 *   which physical worker handled which job across distributed instances.
 *
 * Controlled via env vars in docker-compose.yml:
 *   WORKER_SLOTS_HIGH=3
 *   WORKER_SLOTS_NORMAL=2
 *   WORKER_SLOTS_LOW=1
 */

require("dotenv").config();

const os      = require("os");
const connectDB = require("./config/db");
const { createRedisClient } = require("./config/redis");
const { processJob } = require("./jobs/jobProcessor");
const mongoose = require("mongoose");

// Unique identity for this worker instance.
// Docker assigns each container a unique hostname (short UUID).
// Shows up in every log line so you know WHICH machine processed the job.
const WORKER_ID = os.hostname().slice(0, 8);

// ─── Job Model ────────────────────────────────────────────────────────────────
const jobSchema = new mongoose.Schema(
  {
    type:     String,
    payload:  mongoose.Schema.Types.Mixed,
    priority: { type: String, enum: ["high", "normal", "low"], default: "normal" },
    status: {
      type:    String,
      enum:    ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "DEAD"],
      default: "QUEUED",
    },
    result:     { type: mongoose.Schema.Types.Mixed, default: null },
    error:      { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    lastError:  { type: String, default: null },
    startedAt:   { type: Date, default: null },
    completedAt: { type: Date, default: null },
    deadAt:      { type: Date, default: null },
  },
  { timestamps: true }
);

const Job = mongoose.model("Job", jobSchema);

// ─── Queue names ──────────────────────────────────────────────────────────────
const QUEUES = {
  high:   "taskflow:jobs:high",
  normal: "taskflow:jobs:normal",
  low:    "taskflow:jobs:low",
};
const DLQ_NAME = "taskflow:dead";

// ─── Slot type definitions ────────────────────────────────────────────────────
const SLOT_TYPES = {
  high:   { label: "HIGH",   queues: [QUEUES.high, QUEUES.normal, QUEUES.low] },
  normal: { label: "NORMAL", queues: [QUEUES.normal, QUEUES.low] },
  low:    { label: "LOW",    queues: [QUEUES.low] },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getBackoffDelay = (retryCount) => Math.min(Math.pow(2, retryCount) * 1000, 30000);

// ─── Single Slot ──────────────────────────────────────────────────────────────
const runSlot = async (slotId, slotType) => {
  const { label, queues } = SLOT_TYPES[slotType];
  const client = createRedisClient();

  // Log prefix includes worker ID + slot — identifies machine AND slot
  // Example: [a3f2c1b4][Slot 1][HIGH]
  const tag = `[${WORKER_ID}][Slot ${slotId}][${label}]`;

  const listeningSummary = queues.map((q) => q.replace("taskflow:jobs:", "")).join(" -> ");
  console.log(`${tag} Ready — listening: ${listeningSummary}`);

  while (true) {
    try {
      const result    = await client.brpop(...queues, 0);
      const fromQueue = result[0];
      const jobId     = result[1];

      console.log(`\n${tag} ─────────────────────────────────`);
      console.log(`${tag} Received: ${jobId}`);
      console.log(`${tag} From:     ${fromQueue}`);

      const job = await Job.findById(jobId);
      if (!job) {
        console.warn(`${tag} Job not found: ${jobId} - skipping.`);
        continue;
      }

      job.status    = "PROCESSING";
      job.startedAt = new Date();
      await job.save();
      console.log(`${tag} Priority: ${job.priority.toUpperCase()} | Attempt: ${job.retryCount + 1}/${job.maxRetries + 1}`);

      try {
        const jobResult = await processJob(job);

        job.status      = "COMPLETED";
        job.result      = jobResult;
        job.completedAt = new Date();
        await job.save();
        console.log(`${tag} COMPLETED: ${job._id}`);

      } catch (processingError) {
        job.lastError = processingError.message;

        if (job.retryCount < job.maxRetries) {
          job.retryCount += 1;
          job.status      = "QUEUED";
          await job.save();

          const delay     = getBackoffDelay(job.retryCount);
          const requeueTo = QUEUES[job.priority] || QUEUES.normal;

          console.error(`${tag} FAILED: ${processingError.message}`);
          console.log(`${tag} Retry ${job.retryCount}/${job.maxRetries} in ${delay / 1000}s -> ${requeueTo}`);
          await sleep(delay);
          await client.lpush(requeueTo, job._id.toString());

        } else {
          job.status      = "DEAD";
          job.error       = processingError.message;
          job.deadAt      = new Date();
          job.completedAt = new Date();
          await job.save();

          await client.lpush(DLQ_NAME, job._id.toString());
          console.error(`${tag} DEAD (all ${job.maxRetries + 1} attempts exhausted): ${job._id}`);
        }
      }

      console.log(`${tag} ─────────────────────────────────\n`);

    } catch (err) {
      console.error(`${tag} Unexpected error:`, err.message);
      await sleep(1000);
    }
  }
};

// ─── Main Entry Point ─────────────────────────────────────────────────────────
const runWorker = async () => {
  const slotsHigh   = parseInt(process.env.WORKER_SLOTS_HIGH,   10) || 3;
  const slotsNormal = parseInt(process.env.WORKER_SLOTS_NORMAL, 10) || 2;
  const slotsLow    = parseInt(process.env.WORKER_SLOTS_LOW,    10) || 1;
  const totalSlots  = slotsHigh + slotsNormal + slotsLow;

  console.log(`[WORKER] ========================================`);
  console.log(`[WORKER] Worker ID:   ${WORKER_ID}  (Docker hostname)`);
  console.log(`[WORKER] Slot pool:   ${slotsHigh} HIGH + ${slotsNormal} NORMAL + ${slotsLow} LOW = ${totalSlots} slots`);
  console.log(`[WORKER] HIGH slots:  high -> normal -> low`);
  console.log(`[WORKER] NORMAL slots: normal -> low`);
  console.log(`[WORKER] LOW slots:   low only`);
  console.log(`[WORKER] ========================================`);

  await connectDB();

  const slots = [];
  let slotId  = 1;
  for (let i = 0; i < slotsHigh;   i++) slots.push(runSlot(slotId++, "high"));
  for (let i = 0; i < slotsNormal; i++) slots.push(runSlot(slotId++, "normal"));
  for (let i = 0; i < slotsLow;    i++) slots.push(runSlot(slotId++, "low"));

  console.log(`[WORKER] ${totalSlots} slot(s) launched. Waiting for jobs...`);
  await Promise.all(slots);
};

process.on("SIGTERM", () => { console.log(`[${WORKER_ID}] SIGTERM - shutting down...`); process.exit(0); });
process.on("SIGINT",  () => { console.log(`[${WORKER_ID}] SIGINT - shutting down...`);  process.exit(0); });

runWorker().catch((err) => {
  console.error(`[${WORKER_ID}] Fatal startup error:`, err.message);
  process.exit(1);
});
