import { DBSchema, IDBPDatabase, openDB } from 'idb';
import {
  BackupPayload,
  BackupPreview,
  Category,
  PaymentMode,
  Person,
  Profile,
  Transaction,
  TransactionContext,
  TransactionType,
} from '../types/cashbook';
import {
  generateId,
  hashPin,
  isValidDateStr,
  isValidTimeStr,
  MAX_SAFE_PAISE,
} from '../utils/currency';

function resetDbConnection(
  targetPromise?: Promise<IDBPDatabase<CashbookDBSchema>>
): void {
  if (!targetPromise || dbPromise === targetPromise) {
    dbPromise = null;
  }
}

function formatStorageError(err: unknown, fallback: string): Error {
  if (err instanceof Error) {
    if (err.name === 'QuotaExceededError') {
      return new Error('Device storage is full. Free up space or export a backup before continuing.');
    }
    if (err.name === 'AbortError') {
      return new Error('Storage operation was cancelled before saving. No partial changes were kept.');
    }
    if (err.name === 'InvalidStateError' || err.name === 'TransactionInactiveError') {
      resetDbConnection();
      return new Error('Local storage connection was interrupted. Please try again.');
    }
    if (err.name === 'VersionError') {
      resetDbConnection();
      return new Error('Local storage database version mismatch. Reload the app to continue.');
    }
    if (err.name === 'SecurityError') {
      return new Error('Local storage is blocked by browser privacy settings.');
    }
    if (err.name === 'UnknownError') {
      return new Error(fallback);
    }
    return err;
  }
  return new Error(fallback);
}

interface CashbookDBSchema extends DBSchema {
  profiles: {
    key: string;
    value: Profile;
  };
  categories: {
    key: string;
    value: Category;
    indexes: { 'by-profile': string };
  };
  people: {
    key: string;
    value: Person;
    indexes: { 'by-profile': string };
  };
  transactions: {
    key: string;
    value: Transaction;
    indexes: { 'by-profile': string; 'by-profile-date': [string, string] };
  };
}

const DB_NAME = 'cashbook_ledger_v1';
const DB_VERSION = 1;
const ALLOWED_AUTO_LOCK_MINUTES = new Set([0, 1, 5, 15, 30]);

let dbPromise: Promise<IDBPDatabase<CashbookDBSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<CashbookDBSchema>> {
  if (!dbPromise) {
    let pending: Promise<IDBPDatabase<CashbookDBSchema>>;
    pending = openDB<CashbookDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('categories')) {
          const catStore = db.createObjectStore('categories', { keyPath: 'id' });
          catStore.createIndex('by-profile', 'profileId');
        }
        if (!db.objectStoreNames.contains('people')) {
          const peopleStore = db.createObjectStore('people', { keyPath: 'id' });
          peopleStore.createIndex('by-profile', 'profileId');
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txStore.createIndex('by-profile', 'profileId');
          txStore.createIndex('by-profile-date', ['profileId', 'date']);
        }
      },
      blocking() {
        resetDbConnection(pending);
      },
      terminated() {
        resetDbConnection(pending);
      },
    })
      .then((db) => {
        db.addEventListener('versionchange', () => {
          resetDbConnection(pending);
          db.close();
        });
        db.addEventListener('close', () => {
          resetDbConnection(pending);
        });
        return db;
      })
      .catch((err) => {
        resetDbConnection(pending);
        throw formatStorageError(err, 'Unable to open local storage database.');
      });
    dbPromise = pending;
  }
  return dbPromise;
}

const DEFAULT_CATEGORIES: Array<{
  name: string;
  type: TransactionType;
  context: TransactionContext;
}> = [
  // Personal Expenses
  { name: 'Food', type: 'spent', context: 'personal' },
  { name: 'Petrol', type: 'spent', context: 'personal' },
  { name: 'Shopping', type: 'spent', context: 'personal' },
  { name: 'Travel', type: 'spent', context: 'personal' },
  { name: 'Medical', type: 'spent', context: 'personal' },
  { name: 'Other Personal', type: 'spent', context: 'personal' },
  // Business Expenses
  { name: 'Fuel & Vehicle', type: 'spent', context: 'business' },
  { name: 'Transportation', type: 'spent', context: 'business' },
  { name: 'Labour Payment', type: 'spent', context: 'business' },
  { name: 'Supplies & Materials', type: 'spent', context: 'business' },
  { name: 'Rent & Utilities', type: 'spent', context: 'business' },
  { name: 'Maintenance & Repairs', type: 'spent', context: 'business' },
  // Income (Business & Personal)
  { name: 'Payments Received', type: 'received', context: 'business' },
  { name: 'Business Income', type: 'received', context: 'business' },
  { name: 'Other Business Income', type: 'received', context: 'business' },
  { name: 'Personal Income', type: 'received', context: 'personal' },
  { name: 'Other Income', type: 'received', context: 'personal' },
];

export async function getProfiles(): Promise<Profile[]> {
  try {
    const db = await getDb();
    const list = await db.getAll('profiles');
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (err) {
    throw formatStorageError(err, 'Unable to read profiles from local storage.');
  }
}

export async function createProfile(
  name: string,
  pin?: string | null
): Promise<Profile> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Profile name is required.');

  const profileId = generateId();
  const pinHash = pin && pin.trim() ? await hashPin(pin.trim()) : null;
  const profile: Profile = {
    id: profileId,
    name: trimmed,
    pinHash,
    lastPaymentMode: 'cash',
    lastContext: 'business',
    autoLockMinutes: 5,
    createdAt: new Date().toISOString(),
  };

  try {
    const db = await getDb();
    const tx = db.transaction(['profiles', 'categories'], 'readwrite');
    await tx.objectStore('profiles').put(profile);
    const catStore = tx.objectStore('categories');
    for (const def of DEFAULT_CATEGORIES) {
      await catStore.put({
        id: generateId(),
        profileId,
        name: def.name,
        type: def.type,
        context: def.context,
        isDefault: true,
        isArchived: false,
        usageCount: 0,
        lastUsedAt: null,
      });
    }
    await tx.done;
    return profile;
  } catch (err) {
    throw formatStorageError(err, 'Unable to create profile in local storage.');
  }
}

export async function updateProfile(profile: Profile): Promise<void> {
  try {
    const db = await getDb();
    await db.put('profiles', profile);
  } catch (err) {
    throw formatStorageError(err, 'Unable to update profile settings.');
  }
}

export async function deleteProfile(profileId: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(
      ['profiles', 'categories', 'people', 'transactions'],
      'readwrite'
    );

    await tx.objectStore('profiles').delete(profileId);

    const cats = await tx.objectStore('categories').index('by-profile').getAllKeys(profileId);
    for (const key of cats) await tx.objectStore('categories').delete(key);

    const ppl = await tx.objectStore('people').index('by-profile').getAllKeys(profileId);
    for (const key of ppl) await tx.objectStore('people').delete(key);

    const txs = await tx.objectStore('transactions').index('by-profile').getAllKeys(profileId);
    for (const key of txs) await tx.objectStore('transactions').delete(key);

    await tx.done;
  } catch (err) {
    throw formatStorageError(err, 'Unable to delete profile.');
  }
}

export async function getCategories(profileId: string): Promise<Category[]> {
  try {
    const db = await getDb();
    const list = await db.getAllFromIndex('categories', 'by-profile', profileId);
    return list.sort((a, b) => {
      if (Boolean(a.isArchived) !== Boolean(b.isArchived)) {
        return a.isArchived ? 1 : -1;
      }
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    throw formatStorageError(err, 'Unable to read categories from local storage.');
  }
}

export async function saveCategory(category: Category): Promise<Category> {
  try {
    const db = await getDb();
    await db.put('categories', category);
    return category;
  } catch (err) {
    throw formatStorageError(err, 'Unable to save category.');
  }
}

export async function getCategoryUsageCount(
  profileId: string,
  categoryId: string
): Promise<number> {
  try {
    const db = await getDb();
    const txs = await db.getAllFromIndex('transactions', 'by-profile', profileId);
    return txs.reduce((count, tx) => (tx.categoryId === categoryId ? count + 1 : count), 0);
  } catch (err) {
    throw formatStorageError(err, 'Unable to verify category usage.');
  }
}

export async function renameCategory(
  profileId: string,
  categoryId: string,
  rawNewName: string
): Promise<void> {
  const newName = rawNewName.trim();
  if (!newName) throw new Error('Category name cannot be empty.');

  try {
    const db = await getDb();
    const idbTx = db.transaction(['categories', 'transactions'], 'readwrite');
    const catStore = idbTx.objectStore('categories');
    const txStore = idbTx.objectStore('transactions');

    const target = await catStore.get(categoryId);
    if (!target || target.profileId !== profileId) {
      throw new Error('Category not found in active profile.');
    }

    const allCats = await catStore.index('by-profile').getAll(profileId);
    const duplicate = allCats.find(
      (c) =>
        c.id !== categoryId &&
        c.type === target.type &&
        c.context === target.context &&
        c.name.toLowerCase() === newName.toLowerCase()
    );
    if (duplicate) {
      throw new Error(`Category "${newName}" already exists for ${target.context} ${target.type}.`);
    }

    await catStore.put({ ...target, name: newName });

    // Keep historical transaction snapshots consistent across history, reports & filters
    const profileTxs = await txStore.index('by-profile').getAll(profileId);
    for (const tx of profileTxs) {
      if (tx.categoryId === categoryId && tx.categoryNameSnapshot !== newName) {
        await txStore.put({ ...tx, categoryNameSnapshot: newName });
      }
    }

    await idbTx.done;
  } catch (err) {
    throw formatStorageError(err, 'Unable to rename category.');
  }
}

export async function setCategoryArchived(
  profileId: string,
  categoryId: string,
  isArchived: boolean
): Promise<void> {
  try {
    const db = await getDb();
    const existing = await db.get('categories', categoryId);
    if (!existing || existing.profileId !== profileId) {
      throw new Error('Category not found in active profile.');
    }
    await db.put('categories', { ...existing, isArchived });
  } catch (err) {
    throw formatStorageError(err, 'Unable to update category archive state.');
  }
}

export async function deleteCategory(
  categoryId: string,
  profileId: string
): Promise<void> {
  if (!profileId || !profileId.trim()) {
    throw new Error('Active profile is required to delete a category.');
  }
  try {
    const db = await getDb();
    const idbTx = db.transaction('categories', 'readwrite');
    const store = idbTx.objectStore('categories');
    const existing = await store.get(categoryId);
    if (existing && existing.profileId !== profileId) {
      idbTx.done.catch(() => {});
      throw new Error('Cannot delete a category from another profile.');
    }
    if (existing) {
      await store.delete(categoryId);
    }
    await idbTx.done;
  } catch (err) {
    throw formatStorageError(err, 'Unable to delete category.');
  }
}

export async function getPeople(profileId: string): Promise<Person[]> {
  try {
    const db = await getDb();
    const list = await db.getAllFromIndex('people', 'by-profile', profileId);
    return list.sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    throw formatStorageError(err, 'Unable to read saved people from local storage.');
  }
}

export async function savePerson(person: Person): Promise<Person> {
  try {
    const db = await getDb();
    await db.put('people', person);
    return person;
  } catch (err) {
    throw formatStorageError(err, 'Unable to save person.');
  }
}

export async function deletePerson(
  personId: string,
  profileId: string
): Promise<void> {
  if (!profileId || !profileId.trim()) {
    throw new Error('Active profile is required to remove a saved person.');
  }
  try {
    const db = await getDb();
    const idbTx = db.transaction('people', 'readwrite');
    const store = idbTx.objectStore('people');
    const existing = await store.get(personId);
    if (existing && existing.profileId !== profileId) {
      idbTx.done.catch(() => {});
      throw new Error('Cannot remove a saved person from another profile.');
    }
    if (existing) {
      await store.delete(personId);
    }
    await idbTx.done;
  } catch (err) {
    throw formatStorageError(err, 'Unable to remove saved person.');
  }
}

export async function getTransactions(profileId: string): Promise<Transaction[]> {
  try {
    const db = await getDb();
    return await db.getAllFromIndex('transactions', 'by-profile', profileId);
  } catch (err) {
    throw formatStorageError(err, 'Unable to read transactions from local storage.');
  }
}

export interface SaveTransactionInput {
  existingId?: string;
  profileId: string;
  amountPaise: number;
  type: TransactionType;
  context: TransactionContext;
  categoryId: string;
  categoryNameSnapshot: string;
  personId: string | null;
  personNameSnapshot: string | null;
  saveNewPersonIfNamed?: boolean;
  paymentMode: PaymentMode;
  date: string;
  time: string;
  notes: string;
}

export async function saveTransaction(
  input: SaveTransactionInput
): Promise<{ transaction: Transaction; createdPerson: Person | null }> {
  if (!input.profileId || !input.profileId.trim()) {
    throw new Error('Transaction must belong to a valid profile.');
  }
  if (
    !Number.isSafeInteger(input.amountPaise) ||
    input.amountPaise <= 0 ||
    input.amountPaise > MAX_SAFE_PAISE
  ) {
    throw new Error('Transaction amount must be greater than ₹0 and within valid limits.');
  }
  if (input.type !== 'received' && input.type !== 'spent') {
    throw new Error('Invalid transaction type.');
  }
  if (input.context !== 'personal' && input.context !== 'business') {
    throw new Error('Invalid transaction context.');
  }
  if (input.paymentMode !== 'cash' && input.paymentMode !== 'online') {
    throw new Error('Invalid payment mode.');
  }
  if (!input.categoryId || !input.categoryNameSnapshot.trim()) {
    throw new Error('Transaction category is required.');
  }
  if (!isValidDateStr(input.date)) {
    throw new Error('Transaction date must be a valid calendar date.');
  }
  if (!isValidTimeStr(input.time)) {
    throw new Error('Transaction time must be valid (HH:mm).');
  }

  try {
    const db = await getDb();
    const profileCheck = await db.get('profiles', input.profileId);
    if (!profileCheck) {
      throw new Error('Active profile does not exist in storage.');
    }

    const nowIso = new Date().toISOString();

    let resolvedPersonId = input.personId;
    let resolvedPersonName = input.personNameSnapshot?.trim() || null;
    let createdPerson: Person | null = null;

    if (!resolvedPersonId && resolvedPersonName && input.saveNewPersonIfNamed) {
      const existingPeople = await getPeople(input.profileId);
      const match = existingPeople.find(
        (p) => p.name.toLowerCase() === resolvedPersonName!.toLowerCase()
      );
      if (match) {
        resolvedPersonId = match.id;
        resolvedPersonName = match.name;
      } else {
        createdPerson = {
          id: generateId(),
          profileId: input.profileId,
          name: resolvedPersonName,
          usageCount: 0,
          lastUsedAt: null,
        };
        resolvedPersonId = createdPerson.id;
      }
    }

    const existingTx = input.existingId
      ? await db.get('transactions', input.existingId)
      : undefined;

    if (existingTx && existingTx.profileId !== input.profileId) {
      throw new Error('Cannot edit a transaction belonging to another profile.');
    }

    const transaction: Transaction = {
      id: existingTx ? existingTx.id : generateId(),
      profileId: input.profileId,
      amountPaise: input.amountPaise,
      type: input.type,
      context: input.context,
      categoryId: input.categoryId,
      categoryNameSnapshot: input.categoryNameSnapshot.trim(),
      personId: resolvedPersonId,
      personNameSnapshot: resolvedPersonName,
      paymentMode: input.paymentMode,
      date: input.date,
      time: input.time,
      notes: input.notes.trim(),
      createdAt: existingTx ? existingTx.createdAt : nowIso,
      updatedAt: nowIso,
    };

    const idbTx = db.transaction(
      ['transactions', 'categories', 'people', 'profiles'],
      'readwrite'
    );

    await idbTx.objectStore('transactions').put(transaction);

    const cat = await idbTx.objectStore('categories').get(input.categoryId);
    if (cat && cat.profileId === input.profileId) {
      await idbTx.objectStore('categories').put({
        ...cat,
        usageCount: existingTx ? cat.usageCount : cat.usageCount + 1,
        lastUsedAt: nowIso,
      });
    }

    if (createdPerson) {
      await idbTx.objectStore('people').put({
        ...createdPerson,
        usageCount: 1,
        lastUsedAt: nowIso,
      });
    } else if (resolvedPersonId) {
      const person = await idbTx.objectStore('people').get(resolvedPersonId);
      if (person && person.profileId === input.profileId) {
        await idbTx.objectStore('people').put({
          ...person,
          usageCount: existingTx ? person.usageCount : person.usageCount + 1,
          lastUsedAt: nowIso,
        });
      }
    }

    const profile = await idbTx.objectStore('profiles').get(input.profileId);
    if (profile) {
      await idbTx.objectStore('profiles').put({
        ...profile,
        lastPaymentMode: input.paymentMode,
        lastContext: input.context,
      });
    }

    await idbTx.done;
    return { transaction, createdPerson };
  } catch (err) {
    throw formatStorageError(err, 'Failed to save transaction to local storage.');
  }
}

export async function deleteTransaction(
  transactionId: string,
  profileId?: string
): Promise<void> {
  try {
    const db = await getDb();
    if (profileId) {
      const existing = await db.get('transactions', transactionId);
      if (existing && existing.profileId !== profileId) {
        throw new Error('Cannot delete a transaction from another profile.');
      }
    }
    await db.delete('transactions', transactionId);
  } catch (err) {
    throw formatStorageError(err, 'Unable to delete transaction.');
  }
}

export async function exportProfileBackup(profileId: string): Promise<BackupPayload> {
  try {
    const db = await getDb();
    // Single readonly transaction ensures a consistent point-in-time snapshot
    const snapTx = db.transaction(
      ['profiles', 'categories', 'people', 'transactions'],
      'readonly'
    );

    const profile = await snapTx.objectStore('profiles').get(profileId);
    if (!profile) throw new Error('Profile not found.');

    const [categories, people, transactions] = await Promise.all([
      snapTx.objectStore('categories').index('by-profile').getAll(profileId),
      snapTx.objectStore('people').index('by-profile').getAll(profileId),
      snapTx.objectStore('transactions').index('by-profile').getAll(profileId),
    ]);
    await snapTx.done;

    const { pinHash: _ignored, ...safeProfile } = profile;
    void _ignored;

    return {
      schemaVersion: 1,
      appName: 'Folio',
      exportedAt: new Date().toISOString(),
      profile: safeProfile,
      categories,
      people,
      transactions,
    };
  } catch (err) {
    throw formatStorageError(err, 'Unable to create JSON backup snapshot.');
  }
}

export async function validateAndPreviewBackup(
  raw: unknown,
  activeProfileId?: string
): Promise<{ payload: BackupPayload; preview: BackupPreview }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Backup file must contain a valid JSON object.');
  }

  const data = raw as Record<string, unknown>;

  if (data.schemaVersion !== 1) {
    throw new Error(
      `Unsupported backup format version (${String(data.schemaVersion ?? 'unknown')}).`
    );
  }

  if (!data.profile || typeof data.profile !== 'object' || Array.isArray(data.profile)) {
    throw new Error('Backup file is missing valid profile metadata.');
  }

  const rawProfile = data.profile as Record<string, unknown>;
  if (typeof rawProfile.id !== 'string' || !rawProfile.id.trim()) {
    throw new Error('Backup profile ID is missing or invalid.');
  }
  const backupProfileId = rawProfile.id.trim();

  if (typeof rawProfile.name !== 'string' || !rawProfile.name.trim()) {
    throw new Error('Backup profile name is missing or invalid.');
  }

  if (
    rawProfile.lastPaymentMode !== undefined &&
    rawProfile.lastPaymentMode !== 'cash' &&
    rawProfile.lastPaymentMode !== 'online'
  ) {
    throw new Error('Backup profile contains an invalid default payment mode.');
  }

  if (
    rawProfile.lastContext !== undefined &&
    rawProfile.lastContext !== 'personal' &&
    rawProfile.lastContext !== 'business'
  ) {
    throw new Error('Backup profile contains an invalid default context.');
  }

  let validatedAutoLockMinutes = 5;
  if (rawProfile.autoLockMinutes !== undefined) {
    if (
      typeof rawProfile.autoLockMinutes !== 'number' ||
      !Number.isFinite(rawProfile.autoLockMinutes) ||
      !Number.isInteger(rawProfile.autoLockMinutes) ||
      rawProfile.autoLockMinutes < 0 ||
      !ALLOWED_AUTO_LOCK_MINUTES.has(rawProfile.autoLockMinutes)
    ) {
      throw new Error(
        'Backup profile contains an invalid or unsupported auto-lock duration.'
      );
    }
    validatedAutoLockMinutes = rawProfile.autoLockMinutes;
  }

  if (
    rawProfile.createdAt !== undefined &&
    (typeof rawProfile.createdAt !== 'string' ||
      !rawProfile.createdAt.trim() ||
      Number.isNaN(Date.parse(rawProfile.createdAt)))
  ) {
    throw new Error('Backup profile creation timestamp is invalid.');
  }

  if (
    !Array.isArray(data.categories) ||
    !Array.isArray(data.people) ||
    !Array.isArray(data.transactions)
  ) {
    throw new Error('Backup file is missing categories, people, or transactions arrays.');
  }

  const validatedCategories: Category[] = [];
  const seenCatIds = new Set<string>();
  const categoryById = new Map<string, Category>();
  for (let i = 0; i < data.categories.length; i++) {
    const item = data.categories[i] as Record<string, unknown> | null;
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      (item.type !== 'received' && item.type !== 'spent') ||
      (item.context !== 'personal' && item.context !== 'business')
    ) {
      throw new Error(`Invalid category record found at index ${i}.`);
    }

    const catId = item.id.trim();
    if (seenCatIds.has(catId)) {
      throw new Error(`Duplicate category ID (${catId}) found inside backup file.`);
    }
    if (
      typeof item.profileId !== 'string' ||
      item.profileId.trim() !== backupProfileId
    ) {
      throw new Error(
        `Category "${item.name.trim()}" has an invalid or mismatched profile reference.`
      );
    }

    const category: Category = {
      id: catId,
      profileId: backupProfileId,
      name: item.name.trim(),
      type: item.type,
      context: item.context,
      isDefault: Boolean(item.isDefault),
      isArchived: Boolean(item.isArchived),
      usageCount:
        typeof item.usageCount === 'number' &&
        Number.isFinite(item.usageCount) &&
        item.usageCount >= 0
          ? item.usageCount
          : 0,
      lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : null,
    };
    seenCatIds.add(catId);
    categoryById.set(catId, category);
    validatedCategories.push(category);
  }

  const validatedPeople: Person[] = [];
  const seenPersonIds = new Set<string>();
  for (let i = 0; i < data.people.length; i++) {
    const item = data.people[i] as Record<string, unknown> | null;
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      typeof item.name !== 'string' ||
      !item.name.trim()
    ) {
      throw new Error(`Invalid person record found at index ${i}.`);
    }

    const personId = item.id.trim();
    if (seenPersonIds.has(personId)) {
      throw new Error(`Duplicate person ID (${personId}) found inside backup file.`);
    }
    if (
      typeof item.profileId !== 'string' ||
      item.profileId.trim() !== backupProfileId
    ) {
      throw new Error(
        `Person "${item.name.trim()}" has an invalid or mismatched profile reference.`
      );
    }

    seenPersonIds.add(personId);
    validatedPeople.push({
      id: personId,
      profileId: backupProfileId,
      name: item.name.trim(),
      roleNote: typeof item.roleNote === 'string' ? item.roleNote : undefined,
      usageCount:
        typeof item.usageCount === 'number' &&
        Number.isFinite(item.usageCount) &&
        item.usageCount >= 0
          ? item.usageCount
          : 0,
      lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : null,
    });
  }

  const validatedTxs: Transaction[] = [];
  const seenTxIds = new Set<string>();
  for (let i = 0; i < data.transactions.length; i++) {
    const item = data.transactions[i] as Record<string, unknown> | null;
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      typeof item.amountPaise !== 'number' ||
      !Number.isSafeInteger(item.amountPaise) ||
      item.amountPaise <= 0 ||
      item.amountPaise > MAX_SAFE_PAISE ||
      (item.type !== 'received' && item.type !== 'spent') ||
      (item.context !== 'personal' && item.context !== 'business') ||
      (item.paymentMode !== 'cash' && item.paymentMode !== 'online') ||
      typeof item.categoryId !== 'string' ||
      !item.categoryId.trim() ||
      typeof item.categoryNameSnapshot !== 'string' ||
      !item.categoryNameSnapshot.trim() ||
      typeof item.date !== 'string' ||
      !isValidDateStr(item.date) ||
      typeof item.time !== 'string' ||
      !isValidTimeStr(item.time)
    ) {
      throw new Error(`Invalid or corrupted transaction record found at index ${i}.`);
    }

    const txId = item.id.trim();
    if (seenTxIds.has(txId)) {
      throw new Error(`Duplicate transaction ID (${txId}) found inside backup file.`);
    }
    if (
      typeof item.profileId !== 'string' ||
      item.profileId.trim() !== backupProfileId
    ) {
      throw new Error(
        `Transaction at index ${i} has an invalid or mismatched profile reference.`
      );
    }

    const txCatId = item.categoryId.trim();
    const referencedCategory = categoryById.get(txCatId);
    if (!referencedCategory) {
      throw new Error(
        `Transaction at index ${i} references a category that does not exist in this backup.`
      );
    }
    if (
      referencedCategory.type !== item.type ||
      referencedCategory.context !== item.context
    ) {
      throw new Error(
        `Transaction at index ${i} has a type or context inconsistent with its category.`
      );
    }

    if (
      item.personId !== undefined &&
      item.personId !== null &&
      (typeof item.personId !== 'string' || !item.personId.trim())
    ) {
      throw new Error(`Transaction at index ${i} has an invalid person reference.`);
    }

    seenTxIds.add(txId);

    validatedTxs.push({
      id: txId,
      profileId: backupProfileId,
      amountPaise: item.amountPaise,
      type: item.type,
      context: item.context,
      categoryId: txCatId,
      categoryNameSnapshot: item.categoryNameSnapshot.trim(),
      personId: typeof item.personId === 'string' ? item.personId.trim() : null,
      personNameSnapshot:
        typeof item.personNameSnapshot === 'string' && item.personNameSnapshot.trim()
          ? item.personNameSnapshot.trim()
          : null,
      paymentMode: item.paymentMode,
      date: item.date,
      time: item.time,
      notes: typeof item.notes === 'string' ? item.notes : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
  }

  let duplicateTransactionCount = 0;
  if (activeProfileId) {
    const existingTxs = await getTransactions(activeProfileId);
    const existingIds = new Set(existingTxs.map((t) => t.id));
    for (const tx of validatedTxs) {
      if (existingIds.has(tx.id)) duplicateTransactionCount += 1;
    }
  }

  const exportedAt =
    typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt))
      ? data.exportedAt
      : null;

  const payload: BackupPayload = {
    schemaVersion: 1,
    appName: typeof data.appName === 'string' && data.appName.trim() ? data.appName.trim() : undefined,
    exportedAt: exportedAt || new Date().toISOString(),
    profile: {
      id: backupProfileId,
      name: rawProfile.name.trim(),
      lastPaymentMode: rawProfile.lastPaymentMode === 'online' ? 'online' : 'cash',
      lastContext: rawProfile.lastContext === 'personal' ? 'personal' : 'business',
      autoLockMinutes: validatedAutoLockMinutes,
      createdAt:
        typeof rawProfile.createdAt === 'string'
          ? rawProfile.createdAt
          : new Date().toISOString(),
    },
    categories: validatedCategories,
    people: validatedPeople,
    transactions: validatedTxs,
  };

  return {
    payload,
    preview: {
      profileCount: 1,
      profileName: payload.profile.name,
      transactionCount: validatedTxs.length,
      categoryCount: validatedCategories.length,
      peopleCount: validatedPeople.length,
      exportedAt,
      duplicateTransactionCount,
    },
  };
}

export async function restoreBackupPayload(
  raw: unknown,
  mode: 'new_profile' | 'merge_into_active',
  activeProfileId?: string
): Promise<{ profile: Profile; importedTxCount: number; skippedDuplicates: number }> {
  const { payload: data } = await validateAndPreviewBackup(
    raw,
    mode === 'merge_into_active' ? activeProfileId : undefined
  );

  try {
    const db = await getDb();

    // Single atomic readwrite transaction across all 4 stores prevents partial imports
    const idbTx = db.transaction(
      ['profiles', 'categories', 'people', 'transactions'],
      'readwrite'
    );

    const profileStore = idbTx.objectStore('profiles');
    const catStore = idbTx.objectStore('categories');
    const peopleStore = idbTx.objectStore('people');
    const txStore = idbTx.objectStore('transactions');

    let targetProfile: Profile;

    if (mode === 'merge_into_active' && activeProfileId) {
      const existing = await profileStore.get(activeProfileId);
      if (!existing) throw new Error('Active profile not found.');
      targetProfile = existing;
    } else {
      const newId = generateId();
      targetProfile = {
        id: newId,
        name: data.profile.name || 'Restored Folio',
        pinHash: null, // Restored profiles start unlocked; user can set a PIN in Settings
        lastPaymentMode: data.profile.lastPaymentMode === 'online' ? 'online' : 'cash',
        lastContext: data.profile.lastContext === 'personal' ? 'personal' : 'business',
        autoLockMinutes:
          typeof data.profile.autoLockMinutes === 'number' ? data.profile.autoLockMinutes : 5,
        createdAt: new Date().toISOString(),
      };
      await profileStore.put(targetProfile);
    }

    const targetId = targetProfile.id;

    const [existingCats, existingPeople, existingTxs] =
      mode === 'merge_into_active'
        ? await Promise.all([
            catStore.index('by-profile').getAll(targetId),
            peopleStore.index('by-profile').getAll(targetId),
            txStore.index('by-profile').getAll(targetId),
          ])
        : [[], [], []];

    const existingCatIds = new Set(existingCats.map((c) => c.id));
    const existingPersonIds = new Set(existingPeople.map((p) => p.id));
    const existingTxIds = new Set(existingTxs.map((t) => t.id));
    const catIdMap = new Map<string, string>();
    const personIdMap = new Map<string, string>();

    for (const cat of data.categories) {
      const match = existingCats.find(
        (c) =>
          c.name.toLowerCase() === cat.name.toLowerCase() &&
          c.type === cat.type &&
          c.context === cat.context
      );
      if (match) {
        catIdMap.set(cat.id, match.id);
      } else {
        const mappedId =
          mode === 'new_profile' || existingCatIds.has(cat.id) ? generateId() : cat.id;
        existingCatIds.add(mappedId);
        catIdMap.set(cat.id, mappedId);
        await catStore.put({
          ...cat,
          id: mappedId,
          profileId: targetId,
        });
      }
    }

    for (const person of data.people) {
      const match = existingPeople.find(
        (p) => p.name.toLowerCase() === person.name.toLowerCase()
      );
      if (match) {
        personIdMap.set(person.id, match.id);
      } else {
        const mappedId =
          mode === 'new_profile' || existingPersonIds.has(person.id)
            ? generateId()
            : person.id;
        existingPersonIds.add(mappedId);
        personIdMap.set(person.id, mappedId);
        await peopleStore.put({
          ...person,
          id: mappedId,
          profileId: targetId,
        });
      }
    }

    let importedTxCount = 0;
    let skippedDuplicates = 0;

    for (const tx of data.transactions) {
      if (mode === 'merge_into_active' && existingTxIds.has(tx.id)) {
        skippedDuplicates += 1;
        continue;
      }

      const mappedTxId = mode === 'new_profile' ? generateId() : tx.id;
      const mappedCatId = catIdMap.get(tx.categoryId) || tx.categoryId;
      const mappedPersonId = tx.personId ? personIdMap.get(tx.personId) || tx.personId : null;

      await txStore.put({
        ...tx,
        id: mappedTxId,
        profileId: targetId,
        categoryId: mappedCatId,
        personId: mappedPersonId,
      });
      importedTxCount += 1;
    }

    await idbTx.done;

    return { profile: targetProfile, importedTxCount, skippedDuplicates };
  } catch (err) {
    throw formatStorageError(
      err,
      'Backup import failed. No partial changes were applied to your ledger.'
    );
  }
}

export async function resetProfileData(profileId: string): Promise<void> {
  if (typeof profileId !== 'string' || !profileId.trim()) {
    throw new Error('A valid active profile ID is required to delete profile data.');
  }
  const targetProfileId = profileId.trim();

  try {
    const db = await getDb();
    const idbTx = db.transaction(
      ['profiles', 'categories', 'people', 'transactions'],
      'readwrite'
    );

    try {
      const profile = await idbTx.objectStore('profiles').get(targetProfileId);
      if (!profile) {
        throw new Error('Active profile does not exist in storage.');
      }

      const catStore = idbTx.objectStore('categories');
      const peopleStore = idbTx.objectStore('people');
      const txStore = idbTx.objectStore('transactions');

      const [catRecords, peopleRecords, txRecords] = await Promise.all([
        catStore.index('by-profile').getAll(targetProfileId),
        peopleStore.index('by-profile').getAll(targetProfileId),
        txStore.index('by-profile').getAll(targetProfileId),
      ]);

      for (const cat of catRecords) {
        if (cat.profileId !== targetProfileId) {
          throw new Error('Profile ownership mismatch while deleting categories.');
        }
        await catStore.delete(cat.id);
      }

      for (const person of peopleRecords) {
        if (person.profileId !== targetProfileId) {
          throw new Error('Profile ownership mismatch while deleting saved people.');
        }
        await peopleStore.delete(person.id);
      }

      for (const tx of txRecords) {
        if (tx.profileId !== targetProfileId) {
          throw new Error('Profile ownership mismatch while deleting transactions.');
        }
        await txStore.delete(tx.id);
      }

      await idbTx.done;
    } catch (innerErr) {
      try {
        idbTx.abort();
      } catch {
        // Ignore if transaction already aborted or finished
      }
      await idbTx.done.catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    throw formatStorageError(err, 'Unable to delete active profile data.');
  }
}

export async function resetAllAppData(): Promise<void> {
  try {
    const db = await getDb();
    const idbTx = db.transaction(
      ['profiles', 'categories', 'people', 'transactions'],
      'readwrite'
    );
    await Promise.all([
      idbTx.objectStore('profiles').clear(),
      idbTx.objectStore('categories').clear(),
      idbTx.objectStore('people').clear(),
      idbTx.objectStore('transactions').clear(),
    ]);
    await idbTx.done;
  } catch (err) {
    throw formatStorageError(err, 'Unable to clear local app data.');
  }
}

