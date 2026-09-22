/**
 * jobController.js — Business Logic for Job Endpoints
 *
 * This is where the actual work happens.
 * The routes file just maps URLs to these functions.
 *
 * Each function receives:
 *   req — the incoming HTTP request (headers, body, params)
 *   res — the outgoing HTTP response (what we send back)
 */

const Job = require("../models/Job");
const { enqueue } = require("../services/queueService");

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jobs
// Creates a new job in MongoDB and returns the job ID.
// ─────────────────────────────────────────────────────────────────────────────

const createJob = async (req, res) => {
  try {
    const { type, payload } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    // "type" is required — the Worker needs to know WHAT to do with the job.
    if (!type) {
      return res.status(400).json({
        error: "Missing required field: type",
      });
    }

    // ── Create the Job document in MongoDB ────────────────────────────────────
    // new Job(...) creates the object in memory.
    // job.save() writes it to MongoDB.
    // The "status" defaults to "QUEUED" automatically (defined in the schema).
    const job = new Job({
      type,
      payload: payload || {}, // default to empty object if no payload given
    });

    await job.save();

    // ── Push job ID into Redis queue ──────────────────────────────────────────
    // MongoDB has the full document. Redis gets only the ID.
    // The Worker will use the ID to fetch the full document from MongoDB.
    await enqueue(job._id);

    // ── Logging ───────────────────────────────────────────────────────────────
    console.log(`[API] Job created: ${job._id}`);
    console.log(`[API] Job queued:  ${job._id}`);

    // ── Respond immediately ───────────────────────────────────────────────────
    // We don't wait for the job to be processed.
    // We just confirm the job was accepted.
    return res.status(201).json({
      jobId: job._id,
      status: job.status, // "QUEUED"
    });
  } catch (error) {
    console.error("[API] Error creating job:", error.message);
    return res.status(500).json({ error: "Failed to create job" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs/:id
// Returns the current status (and result/error if available) of a job.
//
// Response shape changes based on status:
//   QUEUED/PROCESSING → no result or error (they don't exist yet)
//   COMPLETED         → includes result, completedAt
//   FAILED            → includes error, completedAt
// ─────────────────────────────────────────────────────────────────────────────

const getJob = async (req, res) => {
  try {
    const { id } = req.params;

    // Guard: MongoDB ObjectIds are 24 hex characters.
    // Without this check, an invalid ID like "abc" causes Mongoose to throw
    // a CastError which would fall into the 500 catch block — confusing for clients.
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid job ID format" });
    }

    const job = await Job.findById(id);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Build response — always include these fields
    const response = {
      jobId: job._id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
    };

    // Only include timing + result/error fields when they have meaningful values
    if (job.startedAt) response.startedAt = job.startedAt;
    if (job.completedAt) response.completedAt = job.completedAt;
    if (job.status === "COMPLETED") response.result = job.result;
    if (job.status === "FAILED") response.error = job.error;

    return res.json(response);

  } catch (error) {
    console.error("[API] Error fetching job:", error.message);
    return res.status(500).json({ error: "Failed to fetch job" });
  }
};

module.exports = { createJob, getJob };
