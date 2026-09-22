/**
 * worker.js — The Worker Process
 *
 * This is the entry point for the Worker.
 * It runs completely independently from the API (separate Node.js process).
 *
 * THE CORE LOOP:
 *   1. Connect to MongoDB and Redis
 *   2. Block on BRPOP — wait for a job ID to appear in Redis
 *   3. When a job ID arrives, fetch the full job from MongoDB
 *   4. Update status to PROCESSING
 *   5. Run the job processor
 *   6. Update status to COMPLETED (or FAILED)
 *   7. Go back to step 2 immediately
 *
 * The Worker never stops unless the process is killed.
 * It processes one job at a time (simple, predictable, easy to understand).
 */

require("dotenv").config();

const connectDB = require("./config/db");
const { createRedisClient } = require("./config/redis");
const { processJob } = require("./jobs/jobProcessor");

// We require the Job model here — the Worker needs it to:
//   - Find a job by ID (Job.findById)
//   - Update job status (job.save)
// This is a copy of the same schema as the API — both processes
// talk to the SAME MongoDB collection, just through separate connections.
const mongoose = require("mongoose");

// ─── Job Model (inline for the worker) ───────────────────────────────────────
// We define the schema again here rather than sharing files between api/ and worker/.
// This keeps the two services independent — they only share MongoDB as a contract.
const jobSchema = new mongoose.Schema(
  {
    type: String,
    payload: mongoose.Schema.Types.Mixed,
    status: {
      type: String,
      enum: ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"],
      default: "QUEUED",
    },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const Job = mongoose.model("Job", jobSchema);

// ─── Queue config ─────────────────────────────────────────────────────────────
const QUEUE_NAME = "taskflow:jobs";

// ─── Main Worker Loop ─────────────────────────────────────────────────────────

const runWorker = async () => {
  console.log("[WORKER] TaskFlow Worker starting...");

  // Step 1: Connect to MongoDB (must succeed before we start processing)
  await connectDB();

  // Step 2: Create a dedicated Redis client for blocking operations
  // This client will be held open by BRPOP — it cannot do anything else.
  const redisClient = createRedisClient();

  console.log("[WORKER] Waiting for jobs... (press Ctrl+C to stop)");
  console.log(`[WORKER] Listening on Redis queue: ${QUEUE_NAME}`);

  // Step 3: The infinite loop
  // This loop never exits unless the process is killed.
  while (true) {
    try {
      // ── BRPOP: Block until a job ID arrives ──────────────────────────────
      // This is the key command. The Worker sleeps here, using 0 CPU,
      // until Redis receives an LPUSH from the API.
      //
      // BRPOP returns: ["taskflow:jobs", "jobId123..."]
      // We only need index [1] (the actual job ID).
      //
      // timeout = 0 means: wait forever. Never time out.
      const result = await redisClient.brpop(QUEUE_NAME, 0);
      const jobId = result[1];

      console.log(`\n[WORKER] ──────────────────────────────────────`);
      console.log(`[WORKER] Received job: ${jobId}`);

      // ── Fetch the full job document from MongoDB ──────────────────────────
      const job = await Job.findById(jobId);

      if (!job) {
        // This can happen if MongoDB was cleared but Redis wasn't.
        // Safe to skip — just log and move on.
        console.warn(`[WORKER] Job not found in MongoDB: ${jobId} — skipping.`);
        continue;
      }

      // ── Mark as PROCESSING ────────────────────────────────────────────────
      // Anyone querying GET /api/jobs/:id will now see "PROCESSING".
      // This happens BEFORE the actual work starts.
      job.status = "PROCESSING";
      job.startedAt = new Date();
      await job.save();
      console.log(`[WORKER] Job status: PROCESSING`);

      // ── Do the actual work ────────────────────────────────────────────────
      // processJob() routes to the correct handler based on job.type.
      // If it throws, we catch it below and mark the job as FAILED.
      try {
        const result = await processJob(job);

        // ── Success: mark as COMPLETED ──────────────────────────────────────
        job.status = "COMPLETED";
        job.result = result;
        job.completedAt = new Date();
        await job.save();
        console.log(`[WORKER] Job completed: ${job._id}`);
        console.log(`[WORKER] Result: ${JSON.stringify(result)}`);

      } catch (processingError) {
        // ── Failure: mark as FAILED ─────────────────────────────────────────
        // The error message is stored in MongoDB so the client can see it.
        job.status = "FAILED";
        job.error = processingError.message;
        job.completedAt = new Date();
        await job.save();
        console.error(`[WORKER] Job FAILED: ${job._id}`);
        console.error(`[WORKER] Error: ${processingError.message}`);
      }

      console.log(`[WORKER] ──────────────────────────────────────\n`);

    } catch (err) {
      // Outer catch: handles unexpected errors (e.g., Redis disconnect).
      // We log and continue — the Worker should never crash from a bad job.
      console.error("[WORKER] Unexpected error in loop:", err.message);
      // Brief pause before retrying to avoid a tight crash loop
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
process.on("SIGTERM", () => {
  console.log("[WORKER] Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[WORKER] Received SIGINT (Ctrl+C), shutting down...");
  process.exit(0);
});

// ─── Start ────────────────────────────────────────────────────────────────────
runWorker().catch((err) => {
  console.error("[WORKER] Fatal startup error:", err.message);
  process.exit(1);
});
