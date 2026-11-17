import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmDialogSecondaryAction {
  label: string;
  variant?: 'default' | 'destructive' | 'primary';
  onClick: () => void | Promise<void>;
}

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  isBusy?: boolean;
  children?: React.ReactNode;
  secondaryAction?: ConfirmDialogSecondaryAction;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  isBusy = false,
  children,
  secondaryAction,
  onCancel,
  onConfirm,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isBusy, onCancel]);

  if (!isOpen) return null;

  const isDestructive = variant === 'destructive';

  const secondaryClass =
    secondaryAction?.variant === 'destructive'
      ? 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
      : secondaryAction?.variant === 'primary'
        ? 'bg-zinc-100 text-zinc-950 hover:bg-white'
        : 'border border-white/[0.1] bg-[#18181D] text-zinc-200 hover:bg-zinc-800';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div
        className="absolute inset-0"
        onClick={() => {
          if (!isBusy) onCancel();
        }}
        aria-hidden="true"
      />

      <div
        className={`relative z-10 w-full max-w-md rounded-2xl border bg-[#121216] p-6 shadow-2xl space-y-4 ${
          isDestructive ? 'border-rose-500/30' : 'border-white/[0.1]'
        }`}
      >
        <div className="flex items-start gap-3">
          {isDestructive && (
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3
              id="confirm-dialog-title"
              className="text-base font-semibold text-zinc-100"
            >
              {title}
            </h3>
            <p
              id="confirm-dialog-desc"
              className="mt-1.5 text-xs text-zinc-300 leading-relaxed"
            >
              {message}
            </p>
          </div>
        </div>

        {children && <div>{children}</div>}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="min-h-[44px] px-4 rounded-xl border border-white/[0.1] bg-[#18181D] text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          {secondaryAction && (
            <button
              type="button"
              disabled={isBusy}
              onClick={secondaryAction.onClick}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${secondaryClass}`}
            >
              {secondaryAction.label}
            </button>
          )}
          <button
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
            className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
              isDestructive
                ? 'bg-rose-500 text-white hover:bg-rose-600'
                : 'bg-zinc-100 text-zinc-950 hover:bg-white'
            }`}
          >
            {isBusy ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
