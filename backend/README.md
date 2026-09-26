# TaskFlow — Distributed Job Queue Platform

A production-grade, distributed job queue built from scratch using **Node.js**, **Express**, **MongoDB Atlas**, and **Redis** — without any heavy queue framework (no BullMQ, no Celery, no Kafka).

---

## 📖 Table of Contents

1. [What is TaskFlow?](#what-is-taskflow)
2. [Key Capabilities & Architecture](#key-capabilities--architecture)
3. [Core Concepts](#core-concepts)
   - [Job Lifecycle State Machine](#job-lifecycle-state-machine)
   - [Retries & Exponential Backoff](#retries--exponential-backoff)
   - [Dead Letter Queue (DLQ) & Requeueing](#dead-letter-queue-dlq--requeueing)
   - [Priority Queues (Multi-key BRPOP)](#priority-queues-multi-key-brpop)
   - [Weighted Slot Concurrency & Worker Scaling](#weighted-slot-concurrency--worker-scaling)
   - [Job Leases & The Crash-Recovery Reaper](#job-leases--the-crash-recovery-reaper)
   - [Idempotency Keys](#idempotency-keys)
4. [System Architecture Diagram](#system-architecture-diagram)
5. [Tech Stack](#tech-stack)
6. [Project Structure](#project-structure)
7. [API Reference](#api-reference)
8. [Configuration & Environment Variables](#configuration--environment-variables)
9. [How to Run](#how-to-run)
10. [Testing & Verification Flows](#testing--verification-flows)

---

## What is TaskFlow?

TaskFlow is a **distributed background job processing platform**. It decouples HTTP request handling from time-consuming tasks (video rendering, email dispatching, payment reconciliation, data sync).

When a client submits work:
1. The **API Server** stores the job in MongoDB, pushes only the lightweight job ID into Redis, and responds immediately with `201 Accepted`.
2. One or more **Distributed Worker Containers** (each running a pool of concurrent slots) atomically consume jobs via Redis `BRPOP`, acquire an expiring **lease**, process the payload, and update state in MongoDB.
3. If any worker process crashes mid-execution, a **Lease Reaper** detects the abandoned job and rescues it.

---

## Key Capabilities & Architecture

| Feature | How It Works |
|---|---|
| **Zero Heavy Dependencies** | Built using raw Redis Lists + blocking commands (`BRPOP`, `LPUSH`) and Mongoose. |
| **Exponential Backoff Retries** | When a job fails, backoff delay = `min(2^retryCount * 1000ms, 30000ms)`. |
| **Dead Letter Queue (DLQ)** | Jobs exhausting retries transition to `DEAD` and are placed in `taskflow:dead`. |
| **Manual Requeueing** | `POST /api/jobs/:id/requeue` resets attempts and re-injects dead jobs into the active queue. |
| **3 Priority Tiers** | `high`, `normal`, and `low` queues processed in order using Redis multi-key `BRPOP`. |
| **Weighted Slot Concurrency** | Dedicated slots for priority levels (e.g., 3 High, 2 Normal, 1 Low). |
| **Horizontal Scaling** | Scale workers horizontally via `docker-compose up --scale worker=N`. |
| **Job Leases (Crash Recovery)** | Active jobs are locked with `leasedUntil` and `leasedBy`. Atomic `acquireLease` prevents duplicate processing. |
| **Background Lease Reaper** | Scans every 10s for `PROCESSING` jobs with expired leases and safely re-enqueues them. |
| **Idempotency Keys** | Prevents duplicate job creation when clients retry network-dropped HTTP requests. |
| **Search & Pagination API** | Query jobs by `status`, `type`, `priority` with pagination metadata. |

---

## Core Concepts

### Job Lifecycle State Machine

```
              ┌──────────────┐
              │    QUEUED    │ ◄──────────────────────────────┐
              └──────┬───────┘                                │
                     │ worker acquires lease                  │
                     ▼                                        │
              ┌──────────────┐                                │ retryCount < maxRetries
              │  PROCESSING  │                                │ (re-enqueued with delay)
              └──────┬───────┘                                │
                     │                                        │
        ┌────────────┴────────────┐                           │
        │                         │                           │
     Success                   Failure                        │
        │                         │                           │
        ▼                         ▼                           │
 ┌─────────────┐       retryCount < maxRetries? ──────────────┘
 │  COMPLETED  │                  │
 └─────────────┘                  │ No (exhausted)
                                  ▼
                           ┌─────────────┐
                           │    DEAD     │ ──(Requeue Endpoint)──► QUEUED
                           └─────────────┘
```

---

### Retries & Exponential Backoff

When an unhandled exception occurs inside `jobProcessor.js`:
- If `retryCount < maxRetries`, the job status returns to `QUEUED`, `retryCount` increments, and execution sleeps for `2^retryCount` seconds before re-pushing the ID into Redis:
  - Attempt 1: wait 2s
  - Attempt 2: wait 4s
  - Attempt 3: wait 8s (up to max 30s)
- If retries are exhausted, the job transitions to `DEAD`.

---

### Dead Letter Queue (DLQ) & Requeueing

Instead of silently vanishing, exhausted jobs:
1. Transition to `DEAD` in MongoDB with `deadAt` set to timestamp.
2. Are pushed to Redis list `taskflow:dead`.
3. Can be inspected via `GET /api/jobs/dead` or `GET /api/jobs?status=DEAD`.
4. Can be requeued via `POST /api/jobs/:id/requeue`, which resets counters, removes the ID from `taskflow:dead`, and re-inserts it into the active priority queue.

---

### Priority Queues (Multi-key BRPOP)

Instead of a single queue, TaskFlow maintains three separate Redis lists:
- `taskflow:jobs:high`
- `taskflow:jobs:normal`
- `taskflow:jobs:low`

Worker slots use Redis's native multi-key blocking pop:
```javascript
client.brpop("taskflow:jobs:high", "taskflow:jobs:normal", "taskflow:jobs:low", 0);
```
Redis checks keys strictly **left-to-right**. If `high` has items, it returns immediately and never touches `normal` or `low`. This gives strict priority ordering with zero polling overhead.

---

### Weighted Slot Concurrency & Worker Scaling

Each Worker container runs an internal pool of independent execution **slots**. Slots are weighted so high-priority traffic always has dedicated processing power:

- **HIGH Slots (3)**: Listen to `high -> normal -> low` (prioritize urgent work, help drain lower tiers if idle).
- **NORMAL Slots (2)**: Listen to `normal -> low` (handle standard workload, never steal high-priority slots).
- **LOW Slots (1)**: Listens to `low` (ensures background tasks never starve).

To scale across multiple physical nodes or containers:
```bash
docker-compose up --scale worker=3 -d
```
All containers independently connect to Redis. Because Redis `BRPOP` is atomic, work is automatically distributed with zero race conditions.

---

### Job Leases & The Crash-Recovery Reaper

**The Crash Problem:** If a worker picks up a job, marks it `PROCESSING`, and immediately encounters an Out-Of-Memory (OOM) or container crash, the job is lost from Redis and remains stuck in MongoDB forever.

**The Solution:**
1. **Atomic Lease:** When picking up a job, a slot runs an atomic MongoDB update:
   ```javascript
   Job.findOneAndUpdate(
     { _id: jobId, status: "QUEUED" },
     { $set: { status: "PROCESSING", leasedUntil: now + 30s, leasedBy: WORKER_ID } }
   );
   ```
2. **Lease Reaper:** A background worker routine runs every 10 seconds checking:
   ```javascript
   Job.findOneAndUpdate(
     { status: "PROCESSING", leasedUntil: { $lt: new Date() } },
     { $set: { leasedUntil: now + 30s, leasedBy: WORKER_ID } }
   );
   ```
   If found, the reaper increments `retryCount` and pushes the job back into Redis.

---

### Idempotency Keys

Clients can provide an optional `idempotencyKey` on submission:
```json
{
  "type": "send-invoice",
  "payload": { "invoiceId": 1024 },
  "idempotencyKey": "order_1024_attempt_1"
}
```
If the network drops and the client retries the request, the API detects the existing non-dead job and responds with `200 OK` and `{ duplicate: true, jobId: "..." }` without creating duplicate work.

---

## System Architecture Diagram

```
                             HTTP Clients / Frontends
                                        │
                                        ▼
                                ┌───────────────┐
                                │ TaskFlow API  │ :3001
                                └───────┬───────┘
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
     ┌───────────────┐                                     ┌───────────────┐
     │ MongoDB Atlas │ ◄────────────────┐                  │  Redis Server │ :6380
     └───────────────┘                  │                  └───────┬───────┘
             ▲                          │                          │
             │ Status, Payload,         │ Lease Updates,           │ Atomic BRPOP
             │ Results, DLQ             │ Reaper Rescues           │ Lists (high/norm/low/dead)
             │                          │                          │
   ┌─────────┴──────────────────────────┴──────────────────────────┴─────────┐
   │                                                                         │
   │  ┌───────────────────────────────┐     ┌───────────────────────────────┐│
   │  │       Worker Container 1      │     │       Worker Container 2      ││
   │  │  [Slot 1-3] HIGH (3 slots)    │     │  [Slot 1-3] HIGH (3 slots)    ││
   │  │  [Slot 4-5] NORMAL (2 slots)  │     │  [Slot 4-5] NORMAL (2 slots)  ││
   │  │  [Slot 6]   LOW (1 slot)      │     │  [Slot 6]   LOW (1 slot)      ││
   │  │  [REAPER]   Every 10s         │     │  [REAPER]   Every 10s         ││
   │  └───────────────────────────────┘     └───────────────────────────────┘│
   │                           Distributed Workers                           │
   └─────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

- **Runtime:** Node.js (v20 Alpine)
- **API Framework:** Express.js
- **Primary Database:** MongoDB Atlas (Cloud Mongoose ODM)
- **In-Memory Queue Engine:** Redis 7 (Alpine)
- **Redis Client:** `ioredis`
- **Orchestration:** Docker Compose (Bridge Network)

---

## Project Structure

```
taskflow/backend/
├── docker-compose.yml         # Multi-service setup (Redis, API, scalable Worker)
├── .env                       # Environment credentials (MONGODB_URI)
├── .env.example               # Example template
├── README.md                  # Comprehensive Documentation
├── api/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js          # Express app entry point
│       ├── config/
│       │   ├── db.js          # Mongoose connection
│       │   └── redis.js       # Shared API Redis instance
│       ├── models/
│       │   └── Job.js         # Mongoose schema (leases, idempotency, indexes)
│       ├── controllers/
│       │   └── jobController.js # Endpoints (CRUD, DLQ, requeue, list/filter)
│       ├── routes/
│       │   └── jobRoutes.js   # Route definitions
│       └── services/
│           └── queueService.js# Redis queue operations (LPUSH, BRPOP, DLQ)
└── worker/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── worker.js          # Main worker loop (weighted slots, reaper, leases)
        ├── config/
        │   ├── db.js          # Dedicated worker Mongo connection
        │   └── redis.js       # Factory for dedicated BRPOP clients
        └── jobs/
            └── jobProcessor.js# Task handlers by type
```

---

## API Reference

### 1. Create a Job
`POST /api/jobs`

**Request Body:**
```json
{
  "type": "example",
  "payload": { "userId": 42 },
  "priority": "high",
  "maxRetries": 3,
  "idempotencyKey": "unique-client-tx-999"
}
```

**Response (201 Created):**
```json
{
  "jobId": "6ab52e2a6cb729c3577da559",
  "status": "QUEUED",
  "priority": "high",
  "maxRetries": 3,
  "idempotencyKey": "unique-client-tx-999",
  "duplicate": false
}
```
*(If called again with the same `idempotencyKey`, returns `200 OK` with `"duplicate": true`)*

---

### 2. List & Filter Jobs
`GET /api/jobs`

**Query Parameters (all optional):**
- `status`: `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, `DEAD`
- `type`: e.g. `example`, `fail-test`
- `priority`: `high`, `normal`, `low`
- `page`: Page number (default: `1`)
- `limit`: Items per page (default: `20`, max: `100`)

**Response (200 OK):**
```json
{
  "meta": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPrevPage": false,
    "filter": { "priority": "high" }
  },
  "jobs": [
    {
      "jobId": "6ab52e2a6cb729c3577da559",
      "type": "example",
      "priority": "high",
      "status": "COMPLETED",
      "retryCount": 0,
      "maxRetries": 3,
      "createdAt": "2026-09-24T14:05:30.510Z",
      "startedAt": "2026-09-24T14:05:30.689Z",
      "completedAt": "2026-09-24T14:05:33.785Z"
    }
  ]
}
```

---

### 3. Get Single Job Status
`GET /api/jobs/:id`

**Response (200 OK):**
```json
{
  "jobId": "6ab52e2a6cb729c3577da559",
  "type": "example",
  "priority": "high",
  "status": "COMPLETED",
  "retryCount": 0,
  "maxRetries": 3,
  "createdAt": "2026-09-24T14:05:30.510Z",
  "startedAt": "2026-09-24T14:05:30.689Z",
  "completedAt": "2026-09-24T14:05:33.785Z",
  "result": { "message": "Job processed successfully", "duration": "3000ms" }
}
```

---

### 4. List Dead Letter Queue (DLQ)
`GET /api/jobs/dead`

**Response (200 OK):**
```json
{
  "count": 1,
  "jobs": [
    {
      "jobId": "6ab3eb7b24653b81325af1ba",
      "type": "fail-test",
      "priority": "normal",
      "status": "DEAD",
      "error": "Intentional failure: fail-test job type always fails",
      "retryCount": 1,
      "maxRetries": 1,
      "deadAt": "2026-09-23T15:17:02.872Z",
      "createdAt": "2026-09-23T15:08:43.836Z"
    }
  ]
}
```

---

### 5. Requeue Dead Job
`POST /api/jobs/:id/requeue`

**Response (200 OK):**
```json
{
  "jobId": "6ab3eb7b24653b81325af1ba",
  "status": "QUEUED",
  "priority": "normal",
  "message": "Job has been requeued successfully. It will be processed shortly."
}
```

---

## Configuration & Environment Variables

### Docker Compose Environment (`docker-compose.yml`):
```yaml
environment:
  - MONGODB_URI=${MONGODB_URI}
  - REDIS_URL=redis://redis:6379
  - WORKER_SLOTS_HIGH=3      # High-priority slots per worker container
  - WORKER_SLOTS_NORMAL=2    # Normal-priority slots per worker container
  - WORKER_SLOTS_LOW=1       # Low-priority slots per worker container
  - LEASE_DURATION_MS=30000  # Lease expiration window (30s)
  - REAPER_INTERVAL_MS=10000 # Orphan scan interval (10s)
```

---

## How to Run

### 1. Prerequisites
- Docker Desktop installed and running
- A MongoDB Atlas connection string in `backend/.env`:
  ```ini
  MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxx.mongodb.net/taskflow
  ```

### 2. Start Services
```powershell
cd C:\Users\akasi\OneDrive\Desktop\taskflow\backend

# Start 1 API + 1 Redis + 2 Worker containers
docker-compose up --build --scale worker=2 -d
```

### 3. Check Service Status
```powershell
docker-compose ps
```

### 4. View Worker Activity
```powershell
docker-compose logs -f worker
```

---

## Testing & Verification Flows

### Test 1: Priority Queueing
Submit a `low` priority job followed immediately by a `high` priority job:
```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3001/api/jobs -ContentType "application/json" -Body '{"type":"example","priority":"low"}'
Invoke-RestMethod -Method POST -Uri http://localhost:3001/api/jobs -ContentType "application/json" -Body '{"type":"example","priority":"high"}'
```
*Observe logs: HIGH slots pick up the `high` job immediately.*

### Test 2: Retries and DLQ
Submit a job configured to intentionally fail:
```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3001/api/jobs -ContentType "application/json" -Body '{"type":"fail-test","maxRetries":2}'
```
*Observe logs: Worker retries at 2s, 4s, and then marks the job `DEAD` in `taskflow:dead`.*

### Test 3: Idempotency
Send identical POSTs with the same `idempotencyKey`:
```powershell
$body = '{"type":"example","idempotencyKey":"tx_test_1"}'
Invoke-RestMethod -Method POST -Uri http://localhost:3001/api/jobs -ContentType "application/json" -Body $body
Invoke-RestMethod -Method POST -Uri http://localhost:3001/api/jobs -ContentType "application/json" -Body $body
```
*Observe response: Second call returns the same `jobId` with `"duplicate": true`.*
