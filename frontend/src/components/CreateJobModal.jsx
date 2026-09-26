import React, { useState } from 'react';
import { X, Send, Sparkles, Key, AlertCircle } from 'lucide-react';
import { createJob } from '../services/api';

const PRESETS = [
  {
    name: 'Sample Worker Task',
    type: 'example',
    priority: 'normal',
    payload: { message: 'Process thumbnail generation', userId: 104, timestamp: Date.now() },
  },
  {
    name: 'Intentional Failure (DLQ / Retries Test)',
    type: 'fail-test',
    priority: 'high',
    payload: { simulateCrash: true, reason: 'Testing exponential backoff' },
  },
  {
    name: 'High Priority Email',
    type: 'example',
    priority: 'high',
    payload: { to: 'admin@taskflow.dev', subject: 'Urgent System Alert' },
  },
  {
    name: 'Low Priority Background Archive',
    type: 'example',
    priority: 'low',
    payload: { archiveBatch: '2026-Q3-data' },
  },
];

export default function CreateJobModal({ isOpen, onClose, onSuccess }) {
  const [type, setType] = useState('example');
  const [priority, setPriority] = useState('normal');
  const [maxRetries, setMaxRetries] = useState(3);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [payloadText, setPayloadText] = useState('{\n  "message": "Hello from TaskFlow UI"\n}');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleApplyPreset = (preset) => {
    setType(preset.type);
    setPriority(preset.priority);
    setPayloadText(JSON.stringify(preset.payload, null, 2));
  };

  const handleGenerateKey = () => {
    setIdempotencyKey(`tx_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    let parsedPayload = {};
    try {
      if (payloadText.trim()) {
        parsedPayload = JSON.parse(payloadText);
      }
    } catch (err) {
      setError('Invalid JSON in payload: ' + err.message);
      return;
    }

    setSubmitting(true);
    try {
      const jobData = {
        type: type.trim(),
        priority,
        maxRetries: Number(maxRetries),
        payload: parsedPayload,
      };

      if (idempotencyKey.trim()) {
        jobData.idempotencyKey = idempotencyKey.trim();
      }

      const res = await createJob(jobData);
      onSuccess(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl shadow-black/80">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Send className="w-4 h-4 text-indigo-400" />
              Enqueue New Job
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Submit work to Redis. Distributed workers will pick it up automatically.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preset Chips */}
        <div className="px-5 pt-4">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            Quick Presets
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handleApplyPreset(p)}
                className="text-xs px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/60 transition-all"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Job Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Job Type <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. example, fail-test, send-email"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Priority & Retries Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Priority */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Queue Priority
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'high', label: 'High', color: 'border-rose-500/40 text-rose-400 bg-rose-500/10' },
                  { id: 'normal', label: 'Normal', color: 'border-indigo-500/40 text-indigo-400 bg-indigo-500/10' },
                  { id: 'low', label: 'Low', color: 'border-slate-600 text-slate-400 bg-slate-800' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPriority(p.id)}
                    className={`py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                      priority === p.id
                        ? `${p.color} ring-1 ring-white/20 shadow-sm`
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Max Retries */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Max Retries
              </label>
              <input
                type="number"
                min="0"
                max="10"
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Idempotency Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="w-3 h-3 text-slate-400" />
                Idempotency Key (Optional)
              </label>
              <button
                type="button"
                onClick={handleGenerateKey}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
              >
                Auto-generate
              </button>
            </div>
            <input
              type="text"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              placeholder="e.g. order_1024_retry"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* JSON Payload */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Payload (JSON)
            </label>
            <textarea
              rows={4}
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="w-full font-mono text-xs px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition-all"
            >
              {submitting ? 'Enqueuing...' : 'Submit to Queue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
