import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastNotification } from '../src/components/ToastNotification';
import { QuickEntryModal } from '../src/components/QuickEntryModal';
import { PinLockScreen } from '../src/components/PinLockScreen';
import { SettingsView } from '../src/components/SettingsView';
import { HistoryView } from '../src/components/HistoryView';
import { ReportsView } from '../src/components/ReportsView';
import type { Category, Person, Profile, Transaction } from '../src/types/cashbook';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  // 1. ToastNotification — success & error variants, centered, iOS rounded container, icons, safe-area
  const successHtml = renderToStaticMarkup(
    React.createElement(ToastNotification, {
      toast: { id: 1, text: 'Entry saved', tone: 'success' },
      onDismiss: () => {},
    })
  );
  assert(successHtml.includes('Entry saved'), 'Success toast renders message text');
  assert(successHtml.includes('role="status"'), 'Success toast has status role');
  assert(successHtml.includes('justify-center'), 'Toast wrapper is horizontally centered');
  assert(successHtml.includes('env(safe-area-inset-top'), 'Toast respects top safe-area inset');
  assert(successHtml.includes('rounded-[22px]'), 'Toast uses rounded iOS-inspired container');
  assert(successHtml.includes('<svg'), 'Success toast renders checkmark icon');
  assert(successHtml.includes('text-emerald-400'), 'Success toast styles checkmark icon in emerald');

  const updatedHtml = renderToStaticMarkup(
    React.createElement(ToastNotification, {
      toast: { id: 2, text: 'Entry updated', tone: 'success' },
      onDismiss: () => {},
    })
  );
  assert(updatedHtml.includes('Entry updated'), 'Updated toast renders message');

  const deletedHtml = renderToStaticMarkup(
    React.createElement(ToastNotification, {
      toast: { id: 3, text: 'Entry deleted', tone: 'success' },
      onDismiss: () => {},
    })
  );
  assert(deletedHtml.includes('Entry deleted'), 'Deleted toast renders message');

  const createdAccountHtml = renderToStaticMarkup(
    React.createElement(ToastNotification, {
      toast: { id: 4, text: 'Account "Main Account" created', tone: 'success' },
      onDismiss: () => {},
    })
  );
  assert(
    createdAccountHtml.includes('Account &quot;Main Account&quot; created'),
    'Account creation toast renders message'
  );

  const errorHtml = renderToStaticMarkup(
    React.createElement(ToastNotification, {
      toast: { id: 5, text: 'Unable to load profile data.', tone: 'error' },
      onDismiss: () => {},
    })
  );
  assert(errorHtml.includes('role="alert"'), 'Error toast uses alert role');
  assert(errorHtml.includes('text-rose-400'), 'Error toast renders alert icon in rose');

  // 2. QuickEntryModal — mobile overflow root-cause fixes, saved categories/people intact, autocomplete disabled
  const categories: Category[] = [
    {
      id: 'cat-1',
      profileId: 'prof-1',
      name: 'Fuel & Vehicle',
      type: 'spent',
      context: 'business',
      isDefault: true,
      isArchived: false,
      usageCount: 3,
      lastUsedAt: null,
    },
    {
      id: 'cat-2',
      profileId: 'prof-1',
      name: 'Very Long Custom Business Maintenance Category Label For Narrow Screens',
      type: 'spent',
      context: 'business',
      isDefault: false,
      isArchived: false,
      usageCount: 1,
      lastUsedAt: null,
    },
  ];
  const people: Person[] = [
    {
      id: 'per-1',
      profileId: 'prof-1',
      name: 'Supervisor A',
      usageCount: 4,
      lastUsedAt: null,
    },
    {
      id: 'per-2',
      profileId: 'prof-1',
      name: 'Long Vendor Name Logistics & Transport Private Limited',
      usageCount: 2,
      lastUsedAt: null,
    },
  ];

  const quickEntryHtml = renderToStaticMarkup(
    React.createElement(QuickEntryModal, {
      isOpen: true,
      onClose: () => {},
      profileId: 'prof-1',
      defaultPaymentMode: 'cash',
      defaultContext: 'business',
      categories,
      people,
      editingTransaction: null,
      onSave: async () => {},
      onDelete: async () => {},
      onCreateCategory: async () => categories[0],
    })
  );

  // Verify root-cause layout fixes (NOT masking via overflow-x-hidden on form)
  assert(
    !quickEntryHtml.includes('overflow-x-hidden'),
    'QuickEntryModal must not mask overflow with overflow-x-hidden'
  );
  assert(
    quickEntryHtml.includes('grid-cols-1 sm:grid-cols-2 gap-3'),
    'Type + Context stack on narrow mobile viewports and sit side-by-side on sm+'
  );
  assert(
    quickEntryHtml.includes('grid-cols-1 min-[400px]:grid-cols-2 gap-3'),
    'Date + Time stack below 400px and sit side-by-side on wider phones/desktop'
  );
  assert(
    quickEntryHtml.includes('id="tx-amount" name="folio-entry-amount" type="text" inputMode="decimal" autoComplete="off"') ||
      (quickEntryHtml.includes('id="tx-amount"') &&
        quickEntryHtml.includes('name="folio-entry-amount"') &&
        quickEntryHtml.includes('autoComplete="off"')) ||
      (quickEntryHtml.includes('id="tx-amount"') &&
        quickEntryHtml.includes('name="folio-entry-amount"') &&
        quickEntryHtml.includes('autocomplete="off"')),
    'Amount input disables browser autocomplete'
  );

  // Check every rendered <input> inside QuickEntryModal has autocomplete="off"
  const quickEntryInputs = quickEntryHtml.match(/<input\b[^>]*>/g) ?? [];
  assert(quickEntryInputs.length >= 5, 'QuickEntryModal renders all 5 primary inputs');
  for (const inputTag of quickEntryInputs) {
    assert(
      inputTag.includes('autocomplete="off"'),
      `QuickEntryModal input missing autocomplete="off": ${inputTag}`
    );
  }
  assert(
    quickEntryHtml.includes('<form autocomplete="off"'),
    'QuickEntryModal form has autocomplete="off"'
  );
  // Saved categories & people remain fully rendered
  assert(quickEntryHtml.includes('Fuel &amp; Vehicle'), 'Saved category renders in QuickEntryModal');
  assert(quickEntryHtml.includes('Supervisor A'), 'Saved person renders in QuickEntryModal');

  // 3. PinLockScreen — account creation form disables autocomplete appropriately
  const pinCreateHtml = renderToStaticMarkup(
    React.createElement(PinLockScreen, {
      profiles: [],
      selectedProfile: null,
      onSelectProfile: () => {},
      onUnlock: () => {},
      onCreateProfile: async () => {},
      onValidateBackupFile: async () => ({
        profileCount: 1,
        profileName: 'Test',
        transactionCount: 0,
        categoryCount: 0,
        peopleCount: 0,
        exportedAt: null,
        duplicateTransactionCount: 0,
      }),
      onRestoreBackupFile: async () => {},
    })
  );
  assert(
    pinCreateHtml.includes('id="profile-name"') &&
      pinCreateHtml.includes('name="folio-account-label"') &&
      pinCreateHtml.includes('autocomplete="off"'),
    'PinLockScreen account name input disables autocomplete'
  );
  assert(
    pinCreateHtml.includes('id="profile-pin"') &&
      pinCreateHtml.includes('autocomplete="new-password"'),
    'PinLockScreen optional PIN input uses autocomplete="new-password"'
  );

  // 4. SettingsView — all non-file inputs disable browser autocomplete
  const sampleProfile: Profile = {
    id: 'prof-1',
    name: 'Main Account',
    pinHash: 'pbkdf2_v1$salt$hash',
    lastPaymentMode: 'cash',
    lastContext: 'business',
    autoLockMinutes: 5,
    createdAt: '2026-11-01T00:00:00.000Z',
  };
  const settingsHtml = renderToStaticMarkup(
    React.createElement(SettingsView, {
      profiles: [sampleProfile],
      activeProfile: sampleProfile,
      categories,
      people,
      transactionCount: 0,
      onUpdateProfile: async () => {},
      onCreateProfile: async () => {},
      onSwitchProfile: () => {},
      onLockNow: () => {},
      onDeleteProfile: async () => {},
      onCreateCategory: async () => categories[0],
      onRenameCategory: async () => {},
      onToggleCategoryArchive: async () => {},
      onCheckCategoryUsage: async () => 0,
      onDeleteCategory: async () => {},
      onCreatePerson: async () => people[0],
      onDeletePerson: async () => {},
      onDownloadJsonBackup: async () => {},
      onValidateBackupFile: async () => ({
        profileCount: 1,
        profileName: 'Main Account',
        transactionCount: 0,
        categoryCount: 0,
        peopleCount: 0,
        exportedAt: null,
        duplicateTransactionCount: 0,
      }),
      onRestoreJsonBackup: async () => ({
        importedTxCount: 0,
        skippedDuplicates: 0,
        profileName: 'Main Account',
      }),
      onExportAllCsv: () => {},
      onLogOut: () => {},
      onResetProfileData: async () => {},
    })
  );
  const settingsInputs = (settingsHtml.match(/<input\b[^>]*>/g) ?? []).filter(
    (tag) => !tag.includes('type="file"')
  );
  assert(settingsInputs.length >= 7, 'SettingsView renders expected text/PIN inputs');
  for (const inputTag of settingsInputs) {
    if (inputTag.includes('type="password"')) {
      assert(
        inputTag.includes('autocomplete="new-password"'),
        `SettingsView password input missing autocomplete="new-password": ${inputTag}`
      );
    } else {
      assert(
        inputTag.includes('autocomplete="off"'),
        `SettingsView input missing autocomplete="off": ${inputTag}`
      );
    }
  }

  // 5. HistoryView & ReportsView — search input disables autocomplete
  const sampleTx: Transaction = {
    id: 'tx-1',
    profileId: 'prof-1',
    amountPaise: 50000,
    type: 'spent',
    context: 'business',
    categoryId: 'cat-1',
    categoryNameSnapshot: 'Fuel & Vehicle',
    personId: 'per-1',
    personNameSnapshot: 'Supervisor A',
    paymentMode: 'cash',
    date: '2026-11-20',
    time: '10:30',
    notes: 'Diesel',
    createdAt: '2026-11-20T05:00:00.000Z',
    updatedAt: '2026-11-20T05:00:00.000Z',
  };
  const historyHtml = renderToStaticMarkup(
    React.createElement(HistoryView, {
      profileName: 'Main Account',
      transactions: [sampleTx],
      categories,
      people,
      onEditTransaction: () => {},
    })
  );
  assert(
    historyHtml.includes('name="folio-history-search"') &&
      historyHtml.includes('autocomplete="off"'),
    'HistoryView search input disables autocomplete'
  );

  const reportsHtml = renderToStaticMarkup(
    React.createElement(ReportsView, {
      profileName: 'Main Account',
      transactions: [sampleTx],
      onEditTransaction: () => {},
    })
  );
  assert(reportsHtml.includes('Reports'), 'ReportsView renders cleanly');

  console.log('ALL_MOBILE_UX_POLISH_TESTS_PASSED');
}

runTests();
