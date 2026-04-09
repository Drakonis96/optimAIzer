import { Router, Request, Response } from 'express';
import { createProvider } from '../providers';
import { ChatRequest, ConciliumMode, ConciliumRequest, Provider } from '../types';
import { hasApiKey } from '../config';
import { getEnabledToolingForProvider, NativeFunctionTool, NativeToolCall } from '../providers/base';
import { buildStreamCacheKey, streamResponseCache, StreamCacheRoute } from '../cache/responseCache';
import { cancelStream, registerStream, unregisterStream } from '../streaming/streamRegistry';
import { safeErrorMessage } from '../security/redact';
import { isModelAllowedForUser } from '../auth/users';
import { estimateInputTokens, estimateTextTokens } from '../auth/costs';
import { assertWithinUserMonthlyBudget, recordUserUsageEvent } from '../auth/usage';
import { AuthUser } from '../auth/types';
import * as documentTools from '../agents/documentTools';
import { analyzeImage } from '../agents/vision';
import { getBuiltinSkills } from '../agents/skills/registry';
import { buildChatSkillsPrompt, buildSkillsPromptFromList } from '../agents/skills/registry';
import { Skill } from '../agents/skills';

export const chatRouter = Router();

interface SummarizeRequest {
  provider: Provider;
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  requestId?: string;
}

const MEMBER_TIMEOUT_MS = 45_000;
const LEADER_TIMEOUT_MS = 70_000;
const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 2048;
const CONCILIUM_MODES: ConciliumMode[] = ['consensus', 'factcheck', 'codereview', 'brainstorm', 'debate'];

const sanitizeConciliumMode = (value: unknown, fallback: ConciliumMode = 'consensus'): ConciliumMode =>
  typeof value === 'string' && CONCILIUM_MODES.includes(value as ConciliumMode)
    ? (value as ConciliumMode)
    : fallback;

const getConciliumResponseLabel = (index: number, blindEval: boolean): string => {
  if (!blindEval) return `Response ${index + 1}`;
  const codePoint = 'A'.charCodeAt(0) + index;
  return `Response ${String.fromCharCode(codePoint)}`;
};

const getConciliumModeTaskInstructions = (mode: ConciliumMode): string => {
  switch (mode) {
    case 'factcheck':
      return 'Identify contradictory claims across responses. Mark which are correct/incorrect with evidence.';
    case 'codereview':
      return 'Evaluate each code solution for correctness, performance, and readability. Produce the optimal version.';
    case 'brainstorm':
      return 'Combine all unique ideas without discarding any. Organize by category.';
    case 'debate':
      return 'Highlight key disagreements. Let models defend their stance. Synthesize based on strongest arguments.';
    case 'consensus':
    default:
      return 'Find areas of agreement/disagreement and provide a balanced final synthesis.';
  }
};

const getLatestUserPrompt = (messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
};

const getConciliumLanguageRule = (latestUserPrompt: string): string => {
  const normalizedPrompt = latestUserPrompt.replace(/\s+/g, ' ').trim();
  const promptPreview = normalizedPrompt.length > 500
    ? `${normalizedPrompt.slice(0, 500)}…`
    : normalizedPrompt;

  if (!promptPreview) {
    return 'CRITICAL LANGUAGE RULE: Respond in the same language used by the user in their prompt.';
  }

  return `CRITICAL LANGUAGE RULE: Respond in the exact same language as the user\'s latest prompt. User latest prompt: "${promptPreview}".`;
};

const buildConciliumSynthesisPrompt = (
  results: Array<{ content: string }>,
  mode: ConciliumMode,
  blindEval: boolean,
  languageRule: string
): string => {
  const responseBlocks = results
    .map((result, index) => `--- ${getConciliumResponseLabel(index, blindEval)} ---\n${result.content}`)
    .join('\n\n');

  return `You are the leader of a multi-model council. The responses below are intentionally anonymized.

Mode: ${mode.toUpperCase()}
Responses received: ${results.length}

${responseBlocks}

--- Your Task ---
${getConciliumModeTaskInstructions(mode)}

Rules:
- Never infer or mention model/provider identity.
- Reference responses only by their response labels.
- Synthesize a clear final answer for the user.
- ${languageRule}`;
};

const isAbortError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  return /abort/i.test(error.message);
};

const normalizeError = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Request aborted.';
  }
  return safeErrorMessage(error, 'Unknown error');
};

const resolveEstimatedOutputTokens = (maxTokens?: number): number => {
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return DEFAULT_ESTIMATED_OUTPUT_TOKENS;
  }
  return Math.max(1, Math.floor(maxTokens));
};

const ensureModelAllowed = (
  res: Response,
  user: AuthUser,
  provider: Provider,
  model: string
): boolean => {
  if (isModelAllowedForUser(user, provider, model)) return true;
  res.status(403).json({ error: `Model "${model}" is not allowed for user "${user.username}".` });
  return false;
};

const ensureBudget = (
  res: Response,
  params: {
    user: AuthUser;
    provider: Provider;
    model: string;
    inputTokens: number;
    estimatedOutputTokens: number;
    tooling?: ChatRequest['tooling'];
    requestsInBatch?: number;
  }
): boolean => {
  try {
    assertWithinUserMonthlyBudget({
      user: params.user,
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      estimatedOutputTokens: params.estimatedOutputTokens,
      tooling: params.tooling,
      requestsInBatch: params.requestsInBatch,
    });
    return true;
  } catch (error) {
    const message = normalizeError(error);
    res.status(402).json({ error: message });
    return false;
  }
};

const writeSse = (res: Response, payload: Record<string, unknown>): void => {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  (res as any).flush?.();
};

const endSse = (res: Response): void => {
  if (res.writableEnded || res.destroyed) return;
  res.end();
};

const setupSse = (res: Response): void => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
};

const emitCachedTokens = (content: string, onToken: (token: string) => void): void => {
  const chunkSize = 240;
  for (let index = 0; index < content.length; index += chunkSize) {
    onToken(content.slice(index, index + chunkSize));
  }
};

const createTimeoutSignal = (
  parentSignal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } => {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);

  const abortFromParent = () => timeoutController.abort();
  if (parentSignal.aborted) {
    timeoutController.abort();
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  const cleanup = () => {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abortFromParent);
  };

  return { signal: timeoutController.signal, cleanup };
};

const streamProviderWithCache = async (options: {
  route: StreamCacheRoute;
  provider: Provider;
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ChatRequest['reasoningEffort'];
  tooling?: ChatRequest['tooling'];
  signal: AbortSignal;
  onToken: (token: string) => void;
  extraCacheKey?: Record<string, unknown>;
}): Promise<{ content: string; streamCompleted: boolean; fromCache: boolean }> => {
  const cacheKey = buildStreamCacheKey({
    route: options.route,
    provider: options.provider,
    model: options.model,
    messages: options.messages,
    systemPrompt: options.systemPrompt,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    reasoningEffort: options.reasoningEffort,
    tooling: options.tooling,
    extra: options.extraCacheKey,
  });

  const cachedResponse = streamResponseCache.get(cacheKey);
  if (cachedResponse !== null) {
    emitCachedTokens(cachedResponse, options.onToken);
    return { content: cachedResponse, streamCompleted: true, fromCache: true };
  }

  const providerAdapter = createProvider(options.provider);
  const stream = providerAdapter.chatStream({
    model: options.model,
    messages: options.messages,
    systemPrompt: options.systemPrompt,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    reasoningEffort: options.reasoningEffort,
    tooling: options.tooling,
    signal: options.signal,
  });

  let content = '';
  let streamCompleted = false;

  for await (const chunk of stream) {
    if (chunk.type === 'token' && chunk.content) {
      content += chunk.content;
      options.onToken(chunk.content);
    } else if (chunk.type === 'error') {
      throw new Error(chunk.error || 'Unknown streaming error');
    } else if (chunk.type === 'done') {
      streamCompleted = true;
    }
  }

  if (streamCompleted && content.trim()) {
    streamResponseCache.set(cacheKey, content);
  }

  return { content, streamCompleted, fromCache: false };
};

chatRouter.post('/cancel', (req: Request, res: Response) => {
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!requestId) {
    res.status(400).json({ error: 'Missing requestId.' });
    return;
  }

  const cancelled = cancelStream(requestId);
  res.json({ success: true, cancelled });
});

// ---------------------------------------------------------------------------
// Chat Document Tools — Allow the main chat to create/edit documents
// ---------------------------------------------------------------------------

const CHAT_AGENT_ID = '_chat_';
const USER_AGENT_HEADER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHAT_TOOL_MAX_ITERATIONS = 6;

const CHAT_DOCUMENT_TOOL_DEFS: NativeFunctionTool[] = [
  {
    name: 'create_word',
    description: 'Crea un documento Word (.docx) con contenido estructurado y formato profesional (alineación, interlineado, sangría, espaciado, fuente). Devuelve un enlace de descarga. NUNCA generes código; usa SIEMPRE esta herramienta.',
    parameters: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: 'Nombre del archivo (ej: "informe.docx")' },
        content: { type: 'string', description: 'JSON array de bloques: [{"type":"heading"|"paragraph"|"bullet"|"table", "text":"...", "level":1-6, "bold":true/false, "italic":true/false, "underline":true/false, "rows":[["c1","c2"]], "alignment":"justified", "lineSpacing":1.5, "spacingBefore":0, "spacingAfter":0, "firstLineIndent":1.25, "fontSize":12, "fontFamily":"Arial"}]' },
        formatting: { type: 'string', description: 'JSON objeto con formato global: {"alignment":"left"|"center"|"right"|"justified", "lineSpacing":1.5, "spacingBefore":0, "spacingAfter":0, "firstLineIndent":1.25, "fontSize":12, "fontFamily":"Times New Roman"}. Se aplica a todos los párrafos salvo que el bloque lo sobrescriba.' },
      },
      required: ['file_name', 'content'],
    },
  },
  {
    name: 'create_pdf',
    description: 'Crea un documento PDF. Devuelve un enlace de descarga. NUNCA generes código; usa SIEMPRE esta herramienta.',
    parameters: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: 'Nombre del archivo (ej: "informe.pdf")' },
        content: { type: 'string', description: 'JSON array de bloques: [{"type":"heading"|"text"|"comment"|"page_break"|"image", "text":"...", "fontSize":12, "bold":true/false, "imageBase64":"..."}]' },
      },
      required: ['file_name', 'content'],
    },
  },
  {
    name: 'create_powerpoint',
    description: 'Crea una presentación PowerPoint (.pptx) con diapositivas, títulos, notas del presentador, imágenes, viñetas, diseño a dos columnas. Usa fetch_image para incluir imágenes de internet. Devuelve un enlace de descarga. NUNCA generes código Python u otro lenguaje; usa SIEMPRE esta herramienta.',
    parameters: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: 'Nombre del archivo (ej: "presentacion.pptx")' },
        slides: { type: 'string', description: 'JSON array de slides: [{"title":"...", "subtitle":"...", "content":"...", "notes":"Notas del presentador aquí", "layout":"title"|"content"|"section"|"blank"|"two_column", "bulletPoints":["..."], "leftColumn":"...", "rightColumn":"...", "backgroundColor":"#FFFFFF", "fontColor":"363636", "images":[{"base64":"data:...","x":1,"y":1.5,"w":4,"h":3,"caption":"..."}]}]' },
        title: { type: 'string', description: 'Título de la presentación (metadato, opcional)' },
      },
      required: ['file_name', 'slides'],
    },
  },
  {
    name: 'create_excel',
    description: 'Crea un archivo Excel (.xlsx) con fórmulas, formato y múltiples hojas. Devuelve un enlace de descarga. NUNCA generes código.',
    parameters: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: 'Nombre del archivo (ej: "datos.xlsx")' },
        sheets: { type: 'string', description: 'JSON array de hojas: [{"name":"Hoja1","headers":["Col1","Col2"],"rows":[["v1","v2"]],"columnWidths":[15,20],"formulas":[{"cell":"C2","formula":"SUM(A2:B2)"}]}]' },
      },
      required: ['file_name', 'sheets'],
    },
  },
  {
    name: 'fetch_image',
    description: 'Descarga una imagen desde una URL, la analiza con IA y la devuelve en base64. Imprescindible para insertar imágenes de internet en presentaciones/documentos.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL directa de la imagen (jpg, png, gif, webp)' },
      },
      required: ['url'],
    },
  },
];

const DOCUMENT_KEYWORDS_RE = /\b(crea|crear|genera|generar|haz|hazme|hacer|escrib[eai]|redact[ae]|prepara|diseñ[ae]|make|create|generate|write|build|prepare|design)\b.*\b(document[oe]?s?|word|\.docx|pdf|\.pdf|powerpoint|pptx|\.pptx|presentaci[oó]n|excel|\.xlsx|hoja\s+de\s+c[aá]lculo|spreadsheet|diapositiva|slide)\b/i;

function chatNeedsDocumentTools(messages: Array<{ role: string; content: string }>): boolean {
  // Check the last 3 user messages
  const recentUserMsgs = messages.filter(m => m.role === 'user').slice(-3);
  return recentUserMsgs.some(m => DOCUMENT_KEYWORDS_RE.test(m.content));
}

async function executeChatDocumentTool(
  toolCall: NativeToolCall,
  userId: string,
  provider: Provider,
  model: string,
): Promise<string> {
  const { name, arguments: params } = toolCall;
  const path = require('path');

  switch (name) {
    case 'create_word': {
      const fileName = params.file_name as string;
      if (!fileName || !params.content) return 'Error: faltan parámetros file_name o content';
      const content = typeof params.content === 'string' ? JSON.parse(params.content) : params.content;
      const formatting = params.formatting
        ? (typeof params.formatting === 'string' ? JSON.parse(params.formatting) : params.formatting)
        : undefined;
      const result = await documentTools.createWord({ userId, agentId: CHAT_AGENT_ID, fileName, content, formatting });
      const safeName = path.basename(fileName);
      const downloadUrl = `/api/agents/${encodeURIComponent(CHAT_AGENT_ID)}/documents/${encodeURIComponent(safeName)}`;
      return `✅ Documento Word creado (${(result.size / 1024).toFixed(1)} KB).\n\n📥 [Descargar ${safeName}](${downloadUrl})`;
    }
    case 'create_pdf': {
      const fileName = params.file_name as string;
      if (!fileName || !params.content) return 'Error: faltan parámetros file_name o content';
      const content = typeof params.content === 'string' ? JSON.parse(params.content) : params.content;
      const result = await documentTools.createPdf({ userId, agentId: CHAT_AGENT_ID, fileName, content });
      const safeName = path.basename(fileName);
      const downloadUrl = `/api/agents/${encodeURIComponent(CHAT_AGENT_ID)}/documents/${encodeURIComponent(safeName)}`;
      return `✅ PDF creado (${(result.size / 1024).toFixed(1)} KB).\n\n📥 [Descargar ${safeName}](${downloadUrl})`;
    }
    case 'create_powerpoint': {
      const fileName = params.file_name as string;
      if (!fileName || !params.slides) return 'Error: faltan parámetros file_name o slides';
      const slides = typeof params.slides === 'string' ? JSON.parse(params.slides) : params.slides;
      const result = await documentTools.createPowerPoint({
        userId,
        agentId: CHAT_AGENT_ID,
        fileName,
        slides,
        title: typeof params.title === 'string' ? params.title : undefined,
      });
      const safeName = path.basename(fileName);
      const downloadUrl = `/api/agents/${encodeURIComponent(CHAT_AGENT_ID)}/documents/${encodeURIComponent(safeName)}`;
      return `✅ PowerPoint creado (${(result.size / 1024).toFixed(1)} KB) — ${slides.length} diapositivas.\n\n📥 [Descargar ${safeName}](${downloadUrl})`;
    }
    case 'create_excel': {
      const fileName = params.file_name as string;
      if (!fileName || !params.sheets) return 'Error: faltan parámetros file_name o sheets';
      const sheets = typeof params.sheets === 'string' ? JSON.parse(params.sheets) : params.sheets;
      const result = await documentTools.createExcel({ userId, agentId: CHAT_AGENT_ID, fileName, sheets });
      const safeName = path.basename(fileName);
      const downloadUrl = `/api/agents/${encodeURIComponent(CHAT_AGENT_ID)}/documents/${encodeURIComponent(safeName)}`;
      return `✅ Excel creado (${(result.size / 1024).toFixed(1)} KB) — ${sheets.length} hoja(s).\n\n📥 [Descargar ${safeName}](${downloadUrl})`;
    }
    case 'fetch_image': {
      const url = params.url as string;
      if (!url) return 'Error: falta el parámetro url';
      const imgResponse = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT_HEADER, 'Accept': 'image/*,*/*;q=0.8' },
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      });
      if (!imgResponse.ok) return `Error HTTP ${imgResponse.status}: ${imgResponse.statusText}`;
      const contentType = imgResponse.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) return `La URL no devuelve una imagen (${contentType})`;
      const buffer = Buffer.from(await imgResponse.arrayBuffer());
      if (buffer.length > 10 * 1024 * 1024) return `Imagen demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`;
      const mimeType = contentType.split(';')[0].trim();
      const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;

      let imageDescription = '';
      try {
        const visionResult = await analyzeImage(
          buffer, mimeType,
          'Describe brevemente qué muestra esta imagen (contenido, estilo, calidad). ¿Es adecuada para una presentación profesional?',
          provider, model,
        );
        imageDescription = visionResult.description;
      } catch { imageDescription = '(No se pudo analizar la imagen)'; }

      return `Imagen descargada (${(buffer.length / 1024).toFixed(1)} KB, ${mimeType}).\n\n**Análisis:** ${imageDescription}\n\nbase64:\n${dataUri}`;
    }
    default:
      return `Herramienta no disponible: ${name}`;
  }
}

const CHAT_DOC_SYSTEM_SUFFIX = `\n\nTienes acceso a herramientas para crear documentos (Word, PDF, PowerPoint, Excel) y descargar/analizar imágenes. Cuando el usuario pida crear un documento, usa SIEMPRE las herramientas disponibles (create_word, create_pdf, create_powerpoint, create_excel). NUNCA uses execute_code, bash, Python, ni ningún otro lenguaje de programación para generar documentos. La herramienta nativa es OBLIGATORIA. Incluye siempre en tu respuesta el enlace de descarga que devuelve la herramienta.\n\nFORMATO WORD: Cuando el usuario pida formato específico (justificado, interlineado 1.5, sangría, sin separación entre párrafos, etc.), usa SIEMPRE el parámetro "formatting" de create_word. Ejemplo: formatting={"alignment":"justified","lineSpacing":1.5,"spacingBefore":0,"spacingAfter":0,"firstLineIndent":1.25,"fontSize":12,"fontFamily":"Times New Roman"}\n\nPLAN DE ACTUACIÓN: Antes de crear o editar cualquier documento, genera primero un plan paso a paso visible para el usuario que incluya: objetivo del documento, estructura propuesta (secciones/hojas/diapositivas), contenido clave de cada parte y formato/estilo a aplicar. Luego ejecuta el plan usando las herramientas.`;

/**
 * POST /api/chat
 * Standard chat completion with SSE streaming.
 * Supports backend-side stream cancellation via requestId.
 */
chatRouter.post('/', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const body = req.body as ChatRequest;
  const { provider, model, messages, systemPrompt, maxTokens, temperature, reasoningEffort, tooling, requestId, skills: skillsOption } = body;

  // Validate
  if (!provider || !model || !messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing required fields: provider, model, messages' });
    return;
  }

  // Build effective system prompt with skills if enabled
  let effectiveSystemPrompt = systemPrompt;
  if (skillsOption) {
    try {
      const builtinSkills = getBuiltinSkills();
      let skillsPrompt = '';

      if (skillsOption === true) {
        // Auto-detect: find skills triggered by latest user message
        const latestUser = messages.filter((m) => m.role === 'user').pop()?.content || '';
        skillsPrompt = buildChatSkillsPrompt(builtinSkills, latestUser);
      } else if (Array.isArray(skillsOption)) {
        // Specific skill IDs enabled
        const selected = builtinSkills.filter((s) => skillsOption.includes(s.id));
        if (selected.length > 0) {
          skillsPrompt = buildSkillsPromptFromList(selected, 'es', { compact: true, maxSkills: 5 });
        }
      }

      if (skillsPrompt) {
        effectiveSystemPrompt = effectiveSystemPrompt
          ? `${effectiveSystemPrompt}\n\n${skillsPrompt}`
          : skillsPrompt;
      }
    } catch (err) {
      console.warn('[Chat] Failed to build skills prompt:', err);
    }
  }

  if (!hasApiKey(provider)) {
    res.status(400).json({ error: `No API key configured for provider: ${provider}. Please add it in Settings.` });
    return;
  }

  if (!ensureModelAllowed(res, authUser, provider, model)) {
    return;
  }

  const effectiveTooling = getEnabledToolingForProvider(provider, tooling);
  const inputTokens = estimateInputTokens(messages, effectiveSystemPrompt);
  if (
    !ensureBudget(res, {
      user: authUser,
      provider,
      model,
      inputTokens,
      estimatedOutputTokens: resolveEstimatedOutputTokens(maxTokens),
      tooling: effectiveTooling,
    })
  ) {
    return;
  }

  const { requestId: streamRequestId, controller } = registerStream(requestId);
  const onClientClose = () => controller.abort();
  res.on('close', onClientClose);

  // -----------------------------------------------------------------------
  // Document-tools path: use chatWithTools loop instead of streaming
  // -----------------------------------------------------------------------
  const providerAdapter = createProvider(provider);
  const useDocumentTools = chatNeedsDocumentTools(messages) && typeof providerAdapter.chatWithTools === 'function';

  if (useDocumentTools) {
    const docSystemPrompt = (effectiveSystemPrompt || '') + CHAT_DOC_SYSTEM_SUFFIX;

    try {
      setupSse(res);
      writeSse(res, { type: 'meta', requestId: streamRequestId });

      const userId = authUser.id;
      let loopMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [...messages];
      let finalContent = '';

      for (let iteration = 0; iteration < CHAT_TOOL_MAX_ITERATIONS; iteration++) {
        if (controller.signal.aborted) break;

        const toolResult = await providerAdapter.chatWithTools!({
          model,
          messages: loopMessages,
          systemPrompt: docSystemPrompt,
          tools: CHAT_DOCUMENT_TOOL_DEFS,
          maxTokens,
          temperature,
        });

        if (toolResult.toolCalls.length === 0) {
          finalContent = toolResult.content;
          break;
        }

        // Execute tool calls and build result messages
        const toolResultMessages: string[] = [];
        for (const tc of toolResult.toolCalls) {
          try {
            const result = await executeChatDocumentTool(tc, userId, provider, model);
            toolResultMessages.push(`[Tool: ${tc.name}] ${result}`);
          } catch (err: any) {
            toolResultMessages.push(`[Tool: ${tc.name}] Error: ${err.message}`);
          }
        }

        // Add assistant response + tool results to conversation
        if (toolResult.content) {
          loopMessages.push({ role: 'assistant', content: toolResult.content });
        }
        loopMessages.push({
          role: 'user',
          content: toolResultMessages.join('\n\n'),
        });

        // On last iteration, set whatever we have
        if (iteration === CHAT_TOOL_MAX_ITERATIONS - 1) {
          finalContent = toolResult.content || toolResultMessages.join('\n\n');
        }
      }

      // Emit the final content as chunked tokens
      if (finalContent) {
        const chunkSize = 80;
        for (let i = 0; i < finalContent.length; i += chunkSize) {
          writeSse(res, { type: 'token', content: finalContent.slice(i, i + chunkSize) });
        }
      }

      recordUserUsageEvent({
        userId: authUser.id,
        provider,
        model,
        inputTokens,
        outputTokens: estimateTextTokens(finalContent),
        source: 'chat',
        tooling: effectiveTooling,
      });

      writeSse(res, controller.signal.aborted ? { type: 'cancelled' } : { type: 'done' });
    } catch (error: unknown) {
      if (controller.signal.aborted || isAbortError(error)) {
        writeSse(res, { type: 'cancelled' });
      } else {
        const message = normalizeError(error);
        console.error('[Chat] Document tools error:', message);
        writeSse(res, { type: 'error', error: message });
      }
    } finally {
      res.off('close', onClientClose);
      unregisterStream(streamRequestId);
      endSse(res);
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Standard streaming path (no document tools)
  // -----------------------------------------------------------------------

  try {
    setupSse(res);
    writeSse(res, { type: 'meta', requestId: streamRequestId });

    const result = await streamProviderWithCache({
      route: 'chat',
      provider,
      model,
      messages,
      systemPrompt: effectiveSystemPrompt,
      maxTokens,
      temperature,
      reasoningEffort,
      tooling: effectiveTooling,
      signal: controller.signal,
      onToken: (token) => writeSse(res, { type: 'token', content: token }),
    });

    if (result.streamCompleted && !result.fromCache) {
      recordUserUsageEvent({
        userId: authUser.id,
        provider,
        model,
        inputTokens,
        outputTokens: estimateTextTokens(result.content),
        source: 'chat',
        tooling: effectiveTooling,
      });
    }

    writeSse(res, controller.signal.aborted ? { type: 'cancelled' } : { type: 'done' });
  } catch (error: unknown) {
    if (controller.signal.aborted || isAbortError(error)) {
      writeSse(res, { type: 'cancelled' });
    } else {
      const message = normalizeError(error);
      console.error('[Chat] Error:', message);
      writeSse(res, { type: 'error', error: message });
    }
  } finally {
    res.off('close', onClientClose);
    unregisterStream(streamRequestId);
    endSse(res);
  }
});

/**
 * POST /api/chat/concilium
 * Concilium mode — parallel member requests, then leader synthesis.
 */
chatRouter.post('/concilium', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const body = req.body as ConciliumRequest;
  const { members, leader, mode, blindEval, messages, systemPrompt, leaderSystemPrompt, maxTokens, temperature, tooling, requestId } = body;

  // Validate
  if (!members || !Array.isArray(members) || members.length < 2) {
    res.status(400).json({ error: 'Concilium requires at least 2 members.' });
    return;
  }
  if (members.length > 7) {
    res.status(400).json({ error: 'Concilium supports at most 7 members.' });
    return;
  }

  if (!leader || !leader.provider || !leader.model) {
    res.status(400).json({ error: 'Concilium requires a leader with provider and model.' });
    return;
  }

  const conciliumMode = sanitizeConciliumMode(mode, 'consensus');
  const blindEvaluation = blindEval === true;
  const latestUserPrompt = getLatestUserPrompt(messages);
  const conciliumLanguageRule = getConciliumLanguageRule(latestUserPrompt);
  const memberSystemPromptFinal = [systemPrompt, conciliumLanguageRule].filter(Boolean).join('\n\n');

  const memberInputTokens = estimateInputTokens(messages, systemPrompt);
  const estimatedOutputTokens = resolveEstimatedOutputTokens(maxTokens);
  const memberToolingByIndex = members.map((member) => getEnabledToolingForProvider(member.provider, tooling));

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    if (!ensureModelAllowed(res, authUser, member.provider, member.model)) {
      return;
    }
    if (!hasApiKey(member.provider)) {
      res.status(400).json({ error: `No API key for ${member.provider}` });
      return;
    }
    if (
      !ensureBudget(res, {
        user: authUser,
        provider: member.provider,
        model: member.model,
        inputTokens: memberInputTokens,
        estimatedOutputTokens,
        tooling: memberToolingByIndex[index],
      })
    ) {
      return;
    }
  }

  if (!ensureModelAllowed(res, authUser, leader.provider, leader.model)) {
    return;
  }
  if (!hasApiKey(leader.provider)) {
    res.status(400).json({ error: `No API key for leader provider: ${leader.provider}` });
    return;
  }

  const { requestId: streamRequestId, controller } = registerStream(requestId);
  const onClientClose = () => controller.abort();
  res.on('close', onClientClose);

  try {
    setupSse(res);
    writeSse(res, { type: 'meta', requestId: streamRequestId });
    writeSse(res, { type: 'phase', phase: 'members', total: members.length });

    const memberResults = await Promise.all(
      members.map(async (member, index) => {
        if (controller.signal.aborted) {
          return { model: member.model, provider: member.provider, content: '', error: 'cancelled', cancelled: true, fromCache: false };
        }

        const { signal, cleanup } = createTimeoutSignal(controller.signal, MEMBER_TIMEOUT_MS);

        try {
          const memberTooling = memberToolingByIndex[index];

          const result = await streamProviderWithCache({
            route: 'concilium_member',
            provider: member.provider,
            model: member.model,
            messages,
            systemPrompt: memberSystemPromptFinal,
            maxTokens,
            temperature,
            tooling: memberTooling,
            signal,
            onToken: (token) => {
              writeSse(res, {
                type: 'member_token',
                index,
                model: member.model,
                provider: member.provider,
                content: token,
              });
            },
          });

          if (!result.streamCompleted && !result.content.trim()) {
            throw new Error('Member stream ended unexpectedly.');
          }

          if (result.streamCompleted && !result.fromCache) {
            recordUserUsageEvent({
              userId: authUser.id,
              provider: member.provider,
              model: member.model,
              inputTokens: memberInputTokens,
              outputTokens: estimateTextTokens(result.content),
              source: 'concilium_member',
              tooling: memberTooling,
            });
          }

          writeSse(res, {
            type: 'member_complete',
            index,
            model: member.model,
            provider: member.provider,
            content: result.content,
          });

          return { model: member.model, provider: member.provider, content: result.content, fromCache: result.fromCache };
        } catch (error: unknown) {
          if ((controller.signal.aborted && isAbortError(error)) || (controller.signal.aborted && signal.aborted)) {
            return { model: member.model, provider: member.provider, content: '', error: 'cancelled', cancelled: true, fromCache: false };
          }

          const errorMessage = signal.aborted && !controller.signal.aborted
            ? 'Request timed out.'
            : normalizeError(error);

          writeSse(res, {
            type: 'member_error',
            index,
            model: member.model,
            provider: member.provider,
            error: errorMessage,
          });

          return { model: member.model, provider: member.provider, content: '', error: errorMessage, fromCache: false };
        } finally {
          cleanup();
        }
      })
    );

    if (controller.signal.aborted) {
      writeSse(res, { type: 'cancelled' });
      return;
    }

    const successfulResults = memberResults.filter((result) => result.content && !result.error);
    if (successfulResults.length === 0) {
      writeSse(res, { type: 'error', error: 'All council members failed to respond.' });
      return;
    }

    writeSse(res, { type: 'phase', phase: 'leader' });

    const synthesisPrompt = buildConciliumSynthesisPrompt(
      successfulResults.map((result) => ({ content: result.content })),
      conciliumMode,
      blindEvaluation,
      conciliumLanguageRule
    );

    const leaderBasePrompt =
      leaderSystemPrompt || 'You are the head of the Concilium. Provide a balanced, well-reasoned final verdict.';
    const leaderSystemPromptFinal = [leaderBasePrompt, conciliumLanguageRule].filter(Boolean).join('\n\n');
    const leaderInputTokens = estimateInputTokens([{ role: 'user', content: synthesisPrompt }], leaderSystemPromptFinal);
    const leaderTooling = getEnabledToolingForProvider(leader.provider, tooling);
    try {
      assertWithinUserMonthlyBudget({
        user: authUser,
        provider: leader.provider,
        model: leader.model,
        inputTokens: leaderInputTokens,
        estimatedOutputTokens,
        tooling: leaderTooling,
      });
    } catch (error) {
      writeSse(res, { type: 'error', error: normalizeError(error) });
      return;
    }

    const runLeaderAttempt = async (): Promise<{
      streamCompleted: boolean;
      emittedTokens: boolean;
      errorMessage: string;
      content: string;
      fromCache: boolean;
    }> => {
      const { signal, cleanup } = createTimeoutSignal(controller.signal, LEADER_TIMEOUT_MS);
      let emittedTokens = false;
      let attemptContent = '';

      try {
        const result = await streamProviderWithCache({
          route: 'concilium_leader',
          provider: leader.provider,
          model: leader.model,
          messages: [{ role: 'user', content: synthesisPrompt }],
          systemPrompt: leaderSystemPromptFinal,
          maxTokens,
          temperature,
          tooling: leaderTooling,
          signal,
          onToken: (token) => {
            emittedTokens = true;
            attemptContent += token;
            writeSse(res, { type: 'leader_token', content: token });
          },
        });

        if (!result.streamCompleted && !emittedTokens) {
          throw new Error('Leader stream ended unexpectedly.');
        }

        return {
          streamCompleted: result.streamCompleted,
          emittedTokens,
          errorMessage: '',
          content: result.content || attemptContent,
          fromCache: result.fromCache,
        };
      } catch (error: unknown) {
        if ((controller.signal.aborted && isAbortError(error)) || (controller.signal.aborted && signal.aborted)) {
          return { streamCompleted: false, emittedTokens, errorMessage: 'cancelled', content: attemptContent, fromCache: false };
        }

        const errorMessage = signal.aborted && !controller.signal.aborted
          ? 'Request timed out.'
          : normalizeError(error);

        return { streamCompleted: false, emittedTokens, errorMessage, content: attemptContent, fromCache: false };
      } finally {
        cleanup();
      }
    };

    let leaderAttempt = await runLeaderAttempt();
    if (controller.signal.aborted) {
      writeSse(res, { type: 'cancelled' });
      return;
    }

    if (!leaderAttempt.streamCompleted && !leaderAttempt.emittedTokens) {
      writeSse(res, { type: 'phase', phase: 'leader_retry' });
      leaderAttempt = await runLeaderAttempt();
    }

    if (controller.signal.aborted) {
      writeSse(res, { type: 'cancelled' });
      return;
    }

    if (!leaderAttempt.streamCompleted && !leaderAttempt.emittedTokens) {
      writeSse(res, {
        type: 'error',
        error: leaderAttempt.errorMessage || 'Leader failed to provide a response.',
      });
      return;
    }

    if (!leaderAttempt.streamCompleted && leaderAttempt.emittedTokens) {
      writeSse(res, { type: 'phase', phase: 'leader_partial' });
    }

    if (leaderAttempt.emittedTokens && !leaderAttempt.fromCache) {
      recordUserUsageEvent({
        userId: authUser.id,
        provider: leader.provider,
        model: leader.model,
        inputTokens: leaderInputTokens,
        outputTokens: estimateTextTokens(leaderAttempt.content),
        source: 'concilium_leader',
        tooling: leaderTooling,
      });
    }

    writeSse(res, { type: 'done' });
  } catch (error: unknown) {
    if (controller.signal.aborted || isAbortError(error)) {
      writeSse(res, { type: 'cancelled' });
    } else {
      const message = normalizeError(error);
      console.error('[Concilium] Error:', message);
      writeSse(res, { type: 'error', error: message });
    }
  } finally {
    res.off('close', onClientClose);
    unregisterStream(streamRequestId);
    endSse(res);
  }
});

/**
 * POST /api/chat/summarize
 * Summarize conversation history via SSE streaming.
 */
chatRouter.post('/summarize', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const body = req.body as SummarizeRequest;
  const { provider, model, messages, requestId } = body;

  if (!provider || !model || !messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing required fields.' });
    return;
  }

  if (!hasApiKey(provider)) {
    res.status(400).json({ error: `No API key for provider: ${provider}` });
    return;
  }

  if (!ensureModelAllowed(res, authUser, provider, model)) {
    return;
  }

  const summaryMessages = messages.map((message) => `[${message.role}]: ${message.content}`).join('\n');
  const summaryPrompt = `Summarize the following conversation into concise bullet points. Focus on key topics discussed, decisions made, and important context. Keep it under 200 words.\n\n${summaryMessages}`;
  const summarySystemPrompt = 'You are a precise summarizer. Output only bullet points in a concise format.';
  const summaryInputTokens = estimateInputTokens([{ role: 'user', content: summaryPrompt }], summarySystemPrompt);
  if (
    !ensureBudget(res, {
      user: authUser,
      provider,
      model,
      inputTokens: summaryInputTokens,
      estimatedOutputTokens: 500,
    })
  ) {
    return;
  }

  const { requestId: streamRequestId, controller } = registerStream(requestId);
  const onClientClose = () => controller.abort();
  res.on('close', onClientClose);

  try {
    setupSse(res);
    writeSse(res, { type: 'meta', requestId: streamRequestId });

    const result = await streamProviderWithCache({
      route: 'summarize',
      provider,
      model,
      messages: [{ role: 'user', content: summaryPrompt }],
      systemPrompt: summarySystemPrompt,
      maxTokens: 500,
      signal: controller.signal,
      onToken: (token) => writeSse(res, { type: 'token', content: token }),
    });

    if (result.streamCompleted && !result.fromCache) {
      recordUserUsageEvent({
        userId: authUser.id,
        provider,
        model,
        inputTokens: summaryInputTokens,
        outputTokens: estimateTextTokens(result.content),
        source: 'summary',
      });
    }

    writeSse(res, controller.signal.aborted ? { type: 'cancelled' } : { type: 'done' });
  } catch (error: unknown) {
    if (controller.signal.aborted || isAbortError(error)) {
      writeSse(res, { type: 'cancelled' });
    } else {
      const message = normalizeError(error);
      console.error('[Summarize] Error:', message);
      writeSse(res, { type: 'error', error: message });
    }
  } finally {
    res.off('close', onClientClose);
    unregisterStream(streamRequestId);
    endSse(res);
  }
});
