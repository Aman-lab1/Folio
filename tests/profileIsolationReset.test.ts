import { verifyPin } from '../src/utils/currency';
import type { Category, Person, Profile, Transaction } from '../src/types/cashbook';

let testsCompleted = false;
process.on('exit', (code) => {
  if (!testsCompleted && code === 0) {
    console.error('Test runner exited before runTests() completed (unresolved promise).');
    process.exit(1);
  }
});

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

// ACID-aware in-memory IDBFactory shim compatible with `idb` v8, supporting:
// - pending request tracking & macrotask auto-commit
// - write-transaction snapshots with rollback on abort() or error
// - deterministic delete failure injection for atomicity testing
function installTransactionalMockIndexedDB() {
  type RecordValue = Record<string, unknown>;
  let storesData = new Map<string, Map<string, RecordValue>>();
  let deleteCallCount = 0;
  let failOnDeleteCall: number | null = null;

  function cloneStores(
    source: Map<string, Map<string, RecordValue>>
  ): Map<string, Map<string, RecordValue>> {
    const copy = new Map<string, Map<string, RecordValue>>();
    for (const [storeName, records] of source.entries()) {
      const storeCopy = new Map<string, RecordValue>();
      for (const [k, v] of records.entries()) {
        storeCopy.set(k, structuredClone(v));
      }
      copy.set(storeName, storeCopy);
    }
    return copy;
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
      for (const cb of [...(this.listeners.get(ev.type) ?? [])]) {
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

  function runTxRequest<T>(
    tx: MockTransaction,
    executor: (req: MockRequest<T>) => void
  ): MockRequest<T> {
    if (tx.finished) {
      const err = new Error('Transaction has finished');
      err.name = 'TransactionInactiveError';
      throw err;
    }
    tx.pendingRequests += 1;
    const req = new MockRequest<T>();
    req.transaction = tx;
    queueMicrotask(() => {
      try {
        if (tx.finished) {
          const abortErr = new Error('Transaction aborted');
          abortErr.name = 'AbortError';
          req.fail(abortErr);
        } else {
          executor(req);
        }
      } finally {
        tx.pendingRequests -= 1;
        tx.maybeComplete();
      }
    });
    return req;
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
      return runTxRequest<RecordValue[]>(this.tx, (req) => {
        const map = storesData.get(this.storeName) ?? new Map();
        const rows = Array.from(map.values())
          .filter((v) => (query === undefined ? true : this.matches(v, query)))
          .map((v) => structuredClone(v));
        req.succeed(rows);
      });
    }
    getAllKeys(query?: unknown) {
      return runTxRequest<string[]>(this.tx, (req) => {
        const map = storesData.get(this.storeName) ?? new Map();
        const keys = Array.from(map.entries())
          .filter(([, v]) => (query === undefined ? true : this.matches(v, query)))
          .map(([k]) => k);
        req.succeed(keys);
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
      return runTxRequest<RecordValue | undefined>(this.tx, (req) => {
        const map = storesData.get(this.name) ?? new Map();
        const val = map.get(key);
        req.succeed(val ? structuredClone(val) : undefined);
      });
    }
    getAll() {
      return runTxRequest<RecordValue[]>(this.tx, (req) => {
        const map = storesData.get(this.name) ?? new Map();
        req.succeed(Array.from(map.values()).map((v) => structuredClone(v)));
      });
    }
    put(val: RecordValue) {
      return runTxRequest<string>(this.tx, (req) => {
        let map = storesData.get(this.name);
        if (!map) {
          map = new Map();
          storesData.set(this.name, map);
        }
        const key = String(val.id);
        map.set(key, structuredClone(val));
        req.succeed(key);
      });
    }
    delete(key: string) {
      return runTxRequest<undefined>(this.tx, (req) => {
        deleteCallCount += 1;
        if (failOnDeleteCall !== null && deleteCallCount === failOnDeleteCall) {
          failOnDeleteCall = null;
          const err = new Error('Simulated mid-transaction IndexedDB delete error');
          err.name = 'UnknownError';
          this.tx.error = err;
          req.fail(err);
          return;
        }
        const map = storesData.get(this.name);
        map?.delete(key);
        req.succeed(undefined);
      });
    }
    clear() {
      return runTxRequest<undefined>(this.tx, (req) => {
        storesData.get(this.name)?.clear();
        req.succeed(undefined);
      });
    }
  }

  class MockTransaction extends MockEventTarget {
    objectStoreNames: string[];
    pendingRequests = 0;
    finished = false;
    error: Error | null = null;
    private snapshot: Map<string, Map<string, RecordValue>> | null;
    private completeTimer: ReturnType<typeof setTimeout> | null = null;
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
      this.snapshot =
        mode === 'readwrite' || mode === 'versionchange'
          ? cloneStores(storesData)
          : null;
      this.maybeComplete();
    }
    objectStore(name: string) {
      return new MockObjectStore(name, this);
    }
    abort() {
      if (this.finished) return;
      this.finished = true;
      if (this.completeTimer !== null) {
        clearTimeout(this.completeTimer);
        this.completeTimer = null;
      }
      if (this.snapshot) {
        storesData = this.snapshot;
      }
      this.dispatchEvent({ type: 'abort' });
    }
    maybeComplete() {
      if (this.finished || this.pendingRequests > 0) {
        if (this.completeTimer !== null && this.pendingRequests > 0) {
          clearTimeout(this.completeTimer);
          this.completeTimer = null;
        }
        return;
      }
      if (this.completeTimer !== null) return;
      this.completeTimer = setTimeout(() => {
        this.completeTimer = null;
        if (!this.finished && this.pendingRequests === 0) {
          this.finished = true;
          this.dispatchEvent({ type: 'complete' });
        }
      }, 0);
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
      const req = new MockOpenRequest();
      queueMicrotask(() => {
        const db = new MockIDBDatabase();
        for (const n of storesData.keys()) {
          db.objectStoreNames._names.add(n);
        }
        req.result = db;
        if (storesData.size === 0) {
          const upgradeTx = new MockTransaction([], 'versionchange', db);
          req.transaction = upgradeTx;
          req.dispatchEvent({ type: 'upgradeneeded', oldVersion: 0, newVersion: 1 });
          upgradeTx.maybeComplete();
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
    getStoresSnapshot() {
      return cloneStores(storesData);
    },
    setFailOnDeleteCall(nthDelete: number | null) {
      deleteCallCount = 0;
      failOnDeleteCall = nthDelete;
    },
  };
}

async function runTests() {
  const idbMock = installTransactionalMockIndexedDB();
  const db = await import('../src/db/cashbookDb');

  // 1. Create 3 isolated profiles with distinct PINs and settings
  const profileA = await db.createProfile('Alpha Business', '1111');
  const profileB = await db.createProfile('Beta Ventures', '2222');
  const profileC = await db.createProfile('Gamma Personal', '3333');

  const updatedProfileA: Profile = {
    ...profileA,
    autoLockMinutes: 15,
    lastPaymentMode: 'online',
    lastContext: 'personal',
  };
  await db.updateProfile(updatedProfileA);

  const updatedProfileB: Profile = {
    ...profileB,
    autoLockMinutes: 30,
    lastPaymentMode: 'cash',
    lastContext: 'business',
  };
  await db.updateProfile(updatedProfileB);

  // 2. Add custom categories (with overlapping names across profiles), saved people (with overlapping names), and transactions to all 3 profiles
  const sharedCatA: Category = {
    id: 'cat-shared-a',
    profileId: profileA.id,
    name: 'Shared Vendor Expense',
    type: 'spent',
    context: 'business',
    isDefault: false,
    isArchived: false,
    usageCount: 0,
    lastUsedAt: null,
  };
  const sharedCatB: Category = {
    id: 'cat-shared-b',
    profileId: profileB.id,
    name: 'Shared Vendor Expense',
    type: 'spent',
    context: 'business',
    isDefault: false,
    isArchived: false,
    usageCount: 0,
    lastUsedAt: null,
  };
  const sharedCatC: Category = {
    id: 'cat-shared-c',
    profileId: profileC.id,
    name: 'Shared Vendor Expense',
    type: 'spent',
    context: 'business',
    isDefault: false,
    isArchived: false,
    usageCount: 0,
    lastUsedAt: null,
  };
  await Promise.all([
    db.saveCategory(sharedCatA),
    db.saveCategory(sharedCatB),
    db.saveCategory(sharedCatC),
  ]);

  const personA: Person = {
    id: 'person-shared-a',
    profileId: profileA.id,
    name: 'Shared Worker',
    roleNote: 'Profile A Driver',
    usageCount: 0,
    lastUsedAt: null,
  };
  const personB: Person = {
    id: 'person-shared-b',
    profileId: profileB.id,
    name: 'Shared Worker',
    roleNote: 'Profile B Contractor',
    usageCount: 0,
    lastUsedAt: null,
  };
  const personC: Person = {
    id: 'person-shared-c',
    profileId: profileC.id,
    name: 'Shared Worker',
    roleNote: 'Profile C Helper',
    usageCount: 0,
    lastUsedAt: null,
  };
  await Promise.all([
    db.savePerson(personA),
    db.savePerson(personB),
    db.savePerson(personC),
  ]);

  await db.saveTransaction({
    profileId: profileA.id,
    amountPaise: 250000,
    type: 'spent',
    context: 'business',
    categoryId: sharedCatA.id,
    categoryNameSnapshot: sharedCatA.name,
    personId: personA.id,
    personNameSnapshot: personA.name,
    paymentMode: 'cash',
    date: '2026-11-10',
    time: '10:30',
    notes: 'Profile A entry 1',
  });
  await db.saveTransaction({
    profileId: profileA.id,
    amountPaise: 120000,
    type: 'spent',
    context: 'business',
    categoryId: sharedCatA.id,
    categoryNameSnapshot: sharedCatA.name,
    personId: null,
    personNameSnapshot: null,
    paymentMode: 'online',
    date: '2026-11-11',
    time: '14:00',
    notes: 'Profile A entry 2',
  });

  await db.saveTransaction({
    profileId: profileB.id,
    amountPaise: 850000,
    type: 'spent',
    context: 'business',
    categoryId: sharedCatB.id,
    categoryNameSnapshot: sharedCatB.name,
    personId: personB.id,
    personNameSnapshot: personB.name,
    paymentMode: 'online',
    date: '2026-11-12',
    time: '09:15',
    notes: 'Profile B protected entry',
  });

  await db.saveTransaction({
    profileId: profileC.id,
    amountPaise: 45000,
    type: 'spent',
    context: 'business',
    categoryId: sharedCatC.id,
    categoryNameSnapshot: sharedCatC.name,
    personId: personC.id,
    personNameSnapshot: personC.name,
    paymentMode: 'cash',
    date: '2026-11-13',
    time: '17:45',
    notes: 'Profile C protected entry',
  });

  const beforeProfileBCats = await db.getCategories(profileB.id);
  const beforeProfileBPeople = await db.getPeople(profileB.id);
  const beforeProfileBTxs = await db.getTransactions(profileB.id);
  const beforeProfileCCats = await db.getCategories(profileC.id);
  const beforeProfileCPeople = await db.getPeople(profileC.id);
  const beforeProfileCTxs = await db.getTransactions(profileC.id);
  const beforeProfileACounts = {
    cats: (await db.getCategories(profileA.id)).length,
    people: (await db.getPeople(profileA.id)).length,
    txs: (await db.getTransactions(profileA.id)).length,
  };
  assert(beforeProfileACounts.cats > 0, 'Profile A should have categories before reset');
  assertEqual(beforeProfileACounts.people, 1, 'Profile A should have 1 person before reset');
  assertEqual(beforeProfileACounts.txs, 2, 'Profile A should have 2 transactions before reset');

  // 3. Invalid / empty / non-existent profile IDs must reject cleanly with zero side effects
  await assertRejects(
    () => db.resetProfileData(''),
    'valid active profile ID is required',
    'Empty profile ID rejected'
  );
  await assertRejects(
    () => db.resetProfileData('   '),
    'valid active profile ID is required',
    'Whitespace profile ID rejected'
  );
  await assertRejects(
    () => db.resetProfileData('non-existent-profile-id'),
    'Active profile does not exist',
    'Non-existent profile ID rejected'
  );

  // 4. Mid-transaction delete failure must abort & roll back atomically without partial deletion
  idbMock.setFailOnDeleteCall(3);
  await assertRejects(
    () => db.resetProfileData(profileA.id),
    'Unable to delete active profile data',
    'Mid-transaction delete failure rejects'
  );
  assertEqual(
    (await db.getCategories(profileA.id)).length,
    beforeProfileACounts.cats,
    'Profile A categories rolled back after mid-transaction error'
  );
  assertEqual(
    (await db.getPeople(profileA.id)).length,
    beforeProfileACounts.people,
    'Profile A people rolled back after mid-transaction error'
  );
  assertEqual(
    (await db.getTransactions(profileA.id)).length,
    beforeProfileACounts.txs,
    'Profile A transactions rolled back after mid-transaction error'
  );

  // 5. Execute profile-scoped reset for Profile A
  await db.resetProfileData(profileA.id);

  // Verify Profile A's financial data is completely deleted
  assertEqual((await db.getTransactions(profileA.id)).length, 0, 'Profile A transactions deleted');
  assertEqual((await db.getCategories(profileA.id)).length, 0, 'Profile A categories deleted');
  assertEqual((await db.getPeople(profileA.id)).length, 0, 'Profile A people deleted');

  // Verify Profile A's profile record, settings, and PIN lock remain intact
  const profilesAfterReset = await db.getProfiles();
  assertEqual(profilesAfterReset.length, 3, 'All 3 profile records preserved');
  const reloadedA = profilesAfterReset.find((p) => p.id === profileA.id);
  assert(Boolean(reloadedA), 'Profile A record preserved');
  assertEqual(reloadedA!.name, 'Alpha Business', 'Profile A name preserved');
  assertEqual(reloadedA!.autoLockMinutes, 15, 'Profile A autoLockMinutes preserved');
  assert(Boolean(reloadedA!.pinHash), 'Profile A PIN hash preserved');
  assertEqual((await verifyPin('1111', reloadedA!.pinHash!)).valid, true, 'Profile A PIN still verifies');

  // Verify Profiles B and C remain 100% untouched (deep equality)
  const reloadedB = profilesAfterReset.find((p) => p.id === profileB.id)!;
  const reloadedC = profilesAfterReset.find((p) => p.id === profileC.id)!;
  assertEqual(reloadedB.name, 'Beta Ventures', 'Profile B name preserved');
  assertEqual(reloadedB.autoLockMinutes, 30, 'Profile B settings preserved');
  assertEqual((await verifyPin('2222', reloadedB.pinHash!)).valid, true, 'Profile B PIN still verifies');
  assertEqual((await verifyPin('3333', reloadedC.pinHash!)).valid, true, 'Profile C PIN still verifies');

  assertDeepEqual(
    await db.getCategories(profileB.id),
    beforeProfileBCats,
    'Profile B categories untouched'
  );
  assertDeepEqual(
    await db.getPeople(profileB.id),
    beforeProfileBPeople,
    'Profile B people untouched'
  );
  assertDeepEqual(
    await db.getTransactions(profileB.id),
    beforeProfileBTxs,
    'Profile B transactions untouched'
  );

  assertDeepEqual(
    await db.getCategories(profileC.id),
    beforeProfileCCats,
    'Profile C categories untouched'
  );
  assertDeepEqual(
    await db.getPeople(profileC.id),
    beforeProfileCPeople,
    'Profile C people untouched'
  );
  assertDeepEqual(
    await db.getTransactions(profileC.id),
    beforeProfileCTxs,
    'Profile C transactions untouched'
  );

  // 6. Verify Profile B backup export & restore still work cleanly
  const backupB = await db.exportProfileBackup(profileB.id);
  const previewB = await db.validateAndPreviewBackup(backupB);
  assertEqual(previewB.preview.transactionCount, 1, 'Profile B backup intact & valid');
  const restoredB = await db.restoreBackupPayload(backupB, 'new_profile');
  assertEqual(restoredB.importedTxCount, 1, 'Restoring Profile B backup succeeds');
  assertEqual((await db.getTransactions(restoredB.profile.id)).length, 1, 'Restored profile has 1 tx');

  // 7. Verify new profile creation & saving new entries on Profile A after reset work cleanly
  const profileD = await db.createProfile('Delta Branch', null);
  assert((await db.getCategories(profileD.id)).length > 0, 'New profile gets default categories');
  const freshCatA: Category = {
    id: 'cat-fresh-a',
    profileId: profileA.id,
    name: 'Fresh Expense',
    type: 'spent',
    context: 'business',
    isDefault: false,
    isArchived: false,
    usageCount: 0,
    lastUsedAt: null,
  };
  await db.saveCategory(freshCatA);
  await db.saveTransaction({
    profileId: profileA.id,
    amountPaise: 50000,
    type: 'spent',
    context: 'business',
    categoryId: freshCatA.id,
    categoryNameSnapshot: freshCatA.name,
    personId: null,
    personNameSnapshot: null,
    paymentMode: 'cash',
    date: '2026-11-17',
    time: '12:00',
    notes: 'Fresh post-reset entry',
  });
  assertEqual((await db.getTransactions(profileA.id)).length, 1, 'Profile A accepts new data post-reset');

  // 8. Verify permanent deleteProfile remains distinct & deletes only target profile + its data
  await db.deleteProfile(profileC.id);
  const profilesAfterDeleteC = await db.getProfiles();
  assert(!profilesAfterDeleteC.some((p) => p.id === profileC.id), 'Profile C record deleted permanently');
  assertEqual((await db.getTransactions(profileC.id)).length, 0, 'Profile C transactions deleted');
  assertEqual((await db.getCategories(profileC.id)).length, 0, 'Profile C categories deleted');
  assertEqual((await db.getPeople(profileC.id)).length, 0, 'Profile C people deleted');
  assertDeepEqual(
    await db.getTransactions(profileB.id),
    beforeProfileBTxs,
    'Profile B still untouched after deleting Profile C'
  );

  // 8b. Duplicate profile name prevention (case-insensitive, trimmed whitespace)
  const uniqueBiz = await db.createProfile('Business');
  await assertRejects(
    () => db.createProfile('business'),
    'already exists',
    'createProfile rejects lowercase duplicate'
  );
  await assertRejects(
    () => db.createProfile(' Business '),
    'already exists',
    'createProfile rejects whitespace-padded duplicate'
  );
  await assertRejects(
    () => db.updateProfile({ ...profileA, name: '  BUSINESS  ' }),
    'already exists',
    'updateProfile rejects renaming to another profile name'
  );
  const profilesBeforeReset = await db.getProfiles();
  assert(
    profilesBeforeReset.some((p) => p.id === uniqueBiz.id && p.name === 'Business'),
    'Existing Business profile preserved unchanged'
  );

  // 9. Verify resetAllAppData remains distinct & wipes everything when explicitly invoked
  await db.resetAllAppData();
  const finalSnapshot = idbMock.getStoresSnapshot();
  assertEqual(finalSnapshot.get('profiles')?.size ?? 0, 0, 'resetAllAppData clears all profiles');
  assertEqual(finalSnapshot.get('categories')?.size ?? 0, 0, 'resetAllAppData clears all categories');
  assertEqual(finalSnapshot.get('people')?.size ?? 0, 0, 'resetAllAppData clears all people');
  assertEqual(finalSnapshot.get('transactions')?.size ?? 0, 0, 'resetAllAppData clears all transactions');

  testsCompleted = true;
  console.log('ALL_PROFILE_ISOLATION_RESET_TESTS_PASSED');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
