import crypto from 'crypto';

const activeStreams = new Map<string, AbortController>();

const normalizeRequestId = (requestId?: string): string => {
  const trimmed = (requestId || '').trim();
  if (trimmed) return trimmed;
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const registerStream = (requestId?: string): { requestId: string; controller: AbortController } => {
  const normalizedId = normalizeRequestId(requestId);
  const existing = activeStreams.get(normalizedId);
  if (existing) {
    existing.abort();
    activeStreams.delete(normalizedId);
  }

  const controller = new AbortController();
  activeStreams.set(normalizedId, controller);
  return { requestId: normalizedId, controller };
};

export const unregisterStream = (requestId: string): void => {
  activeStreams.delete(requestId);
};

export const cancelStream = (requestId: string): boolean => {
  const controller = activeStreams.get(requestId);
  if (!controller) return false;
  controller.abort();
  activeStreams.delete(requestId);
  return true;
};

