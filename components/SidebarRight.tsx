
import React, { useState } from 'react';
import { Sliders, Zap, History, Database, FileText, PanelRightClose, Infinity, Scale, Users, ChevronDown, Globe2, Code2, Wrench, Columns2, Plus, Minus, Save } from 'lucide-react';
import { AppSettings, ModelSelector, ReasoningEffort, ConciliumMode, ConciliumPreset } from '../types';
import { ConfirmationModal } from './ConfirmationModal';
import { getModelsForProvider, PROVIDERS, REASONING_EFFORT_LEVELS, supportsReasoningEffort, TRANSLATIONS, getProviderToolSupport, providerSupportsTemperature } from '../constants';

interface SidebarRightProps {
  settings: AppSettings;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  contextSummary: string;
  isSummarizing: boolean;
  onClose: () => void;
}

export const SidebarRight: React.FC<SidebarRightProps> = ({ 
  settings, 
  onUpdateSetting,
  contextSummary,
  isSummarizing,
  onClose
}) => {
  const CONCILIUM_MIN_MEMBERS = 2;
  const CONCILIUM_MAX_MEMBERS = 7;
  const t = TRANSLATIONS[settings.language];
  const [showTokenConfirm, setShowTokenConfirm] = useState(false);
  const showReasoningSlider = supportsReasoningEffort(settings.provider, settings.mainModel);
  const reasoningEffortIndex = Math.max(0, REASONING_EFFORT_LEVELS.indexOf(settings.reasoningEffort));
  const toolSupport = getProviderToolSupport(settings.provider);
  const mainTempSupported = providerSupportsTemperature(settings.provider);
  const supportsAnyTool = toolSupport.webSearch || toolSupport.codeExecution;
  const hasUnsupportedSelection =
    (settings.tooling.webSearch && !toolSupport.webSearch) ||
    (settings.tooling.codeExecution && !toolSupport.codeExecution);

  // Helper to determine color status based on value
  const getUsageStatus = (value: number, type: 'messages' | 'tokens') => {
    if (type === 'messages') {
        if (value <= 4) return { 
            color: 'text-stone-400', bg: 'bg-stone-100 dark:bg-stone-900/50', border: 'border-stone-200 dark:border-stone-700', 
            label: t.sidebarRight.usageLabels.minimal, accent: 'accent-stone-500', bar: 'bg-stone-400' 
        }; 
        if (value <= 10) return { 
            color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-200 dark:border-emerald-700/50', 
            label: t.sidebarRight.usageLabels.optimal, accent: 'accent-emerald-500', bar: 'bg-emerald-500' 
        }; 
        if (value <= 20) return { 
            color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/30', border: 'border-yellow-200 dark:border-yellow-700/50', 
            label: t.sidebarRight.usageLabels.moderate, accent: 'accent-yellow-500', bar: 'bg-yellow-500' 
        }; 
        if (value <= 35) return { 
            color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/30', border: 'border-orange-200 dark:border-orange-700/50', 
            label: t.sidebarRight.usageLabels.high, accent: 'accent-orange-500', bar: 'bg-orange-500' 
        }; 
        return { 
            color: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30', border: 'border-red-200 dark:border-red-700/50', 
            label: t.sidebarRight.usageLabels.heavy, accent: 'accent-red-500', bar: 'bg-red-500' 
        }; 
    } else {
        // Tokens logic
        if (value <= 1024) return { 
            color: 'text-stone-400', bg: 'bg-stone-100 dark:bg-stone-900/50', border: 'border-stone-200 dark:border-stone-700', 
            label: t.sidebarRight.usageLabels.concise, accent: 'accent-stone-500', bar: 'bg-stone-400' 
        };
        if (value <= 2048) return { 
            color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30', border: 'border-emerald-200 dark:border-emerald-700/50', 
            label: t.sidebarRight.usageLabels.standard, accent: 'accent-emerald-500', bar: 'bg-emerald-500' 
        };
        if (value <= 4096) return { 
            color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/30', border: 'border-yellow-200 dark:border-yellow-700/50', 
            label: t.sidebarRight.usageLabels.detailed, accent: 'accent-yellow-500', bar: 'bg-yellow-500' 
        };
        if (value <= 6144) return { 
            color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/30', border: 'border-orange-200 dark:border-orange-700/50', 
            label: t.sidebarRight.usageLabels.extensive, accent: 'accent-orange-500', bar: 'bg-orange-500' 
        };
        return { 
            color: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30', border: 'border-red-200 dark:border-red-700/50', 
            label: t.sidebarRight.usageLabels.maximum, accent: 'accent-red-500', bar: 'bg-red-500' 
        };
    }
  };

  const contextStatus = getUsageStatus(settings.maxContextMessages, 'messages');
  const tokenStatus = getUsageStatus(settings.maxOutputTokens, 'tokens');

  const getTemperatureStatus = (value: number) => {
    if (value <= 0.3) {
      return {
        label: t.sidebarRight.usageLabels.tempPrecise,
        color: 'text-stone-500 dark:text-stone-300',
        bg: 'bg-stone-100 dark:bg-stone-900/40',
        border: 'border-stone-200 dark:border-stone-700/50',
        accent: 'accent-stone-500',
        bar: 'bg-stone-400',
      };
    }
    if (value <= 0.9) {
      return {
        label: t.sidebarRight.usageLabels.tempBalanced,
        color: 'text-emerald-600 dark:text-emerald-400',
        bg: 'bg-emerald-50 dark:bg-emerald-900/30',
        border: 'border-emerald-200 dark:border-emerald-700/50',
        accent: 'accent-emerald-500',
        bar: 'bg-emerald-500',
      };
    }
    if (value <= 1.4) {
      return {
        label: t.sidebarRight.usageLabels.tempCreative,
        color: 'text-amber-600 dark:text-amber-400',
        bg: 'bg-amber-50 dark:bg-amber-900/30',
        border: 'border-amber-200 dark:border-amber-700/50',
        accent: 'accent-amber-500',
        bar: 'bg-amber-500',
      };
    }
    return {
      label: t.sidebarRight.usageLabels.tempWild,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-900/30',
      border: 'border-red-200 dark:border-red-700/50',
      accent: 'accent-red-500',
      bar: 'bg-red-500',
    };
  };

  const temperatureStatus = getTemperatureStatus(settings.temperature);

  const handleToggleUnlimited = () => {
      if (!settings.unlimitedOutputTokens) {
          setShowTokenConfirm(true);
      } else {
          onUpdateSetting('unlimitedOutputTokens', false);
      }
  };

  const confirmUnlimited = () => {
      onUpdateSetting('unlimitedOutputTokens', true);
  };

  const getConciliumModeLabel = (mode: ConciliumMode): string => {
    if (mode === 'factcheck') return t.sidebarRight.conciliumModeFactcheck;
    if (mode === 'codereview') return t.sidebarRight.conciliumModeCodeReview;
    if (mode === 'brainstorm') return t.sidebarRight.conciliumModeBrainstorm;
    if (mode === 'debate') return t.sidebarRight.conciliumModeDebate;
    return t.sidebarRight.conciliumModeConsensus;
  };

  const updateMember = (index: number, field: 'provider' | 'model', value: string) => {
    const newMembers = [...settings.conciliumMembers];
    const current = newMembers[index];
    if (!current) return;
    if (field === 'provider') {
      const provider = value;
      const providerModels = getModelsForProvider(provider);
      const model = providerModels.some((option) => option.id === current.model)
        ? current.model
        : (providerModels[0]?.id || '');
      newMembers[index] = { provider, model };
      onUpdateSetting('conciliumMembers', newMembers);
      return;
    }
    newMembers[index] = { ...current, model: value };
    onUpdateSetting('conciliumMembers', newMembers);
  };

  const addConciliumMember = () => {
    if (settings.conciliumMembers.length >= CONCILIUM_MAX_MEMBERS) return;
    const lastMember = settings.conciliumMembers[settings.conciliumMembers.length - 1];
    const provider = lastMember?.provider || settings.provider;
    const models = getModelsForProvider(provider);
    onUpdateSetting('conciliumMembers', [
      ...settings.conciliumMembers,
      { provider, model: models[0]?.id || '' },
    ]);
  };

  const removeConciliumMember = (index: number) => {
    if (settings.conciliumMembers.length <= CONCILIUM_MIN_MEMBERS) return;
    onUpdateSetting(
      'conciliumMembers',
      settings.conciliumMembers.filter((_, memberIndex) => memberIndex !== index)
    );
  };

  const applyConciliumPreset = (presetId: string) => {
    const preset = settings.conciliumPresets.find((item) => item.id === presetId);
    if (!preset) return;
    onUpdateSetting('conciliumMembers', [...preset.members]);
    onUpdateSetting('conciliumLeader', { ...preset.leader });
    onUpdateSetting('conciliumMode', preset.mode);
  };

  const saveCurrentConciliumPreset = () => {
    const fallbackName = `Preset ${settings.conciliumPresets.length + 1}`;
    const requestedName = window.prompt(t.sidebarRight.conciliumPresetNamePrompt, fallbackName);
    if (!requestedName || !requestedName.trim()) return;
    const preset: ConciliumPreset = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: requestedName.trim().slice(0, 40),
      members: settings.conciliumMembers.map((member) => ({ ...member })),
      leader: { ...settings.conciliumLeader },
      mode: settings.conciliumMode,
    };
    onUpdateSetting('conciliumPresets', [...settings.conciliumPresets, preset]);
  };

  const activeConciliumPresetId =
    settings.conciliumPresets.find((preset) => {
      if (preset.mode !== settings.conciliumMode) return false;
      if (preset.leader.provider !== settings.conciliumLeader.provider || preset.leader.model !== settings.conciliumLeader.model) {
        return false;
      }
      if (preset.members.length !== settings.conciliumMembers.length) return false;
      for (let index = 0; index < preset.members.length; index += 1) {
        const left = preset.members[index];
        const right = settings.conciliumMembers[index];
        if (!right) return false;
        if (left.provider !== right.provider || left.model !== right.model) return false;
      }
      return true;
    })?.id || '';

  const updateArenaMember = (index: number, field: 'provider' | 'model', value: string) => {
    const newMembers = [...settings.arenaMembers] as [ModelSelector, ModelSelector];
    const current = newMembers[index];
    if (!current) return;
    newMembers[index] = { ...current, [field]: value };
    onUpdateSetting('arenaMembers', newMembers);
  };

  const updateArenaTemperature = (index: number, value: number) => {
    const next = [...settings.arenaTemperatures] as [number, number];
    next[index] = value;
    onUpdateSetting('arenaTemperatures', next);
  };

  const updateTooling = (patch: Partial<AppSettings['tooling']>) => {
    onUpdateSetting('tooling', { ...settings.tooling, ...patch });
  };

  return (
    <div className="h-full flex flex-col bg-surface overflow-y-auto relative">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
            <Sliders size={16} className="text-primary" />
            {t.sidebarRight.configuration}
        </h2>
        <button 
          onClick={onClose}
          className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          <PanelRightClose size={18} />
        </button>
      </div>

      <div className="p-5 space-y-8">

        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Wrench size={16} className="text-zinc-400" />
                    <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.sidebarRight.modelTools}</label>
                </div>
                <button
                    onClick={() => onUpdateSetting('enableModelTools', !settings.enableModelTools)}
                    disabled={!supportsAnyTool}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 ${
                        settings.enableModelTools ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.enableModelTools ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
                {t.sidebarRight.modelToolsDesc}
            </p>
            {!supportsAnyTool && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t.sidebarRight.providerNoTools}</p>
            )}
            {supportsAnyTool && hasUnsupportedSelection && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t.sidebarRight.providerLimitedTools}</p>
            )}
            <div className={`space-y-2 pt-1 ${settings.enableModelTools ? '' : 'opacity-60'}`}>
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2">
                    <span className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <Globe2 size={14} className={toolSupport.webSearch ? 'text-emerald-500' : 'text-zinc-400'} />
                        {t.sidebarRight.webSearchTool}
                    </span>
                    <input
                        type="checkbox"
                        checked={settings.tooling.webSearch}
                        disabled={!settings.enableModelTools || !toolSupport.webSearch}
                        onChange={(e) => updateTooling({ webSearch: e.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                    />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2">
                    <span className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <Code2 size={14} className={toolSupport.codeExecution ? 'text-emerald-500' : 'text-zinc-400'} />
                        {t.sidebarRight.codeExecutionTool}
                    </span>
                    <input
                        type="checkbox"
                        checked={settings.tooling.codeExecution}
                        disabled={!settings.enableModelTools || !toolSupport.codeExecution}
                        onChange={(e) => updateTooling({ codeExecution: e.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                    />
                </label>
            </div>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />
        
        {/* Concilium Mode Section */}
        <div className={`rounded-xl p-4 border transition-colors ${settings.enableConcilium ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50' : 'bg-zinc-100 dark:bg-zinc-900/30 border-zinc-200 dark:border-zinc-800'}`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Scale size={18} className={settings.enableConcilium ? 'text-amber-600 dark:text-amber-500' : 'text-zinc-500'} />
                    <label className={`text-sm font-bold ${settings.enableConcilium ? 'text-amber-700 dark:text-amber-500' : 'text-zinc-700 dark:text-zinc-300'}`}>{t.sidebarRight.conciliumMode}</label>
                </div>
                <button
                    onClick={() => onUpdateSetting('enableConcilium', !settings.enableConcilium)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        settings.enableConcilium ? 'bg-amber-500' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.enableConcilium ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
            </div>
            
            <p className="text-xs text-zinc-500 mb-4">
                {t.sidebarRight.conciliumDesc}
            </p>

            {settings.enableConcilium && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide font-bold text-zinc-500">{t.sidebarRight.conciliumPresets}</p>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <select
                            value={activeConciliumPresetId}
                            onChange={(e) => applyConciliumPreset(e.target.value)}
                            className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/50 rounded px-2 py-1.5 pr-6 text-xs text-zinc-800 dark:text-zinc-300 focus:outline-none focus:border-amber-500 cursor-pointer"
                          >
                            <option value="">{t.sidebarRight.conciliumPresetApply}</option>
                            {settings.conciliumPresets.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                        <button
                          onClick={saveCurrentConciliumPreset}
                          className="inline-flex items-center gap-1 rounded border border-amber-300/70 dark:border-amber-700/60 bg-white/90 dark:bg-zinc-900/60 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                        >
                          <Save size={11} />
                          {t.sidebarRight.conciliumSavePreset}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide font-bold text-zinc-500">{t.sidebarRight.conciliumDeliberationMode}</p>
                      <div className="relative">
                        <select
                          value={settings.conciliumMode}
                          onChange={(e) => onUpdateSetting('conciliumMode', e.target.value as AppSettings['conciliumMode'])}
                          className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/50 rounded px-2 py-1.5 pr-6 text-xs text-zinc-800 dark:text-zinc-300 focus:outline-none focus:border-amber-500 cursor-pointer"
                        >
                          <option value="consensus">{getConciliumModeLabel('consensus')}</option>
                          <option value="factcheck">{getConciliumModeLabel('factcheck')}</option>
                          <option value="codereview">{getConciliumModeLabel('codereview')}</option>
                          <option value="brainstorm">{getConciliumModeLabel('brainstorm')}</option>
                          <option value="debate">{getConciliumModeLabel('debate')}</option>
                        </select>
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-700 dark:text-zinc-300">{t.sidebarRight.conciliumBlindEval}</span>
                        <button
                          onClick={() => onUpdateSetting('conciliumBlindEval', !settings.conciliumBlindEval)}
                          className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                            settings.conciliumBlindEval ? 'bg-amber-500' : 'bg-zinc-300 dark:bg-zinc-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              settings.conciliumBlindEval ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-500">{t.sidebarRight.conciliumBlindEvalDesc}</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                        <span className="flex items-center gap-2">
                          <Users size={12} /> {t.sidebarRight.theCouncil}
                        </span>
                        <span>{t.sidebarRight.conciliumMembersCount.replace('{count}', String(settings.conciliumMembers.length))}</span>
                      </div>

                      {settings.conciliumMembers.map((member, index) => {
                        const memberModels = getModelsForProvider(member.provider);
                        return (
                            <div key={index} className="flex gap-2">
                                 {/* Provider Select */}
                                 <div className="relative w-1/3">
                                    <select 
                                        value={member.provider}
                                        onChange={(e) => updateMember(index, 'provider', e.target.value)}
                                        className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/50 rounded px-2 py-1.5 text-xs text-zinc-800 dark:text-zinc-300 focus:outline-none focus:border-amber-500 cursor-pointer"
                                    >
                                        {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                 </div>
                                 {/* Model Select */}
                                 <div className="relative flex-1">
                                    <select 
                                        value={member.model}
                                        onChange={(e) => updateMember(index, 'model', e.target.value)}
                                        disabled={memberModels.length === 0}
                                        className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/50 rounded px-2 py-1.5 text-xs text-zinc-800 dark:text-zinc-300 focus:outline-none focus:border-amber-500 cursor-pointer"
                                    >
                                        {memberModels.length === 0 && <option value="">Select Model</option>}
                                        {memberModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                    </select>
                                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                                 </div>
                                 <button
                                    onClick={() => removeConciliumMember(index)}
                                    disabled={settings.conciliumMembers.length <= CONCILIUM_MIN_MEMBERS}
                                    className="h-8 w-8 inline-flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={t.sidebarRight.conciliumRemoveMember}
                                  >
                                    <Minus size={12} />
                                  </button>
                            </div>
                        );
                      })}

                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={addConciliumMember}
                          disabled={settings.conciliumMembers.length >= CONCILIUM_MAX_MEMBERS}
                          className="inline-flex items-center gap-1 rounded border border-amber-300/70 dark:border-amber-700/60 bg-white/90 dark:bg-zinc-900/60 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus size={11} />
                          {t.sidebarRight.conciliumAddMember}
                        </button>
                        {settings.conciliumMembers.length >= CONCILIUM_MAX_MEMBERS ? (
                          <span className="text-[10px] text-zinc-500">{t.sidebarRight.conciliumMaxMembersReached}</span>
                        ) : settings.conciliumMembers.length <= CONCILIUM_MIN_MEMBERS ? (
                          <span className="text-[10px] text-zinc-500">{t.sidebarRight.conciliumMinMembersReached}</span>
                        ) : (
                          <span className="text-[10px] text-zinc-500" />
                        )}
                      </div>
                    </div>
                </div>
            )}
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        {/* Arena Mode Section */}
        <div className={`rounded-xl p-4 border transition-colors ${settings.enableArena ? 'bg-cyan-50 dark:bg-cyan-950/20 border-cyan-200 dark:border-cyan-900/50' : 'bg-zinc-100 dark:bg-zinc-900/30 border-zinc-200 dark:border-zinc-800'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Columns2 size={18} className={settings.enableArena ? 'text-cyan-600 dark:text-cyan-500' : 'text-zinc-500'} />
              <label className={`text-sm font-bold ${settings.enableArena ? 'text-cyan-700 dark:text-cyan-400' : 'text-zinc-700 dark:text-zinc-300'}`}>{t.sidebarRight.arenaMode}</label>
            </div>
            <button
              onClick={() => onUpdateSetting('enableArena', !settings.enableArena)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                settings.enableArena ? 'bg-cyan-500' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.enableArena ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <p className="text-xs text-zinc-500 mb-3">{t.sidebarRight.arenaDesc}</p>

          {settings.enableArena && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
              {[0, 1].map((index) => {
                const member = settings.arenaMembers[index];
                if (!member) return null;
                const sideModels = getModelsForProvider(member.provider);
                const supportsTemperature = providerSupportsTemperature(member.provider);
                const tempValue = settings.arenaTemperatures[index] ?? settings.temperature;
                const tempStatus = getTemperatureStatus(tempValue);
                return (
                  <div key={index} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/40 p-3 space-y-2.5">
                    <p className="text-[10px] uppercase tracking-wide font-bold text-zinc-500">
                      {index === 0 ? t.sidebarRight.arenaLeft : t.sidebarRight.arenaRight}
                    </p>
                    <div className="flex gap-2">
                      <div className="relative w-1/3">
                        <select
                          value={member.provider}
                          onChange={(e) => updateArenaMember(index, 'provider', e.target.value)}
                          className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/50 rounded px-2 py-1.5 text-xs text-zinc-800 dark:text-zinc-300 focus:outline-none focus:border-cyan-500 cursor-pointer"
                        >
                          {PROVIDERS.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="relative flex-1">
                        <select
                          value={member.model}
                          onChange={(e) => updateArenaMember(index, 'model', e.target.value)}
                          disabled={sideModels.length === 0}
                          className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/50 rounded px-2 py-1.5 text-xs text-zinc-800 dark:text-zinc-300 focus:outline-none focus:border-cyan-500 cursor-pointer"
                        >
                          {sideModels.length === 0 && <option value="">Select Model</option>}
                          {sideModels.map((model) => (
                            <option key={model.id} value={model.id}>{model.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className={`flex items-center justify-between px-2 py-1 rounded border ${tempStatus.bg} ${tempStatus.border}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${tempStatus.bar}`} />
                          <span className={`text-xs font-mono font-semibold ${tempStatus.color}`}>{tempValue.toFixed(1)}</span>
                        </div>
                        <span className="text-[10px] uppercase tracking-wide text-zinc-500">{tempStatus.label}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={tempValue}
                        disabled={!supportsTemperature}
                        onChange={(e) => updateArenaTemperature(index, parseFloat(e.target.value))}
                        className={`w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer ${tempStatus.accent} disabled:opacity-40`}
                      />
                      {!supportsTemperature && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400">{t.sidebarRight.temperatureUnsupported}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />
        
        {/* Infinite Memory (RAG) Toggle */}
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Database size={16} className="text-zinc-400" />
                    <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.sidebarRight.infiniteMemory}</label>
                </div>
                <button
                    onClick={() => onUpdateSetting('enableInfiniteMemory', !settings.enableInfiniteMemory)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        settings.enableInfiniteMemory ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.enableInfiniteMemory ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
                {t.sidebarRight.infiniteMemoryDesc}
            </p>
            {settings.enableInfiniteMemory && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-500/20">
                    <Database size={12} className="text-indigo-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
                        {t.sidebarRight.ragNoEmbeddingModel}
                    </p>
                </div>
            )}
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        {/* Context Toggle */}
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <History size={16} className="text-zinc-400" />
                    <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.sidebarRight.includeHistory}</label>
                </div>
                <button
                    onClick={() => onUpdateSetting('enableContext', !settings.enableContext)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        settings.enableContext ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.enableContext ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
                {t.sidebarRight.includeHistoryDesc}
            </p>
        </div>

        {/* Smart Summary Toggle */}
        <div className={`space-y-3 transition-all duration-300 ${settings.enableContext ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FileText size={16} className="text-zinc-400" />
                    <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.sidebarRight.smartSummary}</label>
                </div>
                <button
                    onClick={() => onUpdateSetting('enableSummary', !settings.enableSummary)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        settings.enableSummary ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
                    }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settings.enableSummary ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
                {t.sidebarRight.smartSummaryDesc}
            </p>

            {/* Live Preview of Summary */}
            {settings.enableSummary && (
                <div className="mt-2 bg-zinc-100 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700/50 p-3 shadow-inner">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-200 dark:border-zinc-700/50">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{t.sidebarRight.livePreview}</span>
                        {isSummarizing ? (
                            <span className="flex items-center gap-1 text-[10px] text-indigo-400 animate-pulse">
                                <Zap size={10} /> {t.sidebarRight.generating}
                            </span>
                        ) : (
                            <span className="text-[10px] text-zinc-600">{t.sidebarRight.cached}</span>
                        )}
                    </div>
                    <pre className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
                        {contextSummary}
                    </pre>
                </div>
            )}
        </div>

        {/* Max Context Messages */}
        <div className={`space-y-4 transition-opacity duration-300 ${settings.enableContext ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Database size={16} className="text-zinc-400" />
                    <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.sidebarRight.contextWindow}</label>
                </div>
                <div className={`flex items-center gap-2 px-2 py-1 rounded border ${contextStatus.bg} ${contextStatus.border}`}>
                     <div className={`w-1.5 h-1.5 rounded-full ${contextStatus.bar}`} />
                     <span className={`text-xs font-mono font-semibold ${contextStatus.color}`}>
                        {settings.maxContextMessages}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500 border-l border-zinc-300 dark:border-zinc-700/50 pl-2">
                        {contextStatus.label}
                    </span>
                </div>
            </div>
            <input
                type="range"
                min="1"
                max="50"
                step="1"
                value={settings.maxContextMessages}
                onChange={(e) => onUpdateSetting('maxContextMessages', parseInt(e.target.value))}
                className={`w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer ${contextStatus.accent}`}
            />
            <p className="text-xs text-zinc-500">
                {t.sidebarRight.contextWindowDesc}
            </p>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-4" />

        {/* Temperature */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.sidebarRight.temperature}</label>
            <div className={`flex items-center gap-2 px-2 py-1 rounded border ${temperatureStatus.bg} ${temperatureStatus.border}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${temperatureStatus.bar}`} />
              <span className={`text-xs font-mono font-semibold ${temperatureStatus.color}`}>{settings.temperature.toFixed(1)}</span>
              <span className="text-[10px] uppercase tracking-wide text-zinc-500 border-l border-zinc-300 dark:border-zinc-700/50 pl-2">
                {temperatureStatus.label}
              </span>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={settings.temperature}
            disabled={!mainTempSupported}
            onChange={(e) => onUpdateSetting('temperature', parseFloat(e.target.value))}
            className={`w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer ${temperatureStatus.accent} disabled:opacity-40`}
          />
          <p className="text-xs text-zinc-500">{t.sidebarRight.temperatureDesc}</p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{t.sidebarRight.temperatureHelpGood}</p>
          <p className="text-[11px] text-amber-600 dark:text-amber-400">{t.sidebarRight.temperatureHelpRisk}</p>
          <p className="text-[11px] text-zinc-500">{t.sidebarRight.temperatureHelpTip}</p>
          {!mainTempSupported && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">{t.sidebarRight.temperatureUnsupported}</p>
          )}
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-4" />

        {/* Max Output Tokens with Unlimited Toggle */}
        <div className="space-y-4">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                    <Zap size={16} className="text-zinc-400" />
                    <div>
                        <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.sidebarRight.maxOutput}</label>
                        <p className="text-[10px] text-zinc-500">{t.sidebarRight.maxOutputDesc}</p>
                    </div>
                </div>
                
                <div className="flex flex-col items-end gap-2">
                    {/* Unlimited Toggle */}
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] uppercase tracking-wide font-bold ${settings.unlimitedOutputTokens ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-600'}`}>
                            {t.sidebarRight.unlimited}
                        </span>
                        <button
                            onClick={handleToggleUnlimited}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                                settings.unlimitedOutputTokens ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700'
                            }`}
                        >
                            <span
                                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                    settings.unlimitedOutputTokens ? 'translate-x-5' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                </div>
            </div>

            {settings.unlimitedOutputTokens ? (
                <div className="flex items-center justify-center p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-indigo-600 dark:text-indigo-300 text-xs font-medium gap-2">
                    <Infinity size={16} />
                    <span>{t.sidebarRight.noLimitActive}</span>
                </div>
            ) : (
                <>
                    <div className="flex justify-end">
                        <div className={`flex items-center gap-2 px-2 py-1 rounded border ${tokenStatus.bg} ${tokenStatus.border}`}>
                             <div className={`w-1.5 h-1.5 rounded-full ${tokenStatus.bar}`} />
                             <span className={`text-xs font-mono font-semibold ${tokenStatus.color}`}>
                                {settings.maxOutputTokens}
                            </span>
                            <span className="text-[10px] uppercase tracking-wide text-zinc-500 border-l border-zinc-300 dark:border-zinc-700/50 pl-2">
                                {tokenStatus.label}
                            </span>
                        </div>
                    </div>
                     <input
                        type="range"
                        min="256"
                        max="8192"
                        step="256"
                        value={settings.maxOutputTokens}
                        onChange={(e) => onUpdateSetting('maxOutputTokens', parseInt(e.target.value))}
                        className={`w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer ${tokenStatus.accent}`}
                    />
                </>
            )}
        </div>

        {showReasoningSlider && (
            <>
                <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-4" />
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t.sidebarRight.reasoningEffort}</label>
                        <span className="text-xs font-mono uppercase px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300">
                            {t.sidebarRight.reasoningEffortLevels[settings.reasoningEffort]}
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max={(REASONING_EFFORT_LEVELS.length - 1).toString()}
                        step="1"
                        value={reasoningEffortIndex}
                        onChange={(e) => onUpdateSetting('reasoningEffort', REASONING_EFFORT_LEVELS[parseInt(e.target.value, 10)] as ReasoningEffort)}
                        className="w-full h-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <p className="text-xs text-zinc-500">
                        {t.sidebarRight.reasoningEffortDesc}
                    </p>
                </div>
            </>
        )}

      </div>

      <ConfirmationModal 
        isOpen={showTokenConfirm}
        onClose={() => setShowTokenConfirm(false)}
        onConfirm={confirmUnlimited}
        title={t.sidebarRight.disableTokenLimitTitle}
        message={t.sidebarRight.disableTokenLimitMsg}
        confirmText={t.sidebarRight.disableTokenLimitBtn}
        cancelText={t.common.cancel}
      />
    </div>
  );
};
