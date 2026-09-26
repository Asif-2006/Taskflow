import React from 'react';
import { Database, Clock, Cpu, CheckCircle2, AlertOctagon } from 'lucide-react';

export default function StatsOverview({ stats, activeStatus, onSelectStatus }) {
  const cards = [
    {
      id: 'ALL',
      label: 'Total Jobs',
      value: stats.total,
      icon: Database,
      color: 'indigo',
      activeRing: 'ring-indigo-500/50 bg-indigo-950/20',
      badgeColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    },
    {
      id: 'QUEUED',
      label: 'Queued (In Redis)',
      value: stats.queued,
      icon: Clock,
      color: 'amber',
      pulse: stats.queued > 0,
      activeRing: 'ring-amber-500/50 bg-amber-950/20',
      badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    },
    {
      id: 'PROCESSING',
      label: 'Active Processing',
      value: stats.processing,
      icon: Cpu,
      color: 'sky',
      pulse: stats.processing > 0,
      activeRing: 'ring-sky-500/50 bg-sky-950/20',
      badgeColor: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    },
    {
      id: 'COMPLETED',
      label: 'Completed',
      value: stats.completed,
      icon: CheckCircle2,
      color: 'emerald',
      activeRing: 'ring-emerald-500/50 bg-emerald-950/20',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    },
    {
      id: 'DEAD',
      label: 'Dead Letter Queue',
      value: stats.dead,
      icon: AlertOctagon,
      color: 'rose',
      pulse: stats.dead > 0,
      activeRing: 'ring-rose-500/50 bg-rose-950/20',
      badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 sm:gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const isSelected = activeStatus === card.id;

        return (
          <button
            key={card.id}
            onClick={() => onSelectStatus(card.id)}
            className={`text-left p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm transition-all relative overflow-hidden group hover:border-slate-700 hover:shadow-lg ${
              isSelected ? `ring-2 ${card.activeRing}` : ''
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 group-hover:text-slate-300">
                {card.label}
              </span>
              <div
                className={`p-2 rounded-lg border ${card.badgeColor} ${
                  card.pulse ? 'animate-pulse' : ''
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
            </div>

            <div className="flex items-baseline space-x-2">
              <span className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                {stats.loading ? '—' : Number(card.value || 0).toLocaleString()}
              </span>
              {card.pulse && (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                </span>
              )}
            </div>

            {/* Hover bottom bar accent */}
            <div
              className={`absolute bottom-0 left-0 right-0 h-0.5 transition-opacity ${
                isSelected ? 'opacity-100 bg-indigo-500' : 'opacity-0 group-hover:opacity-60 bg-slate-600'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
