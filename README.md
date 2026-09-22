# TaskFlow — Distributed Job Queue Platform

A minimal but fully working distributed job queue built from scratch using **Node.js**, **Express**, **MongoDB**, and **Redis** — without any queue framework.

---

## 📖 Table of Contents

1. [What is this project?](#what-is-this-project)
2. [Core Concepts](#core-concepts)
   - [What is a Job?](#what-is-a-job)
   - [What is a Queue?](#what-is-a-queue)
   - [Why do we need a Worker?](#why-do-we-need-a-worker)
   - [Why Redis?](#why-redis)
   - [Why MongoDB?](#why-mongodb)
   - [MongoDB vs Redis — the key distinction](#mongodb-vs-redis--the-key-distinction)
3. [Architecture](#architecture)
4. [Job Lifecycle](#job-lifecycle)
5. [Project Structure](#project-structure)
6. [Tech Stack](#tech-stack)
7. [API Documentation](#api-documentation)
8. [How to Run](#how-to-run)
9. [How to Test](#how-to-test)
10. [Example Logs](#example-logs)
11. [Git Commit Guide](#git-commit-guide)

---

## What is this project?

TaskFlow is a **job queue platform** — a system that lets you submit work to be done asynchronously.

**The problem it solves:** Imagine a user uploads a file to your API. If the API processes that file itself before responding, the user waits — sometimes for minutes. Instead, TaskFlow lets the API say "I've received your request" instantly, while a separate Worker handles the heavy work in the background.

This is how real-world systems like email delivery, image processing, and video encoding work at scale.

---

## Core Concepts

### What is a Job?

A **job** is a unit of work with:
- A **type** — tells the Worker what to do (`"example"`, `"fail-test"`)
- A **payload** — the input data the Worker needs
- A **status** — where the job is in its lifecycle
- A **result** or **error** — the outcome after processing

```json
{
  "_id": "abc123",
  "type": "example",
  "payload": { "message": "Hello TaskFlow" },
  "status": "COMPLETED",
  "result": { "message": "Job processed successfully" },
  "createdAt": "2026-09-22T14:00:00Z",
  "startedAt": "2026-09-22T14:00:00.3Z",
  "completedAt": "2026-09-22T14:00:03.4Z"
}
```

---

### What is a Queue?

A queue is a line — **First In, First Out (FIFO)**. New jobs join at the back. The Worker picks from the front.

```
New jobs →  [job5, job4, job3, job2, job1]  → Worker picks up
                                     ↑
                              processed first
```

---

### Why do we need a Worker?

The **API** is designed to be fast. It receives requests and responds immediately. If the API also processed jobs, it would block and slow down for every user.

The **Worker** is a separate process whose only job is to process work — slowly, thoroughly, without caring about HTTP response times.

```
API Process                     Worker Process
────────────────────            ────────────────────
Receives HTTP requests          Watches Redis queue
Responds in milliseconds        Processes one job at a time
Never blocks                    Can take seconds or minutes
```

---

### Why Redis?

Redis is an **in-memory data store** — reads and writes happen in microseconds.

For a queue, Redis provides the `BRPOP` command — a **blocking pop** that makes the Worker sleep with 0% CPU usage until a job arrives. No polling, no busy-waiting.

```
LPUSH taskflow:jobs <jobId>   ← API adds a job ID
BRPOP taskflow:jobs 0         ← Worker waits (sleeps) until one appears
```

Redis is **temporary** — once the Worker picks up a job ID, it's gone from Redis.

---

### Why MongoDB?

MongoDB stores the **full persistent record** of every job — forever.

- The API writes the full job document to MongoDB first
- The Worker reads it, updates `status`, and writes back `result` or `error`
- The Client reads from MongoDB via `GET /api/jobs/:id`

MongoDB is **permanent** — job documents survive container restarts, worker crashes, and everything else.

---

### MongoDB vs Redis — the key distinction

> This is the most important concept in the project.

| | MongoDB | Redis |
|--|---------|-------|
| **Stores** | Full job document (all fields) | Only the job ID |
| **Purpose** | Permanent record — what happened | Temporary courier — what's waiting |
| **When a Worker picks up a job** | Document stays forever | Job ID is removed |
| **After job completes** | Document updated with result | Nothing (already empty) |
| **Is it a queue?** | ❌ No | ✅ Yes |

**MongoDB is not the queue. Redis is the queue.**

---

## Architecture

```
                    Client
                       │
                       │ HTTP POST /api/jobs
                       ▼
              ┌─────────────────┐
              │   API Server    │
              │  Node/Express   │
              └───────┬─────────┘
                      │
            ┌─────────┴──────────┐
            │                    │
            ▼                    ▼
      ┌───────────┐       ┌────────────┐
      │  MongoDB  │       │   Redis    │
      │  (Atlas)  │       │   Queue    │
      │           │       │            │
      │ Full job  │       │  [jobId]   │
      │ document  │       │            │
      └───────────┘       └─────┬──────┘
                                │
                                │ BRPOP (blocking)
                                ▼
                        ┌───────────────┐
                        │    Worker     │
                        │  (separate    │
                        │   process)    │
                        └───────┬───────┘
                                │
                      Fetch job from MongoDB
                      Update status → PROCESSING
                      Process the job
                      Update status → COMPLETED / FAILED
                                │
                                ▼
                          ┌───────────┐
                          │  MongoDB  │
                          │  (Atlas)  │
                          │  result   │
                          └───────────┘
                                │
                                │ GET /api/jobs/:id
                                ▼
                            Client
```

---

## Job Lifecycle

```
                 POST /api/jobs
                       │
                       ▼
                   ┌────────┐
                   │ QUEUED │ ← Created in MongoDB, ID in Redis
                   └───┬────┘
                       │  Worker picks it up (BRPOP)
                       ▼
               ┌────────────┐
               │ PROCESSING │ ← Worker set startedAt
               └─────┬──────┘
                     │
           ┌─────────┴──────────┐
           │                    │
           ▼                    ▼
     ┌───────────┐        ┌────────┐
     │ COMPLETED │        │ FAILED │
     │           │        │        │
     │ result ✅ │        │ error ❌│
     └───────────┘        └────────┘
```

---

## Project Structure

```
taskflow/
│
├── api/                          # Express API Server
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js             # MongoDB connection
│   │   │   └── redis.js          # Redis connection
│   │   ├── controllers/
│   │   │   └── jobController.js  # createJob, getJob logic
│   │   ├── models/
│   │   │   └── Job.js            # Mongoose schema
│   │   ├── routes/
│   │   │   └── jobRoutes.js      # URL → handler mapping
│   │   ├── services/
│   │   │   └── queueService.js   # enqueue / dequeue functions
│   │   └── server.js             # Express entry point
│   ├── Dockerfile
│   └── package.json
│
├── worker/                       # Job Worker Process
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js             # MongoDB connection (separate)
│   │   │   └── redis.js          # Redis connection factory
│   │   ├── jobs/
│   │   │   └── jobProcessor.js   # Job type handlers
│   │   └── worker.js             # Main worker loop
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml            # Orchestrates all services
├── .env                          # Your environment variables (not in Git)
├── .env.example                  # Template for .env
├── .gitignore
└── README.md
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| API Server | Node.js + Express | Fast, familiar, minimal |
| Database | MongoDB + Mongoose | Flexible schema, Atlas cloud hosting |
| Queue | Redis (ioredis) | In-memory speed, native `BRPOP` blocking |
| Infrastructure | Docker + Docker Compose | One command to start everything |
| Language | JavaScript | Consistent across API and Worker |

**Not used (Phase 1):** PostgreSQL, BullMQ, Kafka, RabbitMQ, Kubernetes, cloud services.

---

## API Documentation

### POST `/api/jobs`
Submit a new job.

**Request:**
```json
{
  "type": "example",
  "payload": {
    "message": "Hello TaskFlow"
  }
}
```

**Response `201`:**
```json
{
  "jobId": "6ab29d91951c0a1bcf08e355",
  "status": "QUEUED"
}
```

**Job Types:**
| type | behaviour |
|------|-----------|
| `"example"` | Waits 3 seconds, returns success result |
| `"fail-test"` | Intentionally fails → FAILED status |

---

### GET `/api/jobs/:id`
Get the current status of a job.

**Response — QUEUED:**
```json
{
  "jobId": "...",
  "type": "example",
  "status": "QUEUED",
  "createdAt": "2026-09-22T14:00:00.000Z"
}
```

**Response — PROCESSING:**
```json
{
  "jobId": "...",
  "type": "example",
  "status": "PROCESSING",
  "createdAt": "2026-09-22T14:00:00.000Z",
  "startedAt": "2026-09-22T14:00:00.200Z"
}
```

**Response — COMPLETED:**
```json
{
  "jobId": "...",
  "type": "example",
  "status": "COMPLETED",
  "createdAt": "2026-09-22T14:00:00.000Z",
  "startedAt": "2026-09-22T14:00:00.200Z",
  "completedAt": "2026-09-22T14:00:03.400Z",
  "result": {
    "message": "Job processed successfully",
    "processedAt": "2026-09-22T14:00:03.400Z"
  }
}
```

**Response — FAILED:**
```json
{
  "jobId": "...",
  "type": "fail-test",
  "status": "FAILED",
  "createdAt": "2026-09-22T14:00:00.000Z",
  "startedAt": "2026-09-22T14:00:00.200Z",
  "completedAt": "2026-09-22T14:00:01.800Z",
  "error": "Intentional failure: fail-test job type always fails"
}
```

**Error responses:**
| Status | Meaning |
|--------|---------|
| `400` | Invalid job ID format |
| `404` | Job not found |
| `500` | Server error |

---

## How to Run

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- A `.env` file in the project root (copy from `.env.example`)

### 1. Set up environment
```bash
cp .env.example .env
# Edit .env and set your MONGODB_URI (Atlas or local)
```

### 2. Start everything
```bash
docker-compose up --build -d
```

### 3. Verify
```bash
# Check all containers are running
docker-compose ps

# Check API is connected to MongoDB and Redis
docker-compose logs api

# Check Worker is waiting for jobs
docker-compose logs worker
```

### 4. Test the health endpoint
```
GET http://localhost:3001/health
```

### Stop everything
```bash
docker-compose down
```

---

## How to Test

### Submit a job
```bash
curl -X POST http://localhost:3001/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "example", "payload": {"message": "Hello"}}'
```

### Check job status (replace with your jobId)
```bash
curl http://localhost:3001/api/jobs/<jobId>
```

### Watch the Worker process jobs live
```bash
docker-compose logs -f worker
```

### Trigger a failure
```bash
curl -X POST http://localhost:3001/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "fail-test", "payload": {}}'
```

### Inspect the Redis queue
```bash
# See job IDs waiting in the queue
docker exec taskflow-redis redis-cli LRANGE taskflow:jobs 0 -1

# Count jobs in queue
docker exec taskflow-redis redis-cli LLEN taskflow:jobs
```

---

## Example Logs

### API (when a job is submitted):
```
[API] MongoDB connected → mongodb+srv://...
[API] Redis connected   → redis://redis:6379
[API] TaskFlow API server running on port 3000
[API] Job created: 6ab29d91951c0a1bcf08e355
[API] Job enqueued in Redis: 6ab29d91951c0a1bcf08e355
[API] Job queued:  6ab29d91951c0a1bcf08e355
```

### Worker (processing a job):
```
[WORKER] TaskFlow Worker starting...
[WORKER] MongoDB connected → mongodb+srv://...
[WORKER] Redis connected   → redis://redis:6379
[WORKER] Waiting for jobs...

[WORKER] ──────────────────────────────────────
[WORKER] Received job: 6ab29d91951c0a1bcf08e355
[WORKER] Job status: PROCESSING
[WORKER] Processing job: 6ab29d91951c0a1bcf08e355
[WORKER] Payload: {"message":"Hello"}
[WORKER] Job completed: 6ab29d91951c0a1bcf08e355
[WORKER] Result: {"message":"Job processed successfully",...}
[WORKER] ──────────────────────────────────────

[WORKER] Waiting for jobs...
```

### Worker (failed job):
```
[WORKER] ──────────────────────────────────────
[WORKER] Received job: 6ab29d95951c0a1bcf08e358
[WORKER] Job status: PROCESSING
[WORKER] Running fail-test job: 6ab29d95951c0a1bcf08e358
[WORKER] Job FAILED: 6ab29d95951c0a1bcf08e358
[WORKER] Error: Intentional failure: fail-test job type always fails
[WORKER] ──────────────────────────────────────
```

---

## Git Commit Guide

Suggested commit structure (make these after verifying each step):

```
git init
git add .
git commit -m "Initialize TaskFlow project structure"

git add api/src/models/ api/src/config/db.js
git commit -m "Add MongoDB connection and Job model"

git add api/src/controllers/ api/src/routes/ api/src/server.js
git commit -m "Add POST /api/jobs endpoint (MongoDB only)"

git add api/src/config/redis.js api/src/services/queueService.js
git commit -m "Add Redis connection and queue service"

git add api/src/controllers/jobController.js
git commit -m "Enqueue job ID into Redis after MongoDB save"

git add worker/
git commit -m "Add Worker: BRPOP loop, job processor, FAILED handling"

git add api/src/controllers/jobController.js
git commit -m "Polish GET /api/jobs/:id with clean status-aware responses"

git add README.md
git commit -m "Add README with architecture, concepts, and API docs"
```

---

## Phase 2 (Future)

Not implemented yet — keeping Phase 1 simple:

- Job retries + exponential backoff
- Dead Letter Queue (permanently failed jobs)
- Job priorities
- Multiple queues
- Worker heartbeat + failure recovery
- Scheduled / cron jobs
- WebSocket live status updates
- Prometheus + Grafana metrics
- Authentication
