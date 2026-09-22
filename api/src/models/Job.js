/**
 * Job.js — Mongoose Job Model
 *
 * This defines the SCHEMA for a job document in MongoDB.
 *
 * WHY a schema?
 *   MongoDB is schema-less by default — you can store anything.
 *   Mongoose adds a schema layer so we get:
 *     - Validation (required fields, allowed values)
 *     - Defaults (status starts as "QUEUED" automatically)
 *     - Type safety (payload is always an Object, not a string)
 *
 * WHAT is this collection called in MongoDB?
 *   Mongoose automatically pluralizes the model name.
 *   "Job" → stored in the "jobs" collection.
 */

const mongoose = require("mongoose");

// ─── Schema Definition ────────────────────────────────────────────────────────

const jobSchema = new mongoose.Schema(
  {
    // ── What kind of job is this? ──────────────────────────────────────────
    // Examples: "example", "send-email", "resize-image", "fail-test"
    // The Worker will use this to decide HOW to process the job.
    type: {
      type: String,
      required: true, // Must be provided — no type = rejected by Mongoose
    },

    // ── The input data for this job ────────────────────────────────────────
    // This is whatever the client sends along with the job.
    // Example: { message: "Hello TaskFlow" }
    // We use mongoose.Schema.Types.Mixed so it can be any object shape.
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ── Current state of the job ───────────────────────────────────────────
    // This is the field you'll watch change as the job moves through the system:
    //
    //   QUEUED     → API created the job, it's waiting in Redis
    //   PROCESSING → Worker picked it up and is working on it
    //   COMPLETED  → Worker finished successfully, result is stored
    //   FAILED     → Worker threw an error, error message is stored
    //
    status: {
      type: String,
      enum: ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"],
      default: "QUEUED",
    },

    // ── Output of a successfully completed job ─────────────────────────────
    // Null until the Worker completes the job.
    // Example: { message: "Job processed successfully" }
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // ── Error message if the job fails ─────────────────────────────────────
    // Null unless the Worker throws an error.
    error: {
      type: String,
      default: null,
    },

    // ── Timestamps ─────────────────────────────────────────────────────────
    // createdAt  → Set automatically when the API creates the job
    // startedAt  → Set by the Worker when it picks the job up from Redis
    // completedAt → Set by the Worker when it finishes (success or failure)
    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    // Mongoose option: automatically add createdAt and updatedAt fields.
    // We get createdAt for free this way.
    timestamps: true,
  }
);

// ─── Export Model ─────────────────────────────────────────────────────────────
// mongoose.model("Job", jobSchema) creates a Model class.
// A Model is a class that lets you create, read, update, delete documents.
// It maps to the "jobs" collection in MongoDB.

const Job = mongoose.model("Job", jobSchema);

module.exports = Job;
