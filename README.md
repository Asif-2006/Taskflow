# TaskFlow — Distributed Job Queue Platform

A production-grade distributed job queue and background processing system with an interactive web dashboard.

---

## 📁 Repository Structure

```
taskflow/
├── backend/                  # Distributed Job Processing Core
│   ├── api/                  # Express REST API
│   ├── worker/               # Headless Node.js Worker instances
│   ├── load-tests/           # k6 load & failure test suite
│   ├── docker-compose.yml    # Docker Compose multi-service setup
│   └── README.md             # In-depth Backend & Architecture documentation
└── frontend/                 # Interactive Monitoring & Control Dashboard
    └── ...
```

---

## 🚀 Quick Start

### 1. Backend Setup
```bash
cd backend
# Provide your MongoDB Atlas URI in backend/.env
docker-compose up --build --scale worker=3 -d
```
The API runs at `http://localhost:3001` and Redis on `localhost:6380`.

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

For full architecture, testing, and API documentation, see [`backend/README.md`](./backend/README.md).
