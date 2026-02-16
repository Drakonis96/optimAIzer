// ---------------------------------------------------------------------------
// Webhook Event Router — Centralized real-time event dispatch
// ---------------------------------------------------------------------------
// Routes incoming real-time events (HA state changes, Gmail notifications,
// generic webhooks) to the correct agents based on their event subscriptions
// and configuration. Replaces the CRON-dependent polling model with instant
// event-driven reactions.
//
// This module acts as a "nervous system" — external events arrive here and
// are dispatched to all matching agents within milliseconds.
// ---------------------------------------------------------------------------

import * as eventSubs from './eventSubscriptions';
import { findSkillsByEvent } from './skills';
import { IncomingWebhookPayload } from './webhooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RealtimeEventSource =
  | 'home_assistant'
  | 'gmail'
  | 'webhook'
  | 'telegram'
  | 'calendar'
  | 'system';

export interface RealtimeEvent {
  /** Unique event ID */
  id: string;
  /** Source system */
  source: RealtimeEventSource;
  /** Event type within the source (e.g. 'state_changed', 'new_email', 'push') */
  eventType: string;
  /** Target agent IDs (empty = broadcast to all matching agents) */
  targetAgentIds?: string[];
  /** Event payload data */
  data: Record<string, any>;
  /** When the event occurred */
  timestamp: number;
  /** Priority: higher = more urgent */
  priority: 'low' | 'normal' | 'high' | 'critical';
  /** Optional metadata */
  metadata?: Record<string, any>;
}

export interface EventRouteResult {
  /** Agent IDs that received the event */
  routedTo: string[];
  /** Agent IDs where routing failed */
  failed: string[];
  /** Subscriptions that matched */
  matchedSubscriptions: number;
}

export type EventHandler = (agentId: string, userId: string, event: RealtimeEvent, instruction: string) => void;

// ---------------------------------------------------------------------------
// Event Router
// ---------------------------------------------------------------------------

export class WebhookEventRouter {
  private handler: EventHandler | null = null;
  private agentRegistry = new Map<string, { userId: string; sources: Set<RealtimeEventSource> }>();
  private eventLog: Array<{ event: RealtimeEvent; result: EventRouteResult; processedAt: number }> = [];
  private maxLogSize = 200;

  /**
   * Register the event handler that processes events for agents.
   * This is called by the manager to wire up event → agent message queue.
   */
  onEvent(handler: EventHandler): void {
    this.handler = handler;
  }

  /**
   * Register an agent as a listener for real-time events.
   */
  registerAgent(agentId: string, userId: string, sources: RealtimeEventSource[]): void {
    this.agentRegistry.set(agentId, {
      userId,
      sources: new Set(sources),
    });
    console.log(`[EventRouter] Agent ${agentId} registered for sources: ${sources.join(', ')}`);
  }

  /**
   * Unregister an agent (when it stops).
   */
  unregisterAgent(agentId: string): void {
    this.agentRegistry.delete(agentId);
    console.log(`[EventRouter] Agent ${agentId} unregistered`);
  }

  /**
   * Route an event to matching agents.
   */
  dispatch(event: RealtimeEvent): EventRouteResult {
    const result: EventRouteResult = {
      routedTo: [],
      failed: [],
      matchedSubscriptions: 0,
    };

    if (!this.handler) {
      console.warn('[EventRouter] No event handler registered, event dropped');
      return result;
    }

    // Determine target agents
    const targetAgents = event.targetAgentIds?.length
      ? event.targetAgentIds
      : Array.from(this.agentRegistry.keys());

    for (const agentId of targetAgents) {
      const agent = this.agentRegistry.get(agentId);
      if (!agent) continue;

      // Check if agent is listening for this source
      if (!agent.sources.has(event.source) && !agent.sources.has('system' as RealtimeEventSource)) {
        continue;
      }

      try {
        // Build event payload for matching
        const eventPayload: eventSubs.EventPayload = {
          eventType: `${event.source}:${event.eventType}`,
          source: event.source,
          data: event.data,
          timestamp: event.timestamp,
        };

        // Check event subscriptions
        const matchedSubs = eventSubs.matchSubscriptions(agent.userId, agentId, eventPayload);
        result.matchedSubscriptions += matchedSubs.length;

        // For each matched subscription, fire a specific instruction
        for (const sub of matchedSubs) {
          eventSubs.recordSubscriptionFiring(agent.userId, agentId, sub.id);
          const instruction = eventSubs.buildEventSubscriptionInstruction(sub, eventPayload);
          this.handler(agentId, agent.userId, event, instruction);
        }

        // Also check skills
        const triggeredSkills = findSkillsByEvent(agent.userId, agentId, `${event.source}:${event.eventType}`);
        result.matchedSubscriptions += triggeredSkills.length;

        // If no specific subscription matched but the event is targeted at this agent,
        // still deliver it with a generic instruction
        if (matchedSubs.length === 0 && triggeredSkills.length === 0) {
          // Only auto-forward if it's a targeted event or high priority
          if (event.targetAgentIds?.includes(agentId) || event.priority === 'high' || event.priority === 'critical') {
            const genericInstruction = buildGenericEventInstruction(event);
            this.handler(agentId, agent.userId, event, genericInstruction);
          }
        }

        result.routedTo.push(agentId);
      } catch (err: any) {
        console.error(`[EventRouter] Failed to route event to agent ${agentId}:`, err.message);
        result.failed.push(agentId);
      }
    }

    // Log the event
    this.eventLog.push({
      event,
      result,
      processedAt: Date.now(),
    });
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    if (result.routedTo.length > 0) {
      console.log(
        `[EventRouter] Event ${event.source}:${event.eventType} routed to ${result.routedTo.length} agent(s)` +
        (result.matchedSubscriptions > 0 ? ` (${result.matchedSubscriptions} subscription matches)` : '')
      );
    }

    return result;
  }

  /**
   * Get recent event log for diagnostics.
   */
  getRecentEvents(limit = 50): typeof this.eventLog {
    return this.eventLog.slice(-limit);
  }

  /**
   * Get registered agents.
   */
  getRegisteredAgents(): Array<{ agentId: string; userId: string; sources: string[] }> {
    return Array.from(this.agentRegistry.entries()).map(([agentId, info]) => ({
      agentId,
      userId: info.userId,
      sources: Array.from(info.sources),
    }));
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let routerInstance: WebhookEventRouter | null = null;

export function getEventRouter(): WebhookEventRouter {
  if (!routerInstance) {
    routerInstance = new WebhookEventRouter();
  }
  return routerInstance;
}

// ---------------------------------------------------------------------------
// Helper: generate unique event ID
// ---------------------------------------------------------------------------

let eventCounter = 0;

export function generateEventId(source: string): string {
  return `${source}-${Date.now()}-${++eventCounter}`;
}

// ---------------------------------------------------------------------------
// Helper: build a generic instruction for events without subscriptions
// ---------------------------------------------------------------------------

function buildGenericEventInstruction(event: RealtimeEvent): string {
  const dataStr = JSON.stringify(event.data, null, 2).slice(0, 4000);
  const priorityLabel = {
    low: '🔵 Baja',
    normal: '🟢 Normal',
    high: '🟠 Alta',
    critical: '🔴 Crítica',
  }[event.priority];

  return [
    `[EVENTO EN TIEMPO REAL — ${event.source.toUpperCase()}]`,
    '',
    `Se ha recibido un evento externo en tiempo real:`,
    '',
    `📡 Origen: ${event.source}`,
    `📋 Tipo: ${event.eventType}`,
    `⚡ Prioridad: ${priorityLabel}`,
    '',
    'Datos del evento:',
    '```json',
    dataStr,
    '```',
    '',
    'Analiza este evento y decide si requiere notificación o acción.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Priority detection helpers
// ---------------------------------------------------------------------------

/**
 * Determine event priority based on heuristics.
 */
export function detectEventPriority(
  source: RealtimeEventSource,
  eventType: string,
  data: Record<string, any>
): RealtimeEvent['priority'] {
  // Home Assistant critical events
  if (source === 'home_assistant') {
    const entityId = data.entity_id || '';
    const newState = data.new_state?.state || '';

    // Security-related entities
    if (
      entityId.includes('alarm') ||
      entityId.includes('smoke') ||
      entityId.includes('carbon_monoxide') ||
      entityId.includes('water_leak') ||
      entityId.includes('gas')
    ) {
      return 'critical';
    }

    // Door/window sensors at unusual hours (simplified — could be enhanced)
    if (
      entityId.includes('door') ||
      entityId.includes('lock') ||
      entityId.includes('window')
    ) {
      return 'high';
    }

    // Motion sensors
    if (entityId.includes('motion') || entityId.includes('occupancy')) {
      return 'normal';
    }

    // Lights, switches — low priority
    if (entityId.startsWith('light.') || entityId.startsWith('switch.')) {
      return 'low';
    }
  }

  // Gmail
  if (source === 'gmail') {
    // Could enhance with sender analysis, subject line keywords, etc.
    return 'normal';
  }

  // Generic webhooks
  if (source === 'webhook') {
    return 'normal';
  }

  return 'normal';
}
