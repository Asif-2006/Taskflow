import React from 'react';
import {
  Search,
  Filter,
  Eye,
  RefreshCw,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  AlertCircle,
} from 'lucide-react';

export default function JobList({
  jobs,
  meta,
  loading,
  filters,
  onFilterChange,
  onSelectJob,
  onRequeueJob,
}) {
  const [copiedId, setCopiedId] = React.useState(null);

  const handleCopy = (id, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            HIGH
          </span>
        );
      case 'low':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
            LOW
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            NORMAL
          </span>
        );
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            COMPLETED
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            PROCESSING
          </span>
        );
      case 'DEAD':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
            DEAD (DLQ)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            QUEUED
          </span>
        );
    }
  };

  const calculateDuration = (job) => {
    if (!job.startedAt || !job.completedAt) return '—';
    const ms = new Date(job.completedAt) - new Date(job.startedAt);
    return `${ms} ms`;
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm">
      
      {/* Controls Bar */}
      <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/80">
        
        {/* Status Filter Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {['ALL', 'QUEUED', 'PROCESSING', 'COMPLETED', 'DEAD'].map((st) => (
            <button
              key={st}
              onClick={() => onFilterChange({ status: st, page: 1 })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all whitespace-nowrap ${
                filters.status === st
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Priority & Search Filters */}
        <div className="flex items-center space-x-2">
          
          {/* Priority dropdown */}
          <div className="relative">
            <select
              value={filters.priority}
              onChange={(e) => onFilterChange({ priority: e.target.value, page: 1 })}
              className="appearance-none pl-3 pr-8 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Priorities</option>
              <option value="high">High Priority</option>
              <option value="normal">Normal Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </div>

          {/* Type search input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search type..."
              value={filters.type}
              onChange={(e) => onFilterChange({ type: e.target.value, page: 1 })}
              className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-36 sm:w-48"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-950/40">
              <th className="py-3 px-4">Job ID</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Priority</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Attempts</th>
              <th className="py-3 px-4">Duration</th>
              <th className="py-3 px-4">Submitted</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs text-slate-300">
            {jobs.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-600" />
                  No jobs match the current filters.
                </td>
              </tr>
            )}

            {jobs.map((job) => (
              <tr
                key={job.jobId}
                onClick={() => onSelectJob(job.jobId)}
                className="hover:bg-slate-800/40 cursor-pointer transition-colors group"
              >
                {/* ID */}
                <td className="py-3.5 px-4 font-mono font-medium text-slate-300">
                  <div className="flex items-center space-x-1.5">
                    <span>{job.jobId.slice(0, 8)}...</span>
                    <button
                      onClick={(e) => handleCopy(job.jobId, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-white transition-opacity"
                      title="Copy Job ID"
                    >
                      {copiedId === job.jobId ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-400" />
                      )}
                    </button>
                  </div>
                </td>

                {/* Type */}
                <td className="py-3.5 px-4 font-semibold text-white">
                  {job.type}
                </td>

                {/* Priority */}
                <td className="py-3.5 px-4">
                  {getPriorityBadge(job.priority)}
                </td>

                {/* Status */}
                <td className="py-3.5 px-4">
                  {getStatusBadge(job.status)}
                </td>

                {/* Attempts */}
                <td className="py-3.5 px-4 font-mono text-slate-400">
                  {job.retryCount || 0} / {(job.maxRetries ?? 3) + 1}
                </td>

                {/* Duration */}
                <td className="py-3.5 px-4 font-mono text-slate-300">
                  {calculateDuration(job)}
                </td>

                {/* Created At */}
                <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                  {new Date(job.createdAt).toLocaleTimeString()}
                </td>

                {/* Actions */}
                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end space-x-1.5" onClick={(e) => e.stopPropagation()}>
                    {job.status === 'DEAD' && (
                      <button
                        onClick={() => onRequeueJob(job.jobId)}
                        className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 transition-all"
                        title="Requeue this dead job"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Requeue
                      </button>
                    )}
                    <button
                      onClick={() => onSelectJob(job.jobId)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60"
                      title="Inspect details"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-slate-950/40 text-xs text-slate-400">
        <div>
          Showing page <span className="font-semibold text-slate-200">{meta.page}</span> of{' '}
          <span className="font-semibold text-slate-200">{meta.totalPages || 1}</span> ({meta.total || 0} total)
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => onFilterChange({ page: meta.page - 1 })}
            disabled={!meta.hasPrevPage || loading}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2 font-mono font-medium text-slate-300">{meta.page}</span>
          <button
            onClick={() => onFilterChange({ page: meta.page + 1 })}
            disabled={!meta.hasNextPage || loading}
            className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
