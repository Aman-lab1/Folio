import React from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'success' | 'error';
}

interface ToastNotificationProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({
  toast,
  onDismiss,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]"
    >
      <AnimatePresence mode="wait">
        {toast && (
          <motion.div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
            onClick={onDismiss}
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.94 }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 1, scale: 1 }
            }
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96 }
            }
            transition={{
              duration: prefersReducedMotion ? 0.14 : 0.2,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={`pointer-events-auto inline-flex items-center gap-3 min-w-[200px] max-w-[min(calc(100vw-2rem),22rem)] rounded-[22px] border px-5 py-3.5 backdrop-blur-md shadow-[0_16px_40px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.28)] cursor-pointer select-none ${
              toast.tone === 'error'
                ? 'border-rose-500/30 bg-[#231318]/95 text-rose-100'
                : 'border-white/[0.12] bg-[#18181D]/95 text-zinc-100'
            }`}
          >
            {toast.tone === 'error' ? (
              <span
                aria-hidden="true"
                className="w-7 h-7 rounded-full bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0"
              >
                <AlertCircle className="w-4 h-4 stroke-[2.25]" />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
              </span>
            )}
            <span className="text-sm font-medium leading-snug tracking-[-0.005em] break-words">
              {toast.text}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
