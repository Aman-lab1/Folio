import React from 'react';
import { Lock, Plus } from 'lucide-react';
import { AppTab, Profile } from '../types/cashbook';
import { PWAInstallButton } from './PWAInstallButton';

interface TopBarProps {
  activeTab: AppTab;
  onChangeTab: (tab: AppTab) => void;
  activeProfile: Profile;
  onOpenQuickAdd: () => void;
  onLockOrSwitch: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string }> = [
  { id: 'home', label: 'Dashboard' },
  { id: 'history', label: 'History' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onChangeTab,
  activeProfile,
  onOpenQuickAdd,
  onLockOrSwitch,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#09090B]/90 backdrop-blur-md">
      {/* Desktop 3-Zone Top Bar Contract */}
      <div className="hidden md:flex max-w-6xl mx-auto h-16 px-6 items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onChangeTab('home')}
          className="font-display text-lg font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0 hover:text-white transition-colors"
        >
          Folio
        </button>

        <nav className="flex items-center gap-6" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeTab(item.id)}
                className={`min-h-[40px] px-1 text-sm font-medium whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                  isActive
                    ? 'border-zinc-100 text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton variant="compact" />
          <button
            type="button"
            onClick={onOpenQuickAdd}
            className="min-h-[40px] flex items-center gap-2 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Entry</span>
          </button>
        </div>
      </div>

      {/* Mobile Compact App Bar (<= 52px height) */}
      <div className="flex md:hidden h-[52px] px-4 items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onChangeTab('home')}
          className="font-display text-base font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0"
        >
          Folio
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <PWAInstallButton variant="compact" />
          <button
            type="button"
            onClick={onLockOrSwitch}
            className="min-h-[40px] max-w-[160px] flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
            title="Switch or lock profile"
          >
            {activeProfile.pinHash && <Lock className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
            <span className="truncate">{activeProfile.name}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
