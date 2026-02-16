// ---------------------------------------------------------------------------
// Event Subscriptions — Reactive, event-driven agent proactivity
// ---------------------------------------------------------------------------
// Allows agents to subscribe to events and react automatically when they
// occur. Goes beyond CRON-based scheduling by supporting:
//
// 1. Webhook events (github:push, stripe:payment, etc.)
// 2. Keyword triggers (activate when user mentions specific topics)
// 3. Periodic polling checks (price monitors, availability checks, etc.)
// 4. Home Assistant state changes
// 5. Custom event channels
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventSubscription {
  id: string;
  /** Human-readable name */
  name: string;
  /** Event pattern to match (e.g. 'webhook:github:push', 'poll:price_check', 'ha:state_changed') */
  eventPattern: string;
  /** Type of subscription */
  type: 'webhook' | 'poll' | 'keyword' | 'ha_state' | 'custom';
  /** Whether the subscription is active */
  enabled: boolean;
  /** Instruction for the agent when this event fires */
  instruction: string;
  /** Optional conditions in natural language */
  conditions?: string;
  /** For poll-type: interval in minutes */
  pollIntervalMinutes?: number;
  /** For poll-type: what to check (URL, command, etc.) */
  pollTarget?: string;
  /** For ha_state: entity ID to watch */
  haEntityId?: string;
  /** For ha_state: target state value (optional — fires on any change if omitted) */
  haTargetState?: string;
  /** For keyword: the keyword or phrase to match */
  keyword?: string;
  /** Cooldown in minutes between firings (prevent spam) */
  cooldownMinutes: number;
  /** Timestamp of last firing */
  lastFiredAt?: number;
  /** Number of times this subscription has fired */
  fireCount: number;
  /** Creation timestamp */
  createdAt: number;
}

export interface EventPayload {
  /** The event type string */
  eventType: string;
  /** Source of the event */
  source: string;
  /** The event data */
  data: Record<string, any>;
  /** Timestamp of when the event occurred */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Storage — Per-user, per-agent filesystem storage
// Structure: /data/agents/{user_id}/{agent_id}/event_subscriptions/{id}.json
// ---------------------------------------------------------------------------

function resolveDataRoot(): string {
  const explicitRoot = (process.env.OPTIMAIZER_AGENTS_DATA_ROOT || '').trim();
  if (explicitRoot) return path.resolve(explicitRoot);
  return path.resolve(__dirname, '../../../data/agents');
}

function subsDir(userId: string, agentId: string): string {
  const dir = path.join(resolveDataRoot(), userId, agentId, 'event_subscriptions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createSubscription(
  userId: string,
  agentId: string,
  params: Omit<EventSubscription, 'id' | 'fireCount' | 'createdAt' | 'lastFiredAt'>
): EventSubscription {
  const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const sub: EventSubscription = {
    ...params,
    id,
    fireCount: 0,
    createdAt: Date.now(),
  };
  const dir = subsDir(userId, agentId);
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(sub, null, 2), 'utf-8');
  return sub;
}

export function getSubscription(userId: string, agentId: string, subId: string): EventSubscription | null {
  const filePath = path.join(subsDir(userId, agentId), `${subId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function getAllSubscriptions(userId: string, agentId: string): EventSubscription[] {
  const dir = subsDir(userId, agentId);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as EventSubscription;
      } catch {
        return null;
      }
    })
    .filter((s): s is EventSubscription => s !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function updateSubscription(
  userId: string,
  agentId: string,
  subId: string,
  updates: Partial<EventSubscription>
): EventSubscription | null {
  const sub = getSubscription(userId, agentId, subId);
  if (!sub) return null;

  const updated = { ...sub, ...updates, id: sub.id, createdAt: sub.createdAt };
  const dir = subsDir(userId, agentId);
  fs.writeFileSync(path.join(dir, `${subId}.json`), JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export function deleteSubscription(userId: string, agentId: string, subId: string): boolean {
  const filePath = path.join(subsDir(userId, agentId), `${subId}.json`);
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function toggleSubscription(userId: string, agentId: string, subId: string, enabled: boolean): EventSubscription | null {
  return updateSubscription(userId, agentId, subId, { enabled });
}

// ---------------------------------------------------------------------------
// Event Matching — Check if an event matches any active subscription
// ---------------------------------------------------------------------------

/**
 * Find subscriptions that match an incoming event.
 * Returns subscriptions with respect to cooldown periods.
 */
export function matchSubscriptions(
  userId: string,
  agentId: string,
  event: EventPayload
): EventSubscription[] {
  const all = getAllSubscriptions(userId, agentId).filter((s) => s.enabled);
  const now = Date.now();

  return all.filter((sub) => {
    // Check cooldown
    if (sub.lastFiredAt && sub.cooldownMinutes > 0) {
      const cooldownMs = sub.cooldownMinutes * 60 * 1000;
      if (now - sub.lastFiredAt < cooldownMs) return false;
    }

    return matchesEventPattern(sub, event);
  });
}

function matchesEventPattern(sub: EventSubscription, event: EventPayload): boolean {
  const pattern = sub.eventPattern.toLowerCase();
  const eventType = event.eventType.toLowerCase();

  switch (sub.type) {
    case 'webhook':
      // Match webhook events: "webhook:github:push" matches event "github:push"
      // or "webhook:*" matches any webhook event
      if (pattern === 'webhook:*') return true;
      if (pattern.startsWith('webhook:')) {
        const webhookPattern = pattern.slice(8);
        return eventType === webhookPattern || eventType.startsWith(webhookPattern + ':');
      }
      return pattern === eventType;

    case 'keyword':
      // Match keyword in event data or source
      if (sub.keyword) {
        const kw = sub.keyword.toLowerCase();
        const dataStr = JSON.stringify(event.data).toLowerCase();
        return dataStr.includes(kw) || event.source.toLowerCase().includes(kw);
      }
      return false;

    case 'ha_state':
      // Match Home Assistant state change events
      if (sub.haEntityId) {
        const entityId = event.data?.entity_id || '';
        if (entityId !== sub.haEntityId) return false;
        if (sub.haTargetState) {
          const newState = event.data?.new_state?.state || event.data?.state || '';
          return newState === sub.haTargetState;
        }
        return true; // Any state change
      }
      return false;

    case 'poll':
      // Poll subscriptions are handled by the poll ticker, not by event matching
      return false;

    case 'custom':
      // Generic pattern matching
      if (pattern.endsWith('*')) {
        return eventType.startsWith(pattern.slice(0, -1));
      }
      return pattern === eventType;

    default:
      return pattern === eventType;
  }
}

/**
 * Record that a subscription has fired.
 */
export function recordSubscriptionFiring(userId: string, agentId: string, subId: string): void {
  const sub = getSubscription(userId, agentId, subId);
  if (!sub) return;
  updateSubscription(userId, agentId, subId, {
    lastFiredAt: Date.now(),
    fireCount: (sub.fireCount || 0) + 1,
  });
}

// ---------------------------------------------------------------------------
// Poll Ticker — For subscriptions that need periodic checking
// ---------------------------------------------------------------------------

/**
 * Get poll subscriptions that are due for execution.
 */
export function getDuePollSubscriptions(userId: string, agentId: string): EventSubscription[] {
  const all = getAllSubscriptions(userId, agentId).filter((s) => s.enabled && s.type === 'poll');
  const now = Date.now();

  return all.filter((sub) => {
    const intervalMs = (sub.pollIntervalMinutes || 60) * 60 * 1000;
    if (!sub.lastFiredAt) return true; // Never fired
    return now - sub.lastFiredAt >= intervalMs;
  });
}

/**
 * Build an agent instruction for a poll subscription check.
 */
export function buildPollInstruction(sub: EventSubscription): string {
  const lines = [
    `[SUSCRIPCIÓN DE EVENTOS — Comprobación periódica: "${sub.name}"]`,
    '',
    'Se ha activado una comprobación periódica basada en tu suscripción de eventos.',
    '',
    `Instrucciones: ${sub.instruction}`,
  ];

  if (sub.pollTarget) {
    lines.push(`Objetivo a comprobar: ${sub.pollTarget}`);
  }
  if (sub.conditions) {
    lines.push(`Condiciones: ${sub.conditions}`);
  }

  lines.push('');
  lines.push('Si la condición se cumple, notifica al usuario por Telegram con un resumen claro.');
  lines.push('Si no se cumple, registra el resultado sin enviar notificación (a menos que las instrucciones indiquen lo contrario).');

  return lines.join('\n');
}

/**
 * Build an agent instruction for a matched event subscription.
 */
export function buildEventSubscriptionInstruction(sub: EventSubscription, event: EventPayload): string {
  const dataStr = JSON.stringify(event.data, null, 2).slice(0, 4000);

  return [
    `[SUSCRIPCIÓN DE EVENTOS — "${sub.name}" activada]`,
    '',
    `Se ha detectado un evento que coincide con tu suscripción "${sub.name}".`,
    '',
    `Tipo de evento: ${event.eventType}`,
    `Origen: ${event.source}`,
    '',
    `Instrucciones de la suscripción: ${sub.instruction}`,
    sub.conditions ? `Condiciones: ${sub.conditions}` : '',
    '',
    'Datos del evento:',
    '```json',
    dataStr,
    '```',
    '',
    'Analiza el evento según las instrucciones y toma la acción correspondiente.',
    'Si es necesario notificar al usuario, envía un resumen claro por Telegram.',
  ].filter(Boolean).join('\n');
}
