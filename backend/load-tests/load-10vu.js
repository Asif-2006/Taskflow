import http from 'k6/http';
import { check, sleep } from 'k6';

// ─── 10-VU Load Test Configuration ───────────────────────────────────────────
export const options = {
  scenarios: {
    load_10vu: {
      executor: 'constant-vus',
      vus: 10,              // 10 concurrent client virtual users
      duration: '30s',      // 30 seconds duration
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],        // HTTP errors < 1%
    http_req_duration: ['p(95)<1500'],     // 95% of API requests < 1.5s
  },
};

const BASE_URL = 'http://localhost:3001';

export default function () {
  const payload = JSON.stringify({
    type: 'example',
    payload: {
      message: '10-VU load test job',
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

  // Same client pacing as baseline (1s sleep between iterations)
  sleep(1);
}
