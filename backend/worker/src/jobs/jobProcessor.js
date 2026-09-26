/**
 * jobProcessor.js — Job Type Handlers
 *
 * This is where the ACTUAL WORK happens for each job type.
 *
 * HOW IT WORKS:
 *   The worker receives a job object from MongoDB.
 *   It calls processJob(job), which looks at job.type
 *   and routes to the correct handler function.
 *
 * To add a new job type in the future, just add a new case here.
 * Nothing else in the system needs to change.
 *
 * CURRENT JOB TYPES:
 *   "example"   → simulates work (3 second delay), returns success
 *   "fail-test" → intentionally throws an error → job becomes FAILED
 */

/**
 * handler: example
 *
 * Simulates a real job by waiting 3 seconds.
 * The delay is intentional — it lets you watch the status change:
 *   QUEUED → PROCESSING (you see this immediately)
 *   ... 3 seconds pass ...
 *   PROCESSING → COMPLETED (query the API to see this)
 */
const handleExample = async (job) => {
  console.log(`[WORKER] Processing job: ${job._id}`);
  console.log(`[WORKER] Payload: ${JSON.stringify(job.payload)}`);

  // Simulate real work (e.g., sending email, resizing image, calling an API)
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Return the result — this gets stored in MongoDB as job.result
  return {
    message: "Job processed successfully",
    processedAt: new Date().toISOString(),
    input: job.payload,
  };
};

/**
 * handler: fail-test
 *
 * Intentionally throws an error.
 * Use this to observe the FAILED status flow:
 *   QUEUED → PROCESSING → FAILED
 *
 * POST /api/jobs with { "type": "fail-test" } to trigger this.
 */
const handleFailTest = async (job) => {
  console.log(`[WORKER] Running fail-test job: ${job._id}`);
  console.log(`[WORKER] This job is designed to fail intentionally.`);

  // Simulate a short delay before failing (makes it more realistic)
  await new Promise((resolve) => setTimeout(resolve, 1000));

  throw new Error("Intentional failure: fail-test job type always fails");
};

/**
 * processJob(job)
 *
 * Main entry point called by the worker loop.
 * Routes the job to the correct handler based on job.type.
 * Returns the result object (stored in MongoDB on success).
 * Throws an error (caught by worker loop on failure).
 */
const processJob = async (job) => {
  switch (job.type) {
    case "example":
      return await handleExample(job);

    case "fail-test":
      return await handleFailTest(job);

    default:
      // Unknown job types also fail — the worker can't process what it doesn't know.
      throw new Error(`Unknown job type: "${job.type}"`);
  }
};

module.exports = { processJob };
