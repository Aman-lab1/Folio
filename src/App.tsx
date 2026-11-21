import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createProfile,
  deleteCategory,
  deletePerson,
  deleteProfile,
  deleteTransaction,
  exportProfileBackup,
  getCategories,
  getCategoryUsageCount,
  getPeople,
  getProfiles,
  getTransactions,
  renameCategory,
  resetProfileData,
  restoreBackupPayload,
  saveCategory,
  savePerson,
  saveTransaction,
  SaveTransactionInput,
  setCategoryArchived,
  updateProfile,
  validateAndPreviewBackup,
} from './db/cashbookDb';
import {
  AppTab,
  BackupPreview,
  Category,
  Person,
  PersonClassification,
  Profile,
  Transaction,
  TransactionContext,
  TransactionType,
} from './types/cashbook';
import { generateId, getTodayDateStr } from './utils/currency';
import { transactionsToCsv } from './utils/calculations';
import { TopBar } from './components/TopBar';
import { BottomNav } from './components/BottomNav';
import { HomeDashboard } from './components/HomeDashboard';
import { HistoryView } from './components/HistoryView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { QuickEntryDraft, QuickEntryModal } from './components/QuickEntryModal';
import { PinLockScreen } from './components/PinLockScreen';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ToastMessage, ToastNotification } from './components/ToastNotification';

const LAST_PROFILE_KEY = 'cashbook_last_profile_id';
export const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;

export function assertBackupFileWithinLimit(file: Pick<File, 'size'>): void {
  if (file.size > MAX_BACKUP_FILE_BYTES) {
    throw new Error(
      'Backup file is too large (maximum supported size is 25 MB).'
    );
  }
}

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [bootError, setBootError] = useState('');

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [unlockedProfileId, setUnlockedProfileId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [quickEntryDraft, setQuickEntryDraft] = useState<QuickEntryDraft | null>(null);

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const profileLoadSeqRef = useRef(0);
  const toastSeqRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    const id = ++toastSeqRef.current;
    setToast({ id, text, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
      toastTimerRef.current = null;
    }, tone === 'error' ? 3800 : 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const loadProfileData = useCallback(async (profileId: string): Promise<boolean> => {
    const requestId = ++profileLoadSeqRef.current;
    const [cats, ppl, txs] = await Promise.all([
      getCategories(profileId),
      getPeople(profileId),
      getTransactions(profileId),
    ]);
    if (profileLoadSeqRef.current !== requestId) {
      return false;
    }
    setCategories(cats);
    setPeople(ppl);
    setTransactions(txs);
    return true;
  }, []);

  // Initial IndexedDB hydration
  useEffect(() => {
    let mounted = true;
    const bootSeq = ++profileLoadSeqRef.current;
    (async () => {
      try {
        const list = await getProfiles();
        if (!mounted || profileLoadSeqRef.current !== bootSeq) return;
        setProfiles(list);

        if (list.length > 0) {
          const savedId = localStorage.getItem(LAST_PROFILE_KEY);
          const initial = list.find((p) => p.id === savedId) || list[0];
          setSelectedProfileId(initial.id);
          localStorage.setItem(LAST_PROFILE_KEY, initial.id);
          if (!initial.pinHash) {
            const loaded = await loadProfileData(initial.id);
            if (!mounted || !loaded) return;
            setUnlockedProfileId(initial.id);
          }
        }
      } catch (err) {
        if (!mounted) return;
        setBootError(
          err instanceof Error
            ? err.message
            : 'Unable to open local storage database.'
        );
      } finally {
        if (mounted) setIsBooting(false);
      }
    })();

    return () => {
      mounted = false;
      profileLoadSeqRef.current += 1;
    };
  }, [loadProfileData]);

  const lockSession = useCallback(() => {
    profileLoadSeqRef.current += 1;
    // Lock session without discarding quickEntryDraft or isEntryModalOpen
    setUnlockedProfileId(null);
    setCategories([]);
    setPeople([]);
    setTransactions([]);
  }, []);

  const activeProfile =
    profiles.find((p) => p.id === selectedProfileId) ?? null;

  const isUnlocked =
    Boolean(activeProfile) &&
    (!activeProfile?.pinHash || unlockedProfileId === activeProfile?.id);

  // Inactivity & background visibility auto-lock when PIN protection is enabled
  useEffect(() => {
    if (!isUnlocked || !activeProfile?.pinHash) return;

    const lockMinutes = activeProfile.autoLockMinutes ?? 5;
    if (lockMinutes <= 0) return;

    const timeoutMs = lockMinutes * 60_000;
    lastActivityRef.current = Date.now();

    const recordActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const checkInactivity = () => {
      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        lockSession();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkInactivity();
      }
    };

    window.addEventListener('pointerdown', recordActivity, { passive: true });
    window.addEventListener('keydown', recordActivity, { passive: true });
    window.addEventListener('touchstart', recordActivity, { passive: true });
    window.addEventListener('scroll', recordActivity, { passive: true });
    window.addEventListener('focus', checkInactivity);
    document.addEventListener('visibilitychange', handleVisibility);

    const intervalId = window.setInterval(checkInactivity, 10_000);

    return () => {
      window.removeEventListener('pointerdown', recordActivity);
      window.removeEventListener('keydown', recordActivity);
      window.removeEventListener('touchstart', recordActivity);
      window.removeEventListener('scroll', recordActivity);
      window.removeEventListener('focus', checkInactivity);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [isUnlocked, activeProfile, lockSession]);

  const handleSelectProfile = useCallback(
    async (profileId: string) => {
      const selectSeq = ++profileLoadSeqRef.current;
      setUnlockedProfileId(null);
      setCategories([]);
      setPeople([]);
      setTransactions([]);
      if (profileId !== selectedProfileId) {
        setIsEntryModalOpen(false);
        setEditingTransaction(null);
        setQuickEntryDraft(null);
        setActiveTab('home');
      }
      setSelectedProfileId(profileId);
      localStorage.setItem(LAST_PROFILE_KEY, profileId);
      const target = profiles.find((p) => p.id === profileId);
      if (target && !target.pinHash) {
        try {
          const loaded = await loadProfileData(target.id);
          if (!loaded || profileLoadSeqRef.current < selectSeq) return;
          lastActivityRef.current = Date.now();
          setUnlockedProfileId(target.id);
        } catch (err) {
          if (profileLoadSeqRef.current >= selectSeq) {
            showToast(
              err instanceof Error ? err.message : 'Unable to load profile data.',
              'error'
            );
          }
        }
      }
    },
    [profiles, selectedProfileId, loadProfileData, showToast]
  );

  const handleUnlock = useCallback(
    async (profileId: string, upgradedPinHash?: string) => {
      const unlockSeq = ++profileLoadSeqRef.current;
      if (upgradedPinHash) {
        const target = profiles.find((p) => p.id === profileId);
        if (target) {
          const migrated: Profile = { ...target, pinHash: upgradedPinHash };
          try {
            await updateProfile(migrated);
            if (profileLoadSeqRef.current !== unlockSeq) return;
            setProfiles((prev) =>
              prev.map((p) => (p.id === profileId ? migrated : p))
            );
          } catch {
            // Do not block unlock if silent hash upgrade fails; next login retries
          }
        }
      }
      if (profileLoadSeqRef.current !== unlockSeq) return;
      const loaded = await loadProfileData(profileId);
      if (!loaded) return;
      lastActivityRef.current = Date.now();
      setSelectedProfileId(profileId);
      setUnlockedProfileId(profileId);
      localStorage.setItem(LAST_PROFILE_KEY, profileId);
    },
    [profiles, loadProfileData]
  );

  const handleCreateProfile = useCallback(
    async (name: string, pin: string | null) => {
      const createSeq = ++profileLoadSeqRef.current;
      const created = await createProfile(name, pin);
      if (profileLoadSeqRef.current !== createSeq) return;
      const updatedList = await getProfiles();
      if (profileLoadSeqRef.current !== createSeq) return;
      setProfiles(updatedList);
      setIsEntryModalOpen(false);
      setEditingTransaction(null);
      setQuickEntryDraft(null);
      setSelectedProfileId(created.id);
      localStorage.setItem(LAST_PROFILE_KEY, created.id);
      const loaded = await loadProfileData(created.id);
      if (!loaded) return;
      lastActivityRef.current = Date.now();
      setUnlockedProfileId(created.id);
      showToast(`Account "${created.name}" created`);
    },
    [loadProfileData, showToast]
  );

  const handleUpdateProfile = useCallback(
    async (updated: Profile) => {
      await updateProfile(updated);
      const list = await getProfiles();
      setProfiles(list);
    },
    []
  );

  const handleDeleteProfile = useCallback(
    async (profileId: string) => {
      const deleteSeq = ++profileLoadSeqRef.current;
      setUnlockedProfileId(null);
      setCategories([]);
      setPeople([]);
      setTransactions([]);
      await deleteProfile(profileId);
      if (profileLoadSeqRef.current !== deleteSeq) return;
      setIsEntryModalOpen(false);
      setEditingTransaction(null);
      setQuickEntryDraft(null);
      const remaining = await getProfiles();
      if (profileLoadSeqRef.current !== deleteSeq) return;
      setProfiles(remaining);
      if (remaining.length > 0) {
        const next = remaining[0];
        setSelectedProfileId(next.id);
        localStorage.setItem(LAST_PROFILE_KEY, next.id);
        if (!next.pinHash) {
          const loaded = await loadProfileData(next.id);
          if (!loaded) return;
          lastActivityRef.current = Date.now();
          setUnlockedProfileId(next.id);
        }
      } else {
        setSelectedProfileId(null);
        localStorage.removeItem(LAST_PROFILE_KEY);
      }
      setActiveTab('home');
      showToast('Profile deleted');
    },
    [loadProfileData, showToast]
  );

  const handleLogOut = useCallback(() => {
    profileLoadSeqRef.current += 1;
    setUnlockedProfileId(null);
    setSelectedProfileId(null);
    setCategories([]);
    setPeople([]);
    setTransactions([]);
    setIsEntryModalOpen(false);
    setEditingTransaction(null);
    setQuickEntryDraft(null);
    setActiveTab('home');
    localStorage.removeItem(LAST_PROFILE_KEY);
    showToast('Logged out');
  }, [showToast]);

  const handleResetProfileData = useCallback(
    async (profileId: string) => {
      if (!activeProfile || activeProfile.id !== profileId) {
        throw new Error('Active profile mismatch. Cannot delete profile data.');
      }
      const resetSeq = ++profileLoadSeqRef.current;
      await resetProfileData(profileId);
      if (profileLoadSeqRef.current !== resetSeq) return;
      setIsEntryModalOpen(false);
      setEditingTransaction(null);
      setQuickEntryDraft(null);
      setActiveTab('home');
      const loaded = await loadProfileData(profileId);
      if (!loaded) return;
      showToast(`Deleted financial data for "${activeProfile.name}"`);
    },
    [activeProfile, loadProfileData, showToast]
  );

  const handleCreateCategory = useCallback(
    async (
      name: string,
      type: TransactionType,
      context: TransactionContext
    ): Promise<Category> => {
      if (!activeProfile) throw new Error('No active profile.');
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Category name cannot be empty.');
      const duplicate = categories.find(
        (c) =>
          c.type === type &&
          c.context === context &&
          c.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (duplicate) {
        throw new Error(`Category "${trimmed}" already exists for ${context} ${type}.`);
      }
      const cat: Category = {
        id: generateId(),
        profileId: activeProfile.id,
        name: trimmed,
        type,
        context,
        isDefault: false,
        isArchived: false,
        usageCount: 0,
        lastUsedAt: null,
      };
      await saveCategory(cat);
      const cats = await getCategories(activeProfile.id);
      setCategories(cats);
      return cat;
    },
    [activeProfile, categories]
  );

  const handleRenameCategory = useCallback(
    async (categoryId: string, newName: string) => {
      if (!activeProfile) throw new Error('No active profile.');
      await renameCategory(activeProfile.id, categoryId, newName);
      await loadProfileData(activeProfile.id);
    },
    [activeProfile, loadProfileData]
  );

  const handleToggleCategoryArchive = useCallback(
    async (categoryId: string, isArchived: boolean) => {
      if (!activeProfile) throw new Error('No active profile.');
      await setCategoryArchived(activeProfile.id, categoryId, isArchived);
      const cats = await getCategories(activeProfile.id);
      setCategories(cats);
    },
    [activeProfile]
  );

  const handleCheckCategoryUsage = useCallback(
    async (categoryId: string): Promise<number> => {
      if (!activeProfile) return 0;
      return getCategoryUsageCount(activeProfile.id, categoryId);
    },
    [activeProfile]
  );

  const handleDeleteCategory = useCallback(
    async (categoryId: string) => {
      if (!activeProfile) return;
      await deleteCategory(categoryId, activeProfile.id);
      const cats = await getCategories(activeProfile.id);
      setCategories(cats);
      showToast('Category removed');
    },
    [activeProfile, showToast]
  );

  const handleCreatePerson = useCallback(
    async (
      name: string,
      roleNote?: string,
      classification: PersonClassification = 'both'
    ): Promise<Person> => {
      if (!activeProfile) throw new Error('No active profile.');
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Person name cannot be empty.');
      const duplicate = people.some(
        (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (duplicate) {
        const msg = 'A person with this name already exists.';
        showToast(msg, 'error');
        throw new Error(msg);
      }
      const person: Person = {
        id: generateId(),
        profileId: activeProfile.id,
        name: trimmed,
        roleNote,
        classification,
        usageCount: 0,
        lastUsedAt: null,
      };
      try {
        const saved = await savePerson(person);
        const ppl = await getPeople(activeProfile.id);
        setPeople(ppl);
        return saved;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to save person.';
        showToast(msg, 'error');
        throw err;
      }
    },
    [activeProfile, people, showToast]
  );

  const handleUpdatePerson = useCallback(
    async (person: Person) => {
      if (!activeProfile) return;
      const saved = await savePerson(person);
      const ppl = await getPeople(activeProfile.id);
      setPeople(ppl);
      showToast(`Updated "${saved.name}"`);
    },
    [activeProfile, showToast]
  );

  const handleDeletePerson = useCallback(
    async (personId: string) => {
      if (!activeProfile) return;
      await deletePerson(personId, activeProfile.id);
      const ppl = await getPeople(activeProfile.id);
      setPeople(ppl);
      showToast('Person removed');
    },
    [activeProfile, showToast]
  );

  const handleSaveTransaction = useCallback(
    async (input: SaveTransactionInput) => {
      await saveTransaction(input);
      const [updatedProfiles] = await Promise.all([
        getProfiles(),
        loadProfileData(input.profileId),
      ]);
      setProfiles(updatedProfiles);
      setQuickEntryDraft(null);
      showToast(input.existingId ? 'Entry updated' : 'Entry saved');
    },
    [loadProfileData, showToast]
  );

  const handleDeleteTransaction = useCallback(
    async (transactionId: string) => {
      if (!activeProfile) return;
      await deleteTransaction(transactionId, activeProfile.id);
      await loadProfileData(activeProfile.id);
      setQuickEntryDraft(null);
      showToast('Entry deleted');
    },
    [activeProfile, loadProfileData, showToast]
  );

  const handleDownloadJsonBackup = useCallback(async () => {
    if (!activeProfile) return;
    const payload = await exportProfileBackup(activeProfile.id);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `folio_backup_${activeProfile.name
      .toLowerCase()
      .replace(/\s+/g, '_')}_${getTodayDateStr()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Folio JSON backup downloaded');
  }, [activeProfile, showToast]);

  const handleValidateBackupFile = useCallback(
    async (
      file: File,
      mode: 'new_profile' | 'merge_into_active'
    ): Promise<BackupPreview> => {
      assertBackupFileWithinLimit(file);
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Backup file is not valid JSON.');
      }
      const { preview } = await validateAndPreviewBackup(
        parsed,
        mode === 'merge_into_active' ? activeProfile?.id : undefined
      );
      return preview;
    },
    [activeProfile?.id]
  );

  const handleRestoreJsonBackup = useCallback(
    async (file: File, mode: 'new_profile' | 'merge_into_active') => {
      assertBackupFileWithinLimit(file);
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Backup file is not valid JSON.');
      }
      const restoreSeq = ++profileLoadSeqRef.current;
      const result = await restoreBackupPayload(
        parsed,
        mode,
        activeProfile?.id
      );
      if (profileLoadSeqRef.current !== restoreSeq) {
        return {
          importedTxCount: result.importedTxCount,
          skippedDuplicates: result.skippedDuplicates,
          profileName: result.profile.name,
        };
      }
      const list = await getProfiles();
      if (profileLoadSeqRef.current !== restoreSeq) {
        return {
          importedTxCount: result.importedTxCount,
          skippedDuplicates: result.skippedDuplicates,
          profileName: result.profile.name,
        };
      }
      setProfiles(list);
      setIsEntryModalOpen(false);
      setEditingTransaction(null);
      setQuickEntryDraft(null);
      setSelectedProfileId(result.profile.id);
      localStorage.setItem(LAST_PROFILE_KEY, result.profile.id);
      const loaded = await loadProfileData(result.profile.id);
      if (!loaded) {
        return {
          importedTxCount: result.importedTxCount,
          skippedDuplicates: result.skippedDuplicates,
          profileName: result.profile.name,
        };
      }
      lastActivityRef.current = Date.now();
      setUnlockedProfileId(result.profile.id);
      showToast(
        `Restored ${result.importedTxCount} entries${
          result.skippedDuplicates > 0
            ? ` (${result.skippedDuplicates} duplicates skipped)`
            : ''
        }`
      );
      return {
        importedTxCount: result.importedTxCount,
        skippedDuplicates: result.skippedDuplicates,
        profileName: result.profile.name,
      };
    },
    [activeProfile, loadProfileData, showToast]
  );

  const handleExportAllCsv = useCallback(() => {
    if (!activeProfile || transactions.length === 0) return;
    const csv = transactionsToCsv(transactions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeProfile.name
      .toLowerCase()
      .replace(/\s+/g, '_')}_folio_all_${getTodayDateStr()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Folio CSV exported');
  }, [activeProfile, transactions, showToast]);

  if (isBooting) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center text-sm text-zinc-400">
        Opening local ledger...
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-6 text-center">
        <div className="max-w-sm rounded-2xl border border-rose-500/30 bg-[#121216] p-6">
          <h1 className="text-base font-semibold text-zinc-100">
            Storage Unavailable
          </h1>
          <p className="mt-2 text-xs text-zinc-400">{bootError}</p>
        </div>
      </div>
    );
  }

  if (!activeProfile || !isUnlocked) {
    return (
      <>
        <PinLockScreen
          profiles={profiles}
          selectedProfile={activeProfile}
          onSelectProfile={handleSelectProfile}
          onUnlock={handleUnlock}
          onCreateProfile={handleCreateProfile}
          onValidateBackupFile={(file) =>
            handleValidateBackupFile(file, 'new_profile')
          }
          onRestoreBackupFile={async (file) => {
            await handleRestoreJsonBackup(file, 'new_profile');
          }}
        />
        <OfflineIndicator />
        <ToastNotification toast={toast} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      <TopBar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        activeProfile={activeProfile}
        onOpenQuickAdd={() => {
          setEditingTransaction(null);
          setQuickEntryDraft(null);
          setIsEntryModalOpen(true);
        }}
        onLockOrSwitch={() => {
          if (activeProfile.pinHash) {
            lockSession();
          } else {
            setActiveTab('settings');
          }
        }}
      />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-12">
        {activeTab === 'home' && (
          <HomeDashboard
            profileName={activeProfile.name}
            transactions={transactions}
            onOpenQuickAdd={() => {
              setEditingTransaction(null);
              setQuickEntryDraft(null);
              setIsEntryModalOpen(true);
            }}
            onEditTransaction={(tx) => {
              setEditingTransaction(tx);
              setQuickEntryDraft(null);
              setIsEntryModalOpen(true);
            }}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            profileName={activeProfile.name}
            transactions={transactions}
            categories={categories}
            people={people}
            onEditTransaction={(tx) => {
              setEditingTransaction(tx);
              setQuickEntryDraft(null);
              setIsEntryModalOpen(true);
            }}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsView
            profileName={activeProfile.name}
            transactions={transactions}
            onEditTransaction={(tx) => {
              setEditingTransaction(tx);
              setQuickEntryDraft(null);
              setIsEntryModalOpen(true);
            }}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            key={activeProfile.id}
            profiles={profiles}
            activeProfile={activeProfile}
            categories={categories}
            people={people}
            transactionCount={transactions.length}
            onUpdateProfile={handleUpdateProfile}
            onCreateProfile={handleCreateProfile}
            onSwitchProfile={handleSelectProfile}
            onLockNow={lockSession}
            onDeleteProfile={handleDeleteProfile}
            onCreateCategory={handleCreateCategory}
            onRenameCategory={handleRenameCategory}
            onToggleCategoryArchive={handleToggleCategoryArchive}
            onCheckCategoryUsage={handleCheckCategoryUsage}
            onDeleteCategory={handleDeleteCategory}
            onCreatePerson={handleCreatePerson}
            onUpdatePerson={handleUpdatePerson}
            onDeletePerson={handleDeletePerson}
            onShowToast={showToast}
            onDownloadJsonBackup={handleDownloadJsonBackup}
            onValidateBackupFile={handleValidateBackupFile}
            onRestoreJsonBackup={handleRestoreJsonBackup}
            onExportAllCsv={handleExportAllCsv}
            onLogOut={handleLogOut}
            onResetProfileData={handleResetProfileData}
          />
        )}
      </main>

      <BottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onOpenQuickAdd={() => {
          setEditingTransaction(null);
          setQuickEntryDraft(null);
          setIsEntryModalOpen(true);
        }}
      />

      <QuickEntryModal
        isOpen={isEntryModalOpen}
        onClose={() => {
          setIsEntryModalOpen(false);
          setEditingTransaction(null);
          setQuickEntryDraft(null);
        }}
        profileId={activeProfile.id}
        defaultPaymentMode={activeProfile.lastPaymentMode}
        defaultContext={activeProfile.lastContext}
        categories={categories}
        people={people}
        editingTransaction={editingTransaction}
        initialDraft={quickEntryDraft}
        onDraftChange={setQuickEntryDraft}
        onSave={handleSaveTransaction}
        onDelete={handleDeleteTransaction}
        onCreateCategory={handleCreateCategory}
      />

      <OfflineIndicator />
      <ToastNotification toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
