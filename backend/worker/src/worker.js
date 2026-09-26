/**
 * worker.js - The Worker Process
 * Phase 3: Job Leases + Lease Reaper (crash recovery)
 *
 * LEASE LIFECYCLE:
 *
 *   1. Worker picks up jobId from Redis via BRPOP
 *   2. Worker calls acquireLease(jobId) in MongoDB:
 *        - Uses findOneAndUpdate with conditions to prevent double-processing:
 *          { _id: jobId, status: { $in: ["QUEUED"] } }
 *        - Sets: status=PROCESSING, leasedUntil=now+30s, leasedBy=WORKER_ID
 *        - If another worker already grabbed it (race): returns null -> skip
 *   3. Worker processes the job
 *   4. Worker calls releaseLease(job) on success or failure:
 *        - Clears leasedUntil and leasedBy
 *        - Sets final status (COMPLETED / DEAD)
 *
 * LEASE REAPER:
 *
 *   A background loop runs every REAPER_INTERVAL seconds in EACH worker.
 *   It finds jobs where:
 *     { status: "PROCESSING", leasedUntil: { $lt: now } }
 *   These are orphaned jobs — their worker crashed before finishing.
 *
 *   The reaper atomically claims one orphaned job at a time using
 *   findOneAndUpdate, ensuring only ONE reaper across all distributed
 *   workers rescues each orphaned job. No duplicates.
 *
 *   Orphaned job handling:
 *     retryCount < maxRetries -> increment retryCount, QUEUED, re-enqueue
 *     retryCount >= maxRetries -> DEAD, push to DLQ
 *
 * DISTRIBUTED SAFETY:
 *   acquireLease uses atomic findOneAndUpdate — if two workers race to
 *   claim the same job after a reaper re-enqueues it, only one wins.
 *   The loser gets null back and skips. No double-processing.
 *
 * Env vars:
 *   WORKER_SLOTS_HIGH=3
 *   WORKER_SLOTS_NORMAL=2
 *   WORKER_SLOTS_LOW=1
 *   LEASE_DURATION_MS=30000   (30s lease window)
 *   REAPER_INTERVAL_MS=10000  (check for orphans every 10s)
 */

require("dotenv").config();

const os        = require("os");
const connectDB = require("./config/db");
const { createRedisClient } = require("./config/redis");
const { processJob } = require("./jobs/jobProcessor");
const mongoose  = require("mongoose");

const WORKER_ID = os.hostname().slice(0, 8);

// ─── Config ───────────────────────────────────────────────────────────────────
const LEASE_DURATION_MS  = parseInt(process.env.LEASE_DURATION_MS,  10) || 30000;
const REAPER_INTERVAL_MS = parseInt(process.env.REAPER_INTERVAL_MS, 10) || 10000;

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
    result:         { type: mongoose.Schema.Types.Mixed, default: null },
    error:          { type: String, default: null },
    retryCount:     { type: Number, default: 0 },
    maxRetries:     { type: Number, default: 3 },
    lastError:      { type: String, default: null },
    leasedUntil:    { type: Date,   default: null },
    leasedBy:       { type: String, default: null },
    idempotencyKey: { type: String },
    startedAt:      { type: Date,   default: null },
    completedAt:    { type: Date,   default: null },
    deadAt:         { type: Date,   default: null },
  },
  { timestamps: true }
);

jobSchema.index({ status: 1, leasedUntil: 1 }); // Reaper query
const Job = mongoose.model("Job", jobSchema);

// ─── Queue names ──────────────────────────────────────────────────────────────
const QUEUES = {
  high:   "taskflow:jobs:high",
  normal: "taskflow:jobs:normal",
  low:    "taskflow:jobs:low",
};
const DLQ_NAME = "taskflow:dead";

// ─── Slot types ───────────────────────────────────────────────────────────────
const SLOT_TYPES = {
  high:   { label: "HIGH",   queues: [QUEUES.high, QUEUES.normal, QUEUES.low] },
  normal: { label: "NORMAL", queues: [QUEUES.normal, QUEUES.low] },
  low:    { label: "LOW",    queues: [QUEUES.low] },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getBackoffDelay = (retryCount) => Math.min(Math.pow(2, retryCount) * 1000, 30000);

// ─── Lease Helpers ────────────────────────────────────────────────────────────

/**
 * acquireLease(jobId, tag)
 *
 * Atomically claims a job for processing.
 * Uses findOneAndUpdate with strict conditions — safe even if multiple
 * workers try to claim the same job simultaneously (only one wins).
 *
 * Returns the updated job document, or null if the job was already taken.
 */
const acquireLease = async (jobId, tag) => {
  const leasedUntil = new Date(Date.now() + LEASE_DURATION_MS);

  const job = await Job.findOneAndUpdate(
    {
      _id:    jobId,
      // Only claim if still QUEUED — prevents double-processing after
      // a reaper re-enqueues and two workers race to pick it up
      status: "QUEUED",
    },
    {
      $set: {
        status:      "PROCESSING",
        startedAt:   new Date(),
        leasedUntil,
        leasedBy:    WORKER_ID,
      },
    },
    { new: true } // return the updated document
  );

  if (!job) {
    console.warn(`${tag} Could not acquire lease for ${jobId} — already taken or not QUEUED. Skipping.`);
    return null;
  }

  console.log(`${tag} Lease acquired: expires in ${LEASE_DURATION_MS / 1000}s (${leasedUntil.toISOString()})`);
  return job;
};

/**
 * releaseLease(job)
 * Clears the lease fields after a job completes (success or failure).
 */
const releaseLease = async (jobId) => {
  await Job.updateOne(
    { _id: jobId },
    { $set: { leasedUntil: null, leasedBy: null } }
  );
};

// ─── Lease Reaper ─────────────────────────────────────────────────────────────

/**
 * runReaper(redisClient)
 *
 * Background loop that rescues orphaned jobs (worker crashed mid-processing).
 * Runs every REAPER_INTERVAL_MS in each worker instance.
 *
 * Safety: uses findOneAndUpdate to atomically "claim" each orphaned job,
 * so only ONE reaper across all distributed workers handles each one.
 */
const runReaper = async (redisClient) => {
  const tag = `[${WORKER_ID}][REAPER]`;
  console.log(`${tag} Started — scanning every ${REAPER_INTERVAL_MS / 1000}s for orphaned jobs`);

  while (true) {
    await sleep(REAPER_INTERVAL_MS);

    try {
      // Atomically find AND update one orphaned job at a time.
      // "Orphaned" = PROCESSING with an expired lease.
      // We extend the lease while we handle it to prevent other reapers
      // from also picking it up during our processing window.
      const orphan = await Job.findOneAndUpdate(
        {
          status:      "PROCESSING",
          leasedUntil: { $lt: new Date() }, // lease has expired
        },
        {
          $set: {
            // Extend lease so no other reaper grabs this one while we handle it
            leasedUntil: new Date(Date.now() + LEASE_DURATION_MS),
            leasedBy:    WORKER_ID,
          },
        },
        { new: true }
      );

      if (!orphan) continue; // nothing to rescue — loop back

      console.log(`\n${tag} ⚠️  ORPHANED JOB FOUND: ${orphan._id}`);
      console.log(`${tag} Was held by: ${orphan.leasedBy || "unknown"} (lease expired)`);
      console.log(`${tag} retryCount: ${orphan.retryCount}/${orphan.maxRetries}`);

      if (orphan.retryCount < orphan.maxRetries) {
        // Rescue: treat it like a retry
        orphan.retryCount += 1;
        orphan.status      = "QUEUED";
        orphan.lastError   = "Worker crashed or timed out (lease expired)";
        orphan.leasedUntil = null;
        orphan.leasedBy    = null;
        await orphan.save();

        const queueName = QUEUES[orphan.priority] || QUEUES.normal;
        await redisClient.lpush(queueName, orphan._id.toString());

        console.log(`${tag} Rescued — re-enqueued to ${queueName} (attempt ${orphan.retryCount}/${orphan.maxRetries + 1})`);

      } else {
        // No retries left — move to DLQ
        orphan.status      = "DEAD";
        orphan.error       = "Worker crashed or timed out (lease expired) — retries exhausted";
        orphan.deadAt      = new Date();
        orphan.completedAt = new Date();
        orphan.leasedUntil = null;
        orphan.leasedBy    = null;
        await orphan.save();

        await redisClient.lpush(DLQ_NAME, orphan._id.toString());
        console.log(`${tag} Exhausted — moved to DLQ: ${DLQ_NAME}`);
      }

    } catch (err) {
      console.error(`${tag} Error during reap cycle:`, err.message);
    }
  }
};

// ─── Single Worker Slot ───────────────────────────────────────────────────────

const runSlot = async (slotId, slotType, redisClient) => {
  const { label, queues } = SLOT_TYPES[slotType];
  const tag = `[${WORKER_ID}][Slot ${slotId}][${label}]`;
  const listenOn = queues.map((q) => q.replace("taskflow:jobs:", "")).join(" -> ");

  console.log(`${tag} Ready — listening: ${listenOn}`);

  while (true) {
    try {
      const result    = await redisClient.brpop(...queues, 0);
      const fromQueue = result[0];
      const jobId     = result[1];

      console.log(`\n${tag} ─────────────────────────────────`);
      console.log(`${tag} Received: ${jobId} from ${fromQueue}`);

      // Atomically acquire the lease — prevents double-processing
      const job = await acquireLease(jobId, tag);
      if (!job) continue; // another worker/slot already has it

      console.log(`${tag} Priority: ${job.priority.toUpperCase()} | Attempt: ${job.retryCount + 1}/${job.maxRetries + 1}`);

      try {
        const jobResult = await processJob(job);

        job.status      = "COMPLETED";
        job.result      = jobResult;
        job.completedAt = new Date();
        await job.save();
        await releaseLease(job._id);
        console.log(`${tag} COMPLETED: ${job._id}`);

      } catch (processingError) {
        job.lastError = processingError.message;

        if (job.retryCount < job.maxRetries) {
          job.retryCount += 1;
          job.status      = "QUEUED";
          await job.save();
          await releaseLease(job._id);

          const delay     = getBackoffDelay(job.retryCount);
          const requeueTo = QUEUES[job.priority] || QUEUES.normal;
          console.error(`${tag} FAILED: ${processingError.message}`);
          console.log(`${tag} Retry ${job.retryCount}/${job.maxRetries} in ${delay / 1000}s -> ${requeueTo}`);
          await sleep(delay);
          await redisClient.lpush(requeueTo, job._id.toString());

        } else {
          job.status      = "DEAD";
          job.error       = processingError.message;
          job.deadAt      = new Date();
          job.completedAt = new Date();
          await job.save();
          await releaseLease(job._id);
          await redisClient.lpush(DLQ_NAME, job._id.toString());
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
  console.log(`[WORKER] Worker ID:     ${WORKER_ID}`);
  console.log(`[WORKER] Slot pool:     ${slotsHigh} HIGH + ${slotsNormal} NORMAL + ${slotsLow} LOW = ${totalSlots} slots`);
  console.log(`[WORKER] Lease TTL:     ${LEASE_DURATION_MS / 1000}s`);
  console.log(`[WORKER] Reaper every:  ${REAPER_INTERVAL_MS / 1000}s`);
  console.log(`[WORKER] ========================================`);

  await connectDB();

  // One shared Redis client for the reaper (it only does writes, no BRPOP)
  const reaperClient = createRedisClient();

  // Each slot gets its own dedicated Redis client for BRPOP
  const slots = [];
  let slotId  = 1;
  for (let i = 0; i < slotsHigh;   i++) slots.push(runSlot(slotId++, "high",   createRedisClient()));
  for (let i = 0; i < slotsNormal; i++) slots.push(runSlot(slotId++, "normal", createRedisClient()));
  for (let i = 0; i < slotsLow;    i++) slots.push(runSlot(slotId++, "low",    createRedisClient()));

  // Reaper runs alongside all slots
  slots.push(runReaper(reaperClient));

  console.log(`[WORKER] ${totalSlots} slot(s) + 1 reaper launched. Waiting for jobs...`);
  await Promise.all(slots);
};

process.on("SIGTERM", () => { console.log(`[${WORKER_ID}] SIGTERM - shutting down...`); process.exit(0); });
process.on("SIGINT",  () => { console.log(`[${WORKER_ID}] SIGINT - shutting down...`);  process.exit(0); });

runWorker().catch((err) => {
  console.error(`[${WORKER_ID}] Fatal startup error:`, err.message);
  process.exit(1);
});
