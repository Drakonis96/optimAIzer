// ---------------------------------------------------------------------------
// Webhook Routes — Public endpoints for receiving external events
// ---------------------------------------------------------------------------
// These routes do NOT require authentication (webhooks come from external
// services), but they ARE protected by HMAC-SHA256 signature verification
// using the per-agent webhook secret.
//
// Includes endpoints for:
// - Generic webhooks (GitHub, Stripe, etc.)
// - Home Assistant automation webhooks (real-time state notifications)
// - Gmail Pub/Sub push notifications (instant email alerts)
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import {
  enqueueWebhookEvent,
  enqueueRealtimeEvent,
  getAgentWebhookConfig,
} from '../agents/manager';
import {
  verifyWebhookSignature,
  detectWebhookSource,
  generateWebhookSecret,
  IncomingWebhookPayload,
} from '../agents/webhooks';
import { buildHAAutomationWebhookInstruction } from '../agents/homeAssistantWs';
import {
  decodePubSubNotification,
  fetchNewMessagesSinceHistory,
  getWatchState,
  getAgentsWithActiveWatch,
  buildGmailPushInstruction,
} from '../agents/gmailPush';
import {
  getEventRouter,
  generateEventId,
  detectEventPriority,
  RealtimeEvent,
} from '../agents/eventRouter';
import { requireAuth } from '../middleware/auth';

export const webhooksRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/webhooks/generate-secret
// Generate a new random webhook secret (requires auth)
// NOTE: Must be registered BEFORE /:agentId to avoid route collision
// ---------------------------------------------------------------------------
webhooksRouter.post('/generate-secret', requireAuth, (_req: Request, res: Response) => {
  try {
    const secret = generateWebhookSecret();
    res.json({ secret });
  } catch (error: any) {
    console.error('[Webhooks] Error generating secret:', error.message);
    res.status(500).json({ error: 'Internal error generating secret' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/gmail/push
// Receive Gmail push notifications from Google Cloud Pub/Sub.
// NOTE: Must be registered BEFORE /:agentId to avoid route collision.
// ---------------------------------------------------------------------------
webhooksRouter.post('/gmail/push', (req: Request, res: Response) => {
  try {
    const pubsubMessage = req.body?.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      res.status(200).json({ error: 'No message data' });
      return;
    }

    const notification = decodePubSubNotification({
      data: pubsubMessage.data,
      messageId: pubsubMessage.messageId || '',
      publishTime: pubsubMessage.publishTime || '',
    });

    if (!notification) {
      res.status(200).json({ error: 'Failed to decode notification' });
      return;
    }

    console.log(`[Webhooks] Gmail push notification: ${notification.emailAddress} (historyId: ${notification.historyId})`);

    const agentsWithWatch = getAgentsWithActiveWatch();
    let processed = 0;

    for (const agentId of agentsWithWatch) {
      const watchState = getWatchState(agentId);
      if (!watchState) continue;

      const lastHistoryId = watchState.lastHistoryId;

      fetchNewMessagesSinceHistory(agentId, watchState.config, lastHistoryId)
        .then(({ messages, newHistoryId }) => {
          if (messages.length === 0) {
            console.log(`[Webhooks] Gmail push: no new messages for agent ${agentId}`);
            return;
          }

          console.log(`[Webhooks] Gmail push: ${messages.length} new message(s) for agent ${agentId}`);

          const instruction = buildGmailPushInstruction(messages);
          if (instruction) {
            const router = getEventRouter();
            const event: RealtimeEvent = {
              id: generateEventId('gmail'),
              source: 'gmail',
              eventType: 'new_email',
              targetAgentIds: [agentId],
              data: {
                messageCount: messages.length,
                subjects: messages.map((m) => m.subject),
                senders: messages.map((m) => m.from),
                historyId: newHistoryId,
              },
              timestamp: Date.now(),
              priority: detectGmailPriority(messages),
            };
            router.dispatch(event);

            enqueueRealtimeEvent(agentId, {
              source: 'gmail',
              eventType: 'new_email',
              instruction,
              priority: event.priority,
              data: {
                messageCount: messages.length,
                subjects: messages.map((m) => m.subject),
              },
            });
          }
        })
        .catch((err) => {
          console.error(`[Webhooks] Failed to fetch Gmail messages for agent ${agentId}:`, err.message);
        });

      processed++;
    }

    res.status(200).json({ success: true, agentsNotified: processed });
  } catch (error: any) {
    console.error('[Webhooks] Error processing Gmail push:', error.message);
    res.status(200).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/webhooks/realtime/status
// Get status of all real-time event connections (requires auth)
// NOTE: Must be registered BEFORE /:agentId to avoid route collision.
// ---------------------------------------------------------------------------
webhooksRouter.get('/realtime/status', requireAuth, (_req: Request, res: Response) => {
  try {
    const router = getEventRouter();
    const agents = router.getRegisteredAgents();
    const recentEvents = router.getRecentEvents(20);

    res.json({
      registeredAgents: agents,
      recentEvents: recentEvents.map((e) => ({
        id: e.event.id,
        source: e.event.source,
        eventType: e.event.eventType,
        priority: e.event.priority,
        routedTo: e.result.routedTo,
        matchedSubscriptions: e.result.matchedSubscriptions,
        processedAt: e.processedAt,
      })),
    });
  } catch (error: any) {
    console.error('[Webhooks] Error getting realtime status:', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/:agentId
// Receive an external webhook event and enqueue it for the agent.
// This is a PUBLIC endpoint — no auth required, but signature is verified.
// ---------------------------------------------------------------------------
webhooksRouter.post('/:agentId', (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);

    // 1. Check if agent is running and webhooks are enabled
    const agentInfo = getAgentWebhookConfig(agentId);
    if (!agentInfo.running) {
      res.status(404).json({ error: 'Agent not found or not running' });
      return;
    }

    if (!agentInfo.webhooks?.enabled) {
      res.status(403).json({ error: 'Webhooks are not enabled for this agent' });
      return;
    }

    // 2. Verify webhook signature
    const secret = agentInfo.webhooks.secret;
    if (secret) {
      // We need the raw body for signature verification.
      // Express already parsed the body, so we reconstruct it.
      const rawBody = JSON.stringify(req.body);
      const verification = verifyWebhookSignature(secret, rawBody, req.headers as Record<string, string | string[] | undefined>);
      if (!verification.valid) {
        console.warn(`[Webhooks] Signature verification failed for agent ${agentId}: ${verification.error}`);
        res.status(401).json({ error: 'Webhook signature verification failed', detail: verification.error });
        return;
      }
    }

    // 3. Detect source and event type from headers (fallback to body)
    const detected = detectWebhookSource(
      req.headers as Record<string, string | string[] | undefined>,
      req.body?.source
    );

    // 4. Build payload
    const payload: IncomingWebhookPayload = {
      source: req.body?.source || detected.source,
      eventType: req.body?.eventType || detected.eventType || req.body?.type,
      data: req.body?.data || req.body || {},
    };

    // 5. Enqueue the event
    const result = enqueueWebhookEvent(agentId, payload);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      message: `Webhook event from "${payload.source}" enqueued for processing`,
      source: payload.source,
      eventType: payload.eventType,
    });
  } catch (error: any) {
    console.error('[Webhooks] Error processing webhook:', error.message);
    res.status(500).json({ error: 'Internal error processing webhook' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/:agentId/test
// Send a test webhook event (requires auth)
// ---------------------------------------------------------------------------
webhooksRouter.post('/:agentId/test', requireAuth, (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);

    const agentInfo = getAgentWebhookConfig(agentId);
    if (!agentInfo.running) {
      res.status(404).json({ error: 'Agent not found or not running' });
      return;
    }

    if (!agentInfo.webhooks?.enabled) {
      res.status(403).json({ error: 'Webhooks are not enabled for this agent' });
      return;
    }

    const testPayload: IncomingWebhookPayload = {
      source: 'test',
      eventType: 'test_event',
      data: {
        message: 'This is a test webhook event to verify the integration is working.',
        timestamp: new Date().toISOString(),
        triggered_by: 'manual_test',
      },
    };

    const result = enqueueWebhookEvent(agentId, testPayload);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      message: 'Test webhook event sent successfully',
    });
  } catch (error: any) {
    console.error('[Webhooks] Error sending test webhook:', error.message);
    res.status(500).json({ error: 'Internal error sending test webhook' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/webhooks/:agentId/info
// Get webhook configuration info for an agent (requires auth)
// Returns the webhook URL and whether it's enabled.
// ---------------------------------------------------------------------------
webhooksRouter.get('/:agentId/info', requireAuth, (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);

    const agentInfo = getAgentWebhookConfig(agentId);
    if (!agentInfo.running) {
      res.status(404).json({ error: 'Agent not found or not running' });
      return;
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const webhookUrl = `${baseUrl}/api/webhooks/${agentId}`;

    res.json({
      enabled: agentInfo.webhooks?.enabled || false,
      webhookUrl,
      allowedSources: agentInfo.webhooks?.allowedSources || [],
      hasSecret: !!agentInfo.webhooks?.secret,
      // Include real-time endpoint URLs
      realtimeEndpoints: {
        homeAssistant: `${baseUrl}/api/webhooks/${agentId}/ha`,
        gmailPush: `${baseUrl}/api/webhooks/gmail/push`,
      },
    });
  } catch (error: any) {
    console.error('[Webhooks] Error getting webhook info:', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ===========================================================================
// REAL-TIME ENDPOINTS — Event-driven webhooks (no CRON needed)
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /api/webhooks/:agentId/ha
// Receive Home Assistant automation webhook events.
// Configure a HA automation to POST to this URL when events occur.
//
// Expected body: {
//   automation_name: string,
//   entity_id?: string,
//   trigger?: { ... },
//   ... any extra data from HA
// }
//
// No signature verification — HA automations use simple HTTP POST.
// The URL itself acts as the "secret" (use a long agent ID).
// ---------------------------------------------------------------------------
webhooksRouter.post('/:agentId/ha', (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);

    const agentInfo = getAgentWebhookConfig(agentId);
    if (!agentInfo.running) {
      res.status(404).json({ error: 'Agent not found or not running' });
      return;
    }

    if (!agentInfo.webhooks?.enabled) {
      res.status(403).json({ error: 'Webhooks are not enabled for this agent' });
      return;
    }

    const body = req.body || {};
    const automationName = body.automation_name || body.automation || body.name || 'Unknown Automation';
    const entityId = body.entity_id || body.trigger?.entity_id || undefined;

    // Route through the event router for subscription matching
    const router = getEventRouter();
    const event: RealtimeEvent = {
      id: generateEventId('ha'),
      source: 'home_assistant',
      eventType: 'automation_webhook',
      targetAgentIds: [agentId],
      data: {
        automation_name: automationName,
        entity_id: entityId,
        ...body,
      },
      timestamp: Date.now(),
      priority: detectEventPriority('home_assistant', 'automation_webhook', {
        entity_id: entityId,
        ...body,
      }),
    };

    router.dispatch(event);

    // Also enqueue directly as a realtime event
    enqueueRealtimeEvent(agentId, {
      source: 'home_assistant',
      eventType: 'automation_webhook',
      instruction: buildHAAutomationWebhookInstruction(automationName, entityId, body),
      priority: event.priority,
      data: body,
    });

    console.log(`[Webhooks] HA automation webhook received for agent ${agentId}: "${automationName}"`);

    res.json({
      success: true,
      message: `Home Assistant event from "${automationName}" received`,
      source: 'home_assistant',
      priority: event.priority,
    });
  } catch (error: any) {
    console.error('[Webhooks] Error processing HA webhook:', error.message);
    res.status(500).json({ error: 'Internal error processing HA webhook' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/:agentId/ha/state
// Receive a specific HA entity state change via webhook.
// Useful for HA automations that fire on state changes.
//
// Expected body: {
//   entity_id: string,
//   old_state: string,
//   new_state: string,
//   attributes?: Record<string, any>,
//   friendly_name?: string
// }
// ---------------------------------------------------------------------------
webhooksRouter.post('/:agentId/ha/state', (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);

    const agentInfo = getAgentWebhookConfig(agentId);
    if (!agentInfo.running) {
      res.status(404).json({ error: 'Agent not found or not running' });
      return;
    }

    if (!agentInfo.webhooks?.enabled) {
      res.status(403).json({ error: 'Webhooks are not enabled for this agent' });
      return;
    }

    const body = req.body || {};
    const entityId = body.entity_id;
    if (!entityId) {
      res.status(400).json({ error: 'Missing entity_id in request body' });
      return;
    }

    const priority = detectEventPriority('home_assistant', 'state_changed', body);

    // Route through the event router
    const router = getEventRouter();
    const event: RealtimeEvent = {
      id: generateEventId('ha-state'),
      source: 'home_assistant',
      eventType: 'state_changed',
      targetAgentIds: [agentId],
      data: {
        entity_id: entityId,
        old_state: { state: body.old_state, attributes: body.old_attributes || {} },
        new_state: { state: body.new_state, attributes: body.attributes || body.new_attributes || {} },
        friendly_name: body.friendly_name || entityId,
      },
      timestamp: Date.now(),
      priority,
    };

    router.dispatch(event);

    // Also enqueue directly
    const friendlyName = body.friendly_name || entityId;
    enqueueRealtimeEvent(agentId, {
      source: 'home_assistant',
      eventType: 'state_changed',
      instruction: [
        `[EVENTO EN TIEMPO REAL — HOME ASSISTANT]`,
        '',
        `Cambio de estado detectado:`,
        `📍 ${friendlyName} (${entityId})`,
        `🔄 ${body.old_state || '?'} ➡️ ${body.new_state || '?'}`,
        body.attributes ? `📊 Atributos: ${JSON.stringify(body.attributes).slice(0, 500)}` : '',
        '',
        'Decide si el usuario necesita ser notificado.',
      ].filter(Boolean).join('\n'),
      priority,
      data: body,
    });

    console.log(`[Webhooks] HA state change for agent ${agentId}: ${entityId} → ${body.new_state} (priority: ${priority})`);

    res.json({
      success: true,
      entity_id: entityId,
      priority,
    });
  } catch (error: any) {
    console.error('[Webhooks] Error processing HA state webhook:', error.message);
    res.status(500).json({ error: 'Internal error processing HA state webhook' });
  }
});

// ---------------------------------------------------------------------------
// Helper: Detect Gmail priority from message content
// ---------------------------------------------------------------------------
function detectGmailPriority(
  messages: Array<{ subject: string; from: string; isUnread: boolean }>
): RealtimeEvent['priority'] {
  const urgentKeywords = [
    'urgente', 'urgent', 'importante', 'important',
    'alarma', 'alarm', 'emergencia', 'emergency',
    'factura', 'invoice', 'pago', 'payment',
    'cita', 'appointment', 'médic', 'doctor',
    'vencimiento', 'deadline', 'expira', 'expires',
  ];

  for (const msg of messages) {
    const combined = `${msg.subject} ${msg.from}`.toLowerCase();
    for (const kw of urgentKeywords) {
      if (combined.includes(kw)) return 'high';
    }
  }

  return 'normal';
}
