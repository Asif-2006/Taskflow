/**
 * jobController.js - Business Logic for Job Endpoints
 *
 * Phase 3 additions:
 *   createJob - idempotency key support (prevents duplicate jobs on retried POSTs)
 *   getJob    - now returns leasedUntil, leasedBy, idempotencyKey
 */

const Job = require("../models/Job");
const { enqueue, getDead, removeFromDead } = require("../services/queueService");

// ─── POST /api/jobs ───────────────────────────────────────────────────────────

const createJob = async (req, res) => {
  try {
    const { type, payload, priority, maxRetries, idempotencyKey } = req.body;

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

    // ── Idempotency check ─────────────────────────────────────────────────────
    // If the client provided a key, check if a job with that key already exists.
    // This handles the case where the client retries a POST after a timeout.
    //
    // We only treat active jobs as duplicates. A DEAD job with the same key
    // is treated as a new job — the original died, so starting fresh is correct.
    if (idempotencyKey) {
      const existing = await Job.findOne({ idempotencyKey });

      if (existing && existing.status !== "DEAD") {
        console.log(`[API] Duplicate request blocked — idempotencyKey: ${idempotencyKey} -> existing job: ${existing._id}`);
        return res.status(200).json({
          jobId:          existing._id,
          status:         existing.status,
          priority:       existing.priority,
          maxRetries:     existing.maxRetries,
          idempotencyKey: existing.idempotencyKey,
          duplicate:      true, // tells the client this is the original, not a new job
        });
      }
    }

    const job = new Job({
      type,
      payload:    payload || {},
      ...(priority        !== undefined && { priority }),
      ...(maxRetries      !== undefined && { maxRetries }),
      ...(idempotencyKey  !== undefined && { idempotencyKey }),
    });

    await job.save();
    await enqueue(job._id, job.priority);

    console.log(`[API] Job created: ${job._id} (type: ${job.type}, priority: ${job.priority}, maxRetries: ${job.maxRetries}${idempotencyKey ? ", idempotencyKey: " + idempotencyKey : ""})`);

    return res.status(201).json({
      jobId:          job._id,
      status:         job.status,
      priority:       job.priority,
      maxRetries:     job.maxRetries,
      idempotencyKey: job.idempotencyKey || undefined,
      duplicate:      false,
    });
  } catch (error) {
    // MongoDB duplicate key error on idempotencyKey (race condition safety net)
    if (error.code === 11000 && req.body.idempotencyKey) {
      const existing = await Job.findOne({ idempotencyKey: req.body.idempotencyKey });
      if (existing) {
        return res.status(200).json({
          jobId:          existing._id,
          status:         existing.status,
          priority:       existing.priority,
          maxRetries:     existing.maxRetries,
          idempotencyKey: existing.idempotencyKey,
          duplicate:      true,
        });
      }
    }
    console.error("[API] Error creating job:", error.message);
    return res.status(500).json({ error: "Failed to create job" });
  }
};

// ─── GET /api/jobs ────────────────────────────────────────────────────────────

const listJobs = async (req, res) => {
  try {
    const { status, type, priority } = req.query;
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;

    const filter = {};
    if (status)   filter.status   = status;
    if (type)     filter.type     = type;
    if (priority) filter.priority = priority;

    const [total, jobs] = await Promise.all([
      Job.countDocuments(filter),
      Job.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("_id type priority status retryCount maxRetries idempotencyKey createdAt startedAt completedAt deadAt leasedUntil leasedBy"),
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
        jobId:          job._id,
        type:           job.type,
        priority:       job.priority,
        status:         job.status,
        retryCount:     job.retryCount,
        maxRetries:     job.maxRetries,
        idempotencyKey: job.idempotencyKey || undefined,
        createdAt:      job.createdAt,
        ...(job.startedAt   && { startedAt:   job.startedAt }),
        ...(job.completedAt && { completedAt: job.completedAt }),
        ...(job.deadAt      && { deadAt:      job.deadAt }),
        ...(job.leasedUntil && { leasedUntil: job.leasedUntil }),
        ...(job.leasedBy    && { leasedBy:    job.leasedBy }),
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
      .select("_id type payload priority status error retryCount maxRetries idempotencyKey deadAt createdAt");

    return res.json({
      count: deadJobs.length,
      jobs: deadJobs.map((job) => ({
        jobId:          job._id,
        type:           job.type,
        payload:        job.payload,
        priority:       job.priority,
        status:         job.status,
        error:          job.error,
        retryCount:     job.retryCount,
        maxRetries:     job.maxRetries,
        idempotencyKey: job.idempotencyKey || undefined,
        deadAt:         job.deadAt,
        createdAt:      job.createdAt,
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
    job.leasedUntil = null;
    job.leasedBy    = null;
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

    if (job.idempotencyKey) response.idempotencyKey = job.idempotencyKey;
    if (job.startedAt)      response.startedAt      = job.startedAt;
    if (job.completedAt)    response.completedAt    = job.completedAt;
    if (job.deadAt)         response.deadAt         = job.deadAt;
    if (job.leasedUntil)    response.leasedUntil    = job.leasedUntil;
    if (job.leasedBy)       response.leasedBy       = job.leasedBy;

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
