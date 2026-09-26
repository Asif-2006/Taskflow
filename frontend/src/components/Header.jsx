import React from 'react';
import { Activity, RefreshCw, Plus, Layers, Zap } from 'lucide-react';

export default function Header({
  health,
  refreshing,
  autoRefresh,
  setAutoRefresh,
  onRefresh,
  onOpenCreate,
  onOpenBatch,
}) {
  return (
    <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                TaskFlow
              </span>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Distributed Queue
              </span>
            </div>
          </div>
        </div>

        {/* Status & Actions */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          
          {/* Health Indicator */}
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  health?.ok ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              ></span>
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  health?.ok ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              ></span>
            </span>
            <span className="font-medium text-slate-300">
              {health?.ok ? (
                <>
                  <span className="text-emerald-400">Online</span>
                  <span className="text-slate-500 ml-1.5">{health.latency}ms</span>
                </>
              ) : (
                <span className="text-rose-400">Offline</span>
              )}
            </span>
          </div>

          {/* Auto Refresh Toggle */}
          <div className="hidden md:flex items-center space-x-1.5 bg-slate-800/60 border border-slate-700/60 rounded-lg p-1 text-xs">
            <span className="text-slate-400 px-2 flex items-center gap-1 font-medium">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              Poll:
            </span>
            {[
              { label: 'Off', val: 0 },
              { label: '2s', val: 2000 },
              { label: '5s', val: 5000 },
            ].map((opt) => (
              <button
                key={opt.label}
                onClick={() => setAutoRefresh(opt.val)}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  autoRefresh === opt.val
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Manual Refresh */}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-white transition-all disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {/* Batch Submit Button */}
          <button
            onClick={onOpenBatch}
            className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white transition-all"
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Batch Flood</span>
          </button>

          {/* Submit Job Button */}
          <button
            onClick={onOpenCreate}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Enqueue Job</span>
          </button>
        </div>
      </div>
    </header>
  );
}
