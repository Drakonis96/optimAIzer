const WRAPPED_BY_QUOTE = /^(['"`])(.*)\1$/s;

const GOOGLE_KEY_PATTERN = /^AIza[0-9A-Za-z\-_]{20,}$/;
const GROQ_KEY_PATTERN = /^gsk_[A-Za-z0-9_\-]{12,}$/;
const OPENAI_KEY_PATTERN = /^sk-(?:proj-)?[A-Za-z0-9_\-]{12,}$/;
const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_\-]{12,}$/;
const OPENROUTER_KEY_PATTERN = /^(?:sk-or-v1-|or-)[A-Za-z0-9_\-]{12,}$/;

export const normalizeOpenRouterApiKey = (rawKey: string): string => {
  const trimmed = (rawKey || '').trim();
  const unquoted = WRAPPED_BY_QUOTE.test(trimmed)
    ? trimmed.replace(WRAPPED_BY_QUOTE, '$2').trim()
    : trimmed;
  return unquoted.replace(/^Bearer\s+/i, '').trim();
};

export const getOpenRouterApiKeyError = (rawKey: string): string | null => {
  const apiKey = normalizeOpenRouterApiKey(rawKey);
  if (!apiKey) {
    return 'No OpenRouter API key configured.';
  }
  if (OPENROUTER_KEY_PATTERN.test(apiKey)) {
    return null;
  }

  if (GOOGLE_KEY_PATTERN.test(apiKey)) {
    return 'Configured OpenRouter key looks like a Google API key (AIza...). Add an OpenRouter key that starts with "sk-or-v1-".';
  }
  if (GROQ_KEY_PATTERN.test(apiKey)) {
    return 'Configured OpenRouter key looks like a Groq API key (gsk_...). Add an OpenRouter key that starts with "sk-or-v1-".';
  }
  if (ANTHROPIC_KEY_PATTERN.test(apiKey)) {
    return 'Configured OpenRouter key looks like an Anthropic key (sk-ant-...). Add an OpenRouter key that starts with "sk-or-v1-".';
  }
  if (OPENAI_KEY_PATTERN.test(apiKey)) {
    return 'Configured OpenRouter key looks like an OpenAI key (sk-...). Add an OpenRouter key that starts with "sk-or-v1-".';
  }

  return 'Invalid OpenRouter API key format. Expected "sk-or-v1-..." (or legacy "or-...").';
};

