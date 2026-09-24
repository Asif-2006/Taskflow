/**
 * jobRoutes.js - URL to Handler Mapping
 *
 * Route ORDER matters in Express:
 *   1. Specific static paths first  (/dead, /)
 *   2. Dynamic param paths last     (/:id, /:id/requeue)
 *
 * If /:id came before /dead, Express would treat "dead" as a job ID.
 * If /:id came before /, GET / would still work (/ has no param), but
 * declaring the more-specific routes first is always safer practice.
 */

const express = require("express");
const router  = express.Router();
const {
  createJob,
  getJob,
  listJobs,
  listDead,
  requeueJob,
} = require("../controllers/jobController");

// POST /api/jobs           -> submit a new job
router.post("/", createJob);

// GET  /api/jobs           -> list/filter all jobs (with pagination)
router.get("/",  listJobs);

// GET  /api/jobs/dead      -> list all DEAD jobs
// Must be before /:id so "dead" is not treated as a job ID
router.get("/dead", listDead);

// GET  /api/jobs/:id       -> get a single job by ID
router.get("/:id", getJob);

// POST /api/jobs/:id/requeue -> bring a DEAD job back to life
router.post("/:id/requeue", requeueJob);

module.exports = router;
