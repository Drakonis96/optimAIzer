const REDACTION = '[REDACTED]';

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-+/=]{10,}\b/gi,
  /\b(sk-(?:or-v1-|proj-)?[A-Za-z0-9_\-]{12,})\b/g,
  /\b(sk-ant-[A-Za-z0-9_\-]{12,})\b/g,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  /\b(gsk_[A-Za-z0-9_\-]{12,})\b/g,
  /\b(or-[A-Za-z0-9_\-]{12,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9\-]{12,})\b/g,
  // iCloud app-specific passwords (xxxx-xxxx-xxxx-xxxx format)
  /\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b/gi,
  // Google OAuth client secrets (GOCSPX-...)
  /\bGOCSPX-[A-Za-z0-9_\-]{20,}\b/g,
  // Google refresh tokens (1//...)
  /\b1\/\/[A-Za-z0-9_\-]{20,}\b/g,
  // Base64 encoded credentials (Basic auth headers)
  /\bBasic\s+[A-Za-z0-9+/=]{16,}\b/gi,
  // Telegram bot tokens (numeric:alphanumeric)
  /\b\d{8,}:[A-Za-z0-9_\-]{30,}\b/g,
];

const QUERY_SECRET_PATTERN = /([?&](?:api[_-]?key|apikey|access[_-]?token|token|key)=)([^&\s]+)/gi;
const HEADER_SECRET_PATTERN = /((?:x-api-key|authorization)\s*[:=]\s*)([^\s,;]+)/gi;

export const redactSensitive = (value: string): string => {
  if (!value) return '';
  let redacted = value;

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTION);
  }

  redacted = redacted.replace(QUERY_SECRET_PATTERN, `$1${REDACTION}`);
  redacted = redacted.replace(HEADER_SECRET_PATTERN, `$1${REDACTION}`);
  return redacted;
};

export const safeErrorMessage = (error: unknown, fallback = 'Unknown error'): string => {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  const message = redactSensitive(raw || fallback).trim();
  if (!message) return fallback;
  return message.length > 600 ? `${message.slice(0, 597)}...` : message;
};
