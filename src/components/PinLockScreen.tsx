import React, { useEffect, useRef, useState } from 'react';
import { Delete, Lock, Plus, Upload, User } from 'lucide-react';
import { BackupPreview, Profile } from '../types/cashbook';
import { hashPin, verifyPin } from '../utils/currency';
import { ConfirmDialog } from './ConfirmDialog';

interface PinLockScreenProps {
  profiles: Profile[];
  selectedProfile: Profile | null;
  onSelectProfile: (profileId: string) => void;
  onUnlock: (profileId: string, upgradedPinHash?: string) => void | Promise<void>;
  onCreateProfile: (name: string, pin: string | null) => Promise<void>;
  onValidateBackupFile: (file: File) => Promise<BackupPreview>;
  onRestoreBackupFile: (file: File) => Promise<void>;
}

interface PinGuardState {
  failures: number;
  lockedUntilMs: number;
}

const PIN_GUARD_PREFIX = 'cashbook_pin_guard_';

function getPinGuard(profileId: string): PinGuardState {
  try {
    const raw = localStorage.getItem(`${PIN_GUARD_PREFIX}${profileId}`);
    if (!raw) return { failures: 0, lockedUntilMs: 0 };
    const parsed = JSON.parse(raw) as Partial<PinGuardState>;
    return {
      failures: typeof parsed.failures === 'number' && parsed.failures > 0 ? parsed.failures : 0,
      lockedUntilMs:
        typeof parsed.lockedUntilMs === 'number' && parsed.lockedUntilMs > 0
          ? parsed.lockedUntilMs
          : 0,
    };
  } catch {
    return { failures: 0, lockedUntilMs: 0 };
  }
}

function savePinGuard(profileId: string, state: PinGuardState): void {
  try {
    localStorage.setItem(`${PIN_GUARD_PREFIX}${profileId}`, JSON.stringify(state));
  } catch {
    // Ignore storage quota issues for rate-limit state
  }
}

function clearPinGuard(profileId: string): void {
  try {
    localStorage.removeItem(`${PIN_GUARD_PREFIX}${profileId}`);
  } catch {
    // Ignore storage issues
  }
}

function computeCooldownMs(failures: number): number {
  if (failures < 3) return 0;
  if (failures === 3) return 5_000;
  if (failures === 4) return 15_000;
  if (failures === 5) return 30_000;
  return 60_000;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  profiles,
  selectedProfile,
  onSelectProfile,
  onUnlock,
  onCreateProfile,
  onValidateBackupFile,
  onRestoreBackupFile,
}) => {
  const [pinDigits, setPinDigits] = useState('');
  const [pinError, setPinError] = useState('');
  const [cooldownSec, setCooldownSec] = useState(0);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(profiles.length === 0);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [createError, setCreateError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{
    file: File;
    preview: BackupPreview;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profiles.length === 0) {
      setShowCreateForm(true);
    }
  }, [profiles.length]);

  // Sync cooldown countdown when selected profile changes or timer ticks
  useEffect(() => {
    if (!selectedProfile?.id) {
      setCooldownSec(0);
      return;
    }

    const syncCooldown = () => {
      const guard = getPinGuard(selectedProfile.id);
      const remainingMs = guard.lockedUntilMs - Date.now();
      setCooldownSec(remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0);
    };

    syncCooldown();
    const interval = window.setInterval(syncCooldown, 500);
    return () => window.clearInterval(interval);
  }, [selectedProfile?.id]);

  const handleDigit = async (digit: string) => {
    if (!selectedProfile || !selectedProfile.pinHash) return;
    if (isVerifyingPin || cooldownSec > 0 || pinDigits.length >= 4) return;

    const guard = getPinGuard(selectedProfile.id);
    if (guard.lockedUntilMs > Date.now()) {
      setCooldownSec(Math.ceil((guard.lockedUntilMs - Date.now()) / 1000));
      setPinDigits('');
      return;
    }

    const next = pinDigits + digit;
    setPinDigits(next);
    setPinError('');

    if (next.length === 4) {
      setIsVerifyingPin(true);
      try {
        const result = await verifyPin(next, selectedProfile.pinHash);
        if (result.valid) {
          clearPinGuard(selectedProfile.id);
          let upgradedHash: string | undefined;
          if (result.needsMigration) {
            upgradedHash = await hashPin(next);
          }
          setPinDigits('');
          await onUnlock(selectedProfile.id, upgradedHash);
        } else {
          const nextFailures = guard.failures + 1;
          const waitMs = computeCooldownMs(nextFailures);
          const lockedUntilMs = waitMs > 0 ? Date.now() + waitMs : 0;
          savePinGuard(selectedProfile.id, {
            failures: nextFailures,
            lockedUntilMs,
          });
          if (waitMs > 0) {
            const secs = Math.ceil(waitMs / 1000);
            setCooldownSec(secs);
            setPinError(`Incorrect PIN. Too many failed attempts — wait ${secs}s.`);
          } else {
            const leftBeforeWait = 3 - nextFailures;
            setPinError(
              leftBeforeWait === 1
                ? 'Incorrect PIN. 1 attempt left before temporary pause.'
                : 'Incorrect PIN. Try again.'
            );
          }
          setTimeout(() => setPinDigits(''), 220);
        }
      } catch (err) {
        setPinError(err instanceof Error ? err.message : 'Unable to verify PIN.');
        setPinDigits('');
      } finally {
        setIsVerifyingPin(false);
      }
    }
  };

  const handleBackspace = () => {
    if (isVerifyingPin || cooldownSec > 0) return;
    setPinDigits((prev) => prev.slice(0, -1));
    setPinError('');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreateError('Please enter a name for this Folio.');
      return;
    }
    if (newPin && !/^\d{4}$/.test(newPin)) {
      setCreateError('PIN must be exactly 4 digits, or leave blank for no PIN.');
      return;
    }

    try {
      setIsBusy(true);
      setCreateError('');
      await onCreateProfile(trimmed, newPin || null);
      setNewName('');
      setNewPin('');
      setShowCreateForm(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create profile.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || isBusy) return;

    try {
      setIsBusy(true);
      setCreateError('');
      const preview = await onValidateBackupFile(file);
      setPendingRestore({ file, preview });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Invalid backup file.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore || isBusy) return;
    try {
      setIsBusy(true);
      setCreateError('');
      await onRestoreBackupFile(pendingRestore.file);
      setPendingRestore(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Invalid backup file.');
      setPendingRestore(null);
    } finally {
      setIsBusy(false);
    }
  };

  const isKeypadDisabled = isVerifyingPin || cooldownSec > 0;

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#121216] p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-zinc-400">Folio · Every entry tells a story.</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100">
              {showCreateForm
                ? 'Create Folio'
                : selectedProfile
                  ? 'Unlock Ledger'
                  : 'Sign In'}
            </h1>
          </div>
          {profiles.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowCreateForm((v) => !v);
                setCreateError('');
                setPinError('');
                setPinDigits('');
              }}
              className="min-h-[44px] px-3 rounded-xl border border-white/[0.08] bg-[#18181D] text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              {showCreateForm ? 'Back to Profiles' : 'New Profile'}
            </button>
          )}
        </div>

        {showCreateForm ? (
          <form onSubmit={handleCreateSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="profile-name" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Account Name
              </label>
              <input
                id="profile-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Main Account"
                autoFocus
                className="w-full min-h-[48px] rounded-xl border border-white/[0.1] bg-[#18181D] px-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
              />
            </div>

            <div>
              <label htmlFor="profile-pin" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Optional 4-Digit PIN Lock
              </label>
              <input
                id="profile-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Leave blank for instant open"
                className="w-full min-h-[48px] rounded-xl border border-white/[0.1] bg-[#18181D] px-4 font-mono-num text-sm tracking-widest text-zinc-100 placeholder:tracking-normal placeholder:font-sans placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
              />
            </div>

            {createError && (
              <p className="text-xs font-medium text-rose-400" role="alert">
                {createError}
              </p>
            )}

            <button
              type="submit"
              disabled={isBusy}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-zinc-100 text-sm font-semibold text-zinc-950 hover:bg-white active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{isBusy ? 'Creating...' : 'Start Folio'}</span>
            </button>

            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-zinc-500">Have an existing backup?</span>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[40px] flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Restore JSON</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </form>
        ) : (
          <div className="mt-6">
            {(profiles.length > 1 || !selectedProfile) && (
              <div className="mb-6">
                <p className="text-xs text-zinc-400 mb-2">
                  {selectedProfile ? 'Select Private Profile' : 'Select a Profile to Log In'}
                </p>
                <div className={profiles.length === 1 ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-2'}>
                  {profiles.map((p) => {
                    const active = selectedProfile?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setPinDigits('');
                          setPinError('');
                          onSelectProfile(p.id);
                          if (!p.pinHash) {
                            onUnlock(p.id);
                          }
                        }}
                        className={`min-h-[48px] flex items-center gap-2 px-3.5 rounded-xl border text-left text-sm font-medium transition-colors ${
                          active
                            ? 'border-zinc-300 bg-zinc-800 text-white'
                            : 'border-white/[0.08] bg-[#18181D] text-zinc-200 hover:bg-zinc-800/70'
                        }`}
                      >
                        <User className="w-4 h-4 shrink-0 text-zinc-400" />
                        <span className="truncate">{p.name}</span>
                        {p.pinHash ? (
                          <Lock className="w-3.5 h-3.5 ml-auto shrink-0 text-zinc-500" />
                        ) : (
                          <span className="ml-auto text-[11px] text-zinc-500 shrink-0">
                            Open
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedProfile && selectedProfile.pinHash && (
              <div>
                <div className="flex items-center justify-center gap-2 text-sm text-zinc-300">
                  <Lock className="w-4 h-4 text-zinc-400" />
                  <span>
                    Enter 4-digit PIN for <strong className="text-white">{selectedProfile.name}</strong>
                  </span>
                </div>

                {/* PIN dots */}
                <div className="my-5 flex items-center justify-center gap-4">
                  {[0, 1, 2, 3].map((idx) => {
                    const filled = idx < pinDigits.length;
                    return (
                      <div
                        key={idx}
                        className={`w-3.5 h-3.5 rounded-full border transition-all ${
                          filled
                            ? 'bg-zinc-100 border-zinc-100 scale-110'
                            : 'bg-transparent border-zinc-600'
                        }`}
                      />
                    );
                  })}
                </div>

                {(cooldownSec > 0 || pinError) && (
                  <p className="mb-4 text-center text-xs font-medium text-rose-400" role="alert">
                    {cooldownSec > 0
                      ? `Too many failed attempts. Please wait ${cooldownSec}s.`
                      : pinError}
                  </p>
                )}

                {/* Numeric Keypad */}
                <div className="grid grid-cols-3 gap-2.5 max-w-[280px] mx-auto">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      disabled={isKeypadDisabled}
                      onClick={() => handleDigit(digit)}
                      className="h-14 rounded-xl border border-white/[0.08] bg-[#18181D] font-mono-num text-lg font-medium text-zinc-100 hover:bg-zinc-800 active:scale-95 transition-all disabled:opacity-40"
                    >
                      {digit}
                    </button>
                  ))}
                  <div />
                  <button
                    type="button"
                    disabled={isKeypadDisabled}
                    onClick={() => handleDigit('0')}
                    className="h-14 rounded-xl border border-white/[0.08] bg-[#18181D] font-mono-num text-lg font-medium text-zinc-100 hover:bg-zinc-800 active:scale-95 transition-all disabled:opacity-40"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    disabled={isKeypadDisabled}
                    onClick={handleBackspace}
                    aria-label="Backspace"
                    className="h-14 rounded-xl border border-white/[0.08] bg-[#18181D] flex items-center justify-center text-zinc-300 hover:bg-zinc-800 active:scale-95 transition-all disabled:opacity-40"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={Boolean(pendingRestore)}
        title="Import Backup?"
        message="Importing this backup will create a new local profile without overwriting any existing profiles or transactions. Make sure you trust this backup file."
        confirmLabel="Import as New Profile"
        isBusy={isBusy}
        onCancel={() => setPendingRestore(null)}
        onConfirm={handleConfirmRestore}
      >
        {pendingRestore && (
          <div className="rounded-xl border border-white/[0.08] bg-[#18181D] p-3.5 text-xs space-y-1.5">
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">Import Mode</span>
              <span className="font-medium text-zinc-100">Create New Profile</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">Profiles ({pendingRestore.preview.profileCount})</span>
              <span className="font-medium text-zinc-100 truncate">
                {pendingRestore.preview.profileName}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">Transactions</span>
              <span className="font-mono-num text-zinc-100">
                {pendingRestore.preview.transactionCount}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">Categories</span>
              <span className="font-mono-num text-zinc-100">
                {pendingRestore.preview.categoryCount}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-400">Saved People</span>
              <span className="font-mono-num text-zinc-100">
                {pendingRestore.preview.peopleCount}
              </span>
            </div>
            {pendingRestore.preview.exportedAt && (
              <div className="flex justify-between gap-2 pt-1 border-t border-white/[0.06]">
                <span className="text-zinc-400">Backup Created</span>
                <span className="font-mono-num text-zinc-300">
                  {new Date(pendingRestore.preview.exportedAt).toLocaleString('en-IN')}
                </span>
              </div>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
};
