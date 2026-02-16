
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Send, Bot, User as UserIcon, Paperclip, Mic, Quote as QuoteIcon, X, Copy, RefreshCw, GitBranch, Check, Database, FileText, File as FileIcon, Eye } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, MessageAttachment, Quote, Language, QuickInsertPrompt } from '../types';
import { TRANSLATIONS } from '../constants';
import { parseFile, formatAttachmentAsMarkdown, type ParsedAttachment } from '../utils/fileParser';

const ACCEPTED_FILE_TYPES = [
  '.txt,.md,.markdown,.json,.csv,.yml,.yaml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.go,.java,.rs,.sql,.sh,.pdf,.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.rb,.php,.c,.cpp,.h,.hpp,.cs,.swift,.kt,.lua,.r,.toml,.ini,.cfg,.conf,.env,.log,.diff,.patch',
  'text/plain,text/markdown,application/pdf,image/*,application/json,text/csv',
].join(',');

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const getSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const win = window as Window & {
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    SpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
};

type ArtifactPreviewKind = 'html' | 'svg' | 'react';

interface PreviewArtifact {
  previewableIndex: number;
  language: string;
  code: string;
  kind: ArtifactPreviewKind;
}

interface PreviewTarget {
  sourceId: string;
  previewableIndex: number;
  artifact: PreviewArtifact;
}

const HTML_LANGUAGES = new Set(['html', 'htm']);
const SVG_LANGUAGES = new Set(['svg']);
const REACT_LANGUAGES = new Set(['jsx', 'tsx', 'react', 'javascriptreact', 'typescriptreact']);
const MAYBE_REACT_LANGUAGES = new Set(['js', 'ts', 'javascript', 'typescript']);
const SCROLL_BOTTOM_THRESHOLD_PX = 96;

const normalizeCodeLanguage = (rawLanguage: string): string => {
  if (!rawLanguage) return '';
  const normalized = rawLanguage.trim().toLowerCase();
  const languageClassMatch = normalized.match(/language-([a-z0-9#+_-]+)/);
  if (languageClassMatch?.[1]) return languageClassMatch[1];
  return normalized.split(/\s+/)[0].replace(/^language-/, '');
};

const looksLikeSvg = (code: string): boolean => /^\s*<svg[\s>]/i.test(code);
const looksLikeHtml = (code: string): boolean => {
  if (/^\s*<!doctype html/i.test(code)) return true;
  if (/^\s*<(html|body|head|main|section|article|header|footer|nav|div)\b/i.test(code)) return true;
  return false;
};

const looksLikeReactSnippet = (code: string): boolean => {
  if (/\bReact\b/.test(code)) return true;
  if (/\bcreateRoot\s*\(/.test(code) || /\bReactDOM\.render\s*\(/.test(code)) return true;
  if (/\bfunction\s+[A-Z][A-Za-z0-9_$]*\s*\(/.test(code)) return true;
  if (/\bconst\s+[A-Z][A-Za-z0-9_$]*\s*=\s*\(/.test(code)) return true;
  if (/<[A-Z][A-Za-z0-9_$]*[\s>]/.test(code)) return true;
  if (/<>[\s\S]*<\/>/.test(code)) return true;
  return false;
};

const detectArtifactPreviewKind = (language: string, code: string): ArtifactPreviewKind | null => {
  if (!code.trim()) return null;
  if (SVG_LANGUAGES.has(language) || looksLikeSvg(code)) return 'svg';
  if (HTML_LANGUAGES.has(language) || looksLikeHtml(code)) return 'html';
  if (REACT_LANGUAGES.has(language)) return 'react';
  if (MAYBE_REACT_LANGUAGES.has(language) && looksLikeReactSnippet(code)) return 'react';
  return null;
};

const stripReactModuleSyntax = (source: string): string => {
  let output = source;
  output = output.replace(/^\s*import\s.+$/gm, '');
  output = output.replace(/^\s*export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm, 'function $1(');
  output = output.replace(/^\s*export\s+default\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+/gm, 'class $1 ');
  output = output.replace(/^\s*export\s+default\s+/gm, 'const __DefaultExport = ');
  output = output.replace(/^\s*export\s+\{[^}]+\};?\s*$/gm, '');
  output = output.replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ');
  return output.trim();
};

const escapeScriptEndTag = (value: string): string => value.replace(/<\/script/gi, '<\\/script');

const extractLikelyHtmlDocumentSource = (source: string): string => {
  const trimmed = source.trim();
  if (!trimmed) return '';

  const doctypeIndex = trimmed.search(/<!doctype\s+html/i);
  const htmlIndex = trimmed.search(/<html[\s>]/i);
  let startIndex = -1;
  if (doctypeIndex >= 0) startIndex = doctypeIndex;
  if (htmlIndex >= 0 && (startIndex === -1 || htmlIndex < startIndex)) {
    startIndex = htmlIndex;
  }
  if (startIndex > 0) {
    return trimmed.slice(startIndex);
  }
  return trimmed;
};

const buildHtmlPreviewDocument = (source: string): string => {
  const trimmed = extractLikelyHtmlDocumentSource(source);
  if (!trimmed) return '<!doctype html><html><body></body></html>';
  if (/<!doctype html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: Inter, system-ui, -apple-system, sans-serif;
        color: #111827;
      }
      * { box-sizing: border-box; }
    </style>
  </head>
  <body>
${trimmed}
  </body>
</html>`;
};

const buildSvgPreviewDocument = (source: string): string => {
  const trimmed = source.trim();
  const svgMarkup = looksLikeSvg(trimmed)
    ? trimmed
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">${trimmed}</svg>`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #f8fafc;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      svg {
        max-width: 100%;
        max-height: 100%;
      }
    </style>
  </head>
  <body>
${svgMarkup}
  </body>
</html>`;
};

const buildReactPreviewDocument = (source: string): string => {
  const normalized = stripReactModuleSyntax(source);
  const trimmed = normalized.trim();
  const isBareJsxExpression =
    (trimmed.startsWith('<') || trimmed.startsWith('<>')) &&
    !/\b(const|let|var|function|class)\b/.test(trimmed);
  const hasManualMount = /\bcreateRoot\s*\(|\bReactDOM\.render\s*\(/.test(trimmed);
  const runnableSource = isBareJsxExpression ? `const __DefaultExport = () => (${trimmed});` : trimmed;
  const escapedSource = escapeScriptEndTag(runnableSource);

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        font-family: Inter, system-ui, -apple-system, sans-serif;
        background: #f8fafc;
      }
      #root {
        min-height: 100%;
        padding: 16px;
        box-sizing: border-box;
      }
      #preview-error {
        display: none;
        margin: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #fecaca;
        background: #fef2f2;
        color: #b91c1c;
        font-size: 12px;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <pre id="preview-error"></pre>
    <script>
      const __rootNode = document.getElementById('root');
      const __errorNode = document.getElementById('preview-error');
      const __showError = (error) => {
        if (!__errorNode) return;
        const message = error && error.message ? error.message : String(error);
        __errorNode.style.display = 'block';
        __errorNode.textContent = message;
      };
      window.addEventListener('error', (event) => {
        event.preventDefault();
        __showError(event.error || event.message);
      });
      window.addEventListener('unhandledrejection', (event) => {
        __showError(event.reason || 'Unhandled promise rejection');
      });
      const __mount = (candidate) => {
        const resolved = candidate && candidate.default ? candidate.default : candidate;
        if (!resolved) throw new Error('No React component found to render.');
        const element = React.isValidElement(resolved) ? resolved : React.createElement(resolved);
        ReactDOM.createRoot(__rootNode).render(element);
      };
    </script>
    <script type="text/babel" data-presets="typescript,react">
${escapedSource}
${hasManualMount ? '' : `
      const __candidate =
        typeof __DefaultExport !== 'undefined'
          ? __DefaultExport
          : (typeof App !== 'undefined' ? App : null);
      if (!__candidate) {
        throw new Error('Define App or export a default React component for preview.');
      }
      __mount(__candidate);
`}
    </script>
  </body>
</html>`;
};

const buildArtifactPreviewDocument = (artifact: PreviewArtifact): string => {
  if (artifact.kind === 'svg') return buildSvgPreviewDocument(artifact.code);
  if (artifact.kind === 'react') return buildReactPreviewDocument(artifact.code);
  return buildHtmlPreviewDocument(artifact.code);
};

const formatCostBadgeUsd = (value: number): string => `$${Math.max(0, value).toFixed(3)}`;

interface ChatAreaProps {
  conversationId: string;
  messages: Message[];
  onSendMessage: (text: string, quote?: Quote, attachments?: MessageAttachment[]) => void;
  onCancelStreaming: () => void;
  onRetry: (text: string) => void;
  onBranch: (msgId: string) => void;
  language: Language;
  isTyping: boolean;
  ragStatus: string | null;
  quickPrompts: QuickInsertPrompt[];
}

export const ChatArea: React.FC<ChatAreaProps> = ({ 
    conversationId,
    messages, 
    onSendMessage, 
    onCancelStreaming,
    onRetry,
    onBranch,
    language,
    isTyping,
    ragStatus,
    quickPrompts
}) => {
  const t = TRANSLATIONS[language];
  const [input, setInput] = useState('');
  const [activeQuote, setActiveQuote] = useState<Quote | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPromptMenuOpen, setIsPromptMenuOpen] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; content: string; msgId: string; role: any } | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<ParsedAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const promptMenuRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [conversationId]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    scrollToBottom('auto');
    setPreviewTarget(null);
  }, [conversationId, scrollToBottom]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    scrollToBottom(isTyping ? 'auto' : 'smooth');
  }, [messages, isTyping, ragStatus, scrollToBottom]);

  useEffect(() => {
    if (!inputNotice) return;
    const timer = setTimeout(() => setInputNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [inputNotice]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (promptMenuRef.current && !promptMenuRef.current.contains(event.target as Node)) {
        setIsPromptMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!previewTarget) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewTarget(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewTarget]);

  useEffect(() => {
    if (!previewTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [previewTarget]);

  // --- Handlers ---
  const resizeTextarea = (target: HTMLTextAreaElement | null) => {
    if (!target) return;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
  };

  const appendToInput = (value: string) => {
    setInput((prev) => (prev.trim() ? `${prev}\n\n${value}` : value));
    requestAnimationFrame(() => resizeTextarea(textareaRef.current));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const hasContent = input.trim() || pendingAttachments.length > 0;
    if (!hasContent) return;

    // Build final text: user input + attachment markdown
    let finalText = input.trim();
    for (const attachment of pendingAttachments) {
      const md = formatAttachmentAsMarkdown(attachment, t.chatArea.attachedFileLabel);
      finalText = finalText ? `${finalText}\n\n${md}` : md;
    }

    // Build attachment metadata for the message
    const messageAttachments: MessageAttachment[] = pendingAttachments.map((a) => ({
      type: a.type,
      fileName: a.fileName,
      textContent: a.textContent,
      dataUrl: a.dataUrl,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      truncated: a.truncated,
      error: a.error,
    }));

    onSendMessage(finalText, activeQuote || undefined, messageAttachments.length > 0 ? messageAttachments : undefined);
    setInput('');
    setActiveQuote(null);
    setPendingAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    resizeTextarea(e.target);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      })
      .catch(() => {
        setInputNotice(language === 'es' ? 'No se pudo copiar el contenido.' : 'Could not copy the content.');
      });
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleInsertQuickPrompt = (prompt: QuickInsertPrompt) => {
    appendToInput(prompt.content);
    setInputNotice(t.chatArea.promptInserted.replace('{title}', prompt.title));
    setIsPromptMenuOpen(false);
  };

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsParsingFile(true);
    setInputNotice(t.chatArea.parsingFile);

    for (const file of fileArray) {
      try {
        const parsed = await parseFile(file);
        setPendingAttachments((prev) => [...prev, parsed]);
        if (parsed.error) {
          setInputNotice(`⚠️ ${file.name}: ${parsed.error}`);
          continue;
        }
        setInputNotice(t.chatArea.fileAttached.replace('{name}', file.name));
      } catch {
        setInputNotice(t.chatArea.fileAttachError);
      }
    }
    setIsParsingFile(false);
  }, [t]);

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.target.value = '';
    if (!files || files.length === 0) return;
    await processFiles(files);
  };

  const removeAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Drag & Drop ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processFiles(files);
    }
  }, [processFiles]);

  const toggleVoiceInput = () => {
    const SpeechRecognition = getSpeechRecognitionCtor();
    if (!SpeechRecognition) {
      setInputNotice(t.chatArea.voiceUnsupported);
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => {
        setIsRecording(true);
        setInputNotice(t.chatArea.voiceListening);
      };
      recognition.onend = () => {
        setIsRecording(false);
      };
      recognition.onerror = () => {
        setInputNotice(t.chatArea.voiceError);
        setIsRecording(false);
      };
      recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0]?.transcript || '';
          }
        }

        const transcript = finalTranscript.trim();
        if (!transcript) return;

        setInput((prev) => (prev.trim() ? `${prev} ${transcript}` : transcript));
        requestAnimationFrame(() => resizeTextarea(textareaRef.current));
      };
      recognitionRef.current = recognition;
    }

    const recognition = recognitionRef.current;
    recognition.lang = language === 'es' ? 'es-ES' : 'en-US';

    if (isRecording) {
      recognition.stop();
      return;
    }

    try {
      recognition.start();
    } catch {
      setInputNotice(t.chatArea.voiceError);
      setIsRecording(false);
    }
  };

  // --- Selection Logic ---

  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
        setSelectionMenu(null);
        return;
    }

    const text = selection.toString().trim();
    if (!text) return;

    let node = selection.anchorNode;
    if (node && node.nodeType === 3) node = node.parentNode;
    
    const messageContainer = (node as HTMLElement)?.closest('[data-message-id]');
    
    if (messageContainer) {
        const msgId = messageContainer.getAttribute('data-message-id');
        const role = messageContainer.getAttribute('data-role');
        
        if (msgId && role) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            setSelectionMenu({
                x: rect.left + (rect.width / 2),
                y: rect.top - 10,
                content: text,
                msgId: msgId,
                role: role
            });
            return;
        }
    }
    setSelectionMenu(null);
  };

  const confirmQuote = () => {
      if (selectionMenu) {
          setActiveQuote({
              originalMessageId: selectionMenu.msgId,
              content: selectionMenu.content,
              role: selectionMenu.role
          });
          setSelectionMenu(null);
          window.getSelection()?.removeAllRanges();
          textareaRef.current?.focus();
      }
  };

  // --- Typing Indicator ---
  const TypingIndicator = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex items-center ${compact ? 'gap-1 py-0.5' : 'gap-1.5 py-1'}`}>
      <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
      <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
      <div className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce"></div>
    </div>
  );

  const activePreviewArtifact = previewTarget?.artifact || null;

  const activePreviewDocument = useMemo(
    () => (activePreviewArtifact ? buildArtifactPreviewDocument(activePreviewArtifact) : ''),
    [activePreviewArtifact],
  );

  const getPreviewKindLabel = (kind: ArtifactPreviewKind): string => {
    if (kind === 'svg') return t.chatArea.previewKindSvg;
    if (kind === 'react') return t.chatArea.previewKindReact;
    return t.chatArea.previewKindHtml;
  };

  const lastMessage = messages[messages.length - 1];
  const showGlobalTypingIndicator = Boolean(
    isTyping &&
    !ragStatus &&
    (!lastMessage || lastMessage.role === 'user')
  );

  const renderMarkdown = (content: string, sourceId: string, className = 'markdown-body') => {
    let previewableIndex = 0;
    let codeBlockIndex = 0;

    const components = {
      a: ({ ...props }: any) => <a {...props} target="_blank" rel="noreferrer noopener" />,
      table: ({ ...props }: any) => (
        <div className="overflow-x-auto my-3">
          <table {...props} />
        </div>
      ),
      pre: ({ children, ...props }: any) => {
        const childNodes = React.Children.toArray(children);
        const codeElement = childNodes.find((node) => React.isValidElement(node)) as React.ReactElement<any> | undefined;

        const rawCode = codeElement?.props?.children;
        const codeText = Array.isArray(rawCode) ? rawCode.join('') : String(rawCode ?? '');
        const normalizedCode = codeText.replace(/\n$/, '');
        const currentCodeBlockIndex = codeBlockIndex;
        codeBlockIndex += 1;
        const codeBlockCopyId = `${sourceId}:code:${currentCodeBlockIndex}`;
        const isCodeCopied = copiedId === codeBlockCopyId;

        const languageClass = typeof codeElement?.props?.className === 'string' ? codeElement.props.className : '';
        const language = normalizeCodeLanguage(languageClass);
        const previewKind = detectArtifactPreviewKind(language, normalizedCode);

        let currentPreviewableIndex: number | null = null;
        if (previewKind) {
          currentPreviewableIndex = previewableIndex;
          previewableIndex += 1;
        }

        const isActive =
          currentPreviewableIndex !== null &&
          previewTarget?.sourceId === sourceId &&
          previewTarget.previewableIndex === currentPreviewableIndex;
        const previewArtifact =
          currentPreviewableIndex !== null && previewKind
            ? {
                previewableIndex: currentPreviewableIndex,
                language,
                code: normalizedCode,
                kind: previewKind,
              }
            : null;

        return (
          <div className="relative">
            <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-1.5">
              {previewArtifact && (
                <button
                  type="button"
                  onClick={() =>
                    setPreviewTarget({
                      sourceId,
                      previewableIndex: previewArtifact.previewableIndex,
                      artifact: previewArtifact,
                    })
                  }
                  className={`inline-flex items-center justify-center rounded-md border p-1.5 transition-colors ${
                    isActive
                      ? 'border-indigo-500 bg-indigo-500 text-white'
                      : 'border-zinc-300 dark:border-zinc-600 bg-white/90 dark:bg-zinc-900/90 text-zinc-600 dark:text-zinc-300 hover:border-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300'
                  }`}
                  title={`${t.chatArea.previewArtifact} (${getPreviewKindLabel(previewArtifact.kind)})`}
                  aria-label={`${t.chatArea.previewArtifact} (${getPreviewKindLabel(previewArtifact.kind)})`}
                >
                  <Eye size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleCopy(normalizedCode, codeBlockCopyId)}
                className={`inline-flex items-center justify-center rounded-md border p-1.5 transition-colors ${
                  isCodeCopied
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-zinc-300 dark:border-zinc-600 bg-white/90 dark:bg-zinc-900/90 text-zinc-600 dark:text-zinc-300 hover:border-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300'
                }`}
                title={isCodeCopied ? (language === 'es' ? 'Copiado' : 'Copied') : (language === 'es' ? 'Copiar código' : 'Copy code')}
                aria-label={isCodeCopied ? (language === 'es' ? 'Copiado' : 'Copied') : (language === 'es' ? 'Copiar código' : 'Copy code')}
              >
                {isCodeCopied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <pre
              {...props}
              className={`${typeof props.className === 'string' ? props.className : ''} ${
                previewArtifact ? 'pr-24' : 'pr-12'
              }`.trim()}
            >
              {children}
            </pre>
          </div>
        );
      },
    };

    return (
      <div className={className}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    );
  };

  return (
    <div 
      className="flex flex-col h-full w-full max-w-5xl mx-auto relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >

      {/* Drag-and-Drop Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-indigo-500/10 dark:bg-indigo-500/20 border-2 border-dashed border-indigo-500 rounded-xl flex items-center justify-center pointer-events-none backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-indigo-600 dark:text-indigo-400">
            <Paperclip size={40} className="animate-bounce" />
            <span className="text-lg font-medium">{t.chatArea.dragDropHint}</span>
          </div>
        </div>
      )}
      
      {/* Messages List */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8"
        onMouseUp={handleMouseUp}
      >
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          const isLastMessage = index === messages.length - 1;
          const isArena = Boolean(msg.isArena && msg.arenaAnswers && msg.arenaAnswers.length === 2);
          const hideMainBubble = isArena && !msg.content && !msg.quote;
          const isInlineThinking = msg.isThinking && !msg.content;
          const assistantModelTag = !isUser && !msg.isConcilium && !isArena
            ? (msg.model?.trim() || msg.provider?.trim() || '')
            : '';
          const councilAnswersCount = msg.councilAnswers?.length || 0;
          const councilGridColsClass =
            councilAnswersCount >= 5 ? 'md:grid-cols-3' : councilAnswersCount >= 2 ? 'md:grid-cols-2' : 'md:grid-cols-1';
          const arenaCopyContent = isArena && msg.arenaAnswers
            ? msg.arenaAnswers
                .map((answer, arenaIndex) => `#${arenaIndex + 1} ${answer.model}\n\n${answer.content}`)
                .join('\n\n---\n\n')
            : msg.content;
          
          return (
            <div 
              key={msg.id} 
              className={`flex w-full gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 border border-zinc-200 dark:border-zinc-700 select-none mt-1">
                  <Bot size={16} className="text-indigo-500 dark:text-indigo-400" />
                </div>
              )}
              
              <div className={`${isArena ? 'w-full max-w-[98%]' : 'max-w-[85%] md:max-w-[75%]'} space-y-2 ${isUser ? 'items-end flex flex-col' : ''} group`}>
                 <div className="flex items-center gap-2 select-none px-1">
                    <span className="text-xs font-medium text-zinc-500">
                        {isUser ? t.common.you : (msg.isConcilium ? "Concilium" : isArena ? 'Arena' : t.common.assistant)}
                    </span>
                    {!isUser && !msg.isConcilium && !isArena && assistantModelTag && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-500/20 truncate max-w-[180px]">
                        {assistantModelTag}
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                 </div>
                 
                 {/* CONCILIUM: Parallel Bubbles Grid */}
                 {msg.isConcilium && msg.councilAnswers && (
                     <div className={`grid grid-cols-1 ${councilGridColsClass} gap-3 w-full mb-3`}>
                         {msg.councilAnswers.map((answer, i) => (
                             <div key={i} className="bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-xs relative overflow-hidden shadow-sm">
                                 <div className="flex items-center gap-2 mb-2 pb-2 border-b border-zinc-100 dark:border-zinc-800/50">
                                     <div className={`w-2 h-2 rounded-full ${answer.completed ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></div>
                                     <span className="font-semibold text-zinc-600 dark:text-zinc-400 truncate">{answer.model}</span>
                                 </div>
                                 <div className="text-zinc-700 dark:text-zinc-300 min-h-[40px] max-h-56 overflow-y-auto pr-1">
                                     {answer.content ? (
                                        renderMarkdown(answer.content, `message:${msg.id}:council:${i}`, 'markdown-body text-xs')
                                     ) : (
                                         <TypingIndicator />
                                     )}
                                 </div>
                             </div>
                         ))}
                     </div>
                 )}

                 {isArena && msg.arenaAnswers && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full mb-3">
                      {msg.arenaAnswers.map((answer, arenaIndex) => (
                        <div key={arenaIndex} className="bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-xs relative overflow-hidden shadow-sm">
                          <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-zinc-100 dark:border-zinc-800/50">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`w-2 h-2 rounded-full ${answer.completed ? 'bg-emerald-500' : 'bg-cyan-500 animate-pulse'}`}></div>
                              <span className="font-semibold text-zinc-700 dark:text-zinc-300 truncate">{answer.model}</span>
                            </div>
                            {typeof answer.temperature === 'number' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400">
                                T {answer.temperature.toFixed(1)}
                              </span>
                            )}
                          </div>
                          <div className="text-zinc-700 dark:text-zinc-300 min-h-[52px] max-h-72 overflow-y-auto pr-1">
                            {answer.content ? (
                              renderMarkdown(answer.content, `message:${msg.id}:arena:${arenaIndex}`, 'markdown-body text-xs')
                            ) : (
                              <TypingIndicator />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                 )}

                 {/* Message Content Bubble */}
                 {!hideMainBubble && (
                 <div 
                  data-message-id={msg.id}
                  data-role={msg.role}
                  className={`${isInlineThinking ? 'px-2.5 py-1.5 w-fit inline-flex items-center' : 'p-4'} rounded-2xl text-sm leading-relaxed shadow-sm relative transition-colors ${
                    isUser 
                      ? 'bg-indigo-600 text-white rounded-tr-none selection:bg-indigo-800 selection:text-white' 
                      : 'bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/50 rounded-tl-none selection:bg-indigo-500/30 selection:text-white'
                  }`}
                 >
                   {/* Reference Quote */}
                   {msg.quote && (
                       <div className={`mb-3 text-xs p-2 rounded border-l-2 select-none ${
                           isUser 
                           ? 'bg-indigo-700/50 border-indigo-300 text-indigo-100' 
                           : 'bg-zinc-100 dark:bg-zinc-900/50 border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400'
                       }`}>
                           <div className="flex items-center gap-1 mb-1 opacity-70">
                               <QuoteIcon size={10} />
                               <span className="font-semibold uppercase text-[10px]">
                                   {msg.quote.role === 'user' ? t.common.you : t.common.assistant} {t.chatArea.said}:
                               </span>
                           </div>
                           <p className="italic line-clamp-3">"{msg.quote.content}"</p>
                       </div>
                   )}

                   {/* Inline Attached Images */}
                   {msg.attachments && msg.attachments.some((a) => a.type === 'image' && a.dataUrl) && (
                       <div className="mb-3 flex flex-wrap gap-2">
                         {msg.attachments.filter((a) => a.type === 'image' && a.dataUrl).map((att, idx) => (
                           <div key={idx} className="relative group/img">
                             <img
                               src={att.dataUrl}
                               alt={att.fileName}
                               className="max-w-[240px] max-h-[180px] rounded-lg border border-zinc-200 dark:border-zinc-700 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                               onClick={() => window.open(att.dataUrl, '_blank')}
                             />
                             <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                               {att.fileName}
                             </span>
                           </div>
                         ))}
                       </div>
                   )}

                   {/* Attached File Indicators (non-image) */}
                   {msg.attachments && msg.attachments.some((a) => a.type !== 'image') && (
                       <div className="mb-3 flex flex-wrap gap-2">
                         {msg.attachments.filter((a) => a.type !== 'image').map((att, idx) => (
                           <div key={idx} className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg ${
                             isUser ? 'bg-indigo-700/50 text-indigo-100' : 'bg-zinc-100 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700'
                           }`}>
                             {att.type === 'pdf' ? <FileIcon size={12} /> : <FileText size={12} />}
                             <span className="truncate max-w-[150px]">{att.fileName}</span>
                             {att.error && <span className="text-red-500 text-[9px]">(error)</span>}
                             {att.truncated && <span className="text-amber-500 text-[9px]">(truncated)</span>}
                           </div>
                         ))}
                       </div>
                   )}

                   {/* Main Content */}
                   {isInlineThinking ? (
                        <TypingIndicator compact />
                   ) : (
                       renderMarkdown(msg.content, `message:${msg.id}:main`)
                   )}
                 </div>
                 )}

                 {msg.isConcilium && msg.conciliumCostComparison && (
                   <div className="inline-flex items-center rounded border border-amber-200 dark:border-amber-800/60 bg-amber-50/90 dark:bg-amber-950/30 px-2.5 py-1 text-[11px] text-amber-800 dark:text-amber-200">
                     {`${t.chatArea.conciliumCost}: ${formatCostBadgeUsd(msg.conciliumCostComparison.totalConciliumCostUsd)} | ${t.chatArea.soloLeaderCost}: ${formatCostBadgeUsd(msg.conciliumCostComparison.soloLeaderCostUsd)} (${msg.conciliumCostComparison.soloLeaderCostUsd > 0 ? `${msg.conciliumCostComparison.ratio.toFixed(1)}x` : '∞x'})`}
                   </div>
                 )}

                 {/* Action Bar (Hover) */}
                 <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <button 
                        onClick={() => handleCopy(arenaCopyContent, msg.id)}
                        className="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Copy"
                    >
                        {copiedId === msg.id ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                    
                    {/* Retry (Only last user message) */}
                    {isUser && isLastMessage && (
                         <button 
                            onClick={() => onRetry(msg.content)}
                            className="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            title="Retry"
                        >
                            <RefreshCw size={14} />
                        </button>
                    )}

                    <button 
                        onClick={() => onBranch(msg.id)}
                        className="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Branch Conversation"
                    >
                        <GitBranch size={14} />
                    </button>
                 </div>
              </div>

              {isUser && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 text-white shadow-md select-none mt-1">
                  <UserIcon size={16} />
                </div>
              )}
            </div>
          );
        })}
        
        {/* RAG Status Indicator */}
        {ragStatus && (
            <div className="flex justify-start w-full gap-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="w-8 flex-shrink-0" /> {/* Spacer */}
                <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-500/20 px-3 py-2 rounded-lg">
                    <Database size={12} className="animate-pulse" />
                    <span>{ragStatus}</span>
                </div>
            </div>
        )}

        {/* Global Typing Indicator (when Thinking but no empty message yet created) */}
        {showGlobalTypingIndicator && (
             <div className="flex justify-start w-full gap-4">
                <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0 border border-zinc-200 dark:border-zinc-700">
                  <Bot size={16} className="text-indigo-500 dark:text-indigo-400" />
                </div>
                <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 rounded-2xl rounded-tl-none px-2.5 py-1.5 inline-flex items-center justify-center shadow-sm">
                    <TypingIndicator compact />
                </div>
             </div>
        )}

        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* Floating Selection Menu */}
      {selectionMenu && (
          <div 
            className="fixed z-50 transform -translate-x-1/2 -translate-y-full mb-2"
            style={{ left: selectionMenu.x, top: selectionMenu.y }}
          >
              <button 
                onClick={confirmQuote}
                className="flex items-center gap-2 bg-zinc-900 text-white px-3 py-1.5 rounded-full shadow-xl border border-zinc-700 hover:bg-indigo-600 hover:border-indigo-500 transition-all animate-in fade-in zoom-in duration-200 scale-95 hover:scale-100"
              >
                  <QuoteIcon size={12} className="fill-current" />
                  <span className="text-xs font-medium">{t.chatArea.quote}</span>
              </button>
              <div className="w-2 h-2 bg-zinc-900 border-r border-b border-zinc-700 transform rotate-45 absolute left-1/2 -ml-1 -bottom-1"></div>
          </div>
      )}

      {previewTarget && (
        <div
          className="fixed inset-0 z-[80] bg-zinc-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewTarget(null)}
        >
          <div
            className="w-full max-w-6xl h-[88vh] bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-2xl overflow-hidden flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/80">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {t.chatArea.previewModalTitle}
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {activePreviewArtifact ? getPreviewKindLabel(activePreviewArtifact.kind) : t.chatArea.previewArtifact}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTarget(null)}
                className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                title={t.chatArea.closePreview}
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 bg-zinc-100 dark:bg-zinc-950">
              {activePreviewArtifact ? (
                <iframe
                  title={t.chatArea.previewModalTitle}
                  sandbox="allow-scripts"
                  srcDoc={activePreviewDocument}
                  className="w-full h-full border-0 bg-white"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {t.chatArea.previewUnavailable}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 md:p-6 bg-gradient-to-t from-background via-background to-transparent pb-8">
        <div className={`relative bg-surface rounded-xl border border-border shadow-lg ring-1 ring-white/5 dark:ring-white/5 transition-all duration-300 ${activeQuote ? 'rounded-t-none border-t-0' : ''}`}>
            
            {activeQuote && (
                <div className="absolute -top-12 left-0 right-0 h-12 bg-white/90 dark:bg-zinc-800/80 backdrop-blur-md rounded-t-xl border border-border border-b-0 flex items-center justify-between px-4 animate-in slide-in-from-bottom-2 fade-in duration-200">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="h-8 w-1 bg-indigo-500 rounded-full flex-shrink-0" />
                        <div className="flex flex-col justify-center overflow-hidden">
                             <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase">
                                 {t.chatArea.replyingTo} {activeQuote.role}
                             </span>
                             <span className="text-xs text-zinc-500 dark:text-zinc-300 truncate max-w-md">
                                 "{activeQuote.content}"
                             </span>
                        </div>
                    </div>
                    <button 
                        onClick={() => setActiveQuote(null)}
                        className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              onChange={handleFileSelected}
            />

            {/* Pending Attachments Preview */}
            {pendingAttachments.length > 0 && (
              <div className="px-4 pt-3 pb-1 flex flex-wrap gap-2">
                {pendingAttachments.map((att, idx) => (
                  <div
                    key={idx}
                    className="relative group/att flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 max-w-[200px]"
                  >
                    {att.type === 'image' && att.dataUrl ? (
                      <img src={att.dataUrl} alt={att.fileName} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                    ) : att.type === 'pdf' ? (
                      <FileIcon size={14} className="text-red-500 flex-shrink-0" />
                    ) : (
                      <FileText size={14} className="text-indigo-500 flex-shrink-0" />
                    )}
                    <span className="truncate">{att.fileName}</span>
                    {att.error && <span className="text-red-500 text-[9px]">(error)</span>}
                    {att.truncated && <span className="text-amber-500 text-[9px]">(trunc)</span>}
                    <button
                      onClick={() => removeAttachment(idx)}
                      className="ml-1 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-colors flex-shrink-0"
                      title={t.chatArea.removeAttachment}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder={activeQuote ? t.chatArea.writeReply : t.chatArea.askAnything}
                rows={1}
                className="w-full bg-transparent text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 text-sm p-4 pr-32 resize-none focus:outline-none max-h-[200px] overflow-y-auto"
            />

            {inputNotice && (
              <div className="px-4 pb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                {inputNotice}
              </div>
            )}
            
            <div className="absolute right-2 bottom-2 flex items-center gap-2">
                <button
                  onClick={handleAttachClick}
                  className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title={t.chatArea.attach}
                >
                    <Paperclip size={18} />
                </button>
                <div className="relative" ref={promptMenuRef}>
                  <button
                    onClick={() => {
                      if (quickPrompts.length === 0) {
                        setInputNotice(t.chatArea.noSavedPrompts);
                        return;
                      }
                      setIsPromptMenuOpen((prev) => !prev);
                    }}
                    className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    title={t.chatArea.insertPrompt}
                  >
                    <FileText size={18} />
                  </button>
                  {isPromptMenuOpen && quickPrompts.length > 0 && (
                    <div className="absolute right-0 bottom-12 w-72 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden z-30">
                      <div className="px-3 py-2 text-[10px] uppercase tracking-wide font-semibold text-zinc-500 border-b border-zinc-100 dark:border-zinc-800">
                        {t.chatArea.savedPrompts}
                      </div>
                      <div className="max-h-56 overflow-y-auto py-1">
                        {quickPrompts.map((prompt) => (
                          <button
                            key={prompt.id}
                            onClick={() => handleInsertQuickPrompt(prompt)}
                            className="w-full text-left px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">{prompt.title}</p>
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-0.5">{prompt.content}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={toggleVoiceInput}
                  className={`p-2 transition-colors rounded-lg ${
                    isRecording
                      ? 'text-red-500 bg-red-50 dark:bg-red-900/30'
                      : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  title={isRecording ? t.chatArea.voiceListening : t.chatArea.voiceInput}
                >
                    <Mic size={18} />
                </button>
                {isTyping ? (
                  <button
                    onClick={onCancelStreaming}
                    className="p-2 rounded-lg transition-all duration-200 bg-rose-600 text-white hover:bg-rose-500 shadow-lg shadow-rose-900/20"
                    title={t.chatArea.stopGenerating}
                  >
                    <X size={18} />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSubmit()}
                    disabled={!input.trim() && pendingAttachments.length === 0}
                    className={`p-2 rounded-lg transition-all duration-200 ${
                      (input.trim() || pendingAttachments.length > 0)
                        ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/20'
                        : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed'
                    }`}
                  >
                    <Send size={18} />
                  </button>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
