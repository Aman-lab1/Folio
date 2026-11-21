import React, { useMemo, useState } from 'react';
import { ChevronRight, Download, X } from 'lucide-react';
import { DatePreset, Transaction, TransactionContext } from '../types/cashbook';
import {
  CategorySelection,
  computeSummary,
  getDateRangeForPreset,
  getTransactionsForCategory,
  groupByCategory,
  groupByPerson,
  transactionsToCsv,
} from '../utils/calculations';
import { formatPaise, getTodayDateStr } from '../utils/currency';
import { ConfirmDialog } from './ConfirmDialog';
import { TransactionRow } from './TransactionRow';

interface ReportsViewProps {
  profileName: string;
  transactions: Transaction[];
  onEditTransaction: (tx: Transaction) => void;
}

type ReportTab = 'categories' | 'people' | 'modes' | 'contexts';

const REPORT_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'year', label: 'This Year' },
  { id: 'all', label: 'All Time' },
  { id: 'custom', label: 'Custom' },
];

export const ReportsView: React.FC<ReportsViewProps> = ({
  profileName,
  transactions,
  onEditTransaction,
}) => {
  const [preset, setPreset] = useState<DatePreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [contextFilter, setContextFilter] = useState<'all' | TransactionContext>('all');
  const [reportTab, setReportTab] = useState<ReportTab>('categories');
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategorySelection | null>(null);
  const [showExportConfirm, setShowExportConfirm] = useState(false);

  const scoped = useMemo(() => {
    const { from, to } = getDateRangeForPreset(preset, customFrom, customTo);
    return transactions.filter((tx) => {
      if (contextFilter !== 'all' && tx.context !== contextFilter) return false;
      if (from && tx.date < from) return false;
      if (to && tx.date > to) return false;
      return true;
    });
  }, [transactions, preset, customFrom, customTo, contextFilter]);

  const summary = useMemo(() => computeSummary(scoped), [scoped]);
  const spentCategories = useMemo(() => groupByCategory(scoped, 'spent'), [scoped]);
  const receivedCategories = useMemo(() => groupByCategory(scoped, 'received'), [scoped]);
  const peopleBreakdown = useMemo(() => groupByPerson(scoped), [scoped]);

  const activePersonDetail = useMemo(
    () => peopleBreakdown.find((p) => p.key === selectedPersonKey) ?? null,
    [peopleBreakdown, selectedPersonKey]
  );

  const activeCategoryTxs = useMemo(
    () => getTransactionsForCategory(scoped, selectedCategory),
    [scoped, selectedCategory]
  );

  const handleExportCsv = () => {
    const csv = transactionsToCsv(scoped);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${profileName.toLowerCase().replace(/\s+/g, '_')}_folio_report_${preset}_${getTodayDateStr()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            Financial Reports
          </h1>
          <p className="text-[13px] sm:text-sm text-zinc-400 mt-0.5">
            Totals are calculated directly from your recorded transactions
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowExportConfirm(true)}
          disabled={scoped.length === 0}
          className="min-h-[40px] self-start sm:self-auto flex items-center gap-2 rounded-xl border border-white/[0.1] bg-[#121216] px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Report CSV</span>
        </button>
      </div>

      <ConfirmDialog
        isOpen={showExportConfirm}
        title="Export Transactions?"
        message="This will export your transaction data into a CSV file."
        confirmLabel="Export CSV"
        onCancel={() => setShowExportConfirm(false)}
        onConfirm={() => {
          handleExportCsv();
          setShowExportConfirm(false);
        }}
      />

      {/* Period & Context Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {REPORT_PRESETS.map((p) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPreset(p.id);
                  setSelectedPersonKey(null);
                  setSelectedCategory(null);
                }}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                  active
                    ? 'border-zinc-200 bg-zinc-100 text-zinc-950'
                    : 'border-white/[0.08] bg-[#121216] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="inline-flex p-1 rounded-xl bg-[#121216] border border-white/[0.08] self-start">
          {(['all', 'business', 'personal'] as const).map((ctx) => {
            const active = contextFilter === ctx;
            return (
              <button
                key={ctx}
                type="button"
                onClick={() => setContextFilter(ctx)}
                className={`min-h-[36px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  active ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {ctx === 'all' ? 'All' : ctx === 'business' ? 'Business' : 'Personal'}
              </button>
            );
          })}
        </div>
      </div>

      {preset === 'custom' && (
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div>
            <label htmlFor="rep-from" className="block text-xs text-zinc-400 mb-1">
              From
            </label>
            <input
              id="rep-from"
              name="folio-report-from"
              type="date"
              autoComplete="off"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#121216] px-3 font-mono-num text-xs text-zinc-100"
            />
          </div>
          <div>
            <label htmlFor="rep-to" className="block text-xs text-zinc-400 mb-1">
              To
            </label>
            <input
              id="rep-to"
              name="folio-report-to"
              type="date"
              autoComplete="off"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#121216] px-3 font-mono-num text-xs text-zinc-100"
            />
          </div>
        </div>
      )}

      {/* Headline Totals Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-white/[0.08] bg-[#121216] p-4">
          <p className="text-xs text-zinc-400">Total Received</p>
          <p className="mt-1.5 font-mono-num text-xl font-bold text-emerald-400">
            {formatPaise(summary.receivedPaise, { type: 'received' })}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#121216] p-4">
          <p className="text-xs text-zinc-400">Total Spent</p>
          <p className="mt-1.5 font-mono-num text-xl font-bold text-rose-400">
            {formatPaise(summary.spentPaise, { type: 'spent' })}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#121216] p-4">
          <p className="text-xs text-zinc-400">Net Cashflow Difference</p>
          <p className="mt-1.5 font-mono-num text-xl font-bold text-zinc-100">
            {formatPaise(summary.netPaise, { showSign: true })}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#121216] p-4">
          <p className="text-xs text-zinc-400">Transactions</p>
          <p className="mt-1.5 font-mono-num text-xl font-bold text-zinc-100">
            {summary.count}
          </p>
        </div>
      </div>

      {/* Report Dimension Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] overflow-x-auto">
        {(
          [
            { id: 'categories', label: 'By Category' },
            { id: 'people', label: 'By Person' },
            { id: 'modes', label: 'Cash vs Online' },
            { id: 'contexts', label: 'Personal vs Business' },
          ] as const
        ).map((tab) => {
          const active = reportTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setReportTab(tab.id);
                setSelectedPersonKey(null);
                setSelectedCategory(null);
              }}
              className={`min-h-[42px] px-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'border-zinc-100 text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Report Panels */}
      {reportTab === 'categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Spent Categories */}
          <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5">
            <h2 className="text-sm font-semibold text-zinc-100 mb-4">
              Expenses by Category
            </h2>
            {spentCategories.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">
                No expenses recorded for this period.
              </p>
            ) : (
              <div className="space-y-3">
                {spentCategories.map((cat) => {
                  const selection: CategorySelection = {
                    type: 'spent',
                    categoryId: cat.categoryId,
                    categoryName: cat.categoryName,
                  };
                  const active =
                    selectedCategory?.type === selection.type &&
                    selectedCategory?.categoryId === selection.categoryId &&
                    selectedCategory?.categoryName === selection.categoryName;
                  return (
                    <button
                      key={JSON.stringify([cat.type, cat.categoryId, cat.categoryName])}
                      type="button"
                      onClick={() =>
                        setSelectedCategory(active ? null : selection)
                      }
                      className={`w-full text-left p-2.5 rounded-xl border transition-colors ${
                        active
                          ? 'border-zinc-400 bg-[#18181D]'
                          : 'border-transparent hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-medium text-zinc-200">
                          {cat.categoryName}{' '}
                          <span className="text-zinc-500">
                            · {cat.context === 'business' ? 'Business' : 'Personal'} · {cat.count}
                          </span>
                        </span>
                        <span className="font-mono-num font-semibold text-rose-400">
                          {formatPaise(cat.totalPaise)} ({cat.sharePercent}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-rose-400/80"
                          style={{ width: `${Math.max(4, cat.sharePercent)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Received Categories or Drilldown */}
          {selectedCategory ? (
            <section className="rounded-2xl border border-white/[0.08] bg-[#121216] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">
                  {selectedCategory.categoryName} Entries
                </h2>
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div>
                {activeCategoryTxs.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    onSelect={onEditTransaction}
                    showDate={true}
                  />
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5">
              <h2 className="text-sm font-semibold text-zinc-100 mb-4">
                Money Received by Category
              </h2>
              {receivedCategories.length === 0 ? (
                <p className="text-xs text-zinc-500 py-6 text-center">
                  No incoming entries recorded for this period.
                </p>
              ) : (
                <div className="space-y-3">
                  {receivedCategories.map((cat) => {
                    const selection: CategorySelection = {
                      type: 'received',
                      categoryId: cat.categoryId,
                      categoryName: cat.categoryName,
                    };
                    return (
                      <button
                        key={JSON.stringify([cat.type, cat.categoryId, cat.categoryName])}
                        type="button"
                        onClick={() => setSelectedCategory(selection)}
                        className="w-full text-left p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-medium text-zinc-200">
                            {cat.categoryName}{' '}
                            <span className="text-zinc-500">
                              · {cat.context === 'business' ? 'Business' : 'Personal'} · {cat.count}
                            </span>
                          </span>
                          <span className="font-mono-num font-semibold text-emerald-400">
                            {formatPaise(cat.totalPaise)} ({cat.sharePercent}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-400/80"
                            style={{ width: `${Math.max(4, cat.sharePercent)}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {reportTab === 'people' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-6 rounded-2xl border border-white/[0.08] bg-[#121216] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.08]">
              <h2 className="text-sm font-semibold text-zinc-100">
                Person-Wise Summary
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Tap a person to inspect all payments to or from them
              </p>
            </div>
            {peopleBreakdown.length === 0 ? (
              <p className="text-xs text-zinc-500 py-10 text-center">
                No people tagged in transactions for this period.
              </p>
            ) : (
              <div>
                {peopleBreakdown.map((person) => {
                  const active = selectedPersonKey === person.key;
                  return (
                    <button
                      key={person.key}
                      type="button"
                      onClick={() =>
                        setSelectedPersonKey(active ? null : person.key)
                      }
                      className={`w-full min-h-[64px] px-4 py-3 flex items-center justify-between gap-3 border-b border-white/[0.06] last:border-b-0 text-left transition-colors ${
                        active ? 'bg-[#18181D]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-100 truncate">
                          {person.personName}
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {person.count} {person.count === 1 ? 'entry' : 'entries'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right font-mono-num text-xs space-y-0.5">
                          {person.spentPaise > 0 && (
                            <p className="text-rose-400">
                              Paid {formatPaise(person.spentPaise)}
                            </p>
                          )}
                          {person.receivedPaise > 0 && (
                            <p className="text-emerald-400">
                              Recd {formatPaise(person.receivedPaise)}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-500" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="lg:col-span-6 rounded-2xl border border-white/[0.08] bg-[#121216] overflow-hidden">
            {activePersonDetail ? (
              <>
                <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">
                      {activePersonDetail.personName}
                    </h2>
                    <p className="font-mono-num text-xs text-zinc-400 mt-0.5">
                      Paid {formatPaise(activePersonDetail.spentPaise)} · Received{' '}
                      {formatPaise(activePersonDetail.receivedPaise)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPersonKey(null)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  {activePersonDetail.transactions.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      transaction={tx}
                      onSelect={onEditTransaction}
                      showDate={true}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="px-6 py-12 text-center">
                <p className="text-xs text-zinc-500">
                  Select any person on the left to view their complete transaction history.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {reportTab === 'modes' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5 space-y-4">
            <h2 className="text-base font-semibold text-zinc-100">Cash Transactions</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-zinc-400">Cash Received</p>
                <p className="mt-1 font-mono-num text-xl font-bold text-emerald-400">
                  {formatPaise(summary.cashReceivedPaise, { type: 'received' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Cash Spent</p>
                <p className="mt-1 font-mono-num text-xl font-bold text-rose-400">
                  {formatPaise(summary.cashSpentPaise, { type: 'spent' })}
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-zinc-400">Cash Net Difference</span>
              <span className="font-mono-num text-sm font-semibold text-zinc-100">
                {formatPaise(summary.cashReceivedPaise - summary.cashSpentPaise, {
                  showSign: true,
                })}
              </span>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5 space-y-4">
            <h2 className="text-base font-semibold text-zinc-100">Online Transactions</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-zinc-400">Online Received</p>
                <p className="mt-1 font-mono-num text-xl font-bold text-emerald-400">
                  {formatPaise(summary.onlineReceivedPaise, { type: 'received' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Online Spent</p>
                <p className="mt-1 font-mono-num text-xl font-bold text-rose-400">
                  {formatPaise(summary.onlineSpentPaise, { type: 'spent' })}
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-zinc-400">Online Net Difference</span>
              <span className="font-mono-num text-sm font-semibold text-zinc-100">
                {formatPaise(summary.onlineReceivedPaise - summary.onlineSpentPaise, {
                  showSign: true,
                })}
              </span>
            </div>
          </section>
        </div>
      )}

      {reportTab === 'contexts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5 space-y-4">
            <h2 className="text-base font-semibold text-zinc-100">Business Activity</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-zinc-400">Received</p>
                <p className="mt-1 font-mono-num text-xl font-bold text-emerald-400">
                  {formatPaise(summary.businessReceivedPaise, { type: 'received' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Spent</p>
                <p className="mt-1 font-mono-num text-xl font-bold text-rose-400">
                  {formatPaise(summary.businessSpentPaise, { type: 'spent' })}
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-zinc-400">Business Net Difference</span>
              <span className="font-mono-num text-sm font-semibold text-zinc-100">
                {formatPaise(
                  summary.businessReceivedPaise - summary.businessSpentPaise,
                  { showSign: true }
                )}
              </span>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5 space-y-4">
            <h2 className="text-base font-semibold text-zinc-100">Personal Activity</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-zinc-400">Received</p>
                <p className="mt-1 font-mono-num text-xl font-bold text-emerald-400">
                  {formatPaise(summary.personalReceivedPaise, { type: 'received' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Spent</p>
                <p className="mt-1 font-mono-num text-xl font-bold text-rose-400">
                  {formatPaise(summary.personalSpentPaise, { type: 'spent' })}
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-zinc-400">Personal Net Difference</span>
              <span className="font-mono-num text-sm font-semibold text-zinc-100">
                {formatPaise(
                  summary.personalReceivedPaise - summary.personalSpentPaise,
                  { showSign: true }
                )}
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
