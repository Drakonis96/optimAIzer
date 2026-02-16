// ---------------------------------------------------------------------------
// Home Assistant WebSocket Client — Real-time state change subscriptions
// ---------------------------------------------------------------------------
// Connects to the Home Assistant WebSocket API to receive instant state_changed
// events instead of relying on polling/CRON. This enables the agent to react
// immediately when a light turns on, a door opens, temperature changes, etc.
//
// Protocol: https://developers.home-assistant.io/docs/api/websocket
// ---------------------------------------------------------------------------

import { HomeAssistantConfig, HAState, formatEntityState } from './homeAssistant';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HAStateChangedEvent {
  entityId: string;
  oldState: HAState | null;
  newState: HAState | null;
  /** Which attributes changed (if any) */
  changedAttributes: string[];
  timestamp: string;
}

export interface HAWebSocketOptions {
  /** Only forward events for these entity ID prefixes (e.g. ['light.', 'switch.', 'binary_sensor.']). Empty = all */
  entityFilters?: string[];
  /** Debounce rapid-fire state changes per entity (ms). Default: 2000 */
  debounceMs?: number;
  /** Auto-reconnect on disconnect. Default: true */
  autoReconnect?: boolean;
  /** Reconnect delay in ms. Default: 5000 */
  reconnectDelayMs?: number;
  /** Max reconnect attempts. Default: 50 (then gives up) */
  maxReconnectAttempts?: number;
}

type HAWsMessageHandler = (event: HAStateChangedEvent) => void;

// ---------------------------------------------------------------------------
// Home Assistant WebSocket Client
// ---------------------------------------------------------------------------

export class HomeAssistantWebSocket extends EventEmitter {
  private config: HomeAssistantConfig;
  private options: Required<HAWebSocketOptions>;
  private ws: import('ws') | null = null;
  private msgId = 0;
  private authenticated = false;
  private subscriptionId: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private stopped = false;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastStates = new Map<string, string>(); // entityId → last state string (for dedup)
  private stateChangeHandler: HAWsMessageHandler | null = null;

  constructor(config: HomeAssistantConfig, options: HAWebSocketOptions = {}) {
    super();
    this.config = config;
    this.options = {
      entityFilters: options.entityFilters || [],
      debounceMs: options.debounceMs ?? 2000,
      autoReconnect: options.autoReconnect !== false,
      reconnectDelayMs: options.reconnectDelayMs ?? 5000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 50,
    };
  }

  /**
   * Register a handler for state_changed events.
   */
  onStateChanged(handler: HAWsMessageHandler): void {
    this.stateChangeHandler = handler;
  }

  /**
   * Connect to Home Assistant WebSocket API and subscribe to state_changed events.
   */
  async connect(): Promise<void> {
    if (this.ws) {
      this.disconnect();
    }
    this.stopped = false;
    this.reconnectAttempts = 0;

    return this._connect();
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    this.stopped = true;
    this.authenticated = false;
    this.subscriptionId = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.ws) {
      try {
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.authenticated && this.ws?.readyState === 1; // WebSocket.OPEN
  }

  // -----------------------------------------------------------------------
  // Internal: connect + authenticate + subscribe
  // -----------------------------------------------------------------------

  private async _connect(): Promise<void> {
    // Dynamically import 'ws' (Node.js WebSocket library)
    const WebSocket = (await import('ws')).default;

    const wsUrl = this.config.url
      .replace(/^http/, 'ws')
      .replace(/\/+$/, '') + '/api/websocket';

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (!this.authenticated) {
          ws.close();
          reject(new Error('Home Assistant WebSocket connection timed out'));
        }
      }, 15000);

      ws.on('open', () => {
        console.log('[HA-WS] WebSocket connection opened');
      });

      ws.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(msg, resolve, reject, timeout);
        } catch (err: any) {
          console.error('[HA-WS] Failed to parse message:', err.message);
        }
      });

      ws.on('close', (code: number, reason: Buffer) => {
        console.log(`[HA-WS] Connection closed: ${code} ${reason.toString()}`);
        this.authenticated = false;
        this.subscriptionId = null;
        clearTimeout(timeout);
        this.emit('disconnected', { code, reason: reason.toString() });

        if (!this.stopped && this.options.autoReconnect) {
          this._scheduleReconnect();
        }
      });

      ws.on('error', (err: Error) => {
        console.error('[HA-WS] WebSocket error:', err.message);
        this.emit('error', err);
        if (!this.authenticated) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private _handleMessage(
    msg: any,
    onAuth?: (value: void) => void,
    onAuthFail?: (reason: Error) => void,
    authTimeout?: ReturnType<typeof setTimeout>
  ): void {
    switch (msg.type) {
      case 'auth_required':
        // Send authentication
        this._send({
          type: 'auth',
          access_token: this.config.token,
        });
        break;

      case 'auth_ok':
        this.authenticated = true;
        this.reconnectAttempts = 0;
        console.log(`[HA-WS] Authenticated with HA ${msg.ha_version || ''}`);
        if (authTimeout) clearTimeout(authTimeout);
        this.emit('connected', { version: msg.ha_version });

        // Subscribe to state_changed events
        this._subscribeToStateChanges();
        if (onAuth) onAuth();
        break;

      case 'auth_invalid':
        console.error('[HA-WS] Authentication failed:', msg.message);
        if (authTimeout) clearTimeout(authTimeout);
        if (onAuthFail) onAuthFail(new Error(`HA auth failed: ${msg.message}`));
        this.disconnect();
        break;

      case 'event':
        if (msg.id === this.subscriptionId && msg.event?.event_type === 'state_changed') {
          this._handleStateChanged(msg.event.data);
        }
        break;

      case 'result':
        if (msg.success) {
          if (msg.id === this.subscriptionId) {
            console.log('[HA-WS] Subscribed to state_changed events');
          }
        } else {
          console.error('[HA-WS] Command failed:', msg.error?.message || JSON.stringify(msg.error));
        }
        break;
    }
  }

  private _subscribeToStateChanges(): void {
    this.subscriptionId = this._nextId();
    this._send({
      id: this.subscriptionId,
      type: 'subscribe_events',
      event_type: 'state_changed',
    });
  }

  private _handleStateChanged(data: any): void {
    if (!data) return;

    const entityId: string = data.entity_id || '';
    const oldState: HAState | null = data.old_state || null;
    const newState: HAState | null = data.new_state || null;

    // Apply entity filters
    if (this.options.entityFilters.length > 0) {
      const matches = this.options.entityFilters.some(
        (filter) => entityId.startsWith(filter) || entityId === filter
      );
      if (!matches) return;
    }

    // Skip non-meaningful changes (same state value, only last_updated changed)
    if (oldState && newState && oldState.state === newState.state) {
      // Check if any attribute we care about changed
      const changedAttrs = this._getChangedAttributes(oldState, newState);
      if (changedAttrs.length === 0) return;
    }

    // Deduplicate rapid-fire events for the same entity
    const stateKey = `${entityId}:${newState?.state || 'unknown'}`;
    const lastState = this.lastStates.get(entityId);
    if (lastState === stateKey && this.debounceTimers.has(entityId)) {
      return; // Already debouncing identical state
    }
    this.lastStates.set(entityId, stateKey);

    // Debounce
    const existing = this.debounceTimers.get(entityId);
    if (existing) clearTimeout(existing);

    const event: HAStateChangedEvent = {
      entityId,
      oldState,
      newState,
      changedAttributes: this._getChangedAttributes(oldState, newState),
      timestamp: newState?.last_changed || new Date().toISOString(),
    };

    if (this.options.debounceMs > 0) {
      this.debounceTimers.set(
        entityId,
        setTimeout(() => {
          this.debounceTimers.delete(entityId);
          this._emitStateChanged(event);
        }, this.options.debounceMs)
      );
    } else {
      this._emitStateChanged(event);
    }
  }

  private _emitStateChanged(event: HAStateChangedEvent): void {
    if (this.stateChangeHandler) {
      try {
        this.stateChangeHandler(event);
      } catch (err: any) {
        console.error('[HA-WS] State change handler error:', err.message);
      }
    }
    this.emit('state_changed', event);
  }

  private _getChangedAttributes(oldState: HAState | null, newState: HAState | null): string[] {
    if (!oldState || !newState) return ['*'];
    const changed: string[] = [];

    // Check state value itself
    if (oldState.state !== newState.state) {
      changed.push('state');
    }

    // Check meaningful attributes
    const meaningfulAttrs = [
      'brightness', 'color_temp', 'rgb_color', 'temperature',
      'current_temperature', 'hvac_mode', 'hvac_action',
      'percentage', 'current_position', 'media_title',
      'volume_level', 'source', 'battery_level',
      'motion', 'occupancy', 'contact', 'water_leak',
    ];

    for (const attr of meaningfulAttrs) {
      const oldVal = oldState.attributes[attr];
      const newVal = newState.attributes[attr];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changed.push(attr);
      }
    }

    return changed;
  }

  private _send(msg: Record<string, any>): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private _nextId(): number {
    return ++this.msgId;
  }

  private _scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error(`[HA-WS] Max reconnect attempts (${this.options.maxReconnectAttempts}) reached. Giving up.`);
      this.emit('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.options.reconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1),
      60000 // max 1 minute
    );

    console.log(`[HA-WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this._connect();
        console.log('[HA-WS] Reconnected successfully');
      } catch (err: any) {
        console.error('[HA-WS] Reconnect failed:', err.message);
        this._scheduleReconnect();
      }
    }, delay);
  }
}

// ---------------------------------------------------------------------------
// Build a concise agent instruction from a HA state change
// ---------------------------------------------------------------------------

export function buildHAStateChangeInstruction(event: HAStateChangedEvent): string {
  const entityId = event.entityId;
  const domain = entityId.split('.')[0];
  const friendlyName = event.newState?.attributes?.friendly_name || entityId;

  const oldStateStr = event.oldState
    ? formatEntityState(event.oldState)
    : '(desconocido)';
  const newStateStr = event.newState
    ? formatEntityState(event.newState)
    : '(eliminado)';

  const lines = [
    `[EVENTO EN TIEMPO REAL — HOME ASSISTANT]`,
    '',
    `Se ha detectado un cambio de estado en tu sistema domótico:`,
    '',
    `📍 Entidad: ${friendlyName} (${entityId})`,
    `🏠 Dominio: ${domain}`,
    `🔄 Estado anterior: ${event.oldState?.state || 'desconocido'}`,
    `➡️ Estado nuevo: ${event.newState?.state || 'eliminado'}`,
  ];

  if (event.changedAttributes.length > 0 && !event.changedAttributes.includes('*')) {
    lines.push(`📊 Atributos modificados: ${event.changedAttributes.join(', ')}`);
  }

  lines.push(
    '',
    `Detalles del estado anterior:`,
    oldStateStr,
    '',
    `Detalles del estado nuevo:`,
    newStateStr,
    '',
    'Analiza este cambio y decide:',
    '1. ¿Es algo que el usuario deba saber de inmediato? (ej: alarma activada, sensor de agua, puerta abierta de noche)',
    '2. ¿Requiere alguna acción automática?',
    '3. ¿Es un cambio rutinario que no necesita notificación?',
    '',
    'Si es relevante o urgente, notifica al usuario por Telegram con un mensaje claro y conciso.',
    'Si es rutinario (ej: luz encendida a hora normal), NO envíes notificación.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Build instruction for HA automation webhook (HTTP-triggered events)
// ---------------------------------------------------------------------------

export function buildHAAutomationWebhookInstruction(
  automationName: string,
  triggeredEntity: string | undefined,
  payload: Record<string, any>
): string {
  const dataStr = JSON.stringify(payload, null, 2).slice(0, 4000);

  return [
    `[EVENTO EN TIEMPO REAL — AUTOMATIZACIÓN HOME ASSISTANT]`,
    '',
    `Una automatización de Home Assistant ha enviado un webhook:`,
    '',
    `🤖 Automatización: ${automationName}`,
    triggeredEntity ? `📍 Entidad que disparó el trigger: ${triggeredEntity}` : '',
    '',
    'Datos enviados por la automatización:',
    '```json',
    dataStr,
    '```',
    '',
    'Analiza esta notificación de automatización y decide:',
    '1. ¿Debes notificar al usuario por Telegram?',
    '2. ¿Debes ejecutar alguna acción adicional (cambiar estados, consultar información, etc.)?',
    '',
    'Actúa según las instrucciones del evento y las preferencias del usuario.',
  ].filter(Boolean).join('\n');
}
