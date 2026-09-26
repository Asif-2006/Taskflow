import http from 'k6/http';
import { check, sleep } from 'k6';

// ─── Baseline Load Test Configuration ─────────────────────────────────────────
// Small, controlled baseline to measure standard API latency and throughput
// without overwhelming the system or Atlas free tier.
export const options = {
  scenarios: {
    baseline_submission: {
      executor: 'constant-vus',
      vus: 5,               // 5 concurrent client virtual users
      duration: '30s',      // 30 seconds duration
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],        // HTTP errors should be < 1%
    http_req_duration: ['p(95)<1000'],     // 95% of API requests should finish < 1s
  },
};

const BASE_URL = 'http://localhost:3001';

export default function () {
  const payload = JSON.stringify({
    type: 'example',
    payload: {
      message: 'Baseline load test job',
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

  // Short pause between iterations to simulate paced client submissions (~5 req/s)
  sleep(1);
}
