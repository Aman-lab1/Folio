import React from 'react';
import { BarChart3, Clock, Home, Plus, Settings } from 'lucide-react';
import { AppTab } from '../types/cashbook';

interface BottomNavProps {
  activeTab: AppTab;
  onChangeTab: (tab: AppTab) => void;
  onOpenQuickAdd: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  onOpenQuickAdd,
}) => {
  const renderTab = (id: AppTab, label: string, Icon: React.FC<{ className?: string }>) => {
    const isActive = activeTab === id;
    return (
      <button
        type="button"
        onClick={() => onChangeTab(id)}
        className={`min-h-[48px] flex flex-col items-center justify-center gap-1 transition-colors ${
          isActive ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <Icon className="w-5 h-5" />
        <span className="text-xs sm:text-[13px] font-medium tracking-tight leading-none">{label}</span>
      </button>
    );
  };

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-white/[0.08] bg-[#09090B]/95 backdrop-blur-md pb-safe"
    >
      <div className="grid grid-cols-5 items-center h-[62px] px-1">
        {renderTab('home', 'Home', Home)}
        {renderTab('history', 'History', Clock)}

        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={onOpenQuickAdd}
            aria-label="Add new transaction"
            className="w-12 h-12 rounded-2xl bg-zinc-100 text-zinc-950 flex items-center justify-center shadow-lg hover:bg-white active:scale-95 transition-all"
          >
            <Plus className="w-6 h-6 stroke-[2.25]" />
          </button>
        </div>

        {renderTab('reports', 'Reports', BarChart3)}
        {renderTab('settings', 'Settings', Settings)}
      </div>
    </nav>
  );
};
