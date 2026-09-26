import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import StatsOverview from './components/StatsOverview';
import JobList from './components/JobList';
import CreateJobModal from './components/CreateJobModal';
import BatchModal from './components/BatchModal';
import JobDetailModal from './components/JobDetailModal';
import { getHealth, getJobs, requeueJob } from './services/api';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

export default function App() {
  const [health, setHealth] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(3000); // 3 seconds default poll

  const [stats, setStats] = useState({
    total: 0,
    queued: 0,
    processing: 0,
    completed: 0,
    dead: 0,
    loading: true,
  });

  const [filters, setFilters] = useState({
    status: 'ALL',
    priority: 'ALL',
    type: '',
    page: 1,
    limit: 15,
  });

  const [selectedJobId, setSelectedJobId] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const toastTimerRef = useRef(null);

  const showToast = (message, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  };

  // Fetch full stats (runs parallel status count queries for high accuracy)
  const refreshStats = useCallback(async () => {
    try {
      const [allRes, qRes, pRes, cRes, dRes] = await Promise.all([
        getJobs({ limit: 1 }),
        getJobs({ status: 'QUEUED', limit: 1 }),
        getJobs({ status: 'PROCESSING', limit: 1 }),
        getJobs({ status: 'COMPLETED', limit: 1 }),
        getJobs({ status: 'DEAD', limit: 1 }),
      ]);

      setStats({
        total: allRes.meta.total || 0,
        queued: qRes.meta.total || 0,
        processing: pRes.meta.total || 0,
        completed: cRes.meta.total || 0,
        dead: dRes.meta.total || 0,
        loading: false,
      });
    } catch (err) {
      console.error('Stats refresh failed:', err);
    }
  }, []);

  // Fetch jobs for current filter settings
  const refreshJobsList = useCallback(async () => {
    try {
      const res = await getJobs(filters);
      setJobs(res.jobs || []);
      setMeta(res.meta || { page: 1, limit: 15, total: 0, totalPages: 1 });
    } catch (err) {
      console.error('Jobs list refresh failed:', err);
    }
  }, [filters]);

  // Combined refresh
  const loadData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    const healthResult = await getHealth();
    setHealth(healthResult);
    await Promise.all([refreshStats(), refreshJobsList()]);
    if (isManual) setRefreshing(false);
  }, [refreshStats, refreshJobsList]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Polling timer
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData(false);
    }, autoRefresh);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  const handleFilterChange = (newFilters) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const handleRequeueJob = async (id) => {
    try {
      await requeueJob(id);
      showToast(`Job ${id.slice(0, 8)} successfully requeued!`);
      loadData(false);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleJobCreated = (res) => {
    if (res.duplicate) {
      showToast(`Idempotent match: returned existing job ${res.jobId.slice(0, 8)}`, 'info');
    } else {
      showToast(`Job ${res.jobId.slice(0, 8)} enqueued to ${res.priority || 'normal'} queue!`);
    }
    loadData(false);
  };

  const handleBatchCompleted = () => {
    showToast('Batch jobs successfully pushed to queue!');
    loadData(false);
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] flex flex-col">
      
      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div
            className={`px-4 py-3 rounded-xl border shadow-xl flex items-center gap-2.5 text-xs font-semibold ${
              toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-800 text-rose-200'
                : toast.type === 'info'
                ? 'bg-sky-950/90 border-sky-800 text-sky-200'
                : 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Main Header */}
      <Header
        health={health}
        refreshing={refreshing}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        onRefresh={() => loadData(true)}
        onOpenCreate={() => setIsCreateOpen(true)}
        onOpenBatch={() => setIsBatchOpen(true)}
      />

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Top Status & Metrics Overview */}
        <section>
          <StatsOverview
            stats={stats}
            activeStatus={filters.status}
            onSelectStatus={(status) => handleFilterChange({ status, page: 1 })}
          />
        </section>

        {/* Job Explorer Table */}
        <section>
          <JobList
            jobs={jobs}
            meta={meta}
            loading={loading}
            filters={filters}
            onFilterChange={handleFilterChange}
            onSelectJob={(id) => setSelectedJobId(id)}
            onRequeueJob={handleRequeueJob}
          />
        </section>
      </main>

      {/* Modals */}
      <CreateJobModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={handleJobCreated}
      />

      <BatchModal
        isOpen={isBatchOpen}
        onClose={() => setIsBatchOpen(false)}
        onSuccess={handleBatchCompleted}
      />

      <JobDetailModal
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
        onJobUpdated={() => loadData(false)}
      />
    </div>
  );
}
