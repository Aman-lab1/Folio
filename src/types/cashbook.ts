export type TransactionType = 'received' | 'spent';
export type TransactionContext = 'personal' | 'business';
export type PaymentMode = 'cash' | 'online';

export interface Profile {
  id: string;
  name: string;
  pinHash: string | null;
  lastPaymentMode: PaymentMode;
  lastContext: TransactionContext;
  autoLockMinutes?: number; // 0 = never, default 5 when PIN is enabled
  createdAt: string;
}

export interface Category {
  id: string;
  profileId: string;
  name: string;
  type: TransactionType;
  context: TransactionContext;
  isDefault: boolean;
  isArchived?: boolean;
  usageCount: number;
  lastUsedAt: string | null;
}

export interface Person {
  id: string;
  profileId: string;
  name: string;
  roleNote?: string;
  usageCount: number;
  lastUsedAt: string | null;
}

export interface Transaction {
  id: string;
  profileId: string;
  amountPaise: number; // Always positive integer paise (INR * 100)
  type: TransactionType;
  context: TransactionContext;
  categoryId: string;
  categoryNameSnapshot: string;
  personId: string | null;
  personNameSnapshot: string | null;
  paymentMode: PaymentMode;
  date: string; // YYYY-MM-DD (local date)
  time: string; // HH:mm (24h local time)
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type DatePreset =
  | 'today'
  | 'week'
  | 'month'
  | 'last_month'
  | 'year'
  | 'all'
  | 'custom';

export interface TransactionFilter {
  search: string;
  type: 'all' | TransactionType;
  context: 'all' | TransactionContext;
  paymentMode: 'all' | PaymentMode;
  categoryId: string; // 'all' or specific category id
  personId: string; // 'all' or specific person id or 'none'
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
}

export interface BackupPayload {
  schemaVersion: 1;
  appName?: string;
  exportedAt: string;
  profile: Omit<Profile, 'pinHash'>;
  categories: Category[];
  people: Person[];
  transactions: Transaction[];
}

export interface BackupPreview {
  profileCount: number;
  profileName: string;
  transactionCount: number;
  categoryCount: number;
  peopleCount: number;
  exportedAt: string | null;
  duplicateTransactionCount: number;
}

export type AppTab = 'home' | 'history' | 'reports' | 'settings';
