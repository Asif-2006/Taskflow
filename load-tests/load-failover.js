import http from 'k6/http';
import { check, sleep } from 'k6';

// ─── Worker Failure Under Load Test Configuration ──────────────────────────────
export const options = {
  scenarios: {
    failover_50vu: {
      executor: 'constant-vus',
      vus: 50,             // 50 concurrent client virtual users
      duration: '30s',     // 30 seconds duration
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],        // HTTP errors < 5%
    http_req_duration: ['p(95)<3000'],     // 95% of API requests < 3.0s
  },
};

const BASE_URL = 'http://localhost:3001';

export default function () {
  const payload = JSON.stringify({
    type: 'example',
    payload: {
      message: 'Failover load test job',
      timestamp: Date.now(),
    },
    priority: 'normal',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(`${BASE_URL}/api/jobs`, payload, params);

  check(res, {
    'status is 201': (r) => r.status === 201,
    'has jobId': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && body.jobId !== undefined;
      } catch (e) {
        return false;
      }
    },
  });

  sleep(1);
}
