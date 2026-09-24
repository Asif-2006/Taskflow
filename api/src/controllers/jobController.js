/**
 * jobController.js - Business Logic for Job Endpoints
 *
 * Phase 2 additions:
 *   createJob  - accepts priority ("high"/"normal"/"low") and maxRetries
 *   getJob     - returns priority, retryCount, lastError, deadAt
 *   listDead   - GET /api/jobs/dead
 *   requeueJob - POST /api/jobs/:id/requeue
 *   listJobs   - GET /api/jobs?status=X&type=Y&priority=Z&page=1&limit=20
 */

const Job = require("../models/Job");
const { enqueue, getDead, removeFromDead } = require("../services/queueService");

// ─── POST /api/jobs ───────────────────────────────────────────────────────────

const createJob = async (req, res) => {
  try {
    const { type, payload, priority, maxRetries } = req.body;

    if (!type) {
      return res.status(400).json({ error: "Missing required field: type" });
    }

    if (priority !== undefined && !["high", "normal", "low"].includes(priority)) {
      return res.status(400).json({ error: "priority must be one of: high, normal, low" });
    }

    if (maxRetries !== undefined) {
      if (!Number.isInteger(maxRetries) || maxRetries < 0) {
        return res.status(400).json({ error: "maxRetries must be a non-negative integer" });
      }
    }

    const job = new Job({
      type,
      payload: payload || {},
      ...(priority   !== undefined && { priority }),
      ...(maxRetries !== undefined && { maxRetries }),
    });

    await job.save();
    await enqueue(job._id, job.priority);

    console.log(`[API] Job created: ${job._id} (type: ${job.type}, priority: ${job.priority}, maxRetries: ${job.maxRetries})`);

    return res.status(201).json({
      jobId:      job._id,
      status:     job.status,
      priority:   job.priority,
      maxRetries: job.maxRetries,
    });
  } catch (error) {
    console.error("[API] Error creating job:", error.message);
    return res.status(500).json({ error: "Failed to create job" });
  }
};

// ─── GET /api/jobs ────────────────────────────────────────────────────────────
// List and filter jobs with pagination.
//
// Query params (all optional):
//   status   -> QUEUED | PROCESSING | COMPLETED | FAILED | DEAD
//   type     -> any string (e.g. "example", "fail-test")
//   priority -> high | normal | low
//   page     -> default 1
//   limit    -> default 20, max 100
//
// Examples:
//   GET /api/jobs                        -> all jobs page 1
//   GET /api/jobs?status=DEAD            -> only dead jobs
//   GET /api/jobs?priority=high&page=2   -> high priority page 2
//   GET /api/jobs?type=example&limit=5   -> example type, 5 per page
// ─────────────────────────────────────────────────────────────────────────────

const listJobs = async (req, res) => {
  try {
    const { status, type, priority } = req.query;

    // Pagination — clamp to sane values
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;

    // Build MongoDB filter dynamically — only add fields the client provided
    const filter = {};
    if (status)   filter.status   = status;
    if (type)     filter.type     = type;
    if (priority) filter.priority = priority;

    // Count + data in parallel (faster than sequential)
    const [total, jobs] = await Promise.all([
      Job.countDocuments(filter),
      Job.find(filter)
        .sort({ createdAt: -1 }) // newest first
        .skip(skip)
        .limit(limit)
        .select("_id type priority status retryCount maxRetries createdAt startedAt completedAt deadAt"),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.json({
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        filter: Object.fromEntries(
          Object.entries({ status, type, priority }).filter(([, v]) => v !== undefined)
        ),
      },
      jobs: jobs.map((job) => ({
        jobId:      job._id,
        type:       job.type,
        priority:   job.priority,
        status:     job.status,
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
        createdAt:  job.createdAt,
        ...(job.startedAt   && { startedAt:   job.startedAt }),
        ...(job.completedAt && { completedAt: job.completedAt }),
        ...(job.deadAt      && { deadAt:      job.deadAt }),
      })),
    });

  } catch (error) {
    console.error("[API] Error listing jobs:", error.message);
    return res.status(500).json({ error: "Failed to list jobs" });
  }
};

// ─── GET /api/jobs/dead ───────────────────────────────────────────────────────

const listDead = async (req, res) => {
  try {
    const deadJobs = await Job.find({ status: "DEAD" })
      .sort({ deadAt: -1 })
      .select("_id type payload priority status error retryCount maxRetries deadAt createdAt");

    return res.json({
      count: deadJobs.length,
      jobs: deadJobs.map((job) => ({
        jobId:      job._id,
        type:       job.type,
        payload:    job.payload,
        priority:   job.priority,
        status:     job.status,
        error:      job.error,
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
        deadAt:     job.deadAt,
        createdAt:  job.createdAt,
      })),
    });
  } catch (error) {
    console.error("[API] Error listing dead jobs:", error.message);
    return res.status(500).json({ error: "Failed to list dead jobs" });
  }
};

// ─── POST /api/jobs/:id/requeue ───────────────────────────────────────────────

const requeueJob = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid job ID format" });
    }

    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    if (job.status !== "DEAD") {
      return res.status(400).json({
        error: `Job cannot be requeued - current status is "${job.status}". Only DEAD jobs can be requeued.`,
      });
    }

    job.status      = "QUEUED";
    job.retryCount  = 0;
    job.error       = null;
    job.lastError   = null;
    job.result      = null;
    job.deadAt      = null;
    job.startedAt   = null;
    job.completedAt = null;
    await job.save();

    await removeFromDead(id);
    await enqueue(id, job.priority);

    console.log(`[API] Dead job requeued: ${id} -> priority: ${job.priority}`);

    return res.json({
      jobId:    job._id,
      status:   job.status,
      priority: job.priority,
      message:  "Job has been requeued successfully. It will be processed shortly.",
    });
  } catch (error) {
    console.error("[API] Error requeuing job:", error.message);
    return res.status(500).json({ error: "Failed to requeue job" });
  }
};

// ─── GET /api/jobs/:id ────────────────────────────────────────────────────────

const getJob = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid job ID format" });
    }

    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const response = {
      jobId:      job._id,
      type:       job.type,
      priority:   job.priority,
      status:     job.status,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      createdAt:  job.createdAt,
    };

    if (job.startedAt)   response.startedAt   = job.startedAt;
    if (job.completedAt) response.completedAt = job.completedAt;
    if (job.deadAt)      response.deadAt      = job.deadAt;
    if (job.status === "COMPLETED") response.result    = job.result;
    if (job.status === "FAILED" || job.status === "DEAD") response.error = job.error;
    if (job.lastError)  response.lastError = job.lastError;

    return res.json(response);

  } catch (error) {
    console.error("[API] Error fetching job:", error.message);
    return res.status(500).json({ error: "Failed to fetch job" });
  }
};

module.exports = { createJob, getJob, listDead, requeueJob, listJobs };
