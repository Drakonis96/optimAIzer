// ---------------------------------------------------------------------------
// Webhook Handler — Event-based proactivity for agents
// ---------------------------------------------------------------------------
// Receives external events (GitHub, Stripe, etc.) and enqueues them into the
// agent message queue for analysis. The agent decides whether the event is
// urgent and notifies the user via Telegram accordingly.
// ---------------------------------------------------------------------------

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookConfig {
  /** Whether webhooks are enabled for this agent */
  enabled: boolean;
  /** Secret used to validate incoming webhook signatures (HMAC-SHA256) */
  secret: string;
  /** List of source labels the agent accepts (e.g. 'github', 'stripe'). Empty = accept all */
  allowedSources: string[];
}

export interface IncomingWebhookPayload {
  /** Identifier for the external service (e.g. 'github', 'stripe', 'custom') */
  source: string;
  /** The event type as reported by the service (e.g. 'push', 'invoice.paid') */
  eventType?: string;
  /** The raw JSON payload from the external service */
  data: Record<string, any>;
}

export interface WebhookValidationResult {
  valid: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Signature verification helpers
// ---------------------------------------------------------------------------

/**
 * Verify an HMAC-SHA256 signature.
 * Supports:
 *   - GitHub:  X-Hub-Signature-256 header → `sha256=<hex>`
 *   - Stripe:  Stripe-Signature header → `t=<ts>,v1=<hex>` (simplified)
 *   - Generic: X-Webhook-Signature header → `sha256=<hex>` or raw hex
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>
): WebhookValidationResult {
  const normalize = (key: string): string | undefined => {
    const val = headers[key] || headers[key.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  // Determine which header carries the signature
  const githubSig = normalize('X-Hub-Signature-256') || normalize('x-hub-signature-256');
  const stripeSig = normalize('Stripe-Signature') || normalize('stripe-signature');
  const genericSig = normalize('X-Webhook-Signature') || normalize('x-webhook-signature');

  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody)
    .digest('hex');

  // GitHub: sha256=<hex>
  if (githubSig) {
    const provided = githubSig.startsWith('sha256=') ? githubSig.slice(7) : githubSig;
    if (!crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
      return { valid: false, error: 'GitHub signature mismatch' };
    }
    return { valid: true };
  }

  // Stripe: t=<ts>,v1=<hex>
  if (stripeSig) {
    const parts = stripeSig.split(',');
    const v1Part = parts.find((p) => p.startsWith('v1='));
    if (!v1Part) {
      return { valid: false, error: 'Stripe signature missing v1 component' };
    }
    // Stripe signs `${timestamp}.${body}` — for simplicity we verify against raw body
    const provided = v1Part.slice(3);
    try {
      if (!crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
        return { valid: false, error: 'Stripe signature mismatch' };
      }
    } catch {
      return { valid: false, error: 'Stripe signature format invalid' };
    }
    return { valid: true };
  }

  // Generic: sha256=<hex> or raw hex
  if (genericSig) {
    const provided = genericSig.startsWith('sha256=') ? genericSig.slice(7) : genericSig;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
        return { valid: false, error: 'Webhook signature mismatch' };
      }
    } catch {
      return { valid: false, error: 'Webhook signature format invalid' };
    }
    return { valid: true };
  }

  // No signature header found — reject if secret is configured
  return { valid: false, error: 'No signature header found in request' };
}

// ---------------------------------------------------------------------------
// Format webhook event into an agent instruction
// ---------------------------------------------------------------------------

/**
 * Build a prompt that tells the agent to analyse the webhook event and decide
 * whether it is urgent enough to notify the user via Telegram.
 */
export function buildWebhookInstruction(payload: IncomingWebhookPayload): string {
  const dataStr = JSON.stringify(payload.data, null, 2).slice(0, 6000);

  return [
    `[WEBHOOK EVENT — ${payload.source.toUpperCase()}${payload.eventType ? ` / ${payload.eventType}` : ''}]`,
    '',
    'Has recibido un evento externo a través de un webhook. Analiza el contenido y decide:',
    '1. ¿Es algo urgente o importante que el usuario deba conocer inmediatamente?',
    '2. ¿Requiere alguna acción por parte del usuario?',
    '',
    'Si es urgente o relevante, envía un resumen claro y conciso al usuario por Telegram.',
    'Si NO es urgente ni relevante (por ejemplo, un evento rutinario o de bajo impacto), NO envíes mensaje y simplemente responde que el evento fue procesado sin acción.',
    '',
    `Servicio origen: ${payload.source}`,
    payload.eventType ? `Tipo de evento: ${payload.eventType}` : '',
    '',
    'Datos del evento:',
    '```json',
    dataStr,
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Generate a random webhook secret
// ---------------------------------------------------------------------------

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Detect the source / event type from well-known headers
// ---------------------------------------------------------------------------

export function detectWebhookSource(
  headers: Record<string, string | string[] | undefined>,
  bodySource?: string
): { source: string; eventType?: string } {
  const normalize = (key: string): string | undefined => {
    const val = headers[key] || headers[key.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  // GitHub
  const ghEvent = normalize('X-GitHub-Event') || normalize('x-github-event');
  if (ghEvent) {
    return { source: 'github', eventType: ghEvent };
  }

  // Stripe
  const stripeEvent = normalize('Stripe-Signature') || normalize('stripe-signature');
  if (stripeEvent) {
    return { source: 'stripe', eventType: undefined }; // Event type is inside the body
  }

  // GitLab
  const glEvent = normalize('X-Gitlab-Event') || normalize('x-gitlab-event');
  if (glEvent) {
    return { source: 'gitlab', eventType: glEvent };
  }

  // Jira
  const jiraEvent = normalize('X-Atlassian-Webhook-Identifier') || normalize('x-atlassian-webhook-identifier');
  if (jiraEvent) {
    return { source: 'jira', eventType: normalize('X-Event-Key') || normalize('x-event-key') };
  }

  // Linear
  const linearEvent = normalize('Linear-Event') || normalize('linear-event');
  if (linearEvent) {
    return { source: 'linear', eventType: linearEvent };
  }

  // Fallback: use provided source or 'unknown'
  return { source: bodySource || 'unknown', eventType: undefined };
}
