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

function formatStorageError(err: unknown, fallback: string): Error {
  if (err instanceof Error) {
    if (err.name === 'QuotaExceededError') {
      return new Error('Device storage is full. Free up space or export a backup before continuing.');
    }
    if (err.name === 'AbortError') {
      return new Error('Storage operation was cancelled before saving. No partial changes were kept.');
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

let dbPromise: Promise<IDBPDatabase<CashbookDBSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<CashbookDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<CashbookDBSchema>(DB_NAME, DB_VERSION, {
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
    });
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
  const db = await getDb();
  const list = await db.getAll('profiles');
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createProfile(
  name: string,
  pin?: string | null
): Promise<Profile> {
  const db = await getDb();
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
  const db = await getDb();
  const list = await db.getAllFromIndex('categories', 'by-profile', profileId);
  return list.sort((a, b) => {
    if (Boolean(a.isArchived) !== Boolean(b.isArchived)) {
      return a.isArchived ? 1 : -1;
    }
    if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
    return a.name.localeCompare(b.name);
  });
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
  const db = await getDb();
  const txs = await db.getAllFromIndex('transactions', 'by-profile', profileId);
  return txs.reduce((count, tx) => (tx.categoryId === categoryId ? count + 1 : count), 0);
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

export async function deleteCategory(categoryId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('categories', categoryId);
  } catch (err) {
    throw formatStorageError(err, 'Unable to delete category.');
  }
}

export async function getPeople(profileId: string): Promise<Person[]> {
  const db = await getDb();
  const list = await db.getAllFromIndex('people', 'by-profile', profileId);
  return list.sort((a, b) => {
    if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
    return a.name.localeCompare(b.name);
  });
}

export async function savePerson(person: Person): Promise<Person> {
  const db = await getDb();
  await db.put('people', person);
  return person;
}

export async function deletePerson(personId: string): Promise<void> {
  const db = await getDb();
  await db.delete('people', personId);
}

export async function getTransactions(profileId: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllFromIndex('transactions', 'by-profile', profileId);
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
  if (typeof rawProfile.name !== 'string' || !rawProfile.name.trim()) {
    throw new Error('Backup profile name is missing or invalid.');
  }

  if (
    !Array.isArray(data.categories) ||
    !Array.isArray(data.people) ||
    !Array.isArray(data.transactions)
  ) {
    throw new Error('Backup file is missing categories, people, or transactions arrays.');
  }

  const validatedCategories: Category[] = [];
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
    validatedCategories.push({
      id: item.id,
      profileId: typeof item.profileId === 'string' ? item.profileId : String(rawProfile.id || ''),
      name: item.name.trim(),
      type: item.type,
      context: item.context,
      isDefault: Boolean(item.isDefault),
      isArchived: Boolean(item.isArchived),
      usageCount: typeof item.usageCount === 'number' && Number.isFinite(item.usageCount) ? item.usageCount : 0,
      lastUsedAt: typeof item.lastUsedAt === 'string' ? item.lastUsedAt : null,
    });
  }

  const validatedPeople: Person[] = [];
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
    validatedPeople.push({
      id: item.id,
      profileId: typeof item.profileId === 'string' ? item.profileId : String(rawProfile.id || ''),
      name: item.name.trim(),
      roleNote: typeof item.roleNote === 'string' ? item.roleNote : undefined,
      usageCount: typeof item.usageCount === 'number' && Number.isFinite(item.usageCount) ? item.usageCount : 0,
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

    if (seenTxIds.has(item.id)) {
      throw new Error(`Duplicate transaction ID (${item.id}) found inside backup file.`);
    }
    seenTxIds.add(item.id);

    validatedTxs.push({
      id: item.id,
      profileId: typeof item.profileId === 'string' ? item.profileId : String(rawProfile.id || ''),
      amountPaise: item.amountPaise,
      type: item.type,
      context: item.context,
      categoryId: item.categoryId,
      categoryNameSnapshot: item.categoryNameSnapshot.trim(),
      personId: typeof item.personId === 'string' && item.personId.trim() ? item.personId : null,
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
      id: typeof rawProfile.id === 'string' && rawProfile.id.trim() ? rawProfile.id : generateId(),
      name: rawProfile.name.trim(),
      lastPaymentMode: rawProfile.lastPaymentMode === 'online' ? 'online' : 'cash',
      lastContext: rawProfile.lastContext === 'personal' ? 'personal' : 'business',
      autoLockMinutes:
        typeof rawProfile.autoLockMinutes === 'number' ? rawProfile.autoLockMinutes : 5,
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

export async function resetAllAppData(): Promise<void> {
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
}

