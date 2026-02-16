import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  ChevronDown,
  Download,
  Eye,
  FileCode,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Languages,
  List,
  ListOrdered,
  Loader2,
  MessageSquareQuote,
  Pencil,
  PanelRight,
  PanelRightClose,
  RefreshCw,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
  Bot,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sendChatMessage, sendConciliumMessage, createStreamingRequestId, cancelStreamingRequest } from '../services/api';
import {
  AppSettings,
  Language,
  ModelOption,
  NoteDocument,
  NoteInsertionMode,
  NotesWorkspaceState,
} from '../types';
import { ConfirmationModal } from './ConfirmationModal';
import { NOTES_PREVIEW_CONTENT_EDITABLE } from '../utils/uiBehavior';

interface ProviderOption {
  id: string;
  name: string;
  models: ModelOption[];
}

interface NotesWorkspaceProps {
  language: Language;
  settings: AppSettings;
  workspace: NotesWorkspaceState;
  activeNote: NoteDocument | null;
  availableProviders: ProviderOption[];
  onCreateNote: () => void;
  onUpdateNoteContent: (noteId: string, content: string) => void;
  onUpdateWorkspace: React.Dispatch<React.SetStateAction<NotesWorkspaceState>>;
  onManualSave: () => Promise<boolean>;
  defaultAiStyles: string[];
  rightSidebarOpen: boolean;
  onCloseRightSidebar: () => void;
  rightSidebarWidth: number;
  onStartRightSidebarResize: () => void;
}

type AssistantMode = 'edit' | 'translation' | 'synonyms' | 'rephrase';
type SuggestionKind = 'synonyms' | 'rephrase';

type SelectionSnapshot = {
  noteId: string;
  start: number;
  end: number;
  text: string;
};

const COPY = {
  es: {
    emptyTitle: 'No hay nota activa',
    emptyBody: 'Crea una nota nueva para empezar.',
    newNote: 'Nueva nota',
    saveNow: 'Guardar ahora',
    saving: 'Guardando...',
    saved: 'Guardado',
    saveError: 'No se pudo guardar',
    export: 'Exportar',
    markdown: 'Markdown (.md)',
    text: 'Texto (.txt)',
    pdf: 'PDF (.pdf)',
    editor: 'Editor Markdown',
    aiPanel: 'Asistente IA',
    undo: 'Deshacer',
    redo: 'Rehacer',
    selectTextHint: 'Selecciona texto en el editor para aplicar IA sobre ese fragmento.',
    mode: 'Modo',
    modeEdit: 'Edición',
    modeTranslation: 'Traducción',
    modeSynonyms: 'Sinónimos',
    modeRephrase: 'Reformulación',
    customPrompt: 'Prompt personalizado',
    customPromptPlaceholder: 'Ej: Hazlo más preciso y directo sin perder contexto.',
    applyPrompt: 'Aplicar prompt',
    insertionMode: 'Inserción del resultado',
    replace: 'Sustituir selección',
    insertBelow: 'Insertar debajo (separado)',
    styles: 'Estilos rápidos',
    addStyle: 'Añadir estilo',
    addStylePlaceholder: 'Nombre del nuevo estilo',
    translationTarget: 'Idioma destino',
    zoom: 'Zoom lectura',
    viewEditor: 'Editor',
    viewPreview: 'Vista previa',
    runTranslation: 'Traducir selección',
    runSynonyms: 'Buscar sinónimos',
    runRephrase: 'Reformular frase',
    streamingResult: 'Resultado en streaming',
    waiting: 'Esperando respuesta...',
    aiError: 'Error de IA',
    noSelection: 'No hay texto seleccionado.',
    suggestions: 'Opciones',
    regenerate: 'Regenerar',
    close: 'Cerrar',
    clickWord: 'Haz clic en una palabra del texto interactivo para ver sinónimos.',
    interactiveText: 'Texto interactivo',
    concilium: 'Concilio',
    conciliumOpen: 'Abrir Concilio',
    conciliumClose: 'Cerrar Concilio',
    rightPanelOpen: 'Abrir menú derecho',
    rightPanelClose: 'Ocultar menú derecho',
    conciliumPrompt: 'Consulta para el Concilio',
    conciliumPromptPlaceholder: 'Pregunta o instrucción para debatir entre modelos...',
    conciliumRun: 'Ejecutar Concilio',
    conciliumRunning: 'Concilio en ejecución...',
    conciliumMembers: 'Modelos del Concilio',
    conciliumSummary: 'Resumen final (modelo activo)',
    addMember: 'Añadir modelo',
    removeMember: 'Quitar',
    removeStyle: 'Eliminar estilo',
    maxMembers: 'Máximo 3 modelos',
    minMembers: 'Mínimo 1 modelo',
    selectionLabel: 'Selección activa',
    styleProtectedTitle: 'Estilo protegido',
    styleProtectedConfirm: 'Entendido',
    styleProtectedMessage: (style: string) => `El estilo "${style}" viene por defecto y no se puede eliminar.`,
  },
  en: {
    emptyTitle: 'No active note',
    emptyBody: 'Create a new note to start.',
    newNote: 'New note',
    saveNow: 'Save now',
    saving: 'Saving...',
    saved: 'Saved',
    saveError: 'Save failed',
    export: 'Export',
    markdown: 'Markdown (.md)',
    text: 'Text (.txt)',
    pdf: 'PDF (.pdf)',
    editor: 'Markdown editor',
    aiPanel: 'AI assistant',
    undo: 'Undo',
    redo: 'Redo',
    selectTextHint: 'Select text in the editor to apply AI to that fragment only.',
    mode: 'Mode',
    modeEdit: 'Editing',
    modeTranslation: 'Translation',
    modeSynonyms: 'Synonyms',
    modeRephrase: 'Rephrase',
    customPrompt: 'Custom prompt',
    customPromptPlaceholder: 'Example: Make it clearer and more concise while keeping context.',
    applyPrompt: 'Apply prompt',
    insertionMode: 'Result insertion',
    replace: 'Replace selection',
    insertBelow: 'Insert below (separated)',
    styles: 'Quick styles',
    addStyle: 'Add style',
    addStylePlaceholder: 'New style name',
    translationTarget: 'Target language',
    zoom: 'Reading zoom',
    viewEditor: 'Editor',
    viewPreview: 'Preview',
    runTranslation: 'Translate selection',
    runSynonyms: 'Find synonyms',
    runRephrase: 'Rephrase selection',
    streamingResult: 'Streaming result',
    waiting: 'Waiting for response...',
    aiError: 'AI error',
    noSelection: 'No text selected.',
    suggestions: 'Options',
    regenerate: 'Regenerate',
    close: 'Close',
    clickWord: 'Click a word from the interactive text to get synonyms.',
    interactiveText: 'Interactive text',
    concilium: 'Concilium',
    conciliumOpen: 'Open Concilium',
    conciliumClose: 'Close Concilium',
    rightPanelOpen: 'Open right menu',
    rightPanelClose: 'Hide right menu',
    conciliumPrompt: 'Concilium prompt',
    conciliumPromptPlaceholder: 'Question or instruction for model deliberation...',
    conciliumRun: 'Run Concilium',
    conciliumRunning: 'Concilium running...',
    conciliumMembers: 'Concilium models',
    conciliumSummary: 'Final summary (active model)',
    addMember: 'Add model',
    removeMember: 'Remove',
    removeStyle: 'Remove style',
    maxMembers: 'Max 3 models',
    minMembers: 'Min 1 model',
    selectionLabel: 'Active selection',
    styleProtectedTitle: 'Protected style',
    styleProtectedConfirm: 'Understood',
    styleProtectedMessage: (style: string) => `The style "${style}" is built-in and cannot be deleted.`,
  },
} as const;

const DEFAULT_TRANSLATION_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Italian',
  'Japanese',
];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const toPlainText = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeSuggestions = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 5);
    }
  } catch {
    // fallback below
  }

  return trimmed
    .split(/\n|;/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
};

const buildSuggestionPrompt = (kind: SuggestionKind, sourceText: string, language: Language): string => {
  const instruction = kind === 'synonyms'
    ? language === 'es'
      ? 'Devuelve exactamente 5 sinónimos adecuados para esta palabra o expresión.'
      : 'Return exactly 5 suitable synonyms for this word or expression.'
    : language === 'es'
      ? 'Devuelve exactamente 5 reformulaciones alternativas para esta frase.'
      : 'Return exactly 5 alternative rephrasings for this phrase.';

  return `${instruction}\n\n${language === 'es' ? 'Texto:' : 'Text:'} "${sourceText}"\n\nReturn format: JSON array of strings.`;
};

const buildSelectionEditPrompt = (
  mode: AssistantMode,
  selectedText: string,
  customPrompt: string,
  translationTarget: string,
  language: Language
): string => {
  if (mode === 'translation') {
    return language === 'es'
      ? `Traduce el siguiente texto al idioma "${translationTarget}" manteniendo significado y tono.\n\nTexto:\n"""\n${selectedText}\n"""`
      : `Translate the following text into "${translationTarget}" while preserving meaning and tone.\n\nText:\n"""\n${selectedText}\n"""`;
  }

  return language === 'es'
    ? `Actualiza únicamente el fragmento seleccionado siguiendo esta instrucción: ${customPrompt}\n\nFragmento:\n"""\n${selectedText}\n"""`
    : `Update only the selected fragment using this instruction: ${customPrompt}\n\nSelected fragment:\n"""\n${selectedText}\n"""`;
};

export const NotesWorkspace: React.FC<NotesWorkspaceProps> = ({
  language,
  settings,
  workspace,
  activeNote,
  availableProviders,
  onCreateNote,
  onUpdateNoteContent,
  onUpdateWorkspace,
  onManualSave,
  defaultAiStyles,
  rightSidebarOpen,
  onCloseRightSidebar,
  rightSidebarWidth,
  onStartRightSidebarResize,
}) => {
  const t = COPY[language];
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('edit');
  const [customPrompt, setCustomPrompt] = useState('');
  const [newStyle, setNewStyle] = useState('');
  const [selectionText, setSelectionText] = useState('');
  const [aiStreamingText, setAiStreamingText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [conciliumOpen, setConciliumOpen] = useState(false);
  const [conciliumPrompt, setConciliumPrompt] = useState('');
  const [conciliumBusy, setConciliumBusy] = useState(false);
  const [conciliumOutputs, setConciliumOutputs] = useState<Array<{ provider: string; model: string; content: string; completed: boolean }>>([]);
  const [conciliumSummary, setConciliumSummary] = useState('');
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [suggestionPopup, setSuggestionPopup] = useState<{
    open: boolean;
    x: number;
    y: number;
    sourceText: string;
    kind: SuggestionKind;
    options: string[];
  }>({ open: false, x: 0, y: 0, sourceText: '', kind: 'synonyms', options: [] });
  const [protectedStyleToDelete, setProtectedStyleToDelete] = useState<string | null>(null);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => window.innerWidth >= 1024);
  const [viewMode, setViewMode] = useState<'editor' | 'preview'>('editor');

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamRequestIdRef = useRef<string | null>(null);
  const selectionSnapshotRef = useRef<SelectionSnapshot | null>(null);
  const transformBaselineRef = useRef<{ noteId: string; source: string; mode: NoteInsertionMode } | null>(null);

  const textScale = Math.max(70, Math.min(180, workspace.readingZoom || 100));
  const interactiveText = useMemo(() => toPlainText(activeNote?.content || ''), [activeNote?.content]);
  const defaultStyleSet = useMemo(() => new Set(defaultAiStyles.map((style) => style.toLowerCase())), [defaultAiStyles]);

  const cancelCurrentRequest = useCallback(() => {
    if (streamRequestIdRef.current) {
      void cancelStreamingRequest(streamRequestIdRef.current);
      streamRequestIdRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setAiBusy(false);
    setConciliumBusy(false);
    setSuggestionsBusy(false);
    transformBaselineRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelCurrentRequest();
    };
  }, [cancelCurrentRequest]);

  useEffect(() => {
    if (!activeNote) {
      setUndoStack([]);
      setRedoStack([]);
      return;
    }
    setUndoStack([]);
    setRedoStack([]);
  }, [activeNote?.id]);

  useEffect(() => {
    const updateViewport = () => {
      setIsDesktopViewport(window.innerWidth >= 1024);
    };

    window.addEventListener('resize', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  const getSelection = (): SelectionSnapshot | null => {
    if (!activeNote || !editorRef.current) return null;
    const start = editorRef.current.selectionStart ?? 0;
    const end = editorRef.current.selectionEnd ?? 0;
    if (end <= start) return null;
    const text = activeNote.content.slice(start, end);
    if (!text.trim()) return null;
    return {
      noteId: activeNote.id,
      start,
      end,
      text,
    };
  };

  const updateSelectionFromEditor = () => {
    const selection = getSelection();
    setSelectionText(selection?.text || '');
  };

  const pushUndoState = (content: string) => {
    setUndoStack((prev) => [...prev.slice(-199), content]);
  };

  const applyContentChange = (nextContent: string, options?: { trackHistory?: boolean }) => {
    if (!activeNote) return;
    if (nextContent === activeNote.content) return;

    const trackHistory = options?.trackHistory !== false;
    if (trackHistory) {
      pushUndoState(activeNote.content);
      setRedoStack([]);
    }

    onUpdateNoteContent(activeNote.id, nextContent);
  };

  const replaceCurrentSelection = (replacement: string) => {
    const snapshot = selectionSnapshotRef.current;
    if (!snapshot || !activeNote || snapshot.noteId !== activeNote.id) return;

    const source = activeNote.content;
    const next = `${source.slice(0, snapshot.start)}${replacement}${source.slice(snapshot.end)}`;
    applyContentChange(next);

    requestAnimationFrame(() => {
      const target = editorRef.current;
      if (!target) return;
      const caret = snapshot.start + replacement.length;
      target.focus();
      target.setSelectionRange(caret, caret);
      setSelectionText('');
    });
  };

  const insertBelowSelection = (generatedText: string) => {
    const snapshot = selectionSnapshotRef.current;
    if (!snapshot || !activeNote || snapshot.noteId !== activeNote.id) return;

    const source = activeNote.content;
    const before = source.slice(0, snapshot.end);
    const after = source.slice(snapshot.end);
    const prefix = before.endsWith('\n') ? '\n' : '\n\n';
    const suffix = after.startsWith('\n') ? '' : '\n\n';
    const block = `${prefix}${generatedText}${suffix}`;
    const next = `${source.slice(0, snapshot.end)}${block}${source.slice(snapshot.end)}`;
    applyContentChange(next);
  };

  const runSelectionTransformation = async (params: {
    mode: AssistantMode;
    customPrompt: string;
    styleName?: string;
  }) => {
    if (!activeNote) return;
    const selection = getSelection();
    if (!selection) {
      setAiError(t.noSelection);
      return;
    }

    cancelCurrentRequest();
    selectionSnapshotRef.current = selection;
    transformBaselineRef.current = {
      noteId: selection.noteId,
      source: activeNote.content,
      mode: workspace.insertionMode,
    };
    setAiError('');
    setAiStreamingText('');
    setAiBusy(true);
    const requestId = createStreamingRequestId();
    streamRequestIdRef.current = requestId;
    const abort = new AbortController();
    abortControllerRef.current = abort;

    const prompt = params.styleName
      ? buildSelectionEditPrompt('edit', selection.text, params.styleName, workspace.translationTargetLanguage, language)
      : buildSelectionEditPrompt(
          params.mode,
          selection.text,
          params.customPrompt,
          workspace.translationTargetLanguage,
          language,
        );

    try {
      let generated = '';
      let historyPushed = false;
      await sendChatMessage(
        {
          provider: settings.provider,
          model: settings.mainModel,
          messages: [{ role: 'user', content: prompt }],
          systemPrompt:
            'You transform text fragments. Return only the transformed text, without explanations, quotes, markdown fences, or extra commentary.',
          temperature: 0.4,
          reasoningEffort: settings.reasoningEffort,
          requestId,
        },
        {
          onToken: (token) => {
            generated += token;
            setAiStreamingText(generated);
            const snapshot = selectionSnapshotRef.current;
            const baseline = transformBaselineRef.current;
            if (!snapshot || !baseline || baseline.noteId !== snapshot.noteId) return;
            if (!historyPushed) {
              pushUndoState(baseline.source);
              setRedoStack([]);
              historyPushed = true;
            }

            const normalizedGenerated = generated;
            const nextContent = baseline.mode === 'insert_below'
              ? (() => {
                  const before = baseline.source.slice(0, snapshot.end);
                  const after = baseline.source.slice(snapshot.end);
                  const prefix = before.endsWith('\n') ? '\n' : '\n\n';
                  const suffix = after.startsWith('\n') ? '' : '\n\n';
                  return `${before}${prefix}${normalizedGenerated}${normalizedGenerated ? suffix : ''}${after}`;
                })()
              : `${baseline.source.slice(0, snapshot.start)}${normalizedGenerated}${baseline.source.slice(snapshot.end)}`;

            onUpdateNoteContent(snapshot.noteId, nextContent);
          },
          onDone: () => {
            const snapshot = selectionSnapshotRef.current;
            const baseline = transformBaselineRef.current;
            const clean = generated.trim();
            if (snapshot && baseline && clean) {
              requestAnimationFrame(() => {
                const target = editorRef.current;
                if (!target) return;
                target.focus();
                if (baseline.mode === 'insert_below') {
                  const before = baseline.source.slice(0, snapshot.end);
                  const prefix = before.endsWith('\n') ? '\n' : '\n\n';
                  const caret = snapshot.end + prefix.length + clean.length;
                  target.setSelectionRange(caret, caret);
                } else {
                  const caret = snapshot.start + clean.length;
                  target.setSelectionRange(caret, caret);
                  setSelectionText('');
                }
              });
            }
            setAiBusy(false);
            streamRequestIdRef.current = null;
            abortControllerRef.current = null;
            transformBaselineRef.current = null;
          },
          onError: (error) => {
            setAiError(error || 'AI request failed');
            setAiBusy(false);
            streamRequestIdRef.current = null;
            abortControllerRef.current = null;
            transformBaselineRef.current = null;
          },
        },
        abort.signal,
      );
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        setAiError(error?.message || 'AI request failed');
      }
      setAiBusy(false);
      streamRequestIdRef.current = null;
      abortControllerRef.current = null;
      transformBaselineRef.current = null;
    }
  };

  const requestSuggestions = async (params: { kind: SuggestionKind; sourceText: string; x: number; y: number }) => {
    const sourceText = params.sourceText.trim();
    if (!sourceText) return;

    cancelCurrentRequest();
    setSuggestionsBusy(true);
    setSuggestionsError('');
    setSuggestionPopup({ open: true, x: params.x, y: params.y, sourceText, kind: params.kind, options: [] });
    const requestId = createStreamingRequestId();
    streamRequestIdRef.current = requestId;
    const abort = new AbortController();
    abortControllerRef.current = abort;

    let output = '';
    try {
      await sendChatMessage(
        {
          provider: settings.provider,
          model: settings.mainModel,
          messages: [{ role: 'user', content: buildSuggestionPrompt(params.kind, sourceText, language) }],
          systemPrompt: 'Return exactly a JSON array with 5 short strings. No extra text.',
          temperature: 0.7,
          reasoningEffort: settings.reasoningEffort,
          requestId,
        },
        {
          onToken: (token) => {
            output += token;
          },
          onDone: () => {
            const options = normalizeSuggestions(output);
            setSuggestionPopup((prev) => ({ ...prev, options }));
            setSuggestionsBusy(false);
            streamRequestIdRef.current = null;
            abortControllerRef.current = null;
          },
          onError: (error) => {
            setSuggestionsError(error || 'Suggestion request failed');
            setSuggestionsBusy(false);
            streamRequestIdRef.current = null;
            abortControllerRef.current = null;
          },
        },
        abort.signal,
      );
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        setSuggestionsError(error?.message || 'Suggestion request failed');
      }
      setSuggestionsBusy(false);
      streamRequestIdRef.current = null;
      abortControllerRef.current = null;
    }
  };

  const applySuggestion = (replacement: string) => {
    const snapshot = getSelection();
    if (!activeNote) return;

    if (snapshot) {
      selectionSnapshotRef.current = snapshot;
      replaceCurrentSelection(replacement);
    } else {
      applyContentChange(`${activeNote.content}\n\n${replacement}`.trim());
    }

    setSuggestionPopup((prev) => ({ ...prev, open: false }));
  };

  const appendStyle = () => {
    const style = newStyle.trim();
    if (!style) return;
    onUpdateWorkspace((prev) => {
      if (prev.aiStyles.some((item) => item.toLowerCase() === style.toLowerCase())) return prev;
      return { ...prev, aiStyles: [...prev.aiStyles, style] };
    });
    setNewStyle('');
  };

  const removeStyle = (style: string) => {
    if (defaultStyleSet.has(style.toLowerCase())) {
      setProtectedStyleToDelete(style);
      return;
    }
    onUpdateWorkspace((prev) => ({
      ...prev,
      aiStyles: prev.aiStyles.filter((item) => item !== style),
    }));
  };

  const updateInsertionMode = (mode: NoteInsertionMode) => {
    onUpdateWorkspace((prev) => ({ ...prev, insertionMode: mode }));
  };

  const updateTranslationLanguage = (target: string) => {
    onUpdateWorkspace((prev) => ({ ...prev, translationTargetLanguage: target }));
  };

  const updateZoom = (delta: number) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      readingZoom: Math.max(70, Math.min(180, (prev.readingZoom || 100) + delta)),
    }));
  };

  const updateConciliumMember = (index: number, field: 'provider' | 'model', value: string) => {
    onUpdateWorkspace((prev) => {
      const next = [...prev.conciliumMembers];
      const current = next[index];
      if (!current) return prev;

      if (field === 'provider') {
        const provider = availableProviders.find((item) => item.id === value) || availableProviders[0];
        if (!provider) return prev;
        next[index] = {
          provider: provider.id,
          model: provider.models[0]?.id || '',
        };
      } else {
        next[index] = {
          ...current,
          model: value,
        };
      }

      return { ...prev, conciliumMembers: next };
    });
  };

  const addConciliumMember = () => {
    onUpdateWorkspace((prev) => {
      if (prev.conciliumMembers.length >= 3) return prev;
      const provider = availableProviders.find((item) => item.id === settings.provider) || availableProviders[0];
      if (!provider) return prev;
      return {
        ...prev,
        conciliumMembers: [...prev.conciliumMembers, { provider: provider.id, model: provider.models[0]?.id || '' }],
      };
    });
  };

  const removeConciliumMember = (index: number) => {
    onUpdateWorkspace((prev) => {
      if (prev.conciliumMembers.length <= 1) return prev;
      const next = prev.conciliumMembers.filter((_, memberIndex) => memberIndex !== index);
      return { ...prev, conciliumMembers: next };
    });
  };

  const runConcilium = async () => {
    const promptSource = conciliumPrompt.trim() || selectionText.trim();
    if (!promptSource) return;

    cancelCurrentRequest();
    setConciliumOutputs(
      workspace.conciliumMembers.map((member) => ({
        provider: member.provider,
        model: member.model,
        content: '',
        completed: false,
      })),
    );
    setConciliumSummary('');
    setConciliumBusy(true);
    const requestId = createStreamingRequestId();
    streamRequestIdRef.current = requestId;
    const abort = new AbortController();
    abortControllerRef.current = abort;

    try {
      await sendConciliumMessage(
        {
          members: workspace.conciliumMembers.map((member) => ({ provider: member.provider, model: member.model })),
          leader: { provider: settings.provider, model: settings.mainModel },
          messages: [{ role: 'user', content: promptSource }],
          systemPrompt:
            'You are a specialist contributor. Provide a structured opinion with strengths, risks, and recommendations.',
          leaderSystemPrompt:
            'Synthesize council responses into one final answer. Keep it concise, actionable, and balanced.',
          temperature: settings.temperature,
          tooling: settings.enableModelTools ? settings.tooling : { webSearch: false, codeExecution: false },
          requestId,
        },
        {
          onMemberToken: (index, model, provider, token) => {
            setConciliumOutputs((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, model, provider, content: item.content + token } : item,
              ),
            );
          },
          onMemberComplete: (index, model, provider, content) => {
            setConciliumOutputs((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, model, provider, content, completed: true } : item,
              ),
            );
          },
          onMemberError: (index, model, provider, error) => {
            setConciliumOutputs((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index
                  ? { ...item, model, provider, content: item.content ? `${item.content}\n\n${error}` : error, completed: true }
                  : item,
              ),
            );
          },
          onLeaderToken: (token) => {
            setConciliumSummary((prev) => prev + token);
          },
          onPhase: () => {
            // no-op for now
          },
          onDone: () => {
            setConciliumBusy(false);
            streamRequestIdRef.current = null;
            abortControllerRef.current = null;
          },
          onError: (error) => {
            setConciliumSummary((prev) => (prev ? `${prev}\n\n${error}` : error));
            setConciliumBusy(false);
            streamRequestIdRef.current = null;
            abortControllerRef.current = null;
          },
        },
        abort.signal,
      );
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        setConciliumSummary((prev) => (prev ? `${prev}\n\n${error?.message || 'Concilium failed'}` : error?.message || 'Concilium failed'));
      }
      setConciliumBusy(false);
      streamRequestIdRef.current = null;
      abortControllerRef.current = null;
    }
  };

  const applyInlineWrap = (prefix: string, suffix = prefix) => {
    if (!activeNote || !editorRef.current) return;
    const textarea = editorRef.current;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selected = activeNote.content.slice(start, end);
    const next = `${activeNote.content.slice(0, start)}${prefix}${selected}${suffix}${activeNote.content.slice(end)}`;
    applyContentChange(next);

    requestAnimationFrame(() => {
      textarea.focus();
      const from = start + prefix.length;
      const to = from + selected.length;
      textarea.setSelectionRange(from, to);
      setSelectionText(selected);
    });
  };

  const applyLinePrefix = (prefix: string) => {
    if (!activeNote || !editorRef.current) return;
    const textarea = editorRef.current;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selected = activeNote.content.slice(start, end) || '';

    const startLine = activeNote.content.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const endLineBreak = activeNote.content.indexOf('\n', end);
    const endLine = endLineBreak === -1 ? activeNote.content.length : endLineBreak;

    const block = activeNote.content.slice(startLine, endLine);
    const prefixed = block
      .split('\n')
      .map((line) => (line.trim() ? `${prefix}${line}` : line))
      .join('\n');

    const next = `${activeNote.content.slice(0, startLine)}${prefixed}${activeNote.content.slice(endLine)}`;
    applyContentChange(next);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(startLine, startLine + prefixed.length);
      setSelectionText(selected);
    });
  };

  const handleUndo = () => {
    if (!activeNote || undoStack.length === 0) return;
    const previousContent = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev.slice(-199), activeNote.content]);
    applyContentChange(previousContent, { trackHistory: false });
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  };

  const handleRedo = () => {
    if (!activeNote || redoStack.length === 0) return;
    const nextContent = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev.slice(-199), activeNote.content]);
    applyContentChange(nextContent, { trackHistory: false });
    requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  };

  const downloadBlob = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const exportCurrentNote = (format: 'md' | 'txt' | 'pdf') => {
    if (!activeNote) return;
    const filename = activeNote.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'note';

    if (format === 'md') {
      downloadBlob(activeNote.content, `${filename}.md`, 'text/markdown');
      setShowExportMenu(false);
      return;
    }

    if (format === 'txt') {
      downloadBlob(toPlainText(activeNote.content), `${filename}.txt`, 'text/plain');
      setShowExportMenu(false);
      return;
    }

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(activeNote.title)}</title>
    <style>
      body {
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        margin: 24px;
        color: #111827;
      }
      h1 {
        margin-bottom: 4px;
      }
      .meta {
        color: #6b7280;
        margin-bottom: 18px;
      }
      .content {
        white-space: pre-wrap;
        text-align: justify;
        text-indent: 1.25rem;
        line-height: 1.65;
      }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(activeNote.title)}</h1>
    <p class="meta">${new Date(activeNote.updatedAt).toLocaleString()}</p>
    <div class="content">${escapeHtml(activeNote.content)}</div>
  </body>
</html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 180);
    }

    setShowExportMenu(false);
  };

  const triggerManualSave = async () => {
    setSaveBusy(true);
    setSaveState('idle');
    try {
      const ok = await onManualSave();
      setSaveState(ok ? 'ok' : 'error');
    } catch {
      setSaveState('error');
    } finally {
      setSaveBusy(false);
      window.setTimeout(() => setSaveState('idle'), 2000);
    }
  };

  if (!activeNote) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t.emptyTitle}</h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t.emptyBody}</p>
          <button
            onClick={onCreateNote}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primaryHover"
          >
            <Plus size={14} />
            {t.newNote}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex min-h-0"
      style={{ paddingRight: isDesktopViewport && rightSidebarOpen ? rightSidebarWidth : 0 }}
    >
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="border-b border-border px-3 md:px-4 py-2 bg-background/80 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={triggerManualSave}
              disabled={saveBusy}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
            >
              {saveBusy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saveBusy ? t.saving : t.saveNow}
            </button>

            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              title={t.undo}
            >
              <Undo2 size={14} />
              {t.undo}
            </button>

            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              title={t.redo}
            >
              <Redo2 size={14} />
              {t.redo}
            </button>

            <div className="relative">
              <button
                onClick={() => setShowExportMenu((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Download size={14} />
                {t.export}
                <ChevronDown size={12} />
              </button>

              {showExportMenu && (
                <div className="absolute left-0 top-full mt-2 w-44 rounded-lg border border-border bg-surface shadow-xl z-30 overflow-hidden">
                  <button
                    onClick={() => exportCurrentNote('md')}
                    className="w-full px-3 py-2 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-2"
                  >
                    <FileCode size={13} /> {t.markdown}
                  </button>
                  <button
                    onClick={() => exportCurrentNote('txt')}
                    className="w-full px-3 py-2 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-2"
                  >
                    <FileText size={13} /> {t.text}
                  </button>
                  <button
                    onClick={() => exportCurrentNote('pdf')}
                    className="w-full px-3 py-2 text-left text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-2 border-t border-border"
                  >
                    <FileText size={13} /> {t.pdf}
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => setConciliumOpen((prev) => !prev)}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                conciliumOpen
                  ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <PanelRight size={14} />
              {conciliumOpen ? t.conciliumClose : t.conciliumOpen}
            </button>

            {saveState !== 'idle' && (
              <span className={`text-xs ${saveState === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {saveState === 'ok' ? t.saved : t.saveError}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <section className="min-h-0 flex-1 border-r border-border flex flex-col">
            <div className="px-3 md:px-4 py-2 border-b border-border flex flex-wrap items-center gap-1.5">
              <div className="inline-flex rounded-md border border-border overflow-hidden mr-1">
                <button
                  onClick={() => setViewMode('editor')}
                  className={`px-2 py-1 text-[11px] font-semibold uppercase tracking-wide inline-flex items-center gap-1 ${
                    viewMode === 'editor'
                      ? 'bg-primary/10 text-primary'
                      : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Pencil size={12} /> {t.viewEditor}
                </button>
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-1 text-[11px] font-semibold uppercase tracking-wide inline-flex items-center gap-1 border-l border-border ${
                    viewMode === 'preview'
                      ? 'bg-primary/10 text-primary'
                      : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Eye size={12} /> {t.viewPreview}
                </button>
              </div>
              {viewMode === 'editor' && (
                <>
                  <div className="w-px h-4 bg-zinc-300 dark:bg-zinc-700 mx-1" />
                  <button onClick={() => applyInlineWrap('**')} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="Bold"><Bold size={14} /></button>
                  <button onClick={() => applyInlineWrap('*')} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="Italic"><Italic size={14} /></button>
                  <button onClick={() => applyLinePrefix('# ')} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="H1"><Heading1 size={14} /></button>
                  <button onClick={() => applyLinePrefix('## ')} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="H2"><Heading2 size={14} /></button>
                  <button onClick={() => applyLinePrefix('### ')} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="H3"><Heading3 size={14} /></button>
                  <button onClick={() => applyLinePrefix('- ')} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="Bulleted list"><List size={14} /></button>
                  <button onClick={() => applyLinePrefix('1. ')} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="Ordered list"><ListOrdered size={14} /></button>
                  <button onClick={() => applyLinePrefix('> ')} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800" title="Quote"><MessageSquareQuote size={14} /></button>
                </>
              )}
            </div>
            {viewMode === 'editor' ? (
              <textarea
                ref={editorRef}
                value={activeNote.content}
                onChange={(event) => applyContentChange(event.target.value)}
                onSelect={updateSelectionFromEditor}
                onKeyUp={updateSelectionFromEditor}
                onClick={updateSelectionFromEditor}
                className="flex-1 min-h-0 w-full resize-none bg-transparent px-4 py-4 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none"
                style={{
                  fontSize: `${textScale}%`,
                  textAlign: 'justify',
                  textIndent: '1.25rem',
                  lineHeight: 1.75,
                }}
                spellCheck={false}
              />
            ) : (
              <div
                className="flex-1 min-h-0 w-full overflow-y-auto px-4 py-4 prose prose-sm dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100 cursor-text"
                style={{
                  fontSize: `${textScale}%`,
                  lineHeight: 1.75,
                }}
                contentEditable={NOTES_PREVIEW_CONTENT_EDITABLE}
                onMouseUp={() => {
                  const sel = window.getSelection();
                  if (sel && sel.toString().trim()) {
                    setSelectionText(sel.toString());
                  }
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeNote.content}</ReactMarkdown>
              </div>
            )}
          </section>
        </div>
      </div>

      {rightSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={onCloseRightSidebar}
        />
      )}
      <aside
        className={`
          fixed inset-y-0 right-0 z-40 max-w-[92vw] bg-surface border-l border-border transform transition-transform duration-300 ease-in-out shadow-2xl lg:shadow-none flex flex-col h-full
          ${rightSidebarOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
        style={{ width: `${rightSidebarWidth}px` }}
      >
        <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 inline-flex items-center gap-2">
              <Sparkles size={15} /> {t.aiPanel}
            </h3>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t.selectTextHint}</p>
          </div>
          <button
            onClick={onCloseRightSidebar}
            className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
            title={t.rightPanelClose}
          >
            <PanelRightClose size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide font-semibold text-zinc-500 mb-1.5">{t.selectionLabel}</p>
            <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-900/40 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 max-h-24 overflow-y-auto whitespace-pre-wrap">
              {selectionText || <span className="text-zinc-500">{t.noSelection}</span>}
            </div>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wide font-semibold text-zinc-500">{t.mode}</label>
            <div className="mt-1 grid grid-cols-2 gap-1.5">
              {[
                { id: 'edit', label: t.modeEdit },
                { id: 'translation', label: t.modeTranslation },
                { id: 'synonyms', label: t.modeSynonyms },
                { id: 'rephrase', label: t.modeRephrase },
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setAssistantMode(mode.id as AssistantMode)}
                  className={`rounded-md border px-2 py-1.5 text-xs ${
                    assistantMode === mode.id
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wide font-semibold text-zinc-500">{t.insertionMode}</label>
            <div className="mt-1.5 space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={workspace.insertionMode === 'replace'}
                  onChange={() => updateInsertionMode('replace')}
                />
                {t.replace}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={workspace.insertionMode === 'insert_below'}
                  onChange={() => updateInsertionMode('insert_below')}
                />
                {t.insertBelow}
              </label>
            </div>
          </div>

          {(assistantMode === 'edit' || assistantMode === 'translation') && (
            <>
              {assistantMode === 'translation' && (
                <div>
                  <label className="text-[11px] uppercase tracking-wide font-semibold text-zinc-500">{t.translationTarget}</label>
                  <div className="mt-1 relative">
                    <Languages size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <select
                      value={workspace.translationTargetLanguage}
                      onChange={(event) => updateTranslationLanguage(event.target.value)}
                      className="w-full appearance-none rounded-md border border-border bg-transparent pl-7 pr-8 py-1.5 text-xs"
                    >
                      {DEFAULT_TRANSLATION_LANGUAGES.map((lang) => (
                        <option key={lang} value={lang}>{lang}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500">
                    <span>{t.zoom}</span>
                    <button onClick={() => updateZoom(-10)} className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800"><ZoomOut size={13} /></button>
                    <button onClick={() => updateZoom(10)} className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800"><ZoomIn size={13} /></button>
                    <span className="font-mono text-[11px]">{textScale}%</span>
                  </div>
                </div>
              )}

              {assistantMode === 'edit' && (
                <div>
                  <label className="text-[11px] uppercase tracking-wide font-semibold text-zinc-500">{t.styles}</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {workspace.aiStyles.map((style) => {
                      const isDefaultStyle = defaultStyleSet.has(style.toLowerCase());
                      return (
                        <div key={style} className="inline-flex items-center rounded-full border border-border bg-zinc-100 dark:bg-zinc-800 text-xs">
                          <button
                            onClick={() => {
                              setAssistantMode('edit');
                              setCustomPrompt(style);
                            }}
                            className={`px-2 py-1 ${isDefaultStyle ? 'rounded-full' : 'rounded-l-full'} ${
                              customPrompt.trim().toLowerCase() === style.toLowerCase()
                                ? 'bg-primary/15 text-primary'
                                : 'hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                          >
                            {style}
                          </button>
                          {!isDefaultStyle && (
                            <button
                              onClick={() => removeStyle(style)}
                              className="px-1.5 py-1 border-l border-border hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-r-full"
                              title={t.removeStyle}
                            >
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <input
                      value={newStyle}
                      onChange={(event) => setNewStyle(event.target.value)}
                      placeholder={t.addStylePlaceholder}
                      className="flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
                    />
                    <button
                      onClick={appendStyle}
                      className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {t.addStyle}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[11px] uppercase tracking-wide font-semibold text-zinc-500">{t.customPrompt}</label>
                <textarea
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                  placeholder={t.customPromptPlaceholder}
                  className="mt-1 w-full h-20 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs resize-none"
                />
                <button
                  onClick={() => {
                    if (assistantMode === 'translation') {
                      void runSelectionTransformation({ mode: 'translation', customPrompt: 'translate' });
                    } else {
                      void runSelectionTransformation({ mode: 'edit', customPrompt: customPrompt.trim() || 'Improve clarity' });
                    }
                  }}
                  disabled={aiBusy}
                  className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primaryHover disabled:opacity-60"
                >
                  {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />}
                  {assistantMode === 'translation' ? t.runTranslation : t.applyPrompt}
                </button>
              </div>
            </>
          )}

          {assistantMode === 'synonyms' && (
            <div className="rounded-xl border border-border bg-zinc-50 dark:bg-zinc-900/40 p-3">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{t.clickWord}</p>
              <p className="mt-2 text-[11px] uppercase tracking-wide font-semibold text-zinc-500">{t.interactiveText}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 leading-7">
                {interactiveText.split(/(\s+)/).map((token, index) => {
                  if (!token.trim()) return <span key={`${token}-${index}`}>{token}</span>;
                  const clickable = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]/.test(token);
                  if (!clickable) return <span key={`${token}-${index}`}>{token}</span>;

                  return (
                    <button
                      key={`${token}-${index}`}
                      onClick={(event) => {
                        void requestSuggestions({
                          kind: 'synonyms',
                          sourceText: token,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      className="rounded px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                    >
                      {token}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {assistantMode === 'rephrase' && (
            <button
              onClick={(event) => {
                const selection = getSelection();
                if (!selection) {
                  setSuggestionsError(t.noSelection);
                  return;
                }
                const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                void requestSuggestions({
                  kind: 'rephrase',
                  sourceText: selection.text,
                  x: rect.left + rect.width / 2,
                  y: rect.bottom,
                });
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primaryHover"
            >
              <Sparkles size={13} />
              {t.runRephrase}
            </button>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-wide font-semibold text-zinc-500 mb-1.5">{t.streamingResult}</p>
            <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-900/40 p-3 min-h-24 text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
              {aiStreamingText || (aiBusy ? t.waiting : '')}
              {aiError && <p className="text-red-600 dark:text-red-400 mt-2">{t.aiError}: {aiError}</p>}
            </div>
          </div>

          {conciliumOpen && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-900/10 p-3 space-y-3">
              <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-2">
                <Bot size={14} /> {t.concilium}
              </h4>

              <div>
                <p className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700/80 dark:text-emerald-300/80 mb-1.5">{t.conciliumMembers}</p>
                <div className="space-y-2">
                  {workspace.conciliumMembers.map((member, index) => {
                    const provider = availableProviders.find((item) => item.id === member.provider) || availableProviders[0];
                    const models = provider?.models || [];
                    return (
                      <div key={`${member.provider}:${member.model}:${index}`} className="rounded-lg border border-emerald-200/70 dark:border-emerald-800/60 p-2 space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5">
                          <select
                            value={member.provider}
                            onChange={(event) => updateConciliumMember(index, 'provider', event.target.value)}
                            className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                          >
                            {availableProviders.map((option) => (
                              <option key={option.id} value={option.id}>{option.name}</option>
                            ))}
                          </select>
                          <select
                            value={member.model}
                            onChange={(event) => updateConciliumMember(index, 'model', event.target.value)}
                            className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                          >
                            {models.map((model) => (
                              <option key={model.id} value={model.id}>{model.name}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={() => removeConciliumMember(index)}
                          disabled={workspace.conciliumMembers.length <= 1}
                          className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 disabled:opacity-50"
                        >
                          <Trash2 size={11} /> {t.removeMember}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={addConciliumMember}
                    disabled={workspace.conciliumMembers.length >= 3}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <Plus size={11} /> {t.addMember}
                  </button>
                  <span className="text-[10px] text-zinc-500">
                    {workspace.conciliumMembers.length >= 3 ? t.maxMembers : t.minMembers}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700/80 dark:text-emerald-300/80">{t.conciliumPrompt}</label>
                <textarea
                  value={conciliumPrompt}
                  onChange={(event) => setConciliumPrompt(event.target.value)}
                  placeholder={t.conciliumPromptPlaceholder}
                  className="mt-1 w-full h-20 rounded-md border border-border bg-transparent px-2 py-1.5 text-xs resize-none"
                />
              </div>

              <button
                onClick={() => {
                  void runConcilium();
                }}
                disabled={conciliumBusy}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {conciliumBusy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {conciliumBusy ? t.conciliumRunning : t.conciliumRun}
              </button>

              {conciliumOutputs.length > 0 && (
                <div className="space-y-2">
                  {conciliumOutputs.map((item, index) => (
                    <div key={`${item.provider}:${item.model}:${index}`} className="rounded-md border border-border bg-white/70 dark:bg-zinc-900/50 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{item.provider} · {item.model}</p>
                      <div className="text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{item.content || (conciliumBusy ? t.waiting : '')}</div>
                    </div>
                  ))}
                </div>
              )}

              {(conciliumSummary || conciliumBusy) && (
                <div className="rounded-md border border-emerald-300/70 dark:border-emerald-700/70 bg-emerald-100/50 dark:bg-emerald-900/20 p-2">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-1">{t.conciliumSummary}</p>
                  <div className="text-xs whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{conciliumSummary || (conciliumBusy ? t.waiting : '')}</div>
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onStartRightSidebarResize();
          }}
          className="absolute left-0 top-0 hidden h-full w-2 -translate-x-1/2 cursor-col-resize lg:block"
          aria-label={language === 'es' ? 'Redimensionar panel derecho' : 'Resize right sidebar'}
          title={language === 'es' ? 'Redimensionar panel derecho' : 'Resize right sidebar'}
        />
      </aside>

      <ConfirmationModal
        isOpen={protectedStyleToDelete !== null}
        onClose={() => setProtectedStyleToDelete(null)}
        onConfirm={() => setProtectedStyleToDelete(null)}
        title={t.styleProtectedTitle}
        message={t.styleProtectedMessage(protectedStyleToDelete || '')}
        confirmText={t.styleProtectedConfirm}
        cancelText={t.close}
      />

      {suggestionPopup.open && (
        <div
          className="fixed z-50 w-72 rounded-xl border border-border bg-surface shadow-2xl"
          style={{
            left: Math.max(12, Math.min(window.innerWidth - 300, suggestionPopup.x - 140)),
            top: Math.max(12, Math.min(window.innerHeight - 280, suggestionPopup.y + 10)),
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t.suggestions}</p>
            <button onClick={() => setSuggestionPopup((prev) => ({ ...prev, open: false }))} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X size={12} />
            </button>
          </div>
          <div className="p-3 space-y-2">
            <div className="rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-300">{suggestionPopup.sourceText}</div>

            {suggestionsBusy ? (
              <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <Loader2 size={13} className="animate-spin" /> {t.waiting}
              </div>
            ) : (
              <div className="space-y-1.5">
                {suggestionPopup.options.map((option) => (
                  <button
                    key={option}
                    onClick={() => applySuggestion(option)}
                    className="w-full text-left rounded-md border border-border px-2 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}

            {suggestionsError && <p className="text-xs text-red-600 dark:text-red-400">{suggestionsError}</p>}

            <button
              onClick={() => {
                void requestSuggestions({
                  kind: suggestionPopup.kind,
                  sourceText: suggestionPopup.sourceText,
                  x: suggestionPopup.x,
                  y: suggestionPopup.y,
                });
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <RefreshCw size={11} /> {t.regenerate}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
