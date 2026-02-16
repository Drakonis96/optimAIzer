
import React, { useState } from 'react';
import { ChevronDown, Box, Cpu, Wallet } from 'lucide-react';
import { AppSettings, SystemPrompt } from '../types';
import { getModelsForProvider, PROVIDERS, TRANSLATIONS } from '../constants';

interface TopBarProps {
  settings: AppSettings;
  systemPrompts: SystemPrompt[];
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  sessionCostUsd: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  monthlyCostUsd: number;
  monthlyBudgetUsd: number;
  sessionBudgetUsd: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  settings,
  systemPrompts,
  onUpdateSetting,
  sessionCostUsd,
  sessionInputTokens,
  sessionOutputTokens,
  monthlyCostUsd,
  monthlyBudgetUsd,
  sessionBudgetUsd,
}) => {
  const [showCostHint, setShowCostHint] = useState(false);
  const t = TRANSLATIONS[settings.language];
  const providerModels = getModelsForProvider(settings.provider);
  const locale = settings.language === 'es' ? 'es-ES' : 'en-US';
  const formatCurrency = (value: number) => new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
  const sessionCost = formatCurrency(sessionCostUsd);
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const monthlyRatio = monthlyBudgetUsd > 0 ? (monthlyCostUsd / monthlyBudgetUsd) : 0;
  const sessionRatio = sessionBudgetUsd > 0 ? (sessionCostUsd / sessionBudgetUsd) : 0;
  const showMonthlyAlert = monthlyBudgetUsd > 0 && monthlyRatio >= 0.5;
  const monthlyAlertClass = monthlyRatio >= 0.9
    ? 'border-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.45)]'
    : monthlyRatio >= 0.75
      ? 'border-orange-500 shadow-[0_0_0_1px_rgba(249,115,22,0.45)]'
      : 'border-yellow-500 shadow-[0_0_0_1px_rgba(234,179,8,0.45)]';
  const sessionProgress = Math.max(0, Math.min(100, sessionRatio * 100));

  return (
    <div className="w-full grid grid-cols-2 gap-2 md:flex md:flex-wrap lg:flex-nowrap md:items-center md:justify-center md:gap-2">
      <div className="min-w-0 md:flex-1 lg:flex-none lg:min-w-[130px]">
        <label className="sr-only">{t.topBar.provider}</label>
        <div className="relative">
          <Cpu size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <select
            value={settings.provider}
            onChange={(e) => onUpdateSetting('provider', e.target.value)}
            className="w-full appearance-none bg-white/60 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-md py-1.5 pl-7 pr-7 text-xs md:text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      <div className="min-w-0 md:flex-1 lg:flex-none lg:min-w-[220px]">
        <label className="sr-only">{t.topBar.model}</label>
        <div className="relative">
          <Box size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <select
            value={settings.mainModel}
            onChange={(e) => onUpdateSetting('mainModel', e.target.value)}
            disabled={providerModels.length === 0}
            className="w-full appearance-none bg-white/60 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-md py-1.5 pl-7 pr-7 text-xs md:text-sm text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:opacity-50"
          >
            {providerModels.length === 0 && <option value="">Select Model</option>}
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      <div className="min-w-0 md:flex-1 lg:flex-none lg:min-w-[160px]">
        <label className="sr-only">{t.topBar.system}</label>
        <div className="relative">
          <select
            value={settings.selectedSystemPromptId}
            onChange={(e) => onUpdateSetting('selectedSystemPromptId', e.target.value)}
            className="w-full appearance-none bg-white/60 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-md py-1.5 pl-2.5 pr-7 text-xs md:text-sm text-indigo-600 dark:text-indigo-400 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500/50 truncate"
          >
            {systemPrompts.map((prompt) => (
              <option key={prompt.id} value={prompt.id} className="bg-surface text-zinc-900 dark:text-zinc-200">
                {prompt.name}
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-400/70 pointer-events-none" />
        </div>
      </div>

      <div className="relative min-w-0 col-span-2 md:col-span-1 md:flex-1 lg:flex-none lg:min-w-[190px]">
        {showMonthlyAlert && (
          <div className={`pointer-events-none absolute -inset-[4px] rounded-lg border-2 ${monthlyAlertClass}`} />
        )}
        {sessionBudgetUsd > 0 && (
          <svg
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            className="pointer-events-none absolute -inset-[2px] h-[calc(100%+4px)] w-[calc(100%+4px)]"
          >
            <rect
              x="1"
              y="1"
              width="98"
              height="38"
              rx="8"
              pathLength={100}
              fill="none"
              stroke="rgba(16,185,129,0.28)"
              strokeWidth="1.5"
              strokeDasharray="1.5 2.2"
            />
            <rect
              x="1"
              y="1"
              width="98"
              height="38"
              rx="8"
              pathLength={100}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${sessionProgress} 100`}
              strokeDashoffset="25"
            />
          </svg>
        )}
        <button
          type="button"
          onMouseEnter={() => setShowCostHint(true)}
          onMouseLeave={() => setShowCostHint(false)}
          onFocus={() => setShowCostHint(true)}
          onBlur={() => setShowCostHint(false)}
          onClick={() => setShowCostHint((prev) => !prev)}
          className="w-full flex items-center justify-between gap-2 bg-zinc-100/70 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 text-left"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Wallet size={13} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
            <span className="text-xs font-mono font-semibold text-zinc-800 dark:text-zinc-100 truncate">{sessionCost}*</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 shrink-0">
            {compact.format(sessionInputTokens)} / {compact.format(sessionOutputTokens)}
          </span>
        </button>
        {showCostHint && (
          <div className="absolute top-full mt-2 right-0 z-20 w-72 max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 text-[11px] leading-relaxed p-2.5 shadow-lg">
            <p>{t.topBar.costApproxHint}</p>
            <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 space-y-1">
              <p>
                {t.topBar.monthlyBudget}: {monthlyBudgetUsd > 0
                  ? `${formatCurrency(monthlyCostUsd)} / ${formatCurrency(monthlyBudgetUsd)} (${Math.min(999, monthlyRatio * 100).toFixed(1)}%)`
                  : t.topBar.budgetDisabled}
              </p>
              <p>
                {t.topBar.sessionBudget}: {sessionBudgetUsd > 0
                  ? `${sessionCost} / ${formatCurrency(sessionBudgetUsd)} (${Math.min(999, sessionRatio * 100).toFixed(1)}%)`
                  : t.topBar.budgetDisabled}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
