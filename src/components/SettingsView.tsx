import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  Download,
  Lock,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import {
  BackupPreview,
  Category,
  Person,
  Profile,
  TransactionContext,
  TransactionType,
} from '../types/cashbook';
import { hashPin, verifyPin } from '../utils/currency';
import { ConfirmDialog, ConfirmDialogSecondaryAction } from './ConfirmDialog';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsViewProps {
  profiles: Profile[];
  activeProfile: Profile;
  categories: Category[];
  people: Person[];
  transactionCount: number;
  onUpdateProfile: (profile: Profile) => Promise<void>;
  onCreateProfile: (name: string, pin: string | null) => Promise<void>;
  onSwitchProfile: (profileId: string) => void;
  onLockNow: () => void;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onCreateCategory: (
    name: string,
    type: TransactionType,
    context: TransactionContext
  ) => Promise<Category>;
  onRenameCategory: (categoryId: string, newName: string) => Promise<void>;
  onToggleCategoryArchive: (categoryId: string, isArchived: boolean) => Promise<void>;
  onCheckCategoryUsage: (categoryId: string) => Promise<number>;
  onDeleteCategory: (categoryId: string) => Promise<void>;
  onCreatePerson: (name: string, roleNote?: string) => Promise<Person>;
  onDeletePerson: (personId: string) => Promise<void>;
  onDownloadJsonBackup: () => Promise<void>;
  onValidateBackupFile: (
    file: File,
    mode: 'new_profile' | 'merge_into_active'
  ) => Promise<BackupPreview>;
  onRestoreJsonBackup: (
    file: File,
    mode: 'new_profile' | 'merge_into_active'
  ) => Promise<{ importedTxCount: number; skippedDuplicates: number; profileName: string }>;
  onExportAllCsv: () => void;
  onLogOut: () => void;
  onResetProfileData: (profileId: string) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profiles,
  activeProfile,
  categories,
  people,
  transactionCount,
  onUpdateProfile,
  onCreateProfile,
  onSwitchProfile,
  onLockNow,
  onDeleteProfile,
  onCreateCategory,
  onRenameCategory,
  onToggleCategoryArchive,
  onCheckCategoryUsage,
  onDeleteCategory,
  onCreatePerson,
  onDeletePerson,
  onDownloadJsonBackup,
  onValidateBackupFile,
  onRestoreJsonBackup,
  onExportAllCsv,
  onLogOut,
  onResetProfileData,
}) => {
  const [profileName, setProfileName] = useState(activeProfile.name);
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [isPinBusy, setIsPinBusy] = useState(false);
  const [removePinInput, setRemovePinInput] = useState('');
  const [removePinError, setRemovePinError] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfilePin, setNewProfilePin] = useState('');

  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<TransactionType>('spent');
  const [newCatCtx, setNewCatCtx] = useState<TransactionContext>('business');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');

  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonNote, setNewPersonNote] = useState('');

  const [restoreMode, setRestoreMode] = useState<'merge_into_active' | 'new_profile'>(
    'merge_into_active'
  );
  const [restoreError, setRestoreError] = useState('');

  type PendingAction =
    | null
    | { kind: 'download_json' }
    | { kind: 'export_csv' }
    | {
        kind: 'import_json';
        file: File;
        preview: BackupPreview;
        mode: 'new_profile' | 'merge_into_active';
      }
    | { kind: 'delete_category_used'; category: Category; usageCount: number }
    | { kind: 'delete_category_unused'; category: Category }
    | { kind: 'remove_pin' }
    | { kind: 'logout' }
    | { kind: 'reset_step1' }
    | { kind: 'reset_step2' }
    | { kind: 'delete_profile' };

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProfileName(activeProfile.name);
  }, [activeProfile.name]);

  const notify = (text: string, tone: 'success' | 'error' = 'success') => {
    setFeedback({ text, tone });
    window.setTimeout(() => {
      setFeedback((prev) => (prev?.text === text ? null : prev));
    }, 3600);
  };

  const handleRenameProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = profileName.trim();
    if (!trimmed) {
      notify('Profile name cannot be empty.', 'error');
      return;
    }
    try {
      await onUpdateProfile({ ...activeProfile, name: trimmed });
      notify('Profile name updated.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to update profile name.', 'error');
    }
  };

  const handleSetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPinBusy) return;
    setPinError('');

    const hasExistingPin = Boolean(activeProfile.pinHash);
    if (hasExistingPin && !/^\d{4}$/.test(currentPinInput)) {
      const msg = 'Enter your current 4-digit PIN.';
      setPinError(msg);
      notify(msg, 'error');
      return;
    }

    if (!/^\d{4}$/.test(pinInput)) {
      const msg = hasExistingPin ? 'Enter a new 4-digit PIN.' : 'Enter a 4-digit PIN.';
      setPinError(msg);
      notify(msg, 'error');
      return;
    }

    try {
      setIsPinBusy(true);
      if (hasExistingPin && activeProfile.pinHash) {
        const verification = await verifyPin(currentPinInput, activeProfile.pinHash);
        if (!verification.valid) {
          const msg = 'Current PIN is incorrect.';
          setPinError(msg);
          notify(msg, 'error');
          return;
        }
      }

      const pinHash = await hashPin(pinInput);
      await onUpdateProfile({
        ...activeProfile,
        pinHash,
        autoLockMinutes: activeProfile.autoLockMinutes ?? 5,
      });
      setCurrentPinInput('');
      setPinInput('');
      setPinError('');
      notify(hasExistingPin ? '4-digit PIN lock updated.' : '4-digit PIN lock saved.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save PIN.';
      setPinError(msg);
      notify(msg, 'error');
    } finally {
      setIsPinBusy(false);
    }
  };

  const handleRequestRemovePin = () => {
    setRemovePinInput('');
    setRemovePinError('');
    setPendingAction({ kind: 'remove_pin' });
  };

  const handleAutoLockChange = async (minutes: number) => {
    try {
      await onUpdateProfile({ ...activeProfile, autoLockMinutes: minutes });
      notify(minutes === 0 ? 'Auto-lock disabled (manual lock only).' : `Auto-lock set to ${minutes} min.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save auto-lock setting.', 'error');
    }
  };

  const handleCreateNewProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) {
      notify('Enter a name for the new profile.', 'error');
      return;
    }
    if (newProfilePin && !/^\d{4}$/.test(newProfilePin)) {
      notify('PIN must be 4 digits or left blank.', 'error');
      return;
    }
    try {
      await onCreateProfile(trimmed, newProfilePin || null);
      setNewProfileName('');
      setNewProfilePin('');
      notify(`Created and switched to ${trimmed}.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to create profile.', 'error');
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    try {
      await onCreateCategory(trimmed, newCatType, newCatCtx);
      setNewCatName('');
      notify(`Category "${trimmed}" added.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to add category.', 'error');
    }
  };

  const handleSaveRenameCategory = async (categoryId: string) => {
    const trimmed = editingCatName.trim();
    if (!trimmed) {
      notify('Category name cannot be empty.', 'error');
      return;
    }
    try {
      await onRenameCategory(categoryId, trimmed);
      setEditingCatId(null);
      setEditingCatName('');
      notify(`Category renamed to "${trimmed}".`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to rename category.', 'error');
    }
  };

  const handleToggleArchiveCategory = async (cat: Category) => {
    try {
      const nextArchived = !Boolean(cat.isArchived);
      await onToggleCategoryArchive(cat.id, nextArchived);
      notify(
        nextArchived
          ? `Archived "${cat.name}". Past entries remain unchanged.`
          : `Restored "${cat.name}" for new entries.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to update category.', 'error');
    }
  };

  const handleRequestDeleteCategory = async (cat: Category) => {
    if (isProcessing) return;
    try {
      const usageCount = await onCheckCategoryUsage(cat.id);
      if (usageCount > 0) {
        setPendingAction({ kind: 'delete_category_used', category: cat, usageCount });
      } else {
        setPendingAction({ kind: 'delete_category_unused', category: cat });
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to verify category usage.', 'error');
    }
  };

  const handleAddPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPersonName.trim();
    if (!trimmed) return;
    try {
      await onCreatePerson(trimmed, newPersonNote.trim() || undefined);
      setNewPersonName('');
      setNewPersonNote('');
      notify(`Saved "${trimmed}".`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save person.', 'error');
    }
  };

  const handleDeletePersonSafe = async (personId: string) => {
    try {
      await onDeletePerson(personId);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to remove person.', 'error');
    }
  };

  const handleBackupFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || isProcessing) return;

    try {
      setIsProcessing(true);
      setRestoreError('');
      const preview = await onValidateBackupFile(file, restoreMode);
      setPendingAction({ kind: 'import_json', file, preview, mode: restoreMode });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Backup file is invalid or corrupted.';
      setRestoreError(msg);
      notify(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmPendingAction = async () => {
    if (!pendingAction || isProcessing) return;

    if (pendingAction.kind === 'reset_step1') {
      setPendingAction({ kind: 'reset_step2' });
      return;
    }

    if (pendingAction.kind === 'logout') {
      setPendingAction(null);
      onLogOut();
      return;
    }

    if (pendingAction.kind === 'export_csv') {
      try {
        onExportAllCsv();
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Unable to export CSV.', 'error');
      }
      setPendingAction(null);
      return;
    }

    try {
      setIsProcessing(true);
      if (pendingAction.kind === 'remove_pin') {
        if (!activeProfile.pinHash) {
          setPendingAction(null);
          return;
        }
        if (!/^\d{4}$/.test(removePinInput)) {
          setRemovePinError('Enter your current 4-digit PIN.');
          return;
        }
        const verification = await verifyPin(removePinInput, activeProfile.pinHash);
        if (!verification.valid) {
          setRemovePinError('Incorrect current PIN. PIN lock was not removed.');
          return;
        }
        await onUpdateProfile({ ...activeProfile, pinHash: null });
        setRemovePinInput('');
        setRemovePinError('');
        setCurrentPinInput('');
        setPinInput('');
        setPinError('');
        notify('PIN lock removed.');
        setPendingAction(null);
        return;
      } else if (pendingAction.kind === 'download_json') {
        await onDownloadJsonBackup();
      } else if (pendingAction.kind === 'import_json') {
        const res = await onRestoreJsonBackup(pendingAction.file, pendingAction.mode);
        setRestoreError('');
        notify(
          `Import succeeded: ${res.importedTxCount} entries added${
            res.skippedDuplicates > 0 ? ` (${res.skippedDuplicates} duplicates skipped)` : ''
          }.`
        );
      } else if (
        pendingAction.kind === 'delete_category_used' ||
        pendingAction.kind === 'delete_category_unused'
      ) {
        await onDeleteCategory(pendingAction.category.id);
      } else if (pendingAction.kind === 'reset_step2') {
        await onResetProfileData(activeProfile.id);
      } else if (pendingAction.kind === 'delete_profile') {
        await onDeleteProfile(activeProfile.id);
      }
      setPendingAction(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to complete action.';
      if (pendingAction.kind === 'remove_pin') {
        setRemovePinError(msg);
        notify(msg, 'error');
        return;
      }
      if (pendingAction.kind === 'import_json') {
        setRestoreError(msg);
      }
      notify(msg, 'error');
      setPendingAction(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleArchiveInsteadOfDelete = async () => {
    if (pendingAction?.kind !== 'delete_category_used' || isProcessing) return;
    try {
      setIsProcessing(true);
      await onToggleCategoryArchive(pendingAction.category.id, true);
      notify(`Archived "${pendingAction.category.name}". Past transactions remain intact.`);
      setPendingAction(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to archive category.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const dialogConfig = ((): {
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'default' | 'destructive';
    secondaryAction?: ConfirmDialogSecondaryAction;
    children?: React.ReactNode;
  } | null => {
    if (!pendingAction) return null;
    switch (pendingAction.kind) {
      case 'download_json':
        return {
          title: 'Download JSON Backup?',
          message:
            'This will create a Folio backup of your application data, including the relevant profiles, transactions, categories and saved information.',
          confirmLabel: 'Download Backup',
          variant: 'default',
        };
      case 'export_csv':
        return {
          title: 'Export Transactions?',
          message: 'This will export your Folio transaction data into a CSV file.',
          confirmLabel: 'Export CSV',
          variant: 'default',
        };
      case 'import_json': {
        const { preview, mode } = pendingAction;
        return {
          title: 'Import Backup?',
          message:
            mode === 'merge_into_active'
              ? `Merging into "${activeProfile.name}" preserves existing entries and skips duplicate transaction IDs.`
              : 'Importing as a new profile leaves all existing profiles and entries untouched.',
          confirmLabel:
            mode === 'merge_into_active' ? 'Merge into Current' : 'Create New Profile',
          variant: 'default',
          children: (
            <div className="rounded-xl border border-white/[0.08] bg-[#18181D] p-3.5 text-xs space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Import Mode</span>
                <span className="font-medium text-zinc-100">
                  {mode === 'merge_into_active'
                    ? `Merge into ${activeProfile.name}`
                    : 'Create New Profile'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Profiles ({preview.profileCount})</span>
                <span className="font-medium text-zinc-100 truncate">
                  {preview.profileName}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Transactions</span>
                <span className="font-mono-num text-zinc-100">
                  {preview.transactionCount}
                  {mode === 'merge_into_active' && preview.duplicateTransactionCount > 0
                    ? ` (${preview.duplicateTransactionCount} duplicate${
                        preview.duplicateTransactionCount === 1 ? '' : 's'
                      } will skip)`
                    : ''}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Categories</span>
                <span className="font-mono-num text-zinc-100">{preview.categoryCount}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400">Saved People</span>
                <span className="font-mono-num text-zinc-100">{preview.peopleCount}</span>
              </div>
              <div className="flex justify-between gap-2 pt-1 border-t border-white/[0.06]">
                <span className="text-zinc-400">Backup Created</span>
                <span className="font-mono-num text-zinc-300">
                  {preview.exportedAt
                    ? new Date(preview.exportedAt).toLocaleString('en-IN')
                    : 'Not recorded'}
                </span>
              </div>
            </div>
          ),
        };
      }
      case 'delete_category_used':
        return {
          title: 'Category Used in Transactions',
          message: `"${pendingAction.category.name}" is used by ${pendingAction.usageCount} recorded transaction${
            pendingAction.usageCount === 1 ? '' : 's'
          }. Archiving is recommended so historical reports stay organized while hiding it from new entries. Deleting will keep past transactions intact, but remove it from the active category list.`,
          confirmLabel: 'Delete Anyway',
          variant: 'destructive',
          secondaryAction: {
            label: 'Archive Category',
            variant: 'primary',
            onClick: handleArchiveInsteadOfDelete,
          },
        };
      case 'delete_category_unused':
        return {
          title: 'Delete Category?',
          message: `Remove "${pendingAction.category.name}"? No recorded transactions currently use this category.`,
          confirmLabel: 'Delete Category',
          variant: 'destructive',
        };
      case 'remove_pin':
        return {
          title: 'Remove PIN Lock?',
          message: 'Enter your current 4-digit PIN to disable PIN lock for this profile.',
          confirmLabel: 'Remove PIN',
          variant: 'destructive',
          children: (
            <div className="space-y-2">
              <label
                htmlFor="remove-pin-input"
                className="block text-xs font-medium text-zinc-400"
              >
                Current 4-Digit PIN
              </label>
              <input
                id="remove-pin-input"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoFocus
                value={removePinInput}
                onChange={(e) => {
                  setRemovePinInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                  if (removePinError) setRemovePinError('');
                }}
                placeholder="Enter current 4-digit PIN"
                className="w-full min-h-[44px] rounded-xl border border-white/[0.12] bg-[#18181D] px-3.5 font-mono-num text-sm tracking-widest text-zinc-100 placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
              />
              {removePinError && (
                <p className="text-xs font-medium text-rose-400" role="alert">
                  {removePinError}
                </p>
              )}
            </div>
          ),
        };
      case 'logout':
        return {
          title: 'Log Out?',
          message:
            'Are you sure you want to log out of this profile? Your saved data will remain available when you log in again.',
          confirmLabel: 'Log Out',
          variant: 'default',
        };
      case 'reset_step1':
        return {
          title: `Delete Data for "${activeProfile.name}"?`,
          message: `This will permanently delete all transactions, categories, and saved people stored under "${activeProfile.name}". This profile record, its PIN lock, and all other profiles on this device will remain untouched.`,
          confirmLabel: 'Continue',
          variant: 'destructive',
        };
      case 'reset_step2':
        return {
          title: 'Confirm Permanent Deletion?',
          message: `Please confirm a second time that you want to permanently erase all transactions, categories, and saved people for "${activeProfile.name}". Other profiles and their backups will not be affected.`,
          confirmLabel: 'Delete Profile Data',
          variant: 'destructive',
        };
      case 'delete_profile':
        return {
          title: 'Delete Profile?',
          message:
            'This will permanently delete this profile and all of its transactions, categories, and saved people from this device. Other profiles will not be affected.',
          confirmLabel: 'Delete Profile',
          variant: 'destructive',
        };
    }
  })();

  const activeCategoryCount = categories.filter((c) => !c.isArchived).length;
  const archivedCategoryCount = categories.length - activeCategoryCount;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            Settings &amp; Backup
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Private profile controls, customizable categories, saved people, and local backups
          </p>
        </div>
        {feedback && (
          <span
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            className={`text-xs font-medium ${
              feedback.tone === 'error' ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {feedback.text}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Profile & PIN Security */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5 space-y-5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-zinc-100">
              Active Private Profile
            </h2>
            <div className="flex items-center gap-2">
              {activeProfile.pinHash && (
                <button
                  type="button"
                  onClick={onLockNow}
                  className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] bg-[#18181D] text-xs font-medium text-zinc-200 hover:bg-zinc-800 flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock Now</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setPendingAction({ kind: 'logout' })}
                className="min-h-[36px] px-3 rounded-lg border border-white/[0.1] bg-[#18181D] text-xs font-medium text-zinc-200 hover:bg-zinc-800 flex items-center gap-1.5 whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleRenameProfile} className="flex gap-2">
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="flex-1 min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-400"
            />
            <button
              type="submit"
              className="min-h-[42px] px-4 rounded-xl bg-zinc-100 text-xs font-semibold text-zinc-950 hover:bg-white whitespace-nowrap shrink-0"
            >
              Rename
            </button>
          </form>

          {/* PIN Lock Controls */}
          <div className="pt-4 border-t border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                <ShieldCheck className="w-4 h-4 text-zinc-400" />
                <span>
                  4-Digit PIN Lock:{' '}
                  <strong className="text-zinc-100">
                    {activeProfile.pinHash ? 'Enabled' : 'Off'}
                  </strong>
                </span>
              </div>
              {activeProfile.pinHash && (
                <button
                  type="button"
                  onClick={handleRequestRemovePin}
                  className="text-xs font-medium text-rose-400 hover:text-rose-300 flex items-center gap-1"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Remove PIN</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSetPin} className="space-y-2.5">
              {activeProfile.pinHash && (
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  aria-label="Current 4-digit PIN"
                  value={currentPinInput}
                  onChange={(e) => {
                    setCurrentPinInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                    if (pinError) setPinError('');
                  }}
                  placeholder="Enter current 4-digit PIN"
                  className="w-full min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3.5 font-mono-num text-sm tracking-widest text-zinc-100 placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
                />
              )}
              <div className="flex gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  aria-label={activeProfile.pinHash ? 'New 4-digit PIN' : 'Set 4-digit PIN'}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                    if (pinError) setPinError('');
                  }}
                  placeholder={activeProfile.pinHash ? 'Enter new 4-digit PIN' : 'Set 4-digit PIN'}
                  className="flex-1 min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3.5 font-mono-num text-sm tracking-widest text-zinc-100 placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
                />
                <button
                  type="submit"
                  disabled={isPinBusy}
                  className="min-h-[42px] px-4 rounded-xl border border-white/[0.12] bg-[#18181D] text-xs font-medium text-zinc-100 hover:bg-zinc-800 whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {isPinBusy
                    ? 'Verifying...'
                    : activeProfile.pinHash
                      ? 'Change PIN'
                      : 'Enable PIN'}
                </button>
              </div>
              {pinError && (
                <p className="text-xs font-medium text-rose-400" role="alert">
                  {pinError}
                </p>
              )}
            </form>

            {activeProfile.pinHash && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <label htmlFor="auto-lock-select" className="text-xs text-zinc-400">
                  Auto-Lock After Inactivity
                </label>
                <select
                  id="auto-lock-select"
                  value={String(activeProfile.autoLockMinutes ?? 5)}
                  onChange={(e) => handleAutoLockChange(Number(e.target.value))}
                  className="min-h-[36px] rounded-lg border border-white/[0.1] bg-[#18181D] px-2.5 text-xs text-zinc-100"
                >
                  <option value="1">1 minute</option>
                  <option value="5">5 minutes (Default)</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="0">Never (Manual only)</option>
                </select>
              </div>
            )}

            <p className="text-[11px] text-zinc-500 leading-relaxed">
              PIN locks access inside the app and pauses after repeated failed tries. Local device storage (IndexedDB) is not encrypted at rest.
            </p>
          </div>

          {/* Switch / Create Profile */}
          <div className="pt-4 border-t border-white/[0.06] space-y-3">
            <p className="text-xs font-medium text-zinc-400">
              Independent Local Profiles (Zero Shared Visibility)
            </p>
            <div className="flex flex-wrap gap-2">
              {profiles.map((p) => {
                const isActive = p.id === activeProfile.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (!isActive) onSwitchProfile(p.id);
                    }}
                    className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      isActive
                        ? 'border-zinc-200 bg-zinc-100 text-zinc-950'
                        : 'border-white/[0.08] bg-[#18181D] text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    {p.pinHash && <Lock className="w-3 h-3" />}
                    <span>{p.name}</span>
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleCreateNewProfile} className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="New profile name..."
                className="sm:col-span-6 min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100 placeholder:text-zinc-500"
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newProfilePin}
                onChange={(e) =>
                  setNewProfilePin(e.target.value.replace(/\D/g, '').slice(0, 4))
                }
                placeholder="PIN (opt)"
                className="sm:col-span-3 min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 font-mono-num text-xs text-zinc-100 placeholder:font-sans placeholder:text-zinc-500"
              />
              <button
                type="submit"
                className="sm:col-span-3 min-h-[42px] px-3 rounded-xl border border-white/[0.12] bg-[#18181D] text-xs font-medium text-zinc-100 hover:bg-zinc-800 flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </form>
          </div>
        </section>

        {/* Backup, Restore & PWA Install */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Backup, Restore &amp; Export
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Currently storing{' '}
              <span className="font-mono-num text-zinc-200">{transactionCount}</span>{' '}
              transactions locally on this device. Save a JSON backup regularly.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPendingAction({ kind: 'download_json' })}
              className="min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-4 text-xs font-semibold text-zinc-950 hover:bg-white transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download JSON Backup</span>
            </button>

            <button
              type="button"
              onClick={() => setPendingAction({ kind: 'export_csv' })}
              disabled={transactionCount === 0}
              className="min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-[#18181D] px-4 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Export All CSV</span>
            </button>
          </div>

          <div className="pt-4 border-t border-white/[0.06] space-y-3">
            <p className="text-xs font-medium text-zinc-300">Restore from JSON Backup</p>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#18181D] border border-white/[0.06]">
              <button
                type="button"
                onClick={() => {
                  setRestoreMode('merge_into_active');
                  setRestoreError('');
                }}
                className={`min-h-[38px] rounded-lg text-xs font-medium transition-colors ${
                  restoreMode === 'merge_into_active'
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Merge into Current
              </button>
              <button
                type="button"
                onClick={() => {
                  setRestoreMode('new_profile');
                  setRestoreError('');
                }}
                className={`min-h-[38px] rounded-lg text-xs font-medium transition-colors ${
                  restoreMode === 'new_profile'
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Import as New Profile
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              {restoreMode === 'merge_into_active'
                ? `Adds missing entries into "${activeProfile.name}" while skipping duplicate transaction IDs.`
                : 'Creates a separate private profile from the backup without modifying existing profiles.'}
            </p>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => fileInputRef.current?.click()}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-[#18181D] text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>Choose Backup JSON File</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleBackupFileSelected}
              className="hidden"
            />
            {restoreError && (
              <p className="text-xs font-medium text-rose-400" role="alert">
                {restoreError}
              </p>
            )}
          </div>

          <div className="pt-4 border-t border-white/[0.06] space-y-2.5">
            <p className="text-xs font-medium text-zinc-300">Offline Mobile Installation</p>
            <PWAInstallButton variant="full" />
            <p className="text-[11px] text-zinc-500">
              Works offline without internet. All entries stay stored persistently in IndexedDB on your device.
            </p>
          </div>

          {profiles.length > 1 && (
            <div className="pt-4 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-zinc-500">Remove this profile from device</span>
              <button
                type="button"
                onClick={() => setPendingAction({ kind: 'delete_profile' })}
                className="min-h-[38px] px-3 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10"
              >
                Delete Profile
              </button>
            </div>
          )}
        </section>

        {/* Categories Manager */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">
              Categories ({activeCategoryCount}
              {archivedCategoryCount > 0 ? `, ${archivedCategoryCount} archived` : ''})
            </h2>
          </div>

          <form onSubmit={handleAddCategory} className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newCatType}
                onChange={(e) => setNewCatType(e.target.value as TransactionType)}
                className="min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100"
              >
                <option value="spent">Spent</option>
                <option value="received">Received</option>
              </select>
              <select
                value={newCatCtx}
                onChange={(e) => setNewCatCtx(e.target.value as TransactionContext)}
                className="min-h-[40px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100"
              >
                <option value="business">Business</option>
                <option value="personal">Personal</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Add new category name..."
                className="flex-1 min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100 placeholder:text-zinc-500"
              />
              <button
                type="submit"
                className="min-h-[42px] px-4 rounded-xl bg-zinc-100 text-xs font-semibold text-zinc-950 hover:bg-white whitespace-nowrap shrink-0"
              >
                Add
              </button>
            </div>
          </form>

          <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {categories.map((cat) => {
              const isEditing = editingCatId === cat.id;
              return (
                <div
                  key={cat.id}
                  className="py-2.5 flex items-center justify-between gap-2"
                >
                  {isEditing ? (
                    <div className="flex-1 flex items-center gap-1.5">
                      <input
                        type="text"
                        value={editingCatName}
                        onChange={(e) => setEditingCatName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleSaveRenameCategory(cat.id);
                          } else if (e.key === 'Escape') {
                            setEditingCatId(null);
                            setEditingCatName('');
                          }
                        }}
                        autoFocus
                        className="flex-1 min-h-[36px] rounded-lg border border-white/[0.14] bg-[#18181D] px-2.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-400"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveRenameCategory(cat.id)}
                        aria-label="Save category rename"
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 hover:bg-white"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCatId(null);
                          setEditingCatName('');
                        }}
                        aria-label="Cancel rename"
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <p
                          className={`text-xs font-medium truncate ${
                            cat.isArchived ? 'text-zinc-500 line-through' : 'text-zinc-200'
                          }`}
                        >
                          {cat.name}
                          {cat.isArchived ? ' (Archived)' : ''}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {cat.context === 'business' ? 'Business' : 'Personal'} ·{' '}
                          {cat.type === 'received' ? 'Received' : 'Spent'}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(cat.id);
                            setEditingCatName(cat.name);
                          }}
                          aria-label={`Rename ${cat.name}`}
                          title="Rename category"
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleArchiveCategory(cat)}
                          aria-label={
                            cat.isArchived
                              ? `Unarchive ${cat.name}`
                              : `Archive ${cat.name}`
                          }
                          title={cat.isArchived ? 'Restore category' : 'Archive category'}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-amber-300 hover:bg-zinc-800"
                        >
                          {cat.isArchived ? (
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          ) : (
                            <Archive className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRequestDeleteCategory(cat)}
                          aria-label={`Delete ${cat.name}`}
                          title="Delete category"
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Saved People Directory */}
        <section className="rounded-2xl border border-white/[0.08] bg-[#121216] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-100">
            Saved People ({people.length})
          </h2>

          <form onSubmit={handleAddPerson} className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                placeholder="Person name (e.g. Supervisor A)"
                className="min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100 placeholder:text-zinc-500"
              />
              <input
                type="text"
                value={newPersonNote}
                onChange={(e) => setNewPersonNote(e.target.value)}
                placeholder="Role note (optional)"
                className="min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-xs text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[42px] rounded-xl border border-white/[0.12] bg-[#18181D] text-xs font-medium text-zinc-100 hover:bg-zinc-800 flex items-center justify-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Save Person</span>
            </button>
          </form>

          {people.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">
              People you save during transaction entry also appear here.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {people.map((person) => (
                <div
                  key={person.id}
                  className="py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-200 truncate">
                      {person.name}
                    </p>
                    {person.roleNote && (
                      <p className="text-[11px] text-zinc-500 truncate">{person.roleNote}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeletePersonSafe(person.id)}
                    aria-label={`Remove ${person.name}`}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Dedicated Delete Active Profile Data Section */}
      <section className="rounded-2xl border border-rose-500/20 bg-[#121216] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h2 className="text-sm font-semibold text-zinc-100">Delete App Data</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Permanently delete all transactions, custom and default categories, and saved people for &ldquo;{activeProfile.name}&rdquo;. This profile record, its PIN lock, and all other profiles remain unaffected.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPendingAction({ kind: 'reset_step1' })}
          className="min-h-[44px] px-4 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
        >
          Delete App Data
        </button>
      </section>

      {/* About Folio Footer */}
      <footer className="rounded-2xl border border-white/[0.06] bg-[#121216]/60 px-5 py-4 space-y-2 text-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-zinc-100">Folio</span>
            <span className="text-zinc-600">·</span>
            <span className="italic text-zinc-400">Every entry tells a story.</span>
          </div>
          <p className="text-[11px] text-zinc-500">
            Private offline-first personal &amp; business ledger stored locally on your device.
          </p>
        </div>
        <p className="pt-1 text-center text-xs font-semibold text-zinc-400">
          Made with love by Aman
        </p>
      </footer>

      <ConfirmDialog
        isOpen={Boolean(dialogConfig)}
        title={dialogConfig?.title ?? ''}
        message={dialogConfig?.message ?? ''}
        confirmLabel={dialogConfig?.confirmLabel ?? 'Confirm'}
        variant={dialogConfig?.variant ?? 'default'}
        secondaryAction={dialogConfig?.secondaryAction}
        isBusy={isProcessing}
        onCancel={() => {
          if (!isProcessing) setPendingAction(null);
        }}
        onConfirm={handleConfirmPendingAction}
      >
        {dialogConfig?.children}
      </ConfirmDialog>
    </div>
  );
};
