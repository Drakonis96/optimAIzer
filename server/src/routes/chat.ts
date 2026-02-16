import { Router, Request, Response } from 'express';
import { createProvider } from '../providers';
import { ChatRequest, ConciliumMode, ConciliumRequest, Provider } from '../types';
import { hasApiKey } from '../config';
import { getEnabledToolingForProvider } from '../providers/base';
import { buildStreamCacheKey, streamResponseCache, StreamCacheRoute } from '../cache/responseCache';
import { cancelStream, registerStream, unregisterStream } from '../streaming/streamRegistry';
import { safeErrorMessage } from '../security/redact';
import { isModelAllowedForUser } from '../auth/users';
import { estimateInputTokens, estimateTextTokens } from '../auth/costs';
import { assertWithinUserMonthlyBudget, recordUserUsageEvent } from '../auth/usage';
import { AuthUser } from '../auth/types';

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

/**
 * POST /api/chat
 * Standard chat completion with SSE streaming.
 * Supports backend-side stream cancellation via requestId.
 */
chatRouter.post('/', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const body = req.body as ChatRequest;
  const { provider, model, messages, systemPrompt, maxTokens, temperature, reasoningEffort, tooling, requestId } = body;

  // Validate
  if (!provider || !model || !messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing required fields: provider, model, messages' });
    return;
  }

  if (!hasApiKey(provider)) {
    res.status(400).json({ error: `No API key configured for provider: ${provider}. Please add it in Settings.` });
    return;
  }

  if (!ensureModelAllowed(res, authUser, provider, model)) {
    return;
  }

  const effectiveTooling = getEnabledToolingForProvider(provider, tooling);
  const inputTokens = estimateInputTokens(messages, systemPrompt);
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

  try {
    setupSse(res);
    writeSse(res, { type: 'meta', requestId: streamRequestId });

    const result = await streamProviderWithCache({
      route: 'chat',
      provider,
      model,
      messages,
      systemPrompt,
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
