/**
 * Job.js - Mongoose Job Model
 *
 * Phase 3 additions:
 *   - leasedUntil    (leases): when the current worker's claim expires
 *   - leasedBy       (leases): which worker ID holds the current lease
 *   - idempotencyKey (idempotency): optional client-supplied unique key
 *                                   prevents duplicate job creation on retried POSTs
 */

const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    // What kind of job - Worker routes on this
    type: {
      type: String,
      required: true,
    },

    // Input data
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Priority - controls which Redis queue this job lands in
    priority: {
      type: String,
      enum: ["high", "normal", "low"],
      default: "normal",
    },

    // Current state
    //   QUEUED     -> waiting in Redis
    //   PROCESSING -> Worker picked it up (has an active lease)
    //   COMPLETED  -> finished successfully
    //   FAILED     -> exhausted all retries
    //   DEAD       -> moved to Dead Letter Queue
    status: {
      type: String,
      enum: ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "DEAD"],
      default: "QUEUED",
    },

    // Output of a successful job
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Final error (FAILED or DEAD)
    error: {
      type: String,
      default: null,
    },

    // Retry tracking
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    lastError:  { type: String, default: null },

    // ── Job Lease (Phase 3) ────────────────────────────────────────────────
    //
    // leasedUntil: the deadline by which the current worker must finish.
    //   - Set to (now + LEASE_DURATION) when a worker starts PROCESSING.
    //   - Cleared to null when the job completes (success or failure).
    //   - If the worker crashes before finishing, this timestamp expires.
    //   - The Lease Reaper detects expired leases and re-enqueues the job.
    //
    // leasedBy: the WORKER_ID (Docker hostname) that currently holds the lease.
    //   - Purely for debugging/observability — tells you which container died.
    //   - Cleared to null when the lease is released.
    //
    leasedUntil: {
      type: Date,
      default: null,
    },

    leasedBy: {
      type: String,
      default: null,
    },

    // ── Idempotency Key (Phase 3) ──────────────────────────────────────────
    //
    // Optional unique key supplied by the client on POST /api/jobs.
    // If a job with this key already exists (and is not DEAD), the API
    // returns the existing job instead of creating a duplicate.
    //
    // Use case: client sends "send-email" job, network times out, client retries.
    // Without idempotency: two identical emails sent.
    // With idempotency: second POST returns the first job — one email sent.
    //
    // Sparse index: allows many jobs WITHOUT a key (null is not indexed),
    // but enforces uniqueness among jobs THAT HAVE a key.
    //
    idempotencyKey: {
      type: String,
      default: null,
    },

    // Timestamps
    startedAt:   { type: Date, default: null },
    completedAt: { type: Date, default: null },
    deadAt:      { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

// Sparse unique index on idempotencyKey.
// "sparse: true" means only documents WITH a non-null key are indexed.
// This allows unlimited jobs with idempotencyKey=null (the default).
jobSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

// Index for the Lease Reaper query:
//   db.jobs.find({ status: "PROCESSING", leasedUntil: { $lt: now } })
// Without this index, the reaper would do a full collection scan every 10s.
jobSchema.index({ status: 1, leasedUntil: 1 });

const Job = mongoose.model("Job", jobSchema);

module.exports = Job;
