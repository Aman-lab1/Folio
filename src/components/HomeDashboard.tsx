import React, { useMemo, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { AppTab, Transaction, TransactionContext } from '../types/cashbook';
import {
  computeSummary,
  getDateRangeForPreset,
  groupByCategory,
  sortTransactionsNewestFirst,
} from '../utils/calculations';
import { formatPaise, getTodayDateStr } from '../utils/currency';
import { TransactionRow } from './TransactionRow';

interface HomeDashboardProps {
  profileName: string;
  transactions: Transaction[];
  onOpenQuickAdd: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onNavigateTab: (tab: AppTab) => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  profileName,
  transactions,
  onOpenQuickAdd,
  onEditTransaction,
  onNavigateTab,
}) => {
  const [contextFilter, setContextFilter] = useState<'all' | TransactionContext>('all');

  const scopedTransactions = useMemo(() => {
    const list =
      contextFilter === 'all'
        ? transactions
        : transactions.filter((t) => t.context === contextFilter);
    return sortTransactionsNewestFirst(list);
  }, [transactions, contextFilter]);

  const todayStr = getTodayDateStr();
  const todayTxs = useMemo(
    () => scopedTransactions.filter((t) => t.date === todayStr),
    [scopedTransactions, todayStr]
  );
  const todaySummary = useMemo(() => computeSummary(todayTxs), [todayTxs]);

  const monthRange = useMemo(() => getDateRangeForPreset('month'), []);
  const monthTxs = useMemo(
    () =>
      scopedTransactions.filter(
        (t) => t.date >= monthRange.from && t.date <= monthRange.to
      ),
    [scopedTransactions, monthRange]
  );
  const monthSummary = useMemo(() => computeSummary(monthTxs), [monthTxs]);

  const topMonthSpentCategories = useMemo(
    () => groupByCategory(monthTxs, 'spent').slice(0, 4),
    [monthTxs]
  );

  const recentTxs = useMemo(() => scopedTransactions.slice(0, 10), [scopedTransactions]);

  return (
    <div className="space-y-6">
      {/* Header & Context Segmented Filter */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-zinc-400">{profileName}</p>
          <h1 className="mt-0.5 text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            Daily Folio
          </h1>
        </div>

        <div
          role="group"
          aria-label="Filter dashboard by context"
          className="inline-flex p-1 rounded-xl bg-[#121216] border border-white/[0.08] self-start sm:self-auto"
        >
          {(['all', 'business', 'personal'] as const).map((ctx) => {
            const active = contextFilter === ctx;
            const label =
              ctx === 'all' ? 'All' : ctx === 'business' ? 'Business' : 'Personal';
            return (
              <button
                key={ctx}
                type="button"
                onClick={() => setContextFilter(ctx)}
                className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Today + Monthly Overview + Cash/Online Split */}
        <div className="lg:col-span-5 space-y-5">
          {/* Today's Cashflow Hero Card */}
          <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">Today&apos;s Activity</h2>
              <span className="font-mono-num text-xs text-zinc-500">
                {todaySummary.count} {todaySummary.count === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-zinc-400">Received</p>
                <p className="mt-1 font-mono-num text-xl sm:text-2xl font-bold text-emerald-400">
                  {formatPaise(todaySummary.receivedPaise, { type: 'received' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Spent</p>
                <p className="mt-1 font-mono-num text-xl sm:text-2xl font-bold text-rose-400">
                  {formatPaise(todaySummary.spentPaise, { type: 'spent' })}
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3.5 border-t border-white/[0.06] flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-400">Today&apos;s Net Difference</p>
                <p className="text-[11px] text-zinc-500">
                  Recorded cashflow only · not opening balance
                </p>
              </div>
              <p
                className={`font-mono-num text-base font-semibold ${
                  todaySummary.netPaise > 0
                    ? 'text-emerald-400'
                    : todaySummary.netPaise < 0
                      ? 'text-rose-400'
                      : 'text-zinc-200'
                }`}
              >
                {formatPaise(todaySummary.netPaise, { showSign: true })}
              </p>
            </div>
          </section>

          {/* Monthly Overview + Cash vs Online */}
          <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">This Month</h2>
              <button
                type="button"
                onClick={() => onNavigateTab('reports')}
                className="text-xs font-medium text-zinc-400 hover:text-zinc-100 flex items-center gap-1 transition-colors"
              >
                <span>Full Reports</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-zinc-500">Received</p>
                <p className="mt-1 font-mono-num text-sm sm:text-base font-semibold text-emerald-400">
                  {formatPaise(monthSummary.receivedPaise)}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Spent</p>
                <p className="mt-1 font-mono-num text-sm sm:text-base font-semibold text-rose-400">
                  {formatPaise(monthSummary.spentPaise)}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Net Diff</p>
                <p className="mt-1 font-mono-num text-sm sm:text-base font-semibold text-zinc-100">
                  {formatPaise(monthSummary.netPaise, { showSign: true })}
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3.5 border-t border-white/[0.06] grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-zinc-300">Cash</p>
                <p className="mt-1 font-mono-num text-xs text-zinc-400">
                  In {formatPaise(monthSummary.cashReceivedPaise)} · Out{' '}
                  {formatPaise(monthSummary.cashSpentPaise)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-300">Online</p>
                <p className="mt-1 font-mono-num text-xs text-zinc-400">
                  In {formatPaise(monthSummary.onlineReceivedPaise)} · Out{' '}
                  {formatPaise(monthSummary.onlineSpentPaise)}
                </p>
              </div>
            </div>
          </section>

          {/* Top Spent Categories This Month */}
          {topMonthSpentCategories.length > 0 && (
            <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                Top Expenses This Month
              </h2>
              <div className="space-y-3">
                {topMonthSpentCategories.map((cat) => (
                  <div key={`${cat.categoryId}_${cat.categoryName}`}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-zinc-300 font-medium truncate pr-2">
                        {cat.categoryName}
                      </span>
                      <span className="font-mono-num text-zinc-200 shrink-0">
                        {formatPaise(cat.totalPaise)} · {cat.sharePercent}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-zinc-300"
                        style={{ width: `${Math.max(4, cat.sharePercent)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Recent Transactions */}
        <section className="lg:col-span-7 rounded-2xl border border-white/[0.08] bg-[#121216] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Recent Transactions</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Tap any entry to edit or delete
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('history')}
              className="min-h-[36px] px-3 rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-1 whitespace-nowrap"
            >
              <span>All History</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentTxs.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-zinc-200">No entries recorded yet</p>
              <p className="mt-1 text-xs text-zinc-500 max-w-xs mx-auto">
                Record your first money received or spent entry in under 10 seconds.
              </p>
              <button
                type="button"
                onClick={onOpenQuickAdd}
                className="mt-5 inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-zinc-100 text-sm font-semibold text-zinc-950 hover:bg-white active:scale-[0.98] transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Add First Entry</span>
              </button>
            </div>
          ) : (
            <div>
              {recentTxs.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  onSelect={onEditTransaction}
                  showDate={true}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
