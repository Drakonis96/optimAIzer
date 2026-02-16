import { randomUUID } from 'crypto';
import { getDatabase } from '../database';
import { estimateCostUsd } from './costs';
import { AuthUser } from './types';
import { ToolingOptions } from '../types';

interface UsageRow {
  totalCostUsd: number;
}

interface UsageAggregateRow {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  apiCalls: number;
}

interface ResourceAggregateRow {
  resourceType: string;
  units: number;
  totalCostUsd: number;
}

export type AgentCostPeriodKey = 'lastDay' | 'lastWeek' | 'lastMonth' | 'lastYear';

export interface AgentCostPeriodSummary {
  from: number;
  to: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  apiCalls: number;
  apiCostUsd: number;
  resourceCostUsd: number;
  totalCostUsd: number;
  resourceCounts: Record<string, number>;
}

export interface AgentCostSummary {
  agentId: string;
  generatedAt: number;
  periods: Record<AgentCostPeriodKey, AgentCostPeriodSummary>;
}

const getMonthRange = (timestamp = Date.now()): { start: number; end: number } => {
  const date = new Date(timestamp);
  const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  return { start, end };
};

const getDayRange = (timestamp = Date.now()): { start: number; end: number } => {
  const date = new Date(timestamp);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
};

const getAgentSourcePattern = (agentId: string): string => `agent:${agentId}:%`;

const queryUsageAggregate = (
  userId: string,
  range: { start: number; end: number },
  options?: { sourceLike?: string }
): UsageAggregateRow => {
  const sourceLike = options?.sourceLike;
  const row = sourceLike
    ? (getDatabase()
        .prepare(
          `SELECT
             COALESCE(SUM(input_tokens), 0) AS inputTokens,
             COALESCE(SUM(output_tokens), 0) AS outputTokens,
             COALESCE(SUM(total_cost_usd), 0) AS totalCostUsd,
             COUNT(*) AS apiCalls
           FROM user_usage_events
           WHERE user_id = ?
             AND created_at >= ?
             AND created_at < ?
             AND source LIKE ?`
        )
        .get(userId, range.start, range.end, sourceLike) as UsageAggregateRow | undefined)
    : (getDatabase()
        .prepare(
          `SELECT
             COALESCE(SUM(input_tokens), 0) AS inputTokens,
             COALESCE(SUM(output_tokens), 0) AS outputTokens,
             COALESCE(SUM(total_cost_usd), 0) AS totalCostUsd,
             COUNT(*) AS apiCalls
           FROM user_usage_events
           WHERE user_id = ?
             AND created_at >= ?
             AND created_at < ?`
        )
        .get(userId, range.start, range.end) as UsageAggregateRow | undefined);

  return {
    inputTokens: Math.max(0, Math.round(toFiniteNumber(row?.inputTokens))),
    outputTokens: Math.max(0, Math.round(toFiniteNumber(row?.outputTokens))),
    totalCostUsd: Math.max(0, toFiniteNumber(row?.totalCostUsd)),
    apiCalls: Math.max(0, Math.round(toFiniteNumber(row?.apiCalls))),
  };
};

const queryResourceAggregate = (
  userId: string,
  agentId: string,
  range: { start: number; end: number }
): { resourceCounts: Record<string, number>; resourceCostUsd: number } => {
  const rows = getDatabase()
    .prepare(
      `SELECT
         resource_type AS resourceType,
         COALESCE(SUM(units), 0) AS units,
         COALESCE(SUM(cost_usd), 0) AS totalCostUsd
       FROM user_resource_events
       WHERE user_id = ?
         AND agent_id = ?
         AND created_at >= ?
         AND created_at < ?
       GROUP BY resource_type`
    )
    .all(userId, agentId, range.start, range.end) as ResourceAggregateRow[];

  const resourceCounts: Record<string, number> = {};
  let resourceCostUsd = 0;

  for (const row of rows) {
    const key = String(row.resourceType || '').trim();
    if (!key) continue;
    const units = Math.max(0, Math.round(toFiniteNumber(row.units)));
    resourceCounts[key] = units;
    resourceCostUsd += Math.max(0, toFiniteNumber(row.totalCostUsd));
  }

  return { resourceCounts, resourceCostUsd };
};

const buildAgentCostPeriodSummary = (
  userId: string,
  agentId: string,
  range: { start: number; end: number }
): AgentCostPeriodSummary => {
  const usage = queryUsageAggregate(userId, range, { sourceLike: getAgentSourcePattern(agentId) });
  const resources = queryResourceAggregate(userId, agentId, range);
  const totalTokens = usage.inputTokens + usage.outputTokens;

  return {
    from: range.start,
    to: range.end,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens,
    apiCalls: usage.apiCalls,
    apiCostUsd: usage.totalCostUsd,
    resourceCostUsd: resources.resourceCostUsd,
    totalCostUsd: usage.totalCostUsd + resources.resourceCostUsd,
    resourceCounts: resources.resourceCounts,
  };
};

export const initializeUsageStore = (): void => {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS user_usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_cost_usd REAL NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_usage_events_user_month ON user_usage_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_user_usage_events_user_source_time ON user_usage_events(user_id, source, created_at);

    CREATE TABLE IF NOT EXISTS user_resource_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      units REAL NOT NULL DEFAULT 1,
      cost_usd REAL NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_resource_events_user_time ON user_resource_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_user_resource_events_user_agent_time ON user_resource_events(user_id, agent_id, created_at);
  `);
};

export const getUserMonthlyCostUsd = (userId: string, timestamp = Date.now()): number => {
  const { start, end } = getMonthRange(timestamp);
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(total_cost_usd), 0) AS totalCostUsd
       FROM user_usage_events
       WHERE user_id = ?
         AND created_at >= ?
         AND created_at < ?`
    )
    .get(userId, start, end) as UsageRow | undefined;

  return Number(row?.totalCostUsd || 0);
};

export const recordUserUsageEvent = (params: {
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  source: string;
  tooling?: ToolingOptions;
  timestamp?: number;
}): void => {
  const timestamp = params.timestamp ?? Date.now();
  const roundedInput = Math.max(0, Math.round(params.inputTokens));
  const roundedOutput = Math.max(0, Math.round(params.outputTokens));
  const cost = estimateCostUsd(params.provider, params.model, roundedInput, roundedOutput, params.tooling);

  getDatabase()
    .prepare(
      `INSERT INTO user_usage_events (
        id,
        user_id,
        provider,
        model,
        input_tokens,
        output_tokens,
        total_cost_usd,
        source,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      params.userId,
      params.provider,
      params.model,
      roundedInput,
      roundedOutput,
      cost.totalCostUsd,
      params.source,
      timestamp
    );
};

export const recordUserResourceEvent = (params: {
  userId: string;
  agentId: string;
  resourceType: string;
  units?: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
  timestamp?: number;
}): void => {
  const timestamp = typeof params.timestamp === 'number' && Number.isFinite(params.timestamp)
    ? params.timestamp
    : Date.now();
  const units = typeof params.units === 'number' && Number.isFinite(params.units) ? params.units : 1;
  const costUsd = typeof params.costUsd === 'number' && Number.isFinite(params.costUsd) ? params.costUsd : 0;
  const metadata = params.metadata && typeof params.metadata === 'object' ? params.metadata : {};

  getDatabase()
    .prepare(
      `INSERT INTO user_resource_events (
        id,
        user_id,
        agent_id,
        resource_type,
        units,
        cost_usd,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      params.userId,
      params.agentId,
      params.resourceType,
      units,
      costUsd,
      JSON.stringify(metadata),
      timestamp
    );
};

export const getAgentCostSummary = (
  userId: string,
  agentId: string,
  referenceTime = Date.now()
): AgentCostSummary => {
  const now = Number.isFinite(referenceTime) ? Math.floor(referenceTime) : Date.now();
  const lastDayStart = now - 24 * 60 * 60 * 1000;
  const lastWeekStart = now - 7 * 24 * 60 * 60 * 1000;
  const lastMonthStart = now - 30 * 24 * 60 * 60 * 1000;
  const lastYearStart = now - 365 * 24 * 60 * 60 * 1000;

  return {
    agentId,
    generatedAt: now,
    periods: {
      lastDay: buildAgentCostPeriodSummary(userId, agentId, { start: lastDayStart, end: now }),
      lastWeek: buildAgentCostPeriodSummary(userId, agentId, { start: lastWeekStart, end: now }),
      lastMonth: buildAgentCostPeriodSummary(userId, agentId, { start: lastMonthStart, end: now }),
      lastYear: buildAgentCostPeriodSummary(userId, agentId, { start: lastYearStart, end: now }),
    },
  };
};

/**
 * Return today's total cost for a specific agent (API cost + resource cost).
 */
export const getAgentDailyCostUsd = (userId: string, agentId: string): number => {
  const { start, end } = getDayRange();
  const usage = queryUsageAggregate(userId, { start, end }, { sourceLike: getAgentSourcePattern(agentId) });
  const resources = queryResourceAggregate(userId, agentId, { start, end });
  return usage.totalCostUsd + resources.resourceCostUsd;
};

export const assertWithinUserMonthlyBudget = (params: {
  user: AuthUser;
  provider: string;
  model: string;
  inputTokens: number;
  estimatedOutputTokens: number;
  tooling?: ToolingOptions;
  requestsInBatch?: number;
}): void => {
  const limitUsd = Number(params.user.monthlyCostLimitUsd || 0);
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) return;

  const currentCost = getUserMonthlyCostUsd(params.user.id);
  const estimate = estimateCostUsd(
    params.provider,
    params.model,
    Math.max(0, params.inputTokens),
    Math.max(0, params.estimatedOutputTokens),
    params.tooling
  );
  const multiplier = Math.max(1, Math.floor(params.requestsInBatch || 1));
  const projectedCost = currentCost + estimate.totalCostUsd * multiplier;

  if (projectedCost > limitUsd + 1e-9) {
    throw new Error(`Monthly cost limit reached for user "${params.user.username}".`);
  }
};
