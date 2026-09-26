import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Copy, Check, Clock, Cpu, AlertTriangle, ShieldCheck } from 'lucide-react';
import { getJobById, requeueJob } from '../services/api';

export default function JobDetailModal({ jobId, onClose, onJobUpdated }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requeuing, setRequeuing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    getJobById(jobId)
      .then((data) => {
        setJob(data);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (!jobId) return null;

  const handleCopyId = () => {
    navigator.clipboard.writeText(jobId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRequeue = async () => {
    setRequeuing(true);
    try {
      await requeueJob(jobId);
      const updated = await getJobById(jobId);
      setJob(updated);
      if (onJobUpdated) onJobUpdated(updated);
    } catch (err) {
      alert('Failed to requeue: ' + err.message);
    } finally {
      setRequeuing(false);
    }
  };

  const getDuration = () => {
    if (!job?.startedAt || !job?.completedAt) return null;
    const diff = new Date(job.completedAt) - new Date(job.startedAt);
    return `${diff} ms`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur z-10">
          <div className="flex items-center space-x-3">
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white">Job Inspector</h3>
                <span className="font-mono text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  {jobId.slice(0, 8)}...
                </span>
                <button
                  onClick={handleCopyId}
                  className="text-slate-500 hover:text-slate-300 p-1"
                  title="Copy full Job ID"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Type: <span className="font-semibold text-slate-200">{job?.type || '—'}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {loading && (
            <div className="py-12 text-center text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Fetching job state...</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-lg">
              {error}
            </div>
          )}

          {job && !loading && (
            <>
              {/* Meta Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase">Status</div>
                  <div className="mt-1 font-bold text-sm">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                        job.status === 'COMPLETED'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : job.status === 'PROCESSING'
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse'
                          : job.status === 'DEAD'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase">Priority</div>
                  <div className="mt-1 text-sm font-semibold capitalize text-slate-200">
                    {job.priority || 'normal'}
                  </div>
                </div>

                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase">Attempts</div>
                  <div className="mt-1 text-sm font-semibold text-slate-200">
                    {job.retryCount || 0} / {(job.maxRetries ?? 3) + 1}
                  </div>
                </div>

                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase">Execution Time</div>
                  <div className="mt-1 text-sm font-mono font-semibold text-slate-200">
                    {getDuration() || '—'}
                  </div>
                </div>
              </div>

              {/* Lease Metadata (if active) */}
              {(job.leasedBy || job.leasedUntil) && (
                <div className="p-3.5 rounded-xl bg-sky-950/20 border border-sky-800/40 text-xs">
                  <div className="flex items-center gap-1.5 text-sky-400 font-semibold mb-1">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Active Distributed Lease</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-300">
                    <div>Leased By Worker: <span className="font-mono text-white">{job.leasedBy}</span></div>
                    <div>Expires: <span className="font-mono text-white">{new Date(job.leasedUntil).toLocaleTimeString()}</span></div>
                  </div>
                </div>
              )}

              {/* Error Trace if any */}
              {(job.error || job.lastError) && (
                <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-800/40 text-xs">
                  <div className="flex items-center gap-1.5 text-rose-400 font-semibold mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Failure Reason</span>
                  </div>
                  <div className="font-mono text-rose-200 text-xs bg-slate-950 p-2.5 rounded-lg border border-slate-800 overflow-x-auto">
                    {job.error || job.lastError}
                  </div>
                </div>
              )}

              {/* Payload */}
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-1">Payload (Input)</div>
                <pre className="font-mono text-xs bg-slate-950 p-3 rounded-xl border border-slate-800 text-slate-300 overflow-x-auto">
                  {JSON.stringify(job.payload || {}, null, 2)}
                </pre>
              </div>

              {/* Result if completed */}
              {job.result && (
                <div>
                  <div className="text-xs font-semibold text-slate-400 mb-1">Result (Output)</div>
                  <pre className="font-mono text-xs bg-slate-950 p-3 rounded-xl border border-slate-800 text-emerald-300 overflow-x-auto">
                    {JSON.stringify(job.result, null, 2)}
                  </pre>
                </div>
              )}

              {/* Timestamps */}
              <div className="text-[11px] text-slate-500 space-y-1 border-t border-slate-800 pt-3">
                <div>Created At: {new Date(job.createdAt).toLocaleString()}</div>
                {job.startedAt && <div>Started At: {new Date(job.startedAt).toLocaleString()}</div>}
                {job.completedAt && <div>Completed At: {new Date(job.completedAt).toLocaleString()}</div>}
                {job.deadAt && <div className="text-rose-400">Moved to DLQ: {new Date(job.deadAt).toLocaleString()}</div>}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 flex justify-between items-center bg-slate-900/90">
          <div>
            {job?.status === 'DEAD' && (
              <button
                onClick={handleRequeue}
                disabled={requeuing}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/30"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${requeuing ? 'animate-spin' : ''}`} />
                <span>{requeuing ? 'Requeuing...' : 'Requeue to Active Pool'}</span>
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
