/**
 * jobRoutes.js — URL → Handler Mapping
 *
 * This file's only job is to say:
 *   "When someone hits THIS URL with THIS method, call THAT function."
 *
 * It contains zero business logic.
 *
 * Express Router lets us group related routes together and
 * mount them all under a prefix (e.g. /api/jobs) in server.js.
 */

const express = require("express");
const router = express.Router();
const { createJob, getJob } = require("../controllers/jobController");

// POST /api/jobs    → createJob()
// This is how a client submits a new job to the system.
router.post("/", createJob);

// GET /api/jobs/:id → getJob()
// This is how a client checks the status of a job.
// :id is a URL parameter — Express puts it in req.params.id
router.get("/:id", getJob);

module.exports = router;
