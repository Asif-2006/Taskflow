/**
 * api.js — Frontend API client for TaskFlow backend
 */

const API_BASE = '';

export async function getHealth() {
  const start = performance.now();
  try {
    const res = await fetch(`${API_BASE}/health`);
    const latency = Math.round(performance.now() - start);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { ok: true, latency, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getJobs(params = {}) {
  const query = new URLSearchParams();
  if (params.status && params.status !== 'ALL') query.append('status', params.status);
  if (params.priority && params.priority !== 'ALL') query.append('priority', params.priority);
  if (params.type) query.append('type', params.type);
  if (params.page) query.append('page', params.page);
  if (params.limit) query.append('limit', params.limit);

  const res = await fetch(`${API_BASE}/api/jobs?${query.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch jobs (${res.status})`);
  return await res.json();
}

export async function getJobById(id) {
  const res = await fetch(`${API_BASE}/api/jobs/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch job ${id}`);
  return await res.json();
}

export async function getDeadJobs() {
  const res = await fetch(`${API_BASE}/api/jobs/dead`);
  if (!res.ok) throw new Error(`Failed to fetch dead jobs (${res.status})`);
  return await res.json();
}

export async function createJob(jobData) {
  const res = await fetch(`${API_BASE}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobData),
  });
  if (!res.ok && res.status !== 200) {
    const errorText = await res.text();
    throw new Error(errorText || `Job creation failed with ${res.status}`);
  }
  return await res.json();
}

export async function requeueJob(id) {
  const res = await fetch(`${API_BASE}/api/jobs/${id}/requeue`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Requeue failed with status ${res.status}`);
  }
  return await res.json();
}
