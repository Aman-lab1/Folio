import React from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Transaction } from '../types/cashbook';
import { formatDateHuman, formatPaise, formatTime12h } from '../utils/currency';

interface TransactionRowProps {
  transaction: Transaction;
  onSelect: (tx: Transaction) => void;
  showDate?: boolean;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({
  transaction,
  onSelect,
  showDate = false,
}) => {
  const isReceived = transaction.type === 'received';

  const metadataParts: string[] = [
    transaction.context === 'business' ? 'Business' : 'Personal',
    transaction.paymentMode === 'cash' ? 'Cash' : 'Online',
  ];

  if (showDate) {
    metadataParts.push(formatDateHuman(transaction.date));
  }
  metadataParts.push(formatTime12h(transaction.time));

  return (
    <button
      type="button"
      onClick={() => onSelect(transaction)}
      className="w-full min-h-[64px] flex items-center gap-3.5 px-4 py-3 text-left hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors border-b border-white/[0.06] last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          isReceived
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-rose-500/10 text-rose-400'
        }`}
        aria-hidden="true"
      >
        {isReceived ? (
          <ArrowDownLeft className="w-4 h-4" />
        ) : (
          <ArrowUpRight className="w-4 h-4" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-[15px] sm:text-base font-medium text-zinc-100 truncate">
            {transaction.categoryNameSnapshot}
          </p>
          {transaction.personNameSnapshot && (
            <p className="text-[13px] sm:text-sm text-zinc-300 truncate shrink-0 max-w-[140px]">
              · {transaction.personNameSnapshot}
            </p>
          )}
        </div>

        <p className="mt-0.5 text-[13px] text-zinc-400 truncate">
          {metadataParts.join(' · ')}
          {transaction.notes ? ` · ${transaction.notes}` : ''}
        </p>
      </div>

      <div className="text-right shrink-0 pl-2">
        <p
          className={`font-mono-num text-[15px] sm:text-base font-semibold ${
            isReceived ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {formatPaise(transaction.amountPaise, { type: transaction.type })}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {isReceived ? 'Received' : 'Spent'}
        </p>
      </div>
    </button>
  );
};
