/**
 * Job.js - Mongoose Job Model
 *
 * Phase 2 fields added:
 *   - priority   (Step 3): high / normal / low
 *   - retryCount (Step 1): current retry attempt
 *   - maxRetries (Step 1): retry ceiling
 *   - lastError  (Step 1): most recent failure message
 *   - deadAt     (Step 2): when job entered DLQ
 */

const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    // What kind of job - Worker routes on this
    type: {
      type: String,
      required: true,
    },

    // Input data for the job
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Priority - controls which Redis queue this job lands in
    // Worker checks: high then normal then low (always in that order)
    //   "high"   -> taskflow:jobs:high   (payments, urgent, user-facing)
    //   "normal" -> taskflow:jobs:normal (default)
    //   "low"    -> taskflow:jobs:low    (newsletters, reports, cleanup)
    priority: {
      type: String,
      enum: ["high", "normal", "low"],
      default: "normal",
    },

    // Current state of the job
    //   QUEUED     -> waiting in Redis
    //   PROCESSING -> Worker picked it up
    //   COMPLETED  -> finished successfully
    //   FAILED     -> exhausted all retries (or maxRetries = 0)
    //   DEAD       -> moved to Dead Letter Queue
    status: {
      type: String,
      enum: ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "DEAD"],
      default: "QUEUED",
    },

    // Output of a successfully completed job
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Final error message (permanent FAILED or DEAD)
    error: {
      type: String,
      default: null,
    },

    // Retry tracking
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    lastError:  { type: String, default: null }, // error from most recent attempt

    // Timestamps
    startedAt:   { type: Date, default: null },
    completedAt: { type: Date, default: null },
    deadAt:      { type: Date, default: null },
  },
  {
    timestamps: true, // auto-adds createdAt, updatedAt
  }
);

const Job = mongoose.model("Job", jobSchema);

module.exports = Job;
