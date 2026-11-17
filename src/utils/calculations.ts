import {
  DatePreset,
  Person,
  Transaction,
  TransactionContext,
  TransactionFilter,
  TransactionType,
} from '../types/cashbook';
import { getTodayDateStr } from './currency';

export interface PeriodSummary {
  receivedPaise: number;
  spentPaise: number;
  netPaise: number;
  count: number;
  cashReceivedPaise: number;
  cashSpentPaise: number;
  onlineReceivedPaise: number;
  onlineSpentPaise: number;
  personalReceivedPaise: number;
  personalSpentPaise: number;
  businessReceivedPaise: number;
  businessSpentPaise: number;
}

export interface CategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  type: TransactionType;
  context: TransactionContext;
  totalPaise: number;
  count: number;
  sharePercent: number;
}

export interface CategorySelection {
  type: TransactionType;
  categoryId: string;
  categoryName: string;
}

export interface PersonBreakdownItem {
  key: string;
  personId: string | null;
  personName: string;
  receivedPaise: number;
  spentPaise: number;
  netPaise: number;
  count: number;
  transactions: Transaction[];
}

export function getDateRangeForPreset(
  preset: DatePreset,
  customFrom?: string,
  customTo?: string
): { from: string; to: string } {
  const now = new Date();
  const todayStr = getTodayDateStr();

  const fmt = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  switch (preset) {
    case 'today':
      return { from: todayStr, to: todayStr };
    case 'week': {
      // Last 7 days inclusive (or Monday-Sunday; 7-day rolling window or Monday start)
      const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
      return { from: fmt(monday), to: todayStr };
    }
    case 'month': {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(firstOfMonth), to: todayStr };
    }
    case 'last_month': {
      const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastOfLast = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(firstOfLast), to: fmt(lastOfLast) };
    }
    case 'year': {
      const firstOfYear = new Date(now.getFullYear(), 0, 1);
      return { from: fmt(firstOfYear), to: todayStr };
    }
    case 'custom':
      return {
        from: customFrom || '',
        to: customTo || '',
      };
    case 'all':
    default:
      return { from: '', to: '' };
  }
}

export function sortTransactionsNewestFirst(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.time !== b.time) return b.time.localeCompare(a.time);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function normalizePersonName(name: string): string {
  return name.trim().toLowerCase();
}

export interface PersonFilterOption {
  id: string;
  name: string;
}

export function buildPersonFilterOptions(
  people: Person[],
  transactions: Transaction[]
): PersonFilterOption[] {
  const entries: Array<{
    id: string;
    name: string;
    normalizedName: string;
  }> = [];
  const byNormalized = new Map<string, number>();
  const byPersonId = new Map<string, number>();

  for (const p of people) {
    const trimmed = p.name.trim();
    const norm = normalizePersonName(trimmed);
    if (!norm) continue;
    const existingIdx = byNormalized.get(norm);
    if (existingIdx !== undefined) {
      byPersonId.set(p.id, existingIdx);
    } else {
      const idx = entries.length;
      entries.push({ id: p.id, name: trimmed, normalizedName: norm });
      byNormalized.set(norm, idx);
      byPersonId.set(p.id, idx);
    }
  }

  for (const tx of transactions) {
    const snap = tx.personNameSnapshot?.trim() ?? '';
    const norm = snap ? normalizePersonName(snap) : '';

    if (tx.personId && byPersonId.has(tx.personId)) {
      continue;
    }

    if (norm && byNormalized.has(norm)) {
      if (tx.personId) {
        byPersonId.set(tx.personId, byNormalized.get(norm)!);
      }
      continue;
    }

    if (norm) {
      const idx = entries.length;
      entries.push({ id: `name:${norm}`, name: snap, normalizedName: norm });
      byNormalized.set(norm, idx);
      if (tx.personId) {
        byPersonId.set(tx.personId, idx);
      }
    } else if (tx.personId) {
      const idx = entries.length;
      entries.push({ id: tx.personId, name: tx.personId, normalizedName: '' });
      byPersonId.set(tx.personId, idx);
    }
  }

  return entries
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterTransactions(
  transactions: Transaction[],
  filter: TransactionFilter,
  people: Person[] = []
): Transaction[] {
  const { from, to } = getDateRangeForPreset(
    filter.datePreset,
    filter.dateFrom,
    filter.dateTo
  );
  const q = filter.search.trim().toLowerCase();

  let targetPersonIds: Set<string> | null = null;
  let targetNormalizedName: string | null = null;

  if (filter.personId !== 'all' && filter.personId !== 'none') {
    targetPersonIds = new Set<string>();
    if (filter.personId.startsWith('name:')) {
      const rawName = filter.personId.slice('name:'.length);
      targetNormalizedName = normalizePersonName(rawName) || null;
    } else {
      targetPersonIds.add(filter.personId);
      const savedMatch = people.find((p) => p.id === filter.personId);
      if (savedMatch) {
        targetNormalizedName = normalizePersonName(savedMatch.name) || null;
      } else {
        const txMatch = transactions.find(
          (t) => t.personId === filter.personId && t.personNameSnapshot?.trim()
        );
        if (txMatch?.personNameSnapshot) {
          targetNormalizedName = normalizePersonName(txMatch.personNameSnapshot) || null;
        } else if (!transactions.some((t) => t.personId === filter.personId)) {
          targetNormalizedName = normalizePersonName(filter.personId) || null;
        }
      }
    }

    if (targetNormalizedName) {
      for (const p of people) {
        if (normalizePersonName(p.name) === targetNormalizedName) {
          targetPersonIds.add(p.id);
        }
      }
      for (const t of transactions) {
        if (
          t.personId &&
          t.personNameSnapshot &&
          normalizePersonName(t.personNameSnapshot) === targetNormalizedName
        ) {
          targetPersonIds.add(t.personId);
        }
      }
    }
  }

  const filtered = transactions.filter((tx) => {
    if (filter.type !== 'all' && tx.type !== filter.type) return false;
    if (filter.context !== 'all' && tx.context !== filter.context) return false;
    if (filter.paymentMode !== 'all' && tx.paymentMode !== filter.paymentMode) return false;
    if (filter.categoryId !== 'all' && tx.categoryId !== filter.categoryId) return false;

    if (filter.personId === 'none') {
      if (tx.personId !== null || (tx.personNameSnapshot && tx.personNameSnapshot.trim() !== '')) {
        return false;
      }
    } else if (filter.personId !== 'all') {
      const matchesId = Boolean(tx.personId && targetPersonIds?.has(tx.personId));
      const matchesName = Boolean(
        targetNormalizedName &&
          tx.personNameSnapshot &&
          normalizePersonName(tx.personNameSnapshot) === targetNormalizedName
      );
      if (!matchesId && !matchesName) {
        return false;
      }
    }

    if (from && tx.date < from) return false;
    if (to && tx.date > to) return false;

    if (q) {
      const haystack = [
        tx.notes,
        tx.categoryNameSnapshot,
        tx.personNameSnapshot ?? '',
        tx.paymentMode,
        tx.context,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  return sortTransactionsNewestFirst(filtered);
}

export function computeSummary(transactions: Transaction[]): PeriodSummary {
  let receivedPaise = 0;
  let spentPaise = 0;
  let cashReceivedPaise = 0;
  let cashSpentPaise = 0;
  let onlineReceivedPaise = 0;
  let onlineSpentPaise = 0;
  let personalReceivedPaise = 0;
  let personalSpentPaise = 0;
  let businessReceivedPaise = 0;
  let businessSpentPaise = 0;

  for (const tx of transactions) {
    const amt = tx.amountPaise;
    if (tx.type === 'received') {
      receivedPaise += amt;
      if (tx.paymentMode === 'cash') cashReceivedPaise += amt;
      else onlineReceivedPaise += amt;

      if (tx.context === 'personal') personalReceivedPaise += amt;
      else businessReceivedPaise += amt;
    } else {
      spentPaise += amt;
      if (tx.paymentMode === 'cash') cashSpentPaise += amt;
      else onlineSpentPaise += amt;

      if (tx.context === 'personal') personalSpentPaise += amt;
      else businessSpentPaise += amt;
    }
  }

  return {
    receivedPaise,
    spentPaise,
    netPaise: receivedPaise - spentPaise,
    count: transactions.length,
    cashReceivedPaise,
    cashSpentPaise,
    onlineReceivedPaise,
    onlineSpentPaise,
    personalReceivedPaise,
    personalSpentPaise,
    businessReceivedPaise,
    businessSpentPaise,
  };
}

export function groupByCategory(
  transactions: Transaction[],
  filterType?: TransactionType
): CategoryBreakdownItem[] {
  const scoped = filterType
    ? transactions.filter((t) => t.type === filterType)
    : transactions;

  const map = new Map<
    string,
    {
      categoryId: string;
      categoryName: string;
      type: TransactionType;
      context: TransactionContext;
      totalPaise: number;
      count: number;
    }
  >();

  let grandTotal = 0;

  for (const tx of scoped) {
    grandTotal += tx.amountPaise;
    const key = JSON.stringify([tx.type, tx.categoryId, tx.categoryNameSnapshot]);
    const existing = map.get(key);
    if (existing) {
      existing.totalPaise += tx.amountPaise;
      existing.count += 1;
    } else {
      map.set(key, {
        categoryId: tx.categoryId,
        categoryName: tx.categoryNameSnapshot,
        type: tx.type,
        context: tx.context,
        totalPaise: tx.amountPaise,
        count: 1,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.totalPaise - a.totalPaise)
    .map((item) => ({
      ...item,
      sharePercent: grandTotal > 0 ? Math.round((item.totalPaise / grandTotal) * 100) : 0,
    }));
}

export function getTransactionsForCategory(
  transactions: Transaction[],
  selection: CategorySelection | null
): Transaction[] {
  if (!selection) return [];
  const matching = transactions.filter(
    (t) =>
      t.type === selection.type &&
      t.categoryId === selection.categoryId &&
      t.categoryNameSnapshot === selection.categoryName
  );
  return sortTransactionsNewestFirst(matching);
}

export function groupByPerson(transactions: Transaction[]): PersonBreakdownItem[] {
  const map = new Map<string, PersonBreakdownItem>();

  for (const tx of transactions) {
    const name = tx.personNameSnapshot?.trim();
    if (!name) continue;
    const key = tx.personId ? `id:${tx.personId}` : `name:${name.toLowerCase()}`;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        key,
        personId: tx.personId,
        personName: name,
        receivedPaise: 0,
        spentPaise: 0,
        netPaise: 0,
        count: 0,
        transactions: [],
      };
      map.set(key, entry);
    }

    if (tx.type === 'received') {
      entry.receivedPaise += tx.amountPaise;
    } else {
      entry.spentPaise += tx.amountPaise;
    }
    entry.netPaise = entry.receivedPaise - entry.spentPaise;
    entry.count += 1;
    entry.transactions.push(tx);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      transactions: sortTransactionsNewestFirst(item.transactions),
    }))
    .sort((a, b) => b.spentPaise + b.receivedPaise - (a.spentPaise + a.receivedPaise));
}

export function groupByDate(
  transactions: Transaction[]
): Array<{ date: string; summary: PeriodSummary; items: Transaction[] }> {
  const sorted = sortTransactionsNewestFirst(transactions);
  const groups = new Map<string, Transaction[]>();

  for (const tx of sorted) {
    const list = groups.get(tx.date);
    if (list) list.push(tx);
    else groups.set(tx.date, [tx]);
  }

  return Array.from(groups.entries()).map(([date, items]) => ({
    date,
    summary: computeSummary(items),
    items,
  }));
}

const FORMULA_TRIGGER_RE = /^[\s\uFEFF\xA0]*[=+\-@\t\r]/;

function escapeCsvCell(value: string, options?: { numeric?: boolean }): string {
  let safe = value;
  if (!options?.numeric && FORMULA_TRIGGER_RE.test(safe)) {
    safe = `'${safe}`;
  }
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function formatPaiseDecimal(paise: number): string {
  const safe = Math.round(paise);
  if (safe === 0) return '0.00';
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

export function transactionsToCsv(transactions: Transaction[]): string {
  const sorted = sortTransactionsNewestFirst(transactions);
  const headers = [
    'Date',
    'Time',
    'Type',
    'Context',
    'Category',
    'Person',
    'Payment Mode',
    'Amount (INR)',
    'Notes',
  ];

  const rows = sorted.map((tx) => {
    const rupees = formatPaiseDecimal(tx.amountPaise);
    return [
      escapeCsvCell(tx.date),
      escapeCsvCell(tx.time),
      escapeCsvCell(tx.type === 'received' ? 'Received' : 'Spent'),
      escapeCsvCell(tx.context === 'personal' ? 'Personal' : 'Business'),
      escapeCsvCell(tx.categoryNameSnapshot),
      escapeCsvCell(tx.personNameSnapshot ?? ''),
      escapeCsvCell(tx.paymentMode === 'cash' ? 'Cash' : 'Online'),
      escapeCsvCell(rupees, { numeric: true }),
      escapeCsvCell(tx.notes ?? ''),
    ].join(',');
  });

  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}
