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
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none top-[calc(env(safe-area-inset-top,0px)+12px)] md:top-[72px] pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]"
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
                : { opacity: 0, y: -14, scale: 0.94 }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scale: 1 }
            }
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: -10, scale: 0.96 }
            }
            transition={{
              duration: prefersReducedMotion ? 0.15 : 0.22,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={`pointer-events-auto inline-flex items-center gap-2.5 max-w-[min(calc(100vw-2rem),26rem)] rounded-[22px] border px-4 py-2.5 backdrop-blur-xl shadow-[0_12px_32px_rgba(0,0,0,0.5),0_2px_6px_rgba(0,0,0,0.3)] cursor-pointer select-none ${
              toast.tone === 'error'
                ? 'border-rose-500/30 bg-[#231318]/95 text-rose-100'
                : 'border-white/[0.12] bg-[#1C1C22]/92 text-zinc-100'
            }`}
          >
            {toast.tone === 'error' ? (
              <span
                aria-hidden="true"
                className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0"
              >
                <AlertCircle className="w-3.5 h-3.5 stroke-[2.25]" />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.6]" />
              </span>
            )}
            <span className="text-[13px] font-medium leading-snug tracking-[-0.005em] break-words">
              {toast.text}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
