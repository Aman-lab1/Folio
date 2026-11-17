import {
  buildPersonFilterOptions,
  filterTransactions,
  formatPaiseDecimal,
  transactionsToCsv,
} from '../src/utils/calculations';
import { hashPin, verifyPin } from '../src/utils/currency';
import { assertBackupFileWithinLimit, MAX_BACKUP_FILE_BYTES } from '../src/App';
import type { Person, Transaction, TransactionFilter } from '../src/types/cashbook';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed (${message}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Assertion failed (${message}): expected ${e}, got ${a}`);
  }
}

async function assertRejects(
  fn: () => Promise<unknown>,
  expectedSubstring: string,
  label: string
): Promise<void> {
  let rejected = false;
  try {
    await fn();
  } catch (err) {
    rejected = true;
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(expectedSubstring)) {
      throw new Error(
        `${label}: expected error containing "${expectedSubstring}", got "${msg}"`
      );
    }
  }
  if (!rejected) {
    throw new Error(`${label}: expected promise rejection, but it resolved`);
  }
}

// Lightweight in-memory IDBFactory shim compatible with `idb` for testing
// ownership checks and connection recovery in `cashbookDb.ts`.
function installMockIndexedDB() {
  type RecordValue = Record<string, unknown>;
  const storesData = new Map<string, Map<string, RecordValue>>();
  let failNextOpen = false;
  let openAttempts = 0;
  let activeDbInstance: MockIDBDatabase | null = null;

  function makeReq<T>(executor: (req: MockRequest<T>) => void): MockRequest<T> {
    const req = new MockRequest<T>();
    queueMicrotask(() => executor(req));
    return req;
  }

  class MockEventTarget {
    private listeners = new Map<string, Array<(ev: unknown) => void>>();
    addEventListener(type: string, cb: (ev: unknown) => void) {
      const list = this.listeners.get(type) ?? [];
      list.push(cb);
      this.listeners.set(type, list);
    }
    removeEventListener(type: string, cb: (ev: unknown) => void) {
      const list = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        list.filter((fn) => fn !== cb)
      );
    }
    dispatchEvent(ev: { type: string; [key: string]: unknown }) {
      const handler = (this as unknown as Record<string, unknown>)[`on${ev.type}`];
      if (typeof handler === 'function') {
        handler.call(this, ev);
      }
      for (const cb of this.listeners.get(ev.type) ?? []) {
        cb.call(this, ev);
      }
      return true;
    }
  }

  class MockRequest<T> extends MockEventTarget {
    result!: T;
    error: Error | null = null;
    transaction: MockTransaction | null = null;
    onsuccess: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    succeed(val: T) {
      this.result = val;
      this.dispatchEvent({ type: 'success' });
    }
    fail(err: Error) {
      this.error = err;
      this.dispatchEvent({ type: 'error' });
    }
  }

  class MockOpenRequest extends MockRequest<MockIDBDatabase> {
    onupgradeneeded: ((ev: unknown) => void) | null = null;
    onblocked: ((ev: unknown) => void) | null = null;
  }

  class MockIndex {
    constructor(
      private storeName: string,
      private keyPath: string | string[],
      private tx: MockTransaction
    ) {}
    private matches(val: RecordValue, query: unknown): boolean {
      if (typeof this.keyPath === 'string') {
        return val[this.keyPath] === query;
      }
      return Array.isArray(query) && this.keyPath.every((k, i) => val[k] === query[i]);
    }
    getAll(query?: unknown) {
      return makeReq<RecordValue[]>((req) => {
        req.transaction = this.tx;
        const map = storesData.get(this.storeName) ?? new Map();
        const rows = Array.from(map.values())
          .filter((v) => (query === undefined ? true : this.matches(v, query)))
          .map((v) => structuredClone(v));
        req.succeed(rows);
        this.tx.scheduleComplete();
      });
    }
    getAllKeys(query?: unknown) {
      return makeReq<string[]>((req) => {
        req.transaction = this.tx;
        const map = storesData.get(this.storeName) ?? new Map();
        const keys = Array.from(map.entries())
          .filter(([, v]) => (query === undefined ? true : this.matches(v, query)))
          .map(([k]) => k);
        req.succeed(keys);
        this.tx.scheduleComplete();
      });
    }
  }

  class MockObjectStore {
    name: string;
    constructor(
      name: string,
      private tx: MockTransaction
    ) {
      this.name = name;
    }
    createIndex(_name: string, _keyPath: string | string[]) {
      return {};
    }
    index(name: string) {
      const keyPath = name === 'by-profile-date' ? ['profileId', 'date'] : 'profileId';
      return new MockIndex(this.name, keyPath, this.tx);
    }
    get(key: string) {
      return makeReq<RecordValue | undefined>((req) => {
        req.transaction = this.tx;
        const map = storesData.get(this.name) ?? new Map();
        const val = map.get(key);
        req.succeed(val ? structuredClone(val) : undefined);
        this.tx.scheduleComplete();
      });
    }
    getAll() {
      return makeReq<RecordValue[]>((req) => {
        req.transaction = this.tx;
        const map = storesData.get(this.name) ?? new Map();
        req.succeed(Array.from(map.values()).map((v) => structuredClone(v)));
        this.tx.scheduleComplete();
      });
    }
    put(val: RecordValue) {
      return makeReq<string>((req) => {
        req.transaction = this.tx;
        let map = storesData.get(this.name);
        if (!map) {
          map = new Map();
          storesData.set(this.name, map);
        }
        const key = String(val.id);
        map.set(key, structuredClone(val));
        req.succeed(key);
        this.tx.scheduleComplete();
      });
    }
    delete(key: string) {
      return makeReq<undefined>((req) => {
        req.transaction = this.tx;
        const map = storesData.get(this.name);
        map?.delete(key);
        req.succeed(undefined);
        this.tx.scheduleComplete();
      });
    }
    clear() {
      return makeReq<undefined>((req) => {
        req.transaction = this.tx;
        storesData.get(this.name)?.clear();
        req.succeed(undefined);
        this.tx.scheduleComplete();
      });
    }
  }

  class MockTransaction extends MockEventTarget {
    objectStoreNames: string[];
    private scheduled = false;
    private finished = false;
    oncomplete: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onabort: ((ev: unknown) => void) | null = null;
    constructor(
      storeNames: string | string[],
      public mode: string,
      public db: MockIDBDatabase
    ) {
      super();
      this.objectStoreNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    }
    objectStore(name: string) {
      return new MockObjectStore(name, this);
    }
    abort() {
      if (this.finished) return;
      this.finished = true;
      this.dispatchEvent({ type: 'abort' });
    }
    scheduleComplete() {
      if (this.scheduled || this.finished) return;
      this.scheduled = true;
      queueMicrotask(() => {
        if (!this.finished) {
          this.finished = true;
          this.dispatchEvent({ type: 'complete' });
        }
      });
    }
  }

  class MockIDBDatabase extends MockEventTarget {
    closed = false;
    objectStoreNames = {
      _names: new Set<string>(),
      contains(name: string) {
        return this._names.has(name);
      },
    };
    createObjectStore(name: string) {
      this.objectStoreNames._names.add(name);
      if (!storesData.has(name)) storesData.set(name, new Map());
      const fakeTx = new MockTransaction(name, 'versionchange', this);
      return new MockObjectStore(name, fakeTx);
    }
    transaction(storeNames: string | string[], mode = 'readonly') {
      if (this.closed) {
        const err = new Error('Database connection is closed');
        err.name = 'InvalidStateError';
        throw err;
      }
      return new MockTransaction(storeNames, mode, this);
    }
    close() {
      if (!this.closed) {
        this.closed = true;
        this.dispatchEvent({ type: 'close' });
      }
    }
  }

  const factory = {
    open(_name: string, _version?: number) {
      openAttempts += 1;
      const req = new MockOpenRequest();
      queueMicrotask(() => {
        if (failNextOpen) {
          failNextOpen = false;
          const err = new Error('Transient IndexedDB open failure');
          err.name = 'UnknownError';
          req.fail(err);
          return;
        }
        const db = new MockIDBDatabase();
        for (const n of storesData.keys()) {
          db.objectStoreNames._names.add(n);
        }
        activeDbInstance = db;
        req.result = db;
        if (storesData.size === 0) {
          const upgradeTx = new MockTransaction([], 'versionchange', db);
          req.transaction = upgradeTx;
          req.dispatchEvent({ type: 'upgradeneeded', oldVersion: 0, newVersion: 1 });
        }
        req.dispatchEvent({ type: 'success' });
      });
      return req;
    },
  };

  Object.defineProperty(globalThis, 'indexedDB', {
    value: factory,
    configurable: true,
    writable: true,
  });
  // `idb` checks `IDBDatabase` / `IDBTransaction` / `IDBObjectStore` / `IDBIndex` / `IDBRequest` prototypes
  class MockIDBCursor {}
  Object.assign(globalThis, {
    IDBDatabase: MockIDBDatabase,
    IDBTransaction: MockTransaction,
    IDBObjectStore: MockObjectStore,
    IDBIndex: MockIndex,
    IDBCursor: MockIDBCursor,
    IDBRequest: MockRequest,
  });

  return {
    storesData,
    setFailNextOpen(v: boolean) {
      failNextOpen = v;
    },
    getOpenAttempts() {
      return openAttempts;
    },
    getActiveDb() {
      return activeDbInstance;
    },
  };
}

async function runTests() {
  // 1. Install mock IndexedDB BEFORE importing cashbookDb
  const idbMock = installMockIndexedDB();
  const dbMod = await import('../src/db/cashbookDb');

  // --- Test Finding 6: IndexedDB connection failure recovery + close/versionchange reset ---
  idbMock.setFailNextOpen(true);
  await assertRejects(
    () => dbMod.getProfiles(),
    'Unable to open local storage database.',
    'Initial openDB failure should reject cleanly'
  );
  // Subsequent call must retry and succeed instead of staying permanently rejected
  const initialProfiles = await dbMod.getProfiles();
  assertDeepEqual(initialProfiles, [], 'Subsequent getProfiles recovers after failed open');
  assertEqual(idbMock.getOpenAttempts(), 2, 'getDb retried after rejected open');

  // Unexpected close resets cached dbPromise so next call opens a new connection
  const dbBeforeClose = idbMock.getActiveDb();
  assert(dbBeforeClose !== null, 'Active DB should exist');
  dbBeforeClose.close();
  await dbMod.getProfiles();
  assertEqual(idbMock.getOpenAttempts(), 3, 'getDb reconnected after close event');

  // versionchange event closes old connection and resets cache cleanly
  const dbBeforeVc = idbMock.getActiveDb();
  dbBeforeVc!.dispatchEvent({ type: 'versionchange' });
  assertEqual(dbBeforeVc!.closed, true, 'versionchange should close old DB connection');
  await dbMod.getProfiles();
  assertEqual(idbMock.getOpenAttempts(), 4, 'getDb reconnected after versionchange');

  // --- Test Finding 1: Profile ownership in deleteCategory and deletePerson ---
  const pA = await dbMod.createProfile('Profile A', null);
  const pB = await dbMod.createProfile('Profile B', null);
  const catsA = await dbMod.getCategories(pA.id);
  const catA = catsA[0];
  assert(Boolean(catA), 'Profile A should have default categories');

  await dbMod.savePerson({
    id: 'person_a1',
    profileId: pA.id,
    name: 'Supervisor A',
    usageCount: 0,
    lastUsedAt: null,
  });

  // Cross-profile category deletion must fail without deleting
  await assertRejects(
    () => dbMod.deleteCategory(catA.id, pB.id),
    'Cannot delete a category from another profile',
    'Cross-profile deleteCategory rejection'
  );
  const catsAAfterFailedDelete = await dbMod.getCategories(pA.id);
  assert(
    catsAAfterFailedDelete.some((c) => c.id === catA.id),
    'Profile A category must remain intact after failed cross-profile deletion'
  );

  // Cross-profile person deletion must fail without deleting
  await assertRejects(
    () => dbMod.deletePerson('person_a1', pB.id),
    'Cannot remove a saved person from another profile',
    'Cross-profile deletePerson rejection'
  );
  const peopleAAfterFailedDelete = await dbMod.getPeople(pA.id);
  assert(
    peopleAAfterFailedDelete.some((p) => p.id === 'person_a1'),
    'Profile A person must remain intact after failed cross-profile deletion'
  );

  // Same-profile deletion succeeds
  await dbMod.deleteCategory(catA.id, pA.id);
  assert(
    !(await dbMod.getCategories(pA.id)).some((c) => c.id === catA.id),
    'Owner deleteCategory should delete category'
  );
  await dbMod.deletePerson('person_a1', pA.id);
  assert(
    !(await dbMod.getPeople(pA.id)).some((p) => p.id === 'person_a1'),
    'Owner deletePerson should delete person'
  );

  // --- Test Finding 2: Strict JSON Backup Validation ---
  const makeValidBackup = () => ({
    schemaVersion: 1,
    appName: 'Folio',
    exportedAt: '2026-11-16T10:00:00.000Z',
    profile: {
      id: 'prof-1',
      name: 'Main Account',
      lastPaymentMode: 'cash',
      lastContext: 'business',
      autoLockMinutes: 5,
      createdAt: '2026-10-01T08:00:00.000Z',
    },
    categories: [
      {
        id: 'cat-1',
        profileId: 'prof-1',
        name: 'Fuel & Vehicle',
        type: 'spent',
        context: 'business',
        isDefault: true,
        isArchived: false,
        usageCount: 1,
        lastUsedAt: null,
      },
    ],
    people: [
      {
        id: 'per-1',
        profileId: 'prof-1',
        name: 'Driver',
        usageCount: 1,
        lastUsedAt: null,
      },
    ],
    transactions: [
      {
        id: 'tx-1',
        profileId: 'prof-1',
        amountPaise: 50000,
        type: 'spent',
        context: 'business',
        categoryId: 'cat-1',
        categoryNameSnapshot: 'Fuel & Vehicle',
        personId: 'per-1',
        personNameSnapshot: 'Driver',
        paymentMode: 'cash',
        date: '2026-11-15',
        time: '12:30',
        notes: 'Diesel',
        createdAt: '2026-11-15T07:00:00.000Z',
        updatedAt: '2026-11-15T07:00:00.000Z',
      },
    ],
  });

  // Valid Folio backup succeeds
  const validRes = await dbMod.validateAndPreviewBackup(makeValidBackup());
  assertEqual(validRes.preview.transactionCount, 1, 'Valid backup preview tx count');

  // Valid older historical Cashbook v1 backup (no appName/autoLockMinutes/isArchived) succeeds
  const olderCashbookBackup = {
    schemaVersion: 1,
    exportedAt: '2025-05-01T09:00:00.000Z',
    profile: {
      id: 'legacy-prof',
      name: 'Cashbook Shop',
      lastPaymentMode: 'cash',
      lastContext: 'business',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    categories: [
      {
        id: 'legacy-cat',
        profileId: 'legacy-prof',
        name: 'Supplies',
        type: 'spent',
        context: 'business',
        isDefault: true,
        usageCount: 1,
        lastUsedAt: null,
      },
    ],
    people: [],
    transactions: [
      {
        id: 'legacy-tx',
        profileId: 'legacy-prof',
        amountPaise: 10000,
        type: 'spent',
        context: 'business',
        categoryId: 'legacy-cat',
        categoryNameSnapshot: 'Supplies',
        personId: null,
        personNameSnapshot: null,
        paymentMode: 'cash',
        date: '2025-05-01',
        time: '09:00',
        notes: '',
        createdAt: '2025-05-01T03:30:00.000Z',
        updatedAt: '2025-05-01T03:30:00.000Z',
      },
    ],
  };
  const legacyRes = await dbMod.validateAndPreviewBackup(olderCashbookBackup);
  assertEqual(legacyRes.payload.profile.autoLockMinutes, 5, 'Older backup defaults autoLockMinutes to 5');

  // Duplicate category IDs rejected
  const dupCatBackup = makeValidBackup();
  dupCatBackup.categories.push({ ...dupCatBackup.categories[0], name: 'Other Fuel' });
  await assertRejects(
    () => dbMod.validateAndPreviewBackup(dupCatBackup),
    'Duplicate category ID',
    'Duplicate category IDs'
  );

  // Duplicate person IDs rejected
  const dupPersonBackup = makeValidBackup();
  dupPersonBackup.people.push({ ...dupPersonBackup.people[0], name: 'Helper' });
  await assertRejects(
    () => dbMod.validateAndPreviewBackup(dupPersonBackup),
    'Duplicate person ID',
    'Duplicate person IDs'
  );

  // Invalid / non-finite / negative / unsupported autoLockMinutes rejected
  for (const badAutoLock of [NaN, Infinity, -5, 2.5, 99, '5']) {
    const b = makeValidBackup() as Record<string, unknown>;
    (b.profile as Record<string, unknown>).autoLockMinutes = badAutoLock;
    await assertRejects(
      () => dbMod.validateAndPreviewBackup(b),
      'auto-lock duration',
      `Invalid autoLockMinutes (${String(badAutoLock)})`
    );
  }

  // Missing category reference in transaction rejected
  const missingCatTxBackup = makeValidBackup();
  missingCatTxBackup.transactions[0].categoryId = 'non-existent-cat';
  await assertRejects(
    () => dbMod.validateAndPreviewBackup(missingCatTxBackup),
    'category that does not exist',
    'Missing transaction category reference'
  );

  // Inconsistent category type/context vs transaction rejected
  const mismatchTypeTxBackup = makeValidBackup();
  mismatchTypeTxBackup.transactions[0].type = 'received';
  await assertRejects(
    () => dbMod.validateAndPreviewBackup(mismatchTypeTxBackup),
    'inconsistent with its category',
    'Transaction type/context conflict with category'
  );

  // Mismatched profileId on category/person/transaction rejected
  const badCatProfileBackup = makeValidBackup();
  badCatProfileBackup.categories[0].profileId = 'other-prof';
  await assertRejects(
    () => dbMod.validateAndPreviewBackup(badCatProfileBackup),
    'mismatched profile reference',
    'Category mismatched profileId'
  );

  const badTxProfileBackup = makeValidBackup();
  badTxProfileBackup.transactions[0].profileId = 'other-prof';
  await assertRejects(
    () => dbMod.validateAndPreviewBackup(badTxProfileBackup),
    'mismatched profile reference',
    'Transaction mismatched profileId'
  );

  // --- Test Finding 3: Backup Import File-Size Limit (25 MB) ---
  let textCalled = false;
  const oversizedFile = {
    size: MAX_BACKUP_FILE_BYTES + 1,
    text: async () => {
      textCalled = true;
      return '{}';
    },
  };
  let sizeRejected = false;
  try {
    assertBackupFileWithinLimit(oversizedFile);
  } catch (err) {
    sizeRejected = true;
    assert(
      err instanceof Error && err.message.includes('25 MB'),
      'Oversized file error should mention 25 MB limit'
    );
  }
  assert(sizeRejected, 'Oversized file must be rejected');
  assertEqual(textCalled, false, 'file.text() must never be called for oversized files');
  assertBackupFileWithinLimit({ size: MAX_BACKUP_FILE_BYTES }); // Exact 25 MB allowed

  // --- Test Finding 4: Require Web Crypto for new PINs, preserve verification ---
  const pbkdf2Hash = await hashPin('4826');
  assert(pbkdf2Hash.startsWith('pbkdf2_v1$'), 'hashPin creates PBKDF2 hash');
  assertEqual((await verifyPin('4826', pbkdf2Hash)).valid, true, 'PBKDF2 valid PIN');
  assertEqual((await verifyPin('0000', pbkdf2Hash)).valid, false, 'PBKDF2 invalid PIN');

  // Legacy SHA-256 hash verification + lazy migration flag
  const legacyDigest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('cashbook_v1:2468')
  );
  const legacyShaHash = Array.from(new Uint8Array(legacyDigest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const legacyGood = await verifyPin('2468', legacyShaHash);
  assertEqual(legacyGood.valid, true, 'Legacy SHA-256 valid PIN');
  assertEqual(legacyGood.needsMigration, true, 'Legacy SHA-256 triggers migration when WebCrypto available');
  assertEqual((await verifyPin('9999', legacyShaHash)).valid, false, 'Legacy SHA-256 invalid PIN');

  // Simulate unsupported Web Crypto context: new PIN creation MUST fail clearly
  const originalCrypto = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });
    await assertRejects(
      () => hashPin('1234'),
      'HTTPS or on localhost',
      'hashPin must reject when Web Crypto is unavailable'
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
    });
  }

  // --- Test Finding 5: History Person-Filter Deduplication ---
  const people: Person[] = [
    { id: 'pid-ramesh', profileId: 'p1', name: 'Ramesh', usageCount: 2, lastUsedAt: null },
    { id: 'pid-suresh', profileId: 'p1', name: 'Suresh Kumar', usageCount: 1, lastUsedAt: null },
  ];
  const personTxs: Transaction[] = [
    {
      id: 'pt1', profileId: 'p1', amountPaise: 1000, type: 'spent', context: 'business',
      categoryId: 'c1', categoryNameSnapshot: 'Labour Payment',
      personId: 'pid-ramesh', personNameSnapshot: 'Ramesh',
      paymentMode: 'cash', date: '2026-11-10', time: '09:00', notes: '',
      createdAt: '2026-11-10T03:30:00Z', updatedAt: '2026-11-10T03:30:00Z',
    },
    {
      id: 'pt2', profileId: 'p1', amountPaise: 2000, type: 'spent', context: 'business',
      categoryId: 'c1', categoryNameSnapshot: 'Labour Payment',
      personId: null, personNameSnapshot: '  ramesh ',
      paymentMode: 'cash', date: '2026-11-11', time: '10:00', notes: '',
      createdAt: '2026-11-11T04:30:00Z', updatedAt: '2026-11-11T04:30:00Z',
    },
    {
      id: 'pt3', profileId: 'p1', amountPaise: 3000, type: 'spent', context: 'business',
      categoryId: 'c1', categoryNameSnapshot: 'Labour Payment',
      personId: null, personNameSnapshot: 'Ramesh Kumar',
      paymentMode: 'online', date: '2026-11-12', time: '11:00', notes: '',
      createdAt: '2026-11-12T05:30:00Z', updatedAt: '2026-11-12T05:30:00Z',
    },
    {
      id: 'pt4', profileId: 'p1', amountPaise: 4000, type: 'spent', context: 'business',
      categoryId: 'c1', categoryNameSnapshot: 'Labour Payment',
      personId: null, personNameSnapshot: '  Vikram ',
      paymentMode: 'cash', date: '2026-11-13', time: '12:00', notes: '',
      createdAt: '2026-11-13T06:30:00Z', updatedAt: '2026-11-13T06:30:00Z',
    },
    {
      id: 'pt5', profileId: 'p1', amountPaise: 5000, type: 'spent', context: 'business',
      categoryId: 'c1', categoryNameSnapshot: 'Labour Payment',
      personId: null, personNameSnapshot: 'vikram',
      paymentMode: 'online', date: '2026-11-14', time: '13:00', notes: '',
      createdAt: '2026-11-14T07:30:00Z', updatedAt: '2026-11-14T07:30:00Z',
    },
  ];

  const options = buildPersonFilterOptions(people, personTxs);
  // Expect exactly 4 unique people: Ramesh, Ramesh Kumar, Suresh Kumar, Vikram
  assertEqual(options.length, 4, 'Deduplicated person options count');
  assertDeepEqual(
    options.map((o) => o.name),
    ['Ramesh', 'Ramesh Kumar', 'Suresh Kumar', 'Vikram'],
    'Deduplicated person option labels'
  );

  const baseFilter: TransactionFilter = {
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

  // Selecting saved Ramesh matches both saved pt1 and ad-hoc pt2, NOT pt3 (Ramesh Kumar)
  const rameshOpt = options.find((o) => o.name === 'Ramesh')!;
  const rameshMatches = filterTransactions(
    personTxs,
    { ...baseFilter, personId: rameshOpt.id },
    people
  );
  assertDeepEqual(
    rameshMatches.map((t) => t.id),
    ['pt2', 'pt1'],
    'Saved Ramesh matches both saved and ad-hoc normalized Ramesh entries'
  );

  // Selecting ad-hoc Vikram matches both '  Vikram ' and 'vikram'
  const vikramOpt = options.find((o) => o.name === 'Vikram')!;
  const vikramMatches = filterTransactions(
    personTxs,
    { ...baseFilter, personId: vikramOpt.id },
    people
  );
  assertDeepEqual(
    vikramMatches.map((t) => t.id),
    ['pt5', 'pt4'],
    'Ad-hoc Vikram matches case/whitespace variants'
  );

  // --- Test Finding 7: CSV Decimal Formatting Edge Cases ---
  assertEqual(formatPaiseDecimal(0), '0.00', 'zero paise');
  assertEqual(formatPaiseDecimal(-0), '0.00', 'negative zero paise');
  assertEqual(formatPaiseDecimal(50), '0.50', 'positive < 1 rupee');
  assertEqual(formatPaiseDecimal(1050), '10.50', 'positive decimal paise');
  assertEqual(formatPaiseDecimal(-50), '-0.50', 'negative < 1 rupee');
  assertEqual(formatPaiseDecimal(-1), '-0.01', 'negative 1 paisa');
  assertEqual(formatPaiseDecimal(-100), '-1.00', 'negative exact rupee');
  assertEqual(formatPaiseDecimal(-1050), '-10.50', 'negative decimal paise');

  const csv = transactionsToCsv([personTxs[0]]);
  assert(csv.includes(',10.00,'), 'CSV serializes paise decimal cleanly');

  console.log('ALL_STAGE_1B_TESTS_PASSED');
}

let testsCompleted = false;
process.on('exit', (code) => {
  if (code === 0 && !testsCompleted) {
    console.error('Test runner exited before runTests() completed (unresolved promise).');
    process.exit(1);
  }
});

runTests()
  .then(() => {
    testsCompleted = true;
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
