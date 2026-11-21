import React, { useMemo, useState } from 'react';
import { Download, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import {
  Category,
  DatePreset,
  Person,
  Transaction,
  TransactionFilter,
} from '../types/cashbook';
import {
  buildPersonFilterOptions,
  computeSummary,
  filterTransactions,
  groupByDate,
  transactionsToCsv,
} from '../utils/calculations';
import { formatDateHuman, formatPaise, getTodayDateStr } from '../utils/currency';
import { ConfirmDialog } from './ConfirmDialog';
import { TransactionRow } from './TransactionRow';

interface HistoryViewProps {
  profileName: string;
  transactions: Transaction[];
  categories: Category[];
  people: Person[];
  onEditTransaction: (tx: Transaction) => void;
}

const DEFAULT_FILTER: TransactionFilter = {
  search: '',
  type: 'all',
  context: 'all',
  paymentMode: 'all',
  categoryId: 'all',
  personId: 'all',
  datePreset: 'all',
  dateFrom: '',
  dateTo: '',
};

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'all', label: 'All Time' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'custom', label: 'Custom' },
];

export const HistoryView: React.FC<HistoryViewProps> = ({
  profileName,
  transactions,
  categories,
  people,
  onEditTransaction,
}) => {
  const [filter, setFilter] = useState<TransactionFilter>(DEFAULT_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);

  const filtered = useMemo(
    () => filterTransactions(transactions, filter, people),
    [transactions, filter, people]
  );

  const summary = useMemo(() => computeSummary(filtered), [filtered]);
  const dayGroups = useMemo(() => groupByDate(filtered), [filtered]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filter.type !== 'all') count++;
    if (filter.context !== 'all') count++;
    if (filter.paymentMode !== 'all') count++;
    if (filter.categoryId !== 'all') count++;
    if (filter.personId !== 'all') count++;
    if (filter.datePreset !== 'all') count++;
    return count;
  }, [filter]);

  // Unique person options from saved people + snapshots in transactions (deduplicated by normalized name)
  const personOptions = useMemo(
    () => buildPersonFilterOptions(people, transactions),
    [people, transactions]
  );

  // Category options including archived categories and historical deleted category snapshots
  const categoryOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const c of categories) {
      map.set(c.id, {
        id: c.id,
        label: `${c.name} (${c.context}${c.isArchived ? ', Archived' : ''})`,
      });
    }
    for (const tx of transactions) {
      if (!map.has(tx.categoryId)) {
        map.set(tx.categoryId, {
          id: tx.categoryId,
          label: `${tx.categoryNameSnapshot} (${tx.context}, Past)`,
        });
      }
    }
    return Array.from(map.values());
  }, [categories, transactions]);

  const handleExportCsv = () => {
    const csv = transactionsToCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${profileName.toLowerCase().replace(/\s+/g, '_')}_folio_${getTodayDateStr()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            Transaction History
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Search, filter by person, category, payment mode, or date range
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowExportConfirm(true)}
          disabled={filtered.length === 0}
          className="min-h-[40px] self-start sm:self-auto flex items-center gap-2 rounded-xl border border-white/[0.1] bg-[#121216] px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV ({filtered.length})</span>
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

      {/* Search + Filter Toggle Bar */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            name="folio-history-search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search notes, person, or category..."
            className="w-full min-h-[44px] rounded-xl border border-white/[0.08] bg-[#121216] pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
            showFilters || activeFilterCount > 0
              ? 'border-zinc-300 bg-zinc-800 text-white'
              : 'border-white/[0.08] bg-[#121216] text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
        </button>
      </div>

      {/* Date Presets Horizontal Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {DATE_PRESETS.map((preset) => {
          const active = filter.datePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => setFilter((f) => ({ ...f, datePreset: preset.id }))}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors border ${
                active
                  ? 'border-zinc-200 bg-zinc-100 text-zinc-950'
                  : 'border-white/[0.08] bg-[#121216] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Expanded Filters Panel */}
      {(showFilters || filter.datePreset === 'custom') && (
        <div className="rounded-2xl border border-white/[0.08] bg-[#121216] p-4 space-y-4">
          {filter.datePreset === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="hist-from" className="block text-xs text-zinc-400 mb-1">
                  From Date
                </label>
                <input
                  id="hist-from"
                  name="folio-history-from"
                  type="date"
                  autoComplete="off"
                  value={filter.dateFrom}
                  onChange={(e) => setFilter((f) => ({ ...f, dateFrom: e.target.value }))}
                  className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 font-mono-num text-xs text-zinc-100"
                />
              </div>
              <div>
                <label htmlFor="hist-to" className="block text-xs text-zinc-400 mb-1">
                  To Date
                </label>
                <input
                  id="hist-to"
                  name="folio-history-to"
                  type="date"
                  autoComplete="off"
                  value={filter.dateTo}
                  onChange={(e) => setFilter((f) => ({ ...f, dateTo: e.target.value }))}
                  className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 font-mono-num text-xs text-zinc-100"
                />
              </div>
            </div>
          )}

          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label htmlFor="f-type" className="block text-xs text-zinc-400 mb-1">
                  Type
                </label>
                <select
                  id="f-type"
                  value={filter.type}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      type: e.target.value as TransactionFilter['type'],
                    }))
                  }
                  className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100"
                >
                  <option value="all">All Types</option>
                  <option value="spent">Spent</option>
                  <option value="received">Received</option>
                </select>
              </div>

              <div>
                <label htmlFor="f-ctx" className="block text-xs text-zinc-400 mb-1">
                  Context
                </label>
                <select
                  id="f-ctx"
                  value={filter.context}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      context: e.target.value as TransactionFilter['context'],
                    }))
                  }
                  className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100"
                >
                  <option value="all">All Contexts</option>
                  <option value="business">Business</option>
                  <option value="personal">Personal</option>
                </select>
              </div>

              <div>
                <label htmlFor="f-mode" className="block text-xs text-zinc-400 mb-1">
                  Payment Mode
                </label>
                <select
                  id="f-mode"
                  value={filter.paymentMode}
                  onChange={(e) =>
                    setFilter((f) => ({
                      ...f,
                      paymentMode: e.target.value as TransactionFilter['paymentMode'],
                    }))
                  }
                  className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100"
                >
                  <option value="all">All Modes</option>
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                </select>
              </div>

              <div>
                <label htmlFor="f-cat" className="block text-xs text-zinc-400 mb-1">
                  Category
                </label>
                <select
                  id="f-cat"
                  value={filter.categoryId}
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, categoryId: e.target.value }))
                  }
                  className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100"
                >
                  <option value="all">All Categories</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="f-person" className="block text-xs text-zinc-400 mb-1">
                  Person
                </label>
                <select
                  id="f-person"
                  value={filter.personId}
                  onChange={(e) =>
                    setFilter((f) => ({ ...f, personId: e.target.value }))
                  }
                  className="w-full min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100"
                >
                  <option value="all">Anyone</option>
                  <option value="none">No Person Tagged</option>
                  {personOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {activeFilterCount > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setFilter(DEFAULT_FILTER)}
                className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filtered Totals Strip */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#121216] px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-[11px] text-zinc-500">Matching Entries</p>
          <p className="font-mono-num text-sm font-semibold text-zinc-100">{summary.count}</p>
        </div>
        <div>
          <p className="text-[11px] text-zinc-500">Total Received</p>
          <p className="font-mono-num text-sm font-semibold text-emerald-400">
            {formatPaise(summary.receivedPaise, { type: 'received' })}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-zinc-500">Total Spent</p>
          <p className="font-mono-num text-sm font-semibold text-rose-400">
            {formatPaise(summary.spentPaise, { type: 'spent' })}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-zinc-500">Net Difference</p>
          <p className="font-mono-num text-sm font-semibold text-zinc-100">
            {formatPaise(summary.netPaise, { showSign: true })}
          </p>
        </div>
      </div>

      {/* Grouped Transaction Ledger */}
      {dayGroups.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-[#121216] px-6 py-14 text-center">
          <p className="text-sm font-medium text-zinc-200">No matching transactions</p>
          <p className="mt-1 text-xs text-zinc-500">
            Try clearing your search or widening the date range.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {dayGroups.map((group) => (
            <section
              key={group.date}
              className="rounded-2xl border border-white/[0.08] bg-[#121216] overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-[#18181D] border-b border-white/[0.06] flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-xs font-semibold text-zinc-200">
                    {formatDateHuman(group.date)}
                  </h2>
                  <span className="font-mono-num text-[11px] text-zinc-500">
                    {group.date}
                  </span>
                </div>
                <p className="font-mono-num text-xs text-zinc-400">
                  Net{' '}
                  <span
                    className={
                      group.summary.netPaise > 0
                        ? 'text-emerald-400'
                        : group.summary.netPaise < 0
                          ? 'text-rose-400'
                          : 'text-zinc-200'
                    }
                  >
                    {formatPaise(group.summary.netPaise, { showSign: true })}
                  </span>
                </p>
              </div>
              <div>
                {group.items.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    onSelect={onEditTransaction}
                    showDate={false}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
