import React, { useState } from 'react';
import { X, Layers, Flame, CheckCircle2 } from 'lucide-react';
import { createJob } from '../services/api';

export default function BatchModal({ isOpen, onClose, onSuccess }) {
  const [count, setCount] = useState(10);
  const [priorityMode, setPriorityMode] = useState('mixed'); // 'mixed', 'high', 'normal', 'low'
  const [jobType, setJobType] = useState('example');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  if (!isOpen) return null;

  const handleRunBatch = async () => {
    setRunning(true);
    setProgress({ done: 0, total: count });

    const priorities = priorityMode === 'mixed' ? ['high', 'normal', 'low'] : [priorityMode];

    for (let i = 1; i <= count; i++) {
      const selectedPriority = priorities[i % priorities.length];
      try {
        await createJob({
          type: jobType,
          priority: selectedPriority,
          payload: { batchIndex: i, batchSize: count, timestamp: Date.now() },
        });
      } catch (err) {
        console.error('Batch item failed:', err);
      }
      setProgress((prev) => ({ ...prev, done: i }));
    }

    setRunning(false);
    onSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl shadow-black/80">
        
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400">
              <Flame className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Batch Queue Ingestion</h3>
              <p className="text-xs text-slate-400">Stress test distributed worker slots</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Number of Jobs to Flood
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[5, 10, 20, 50].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                    count === n
                      ? 'border-indigo-500 bg-indigo-600/20 text-indigo-400'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {n} Jobs
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Priority Distribution
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { id: 'mixed', label: 'Mixed (High/Norm/Low)' },
                { id: 'high', label: 'All High' },
                { id: 'normal', label: 'All Normal' },
                { id: 'low', label: 'All Low' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriorityMode(p.id)}
                  className={`p-2 rounded-lg border text-left font-medium transition-all ${
                    priorityMode === p.id
                      ? 'border-indigo-500 bg-indigo-500/10 text-white'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {running && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <div className="flex justify-between text-xs text-slate-300 mb-1 font-medium">
                <span>Injecting into Redis...</span>
                <span>{progress.done} / {progress.total}</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-indigo-500 h-1.5 transition-all duration-150"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            disabled={running}
            className="px-3.5 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleRunBatch}
            disabled={running}
            className="px-4 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg shadow-md shadow-orange-600/30 flex items-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{running ? 'Submitting...' : `Enqueue ${count} Jobs`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
