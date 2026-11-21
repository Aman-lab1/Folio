import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuickEntryModal } from '../src/components/QuickEntryModal';
import type { Category, Person, Transaction } from '../src/types/cashbook';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  const categories: Category[] = [
    {
      id: 'cat-biz-spent',
      profileId: 'prof-1',
      name: 'Fuel & Vehicle',
      type: 'spent',
      context: 'business',
      isDefault: true,
      isArchived: false,
      usageCount: 10,
      lastUsedAt: null,
    },
    {
      id: 'cat-biz-recd',
      profileId: 'prof-1',
      name: 'Payments Received',
      type: 'received',
      context: 'business',
      isDefault: true,
      isArchived: false,
      usageCount: 5,
      lastUsedAt: null,
    },
    {
      id: 'cat-pers-recd-top',
      profileId: 'prof-1',
      name: 'Personal Income',
      type: 'received',
      context: 'personal',
      isDefault: true,
      isArchived: false,
      usageCount: 20,
      lastUsedAt: null,
    },
    {
      id: 'cat-pers-recd-other',
      profileId: 'prof-1',
      name: 'Other Income',
      type: 'received',
      context: 'personal',
      isDefault: true,
      isArchived: false,
      usageCount: 0,
      lastUsedAt: null,
    },
  ];
  const people: Person[] = [];

  // BUG 1: Fresh open with defaultContext='business' renders Spent + Business + Business Spent categories
  const freshHtml = renderToStaticMarkup(
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
  assert(freshHtml.includes('Fuel &amp; Vehicle'), 'Fresh open renders Business Spent category');
  assert(!freshHtml.includes('Payments Received'), 'Fresh open does not render Business Received category');
  assert(!freshHtml.includes('Other Income'), 'Fresh open does not render Personal Received category');

  // BUG 3 & BUG 4: Edit Entry for a Personal + Received transaction with non-top-usage category
  // Must render Personal active (no Business flicker) and the saved category highlighted on first frame
  const editingTx: Transaction = {
    id: 'tx-edit-1',
    profileId: 'prof-1',
    amountPaise: 25000,
    type: 'received',
    context: 'personal',
    categoryId: 'cat-pers-recd-other',
    categoryNameSnapshot: 'Other Income',
    personId: null,
    personNameSnapshot: null,
    paymentMode: 'online',
    date: '2026-11-21',
    time: '12:00',
    notes: 'Refund',
    createdAt: '2026-11-21T06:30:00.000Z',
    updatedAt: '2026-11-21T06:30:00.000Z',
  };

  const editHtml = renderToStaticMarkup(
    React.createElement(QuickEntryModal, {
      isOpen: true,
      onClose: () => {},
      profileId: 'prof-1',
      defaultPaymentMode: 'cash',
      defaultContext: 'business',
      categories,
      people,
      editingTransaction: editingTx,
      onSave: async () => {},
      onDelete: async () => {},
      onCreateCategory: async () => categories[0],
    })
  );

  // Personal button must have active class, Business button must NOT have active class
  const businessBtnMatch = editHtml.match(/<button[^>]*>Business<\/button>/);
  const personalBtnMatch = editHtml.match(/<button[^>]*>Personal<\/button>/);
  assert(businessBtnMatch && personalBtnMatch, 'Context buttons rendered');
  assert(
    !businessBtnMatch[0].includes('bg-zinc-100 text-zinc-950'),
    'Business must NOT be highlighted on initial frame when editing Personal transaction (Bug 4)'
  );
  assert(
    personalBtnMatch[0].includes('bg-zinc-100 text-zinc-950'),
    'Personal MUST be highlighted on initial frame when editing Personal transaction (Bug 4)'
  );

  // Saved category ("Other Income", usageCount=0) must be highlighted, not "Personal Income" (usageCount=20)
  const otherIncomeBtnMatch = editHtml.match(/<button[^>]*>Other Income<\/button>/);
  const personalIncomeBtnMatch = editHtml.match(/<button[^>]*>Personal Income<\/button>/);
  assert(otherIncomeBtnMatch && personalIncomeBtnMatch, 'Personal Received category pills rendered');
  assert(
    otherIncomeBtnMatch[0].includes('border-zinc-200 bg-zinc-100 text-zinc-950'),
    'Saved category pill MUST be highlighted on initial Edit Entry frame (Bug 3)'
  );
  assert(
    !personalIncomeBtnMatch[0].includes('border-zinc-200 bg-zinc-100 text-zinc-950'),
    'Higher-usage category pill must NOT steal highlight from saved category (Bug 3)'
  );

  console.log('ALL_POST_QA_VOL2_TESTS_PASSED');
}

runTests();
