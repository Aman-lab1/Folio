import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Trash2, UserPlus, X } from 'lucide-react';
import {
  Category,
  PaymentMode,
  Person,
  Transaction,
  TransactionContext,
  TransactionType,
} from '../types/cashbook';
import {
  getCurrentTimeStr,
  getTodayDateStr,
  isValidDateStr,
  isValidTimeStr,
  paiseToRupeeInputString,
  parseRupeesToPaise,
} from '../utils/currency';
import { SaveTransactionInput } from '../db/cashbookDb';

export interface QuickEntryDraft {
  profileId: string;
  editingId: string | null;
  amountStr: string;
  type: TransactionType;
  context: TransactionContext;
  categoryId: string;
  paymentMode: PaymentMode;
  selectedPersonId: string | null;
  personInput: string;
  saveNewPerson: boolean;
  date: string;
  time: string;
  notes: string;
}

interface QuickEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
  defaultPaymentMode: PaymentMode;
  defaultContext: TransactionContext;
  categories: Category[];
  people: Person[];
  editingTransaction: Transaction | null;
  initialDraft?: QuickEntryDraft | null;
  onDraftChange?: (draft: QuickEntryDraft) => void;
  onSave: (input: SaveTransactionInput) => Promise<void>;
  onDelete: (transactionId: string) => Promise<void>;
  onCreateCategory: (
    name: string,
    type: TransactionType,
    context: TransactionContext
  ) => Promise<Category>;
}

function getMatchingCategories(
  categories: Category[],
  type: TransactionType,
  context: TransactionContext,
  editingTransaction: Transaction | null
): Category[] {
  return categories
    .filter((c) => {
      if (c.type !== type || c.context !== context) return false;
      if (c.isArchived && editingTransaction?.categoryId !== c.id) return false;
      return true;
    })
    .sort((a, b) => {
      if (Boolean(a.isArchived) !== Boolean(b.isArchived)) {
        return a.isArchived ? 1 : -1;
      }
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name);
    });
}

function resolveInitialFormState(
  profileId: string,
  defaultPaymentMode: PaymentMode,
  defaultContext: TransactionContext,
  categories: Category[],
  editingTransaction: Transaction | null,
  initialDraft?: QuickEntryDraft | null
) {
  const canRestoreDraft =
    initialDraft &&
    initialDraft.profileId === profileId &&
    initialDraft.editingId === (editingTransaction?.id ?? null);

  if (canRestoreDraft && initialDraft) {
    const matching = getMatchingCategories(
      categories,
      initialDraft.type,
      initialDraft.context,
      editingTransaction
    );
    const hasDraftCat =
      initialDraft.categoryId &&
      (matching.some((c) => c.id === initialDraft.categoryId) ||
        (editingTransaction && editingTransaction.categoryId === initialDraft.categoryId));

    return {
      amountStr: initialDraft.amountStr,
      type: initialDraft.type,
      context: initialDraft.context,
      categoryId: hasDraftCat ? initialDraft.categoryId : (matching[0]?.id ?? ''),
      paymentMode: initialDraft.paymentMode,
      selectedPersonId: initialDraft.selectedPersonId,
      personInput: initialDraft.personInput,
      saveNewPerson: initialDraft.saveNewPerson,
      date: initialDraft.date,
      time: initialDraft.time,
      notes: initialDraft.notes,
    };
  }

  if (editingTransaction) {
    return {
      amountStr: paiseToRupeeInputString(editingTransaction.amountPaise),
      type: editingTransaction.type,
      context: editingTransaction.context,
      categoryId: editingTransaction.categoryId,
      paymentMode: editingTransaction.paymentMode,
      selectedPersonId: editingTransaction.personId,
      personInput: editingTransaction.personNameSnapshot ?? '',
      saveNewPerson: false,
      date: editingTransaction.date,
      time: editingTransaction.time,
      notes: editingTransaction.notes,
    };
  }

  const initialMatching = getMatchingCategories(categories, 'spent', defaultContext, null);
  return {
    amountStr: '',
    type: 'spent' as TransactionType,
    context: defaultContext,
    categoryId: initialMatching[0]?.id ?? '',
    paymentMode: defaultPaymentMode,
    selectedPersonId: null as string | null,
    personInput: '',
    saveNewPerson: true,
    date: getTodayDateStr(),
    time: getCurrentTimeStr(),
    notes: '',
  };
}

export const QuickEntryModal: React.FC<QuickEntryModalProps> = (props) => {
  if (!props.isOpen) return null;
  const formKey = `${props.profileId}::${props.editingTransaction?.id ?? 'new'}`;
  return <QuickEntryForm key={formKey} {...props} />;
};

const QuickEntryForm: React.FC<QuickEntryModalProps> = ({
  onClose,
  profileId,
  defaultPaymentMode,
  defaultContext,
  categories,
  people,
  editingTransaction,
  initialDraft,
  onDraftChange,
  onSave,
  onDelete,
  onCreateCategory,
}) => {
  const amountInputRef = useRef<HTMLInputElement>(null);
  const isSavingRef = useRef(false);

  const initialState = useMemo(
    () =>
      resolveInitialFormState(
        profileId,
        defaultPaymentMode,
        defaultContext,
        categories,
        editingTransaction,
        initialDraft
      ),
    // Computed once per QuickEntryForm mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [amountStr, setAmountStr] = useState(initialState.amountStr);
  const [type, setType] = useState<TransactionType>(initialState.type);
  const [context, setContext] = useState<TransactionContext>(initialState.context);
  const [categoryId, setCategoryId] = useState(initialState.categoryId);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(initialState.paymentMode);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(
    initialState.selectedPersonId
  );
  const [personInput, setPersonInput] = useState(initialState.personInput);
  const [saveNewPerson, setSaveNewPerson] = useState(initialState.saveNewPerson);
  const [date, setDate] = useState(initialState.date);
  const [time, setTime] = useState(initialState.time);
  const [notes, setNotes] = useState(initialState.notes);

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      amountInputRef.current?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  // Sync live unsaved draft back to App so auto-lock never discards unsaved form entries
  useEffect(() => {
    if (!onDraftChange) return;
    onDraftChange({
      profileId,
      editingId: editingTransaction?.id ?? null,
      amountStr,
      type,
      context,
      categoryId,
      paymentMode,
      selectedPersonId,
      personInput,
      saveNewPerson,
      date,
      time,
      notes,
    });
  }, [
    profileId,
    editingTransaction,
    amountStr,
    type,
    context,
    categoryId,
    paymentMode,
    selectedPersonId,
    personInput,
    saveNewPerson,
    date,
    time,
    notes,
    onDraftChange,
  ]);

  // Filter categories for active type + context; hide archived unless currently attached to the edited entry
  const matchingCategories = useMemo(
    () => getMatchingCategories(categories, type, context, editingTransaction),
    [categories, type, context, editingTransaction]
  );

  const handleTypeChange = (nextType: TransactionType) => {
    if (nextType === type) return;
    setType(nextType);
    const nextCats = getMatchingCategories(categories, nextType, context, editingTransaction);
    if (!nextCats.some((c) => c.id === categoryId)) {
      setCategoryId(nextCats[0]?.id ?? '');
    }
  };

  const handleContextChange = (nextContext: TransactionContext) => {
    if (nextContext === context) return;
    setContext(nextContext);
    const nextCats = getMatchingCategories(categories, type, nextContext, editingTransaction);
    if (!nextCats.some((c) => c.id === categoryId)) {
      setCategoryId(nextCats[0]?.id ?? '');
    }
  };

  const frequentPeople = useMemo(() => {
    const q = personInput.trim().toLowerCase();
    if (!q) return people.slice(0, 6);
    return people
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [people, personInput]);

  const isExactSavedPerson = useMemo(() => {
    const trimmed = personInput.trim().toLowerCase();
    if (!trimmed) return false;
    return people.some((p) => p.name.toLowerCase() === trimmed);
  }, [people, personInput]);

  const handleQuickAddCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    try {
      const created = await onCreateCategory(trimmed, type, context);
      setCategoryId(created.id);
      setNewCategoryName('');
      setAddingCategory(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add category.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingRef.current || isSaving) return;

    const cleanedAmount = amountStr.replace(/[₹,\s]/g, '').trim();
    const amountPaise = parseRupeesToPaise(amountStr);
    if (!amountPaise) {
      if (/\.\d{3,}$/.test(cleanedAmount)) {
        setError('Amount can have at most 2 decimal places (paise).');
      } else {
        setError('Enter a valid amount greater than ₹0.');
      }
      amountInputRef.current?.focus();
      return;
    }

    if (!isValidDateStr(date)) {
      setError('Enter a valid calendar date (YYYY-MM-DD).');
      return;
    }

    if (!isValidTimeStr(time)) {
      setError('Enter a valid time (HH:mm).');
      return;
    }

    const activeCat =
      matchingCategories.find((c) => c.id === categoryId) ||
      categories.find((c) => c.id === categoryId && (!c.isArchived || editingTransaction?.categoryId === c.id));

    const fallbackDeletedCatName =
      editingTransaction && editingTransaction.categoryId === categoryId
        ? editingTransaction.categoryNameSnapshot
        : '';

    const resolvedCatId = activeCat?.id || (fallbackDeletedCatName ? editingTransaction!.categoryId : '');
    const resolvedCatName = activeCat?.name || fallbackDeletedCatName;

    if (!resolvedCatId || !resolvedCatName) {
      setError('Please select or create a category.');
      return;
    }

    const trimmedPerson = personInput.trim();
    const matchedSaved = trimmedPerson
      ? people.find((p) => p.name.toLowerCase() === trimmedPerson.toLowerCase())
      : undefined;

    try {
      isSavingRef.current = true;
      setIsSaving(true);
      setError('');
      await onSave({
        existingId: editingTransaction?.id,
        profileId,
        amountPaise,
        type,
        context,
        categoryId: resolvedCatId,
        categoryNameSnapshot: resolvedCatName,
        personId: matchedSaved ? matchedSaved.id : selectedPersonId,
        personNameSnapshot: trimmedPerson || null,
        saveNewPersonIfNamed: Boolean(trimmedPerson && !matchedSaved && saveNewPerson),
        paymentMode,
        date,
        time,
        notes,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save entry.');
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingTransaction || isSavingRef.current || isSaving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      isSavingRef.current = true;
      setIsSaving(true);
      await onDelete(editingTransaction.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete entry.');
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-entry-title"
    >
      {/* Backdrop click close */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 w-full max-w-full md:max-w-lg max-h-[92dvh] flex flex-col rounded-t-3xl md:rounded-2xl border border-white/[0.1] bg-[#121216] shadow-2xl overflow-hidden">
        {/* Mobile grab handle */}
        <div className="md:hidden w-10 h-1 bg-zinc-700 rounded-full mx-auto mt-2.5 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 pt-3 pb-3 border-b border-white/[0.08] shrink-0">
          <h2 id="quick-entry-title" className="min-w-0 truncate text-base font-semibold text-zinc-100">
            {editingTransaction ? 'Edit Entry' : 'Quick Entry'}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {editingTransaction && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSaving}
                className={`min-h-[40px] px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  confirmDelete
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'text-zinc-400 hover:text-rose-400 hover:bg-zinc-800'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>{confirmDelete ? 'Tap to Confirm' : 'Delete'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close entry form"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          autoComplete="off"
          className="flex-1 min-h-0 w-full overflow-y-auto overscroll-y-contain px-4 sm:px-5 py-4 space-y-4"
        >
          {/* Huge Amount Input */}
          <div className="w-full min-w-0 rounded-2xl border border-white/[0.08] bg-[#18181D] px-3.5 sm:px-4 py-3.5 focus-within:border-zinc-400 transition-colors">
            <label htmlFor="tx-amount" className="block text-xs font-medium text-zinc-400 mb-1">
              Amount (INR)
            </label>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-mono-num text-2xl font-semibold text-zinc-400 select-none shrink-0">
                ₹
              </span>
              <input
                ref={amountInputRef}
                id="tx-amount"
                name="folio-entry-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={amountStr}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '');
                  setAmountStr(v);
                  if (error) setError('');
                }}
                placeholder="0"
                className="min-w-0 flex-1 w-full bg-transparent font-mono-num text-3xl font-bold text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Type + Context 1-tap switches */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <span className="block text-xs font-medium text-zinc-400 mb-1.5">Type</span>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#18181D] border border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => handleTypeChange('spent')}
                  className={`min-w-0 min-h-[40px] px-2 rounded-lg text-xs font-semibold transition-colors truncate ${
                    type === 'spent'
                      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  − Spent
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('received')}
                  className={`min-w-0 min-h-[40px] px-2 rounded-lg text-xs font-semibold transition-colors truncate ${
                    type === 'received'
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  + Received
                </button>
              </div>
            </div>

            <div className="min-w-0">
              <span className="block text-xs font-medium text-zinc-400 mb-1.5">Context</span>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#18181D] border border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => handleContextChange('business')}
                  className={`min-w-0 min-h-[40px] px-2 rounded-lg text-xs font-semibold transition-colors truncate ${
                    context === 'business'
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Business
                </button>
                <button
                  type="button"
                  onClick={() => handleContextChange('personal')}
                  className={`min-w-0 min-h-[40px] px-2 rounded-lg text-xs font-semibold transition-colors truncate ${
                    context === 'personal'
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Personal
                </button>
              </div>
            </div>
          </div>

          {/* Categories Quick-Pick */}
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-medium text-zinc-400">Category</span>
              <button
                type="button"
                onClick={() => setAddingCategory((v) => !v)}
                className="text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{addingCategory ? 'Cancel' : 'New Category'}</span>
              </button>
            </div>

            {addingCategory && (
              <div className="mb-2.5 flex items-center gap-2 min-w-0">
                <input
                  type="text"
                  name="folio-new-category"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={`New ${context} ${type} category...`}
                  className="min-w-0 flex-1 min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
                />
                <button
                  type="button"
                  onClick={handleQuickAddCategory}
                  className="min-h-[42px] px-3.5 rounded-xl bg-zinc-100 text-xs font-semibold text-zinc-950 hover:bg-white whitespace-nowrap shrink-0"
                >
                  Add
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 min-w-0">
              {matchingCategories.map((cat) => {
                const selected = cat.id === categoryId;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    className={`min-h-[38px] max-w-full px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors truncate ${
                      selected
                        ? 'border-zinc-200 bg-zinc-100 text-zinc-950'
                        : 'border-white/[0.08] bg-[#18181D] text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    {cat.name}
                    {cat.isArchived ? ' (Archived)' : ''}
                  </button>
                );
              })}
              {matchingCategories.length === 0 && (
                <p className="text-xs text-zinc-500">
                  No active categories here yet. Tap &ldquo;New Category&rdquo; above to add one.
                </p>
              )}
            </div>
          </div>

          {/* Payment Mode */}
          <div className="min-w-0">
            <span className="block text-xs font-medium text-zinc-400 mb-1.5">Payment Mode</span>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#18181D] border border-white/[0.06]">
              <button
                type="button"
                onClick={() => setPaymentMode('cash')}
                className={`min-w-0 min-h-[40px] px-2 rounded-lg text-xs font-semibold transition-colors truncate ${
                  paymentMode === 'cash'
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Cash
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode('online')}
                className={`min-w-0 min-h-[40px] px-2 rounded-lg text-xs font-semibold transition-colors truncate ${
                  paymentMode === 'online'
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Online
              </button>
            </div>
          </div>

          {/* Person / Entity (Optional) */}
          <div className="min-w-0">
            <label htmlFor="tx-person" className="block text-xs font-medium text-zinc-400 mb-1.5">
              Person / Party (Optional)
            </label>
            <input
              id="tx-person"
              name="folio-entry-party"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={personInput}
              onChange={(e) => {
                setPersonInput(e.target.value);
                setSelectedPersonId(null);
              }}
              placeholder="e.g. Supervisor A, Supplier, Labourer..."
              className="w-full min-w-0 min-h-[44px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
            />

            {personInput.trim() && !isExactSavedPerson && (
              <button
                type="button"
                onClick={() => setSaveNewPerson((v) => !v)}
                className="mt-2 flex items-start sm:items-center gap-2 max-w-full text-left text-xs text-zinc-300 hover:text-white"
              >
                <span
                  className={`mt-0.5 sm:mt-0 w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                    saveNewPerson
                      ? 'bg-zinc-100 border-zinc-100 text-zinc-950'
                      : 'border-zinc-600'
                  }`}
                >
                  {saveNewPerson && <Check className="w-3 h-3 stroke-[3]" />}
                </span>
                <UserPlus className="mt-0.5 sm:mt-0 w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="min-w-0 break-words">
                  Save &ldquo;{personInput.trim()}&rdquo; for quick selection next time
                </span>
              </button>
            )}

            {frequentPeople.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 min-w-0">
                {frequentPeople.map((p) => {
                  const active =
                    selectedPersonId === p.id ||
                    personInput.trim().toLowerCase() === p.name.toLowerCase();
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        if (active) {
                          setSelectedPersonId(null);
                          setPersonInput('');
                        } else {
                          setSelectedPersonId(p.id);
                          setPersonInput(p.name);
                        }
                      }}
                      className={`min-h-[34px] max-w-full px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors truncate ${
                        active
                          ? 'border-zinc-300 bg-zinc-800 text-white'
                          : 'border-white/[0.06] bg-[#18181D] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Date, Time & Notes */}
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="tx-date" className="block text-xs font-medium text-zinc-400 mb-1">
                Date
              </label>
              <input
                id="tx-date"
                name="folio-entry-date"
                type="date"
                autoComplete="off"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (error) setError('');
                }}
                className="block w-full min-w-0 max-w-full min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 font-mono-num text-xs text-zinc-100 focus:outline-none focus:border-zinc-400"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="tx-time" className="block text-xs font-medium text-zinc-400 mb-1">
                Time
              </label>
              <input
                id="tx-time"
                name="folio-entry-time"
                type="time"
                autoComplete="off"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  if (error) setError('');
                }}
                className="block w-full min-w-0 max-w-full min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3 font-mono-num text-xs text-zinc-100 focus:outline-none focus:border-zinc-400"
              />
            </div>
          </div>

          <div className="min-w-0">
            <label htmlFor="tx-notes" className="block text-xs font-medium text-zinc-400 mb-1">
              Notes (Optional)
            </label>
            <input
              id="tx-notes"
              name="folio-entry-notes"
              type="text"
              autoComplete="off"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Short description if helpful..."
              className="w-full min-w-0 min-h-[42px] rounded-xl border border-white/[0.1] bg-[#18181D] px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400"
            />
          </div>

          {error && (
            <p className="text-xs font-medium text-rose-400" role="alert">
              {error}
            </p>
          )}

          {/* Pinned Submit CTA */}
          <div className="pt-2 pb-safe">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full min-h-[48px] rounded-xl bg-zinc-100 text-sm font-semibold text-zinc-950 hover:bg-white active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {isSaving
                ? 'Saving...'
                : editingTransaction
                  ? 'Update Entry'
                  : 'Save Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
