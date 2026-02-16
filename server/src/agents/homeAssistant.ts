// ---------------------------------------------------------------------------
// Home Assistant API Client — Smart Home control via HA REST API
// ---------------------------------------------------------------------------
//
// Connects to a Home Assistant instance to control lights, switches, covers,
// climate devices, scenes, scripts, and more.
//
// Requires: HA URL (e.g. http://192.168.1.50:8123) + long-lived access token.
// Token → HA Profile → Long-Lived Access Tokens → Create Token.
// ---------------------------------------------------------------------------

export interface HomeAssistantConfig {
  url: string;       // e.g. http://192.168.1.50:8123
  token: string;     // Long-lived access token
}

// ---------------------------------------------------------------------------
// Entity types returned by HA
// ---------------------------------------------------------------------------

export interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export interface HAService {
  domain: string;
  services: Record<string, { description: string; fields: Record<string, any> }>;
}

export interface HAConfig {
  location_name: string;
  version: string;
  components: string[];
  unit_system: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function haFetch<T>(config: HomeAssistantConfig, endpoint: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = config.url.replace(/\/+$/, '');
  const url = `${baseUrl}/api${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Home Assistant API error ${response.status}: ${text.slice(0, 300)}`);
  }

  // Some HA endpoints return empty 200
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testHomeAssistantConnection(config: HomeAssistantConfig): Promise<{ success: boolean; version?: string; locationName?: string; error?: string }> {
  try {
    const info = await haFetch<HAConfig>(config, '/config');
    return { success: true, version: info.version, locationName: info.location_name };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// State queries
// ---------------------------------------------------------------------------

/** Get all entity states */
export async function getStates(config: HomeAssistantConfig): Promise<HAState[]> {
  return haFetch<HAState[]>(config, '/states');
}

/** Get state of a single entity */
export async function getEntityState(config: HomeAssistantConfig, entityId: string): Promise<HAState> {
  return haFetch<HAState>(config, `/states/${entityId}`);
}

/** Get entities filtered by domain (e.g. "light", "switch", "climate") */
export async function getEntitiesByDomain(config: HomeAssistantConfig, domain: string): Promise<HAState[]> {
  const states = await getStates(config);
  return states.filter(s => s.entity_id.startsWith(`${domain}.`));
}

/** Search entities by name/id pattern */
export async function searchEntities(config: HomeAssistantConfig, query: string): Promise<HAState[]> {
  const states = await getStates(config);
  const q = query.toLowerCase();

  // 1) Direct match on entity_id or friendly_name
  const directMatches = states.filter(s => {
    const friendlyName = String(s.attributes.friendly_name || '').toLowerCase();
    const entityId = s.entity_id.toLowerCase();
    return friendlyName.includes(q) || entityId.includes(q);
  });

  if (directMatches.length > 0) return directMatches;

  // 2) No direct match → try matching against HA area names.
  //    If the query matches an area name, return all entities belonging to that area.
  try {
    const areaEntities = await getEntitiesByAreaName(config, query);
    if (areaEntities.length > 0) return areaEntities;
  } catch {
    // Area resolution failed — fall through to empty result
  }

  return [];
}

// ---------------------------------------------------------------------------
// Area-aware queries (uses HA Template API)
// ---------------------------------------------------------------------------

/** Represents a Home Assistant area with its associated entities */
export interface HAArea {
  id: string;
  name: string;
  entityIds: string[];
}

/**
 * List all areas in Home Assistant with their entity IDs.
 * Uses the HA Template API which is available via REST.
 */
export async function listAreas(config: HomeAssistantConfig): Promise<HAArea[]> {
  // Jinja2 template that outputs JSON with all areas and their entities
  const template =
    '[{% for area_id in areas() %}'
    + '{"id":"{{ area_id }}",'
    + '"name":"{{ area_name(area_id) | replace(\'"\', \'\\\\\\"\')}}",'
    + '"entities":{{ area_entities(area_id) | to_json }}}'
    + '{% if not loop.last %},{% endif %}'
    + '{% endfor %}]';

  // The template API returns text/plain, not application/json, so we
  // use a direct fetch instead of haFetch.
  const baseUrl = config.url.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/api/template`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ template }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HA template API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const raw = await response.text();
  const parsed: Array<{ id: string; name: string; entities: string[] }> = JSON.parse(raw);

  return parsed.map(a => ({
    id: a.id,
    name: a.name,
    entityIds: a.entities,
  }));
}

/**
 * Find an area whose name fuzzy-matches the query, then return the full
 * state objects for every entity belonging to that area.
 */
export async function getEntitiesByAreaName(
  config: HomeAssistantConfig,
  query: string
): Promise<HAState[]> {
  const areas = await listAreas(config);
  const q = query.toLowerCase();

  // Find matching area(s) — the area name contains the query or vice-versa
  const matchingAreas = areas.filter(a => {
    const areaName = a.name.toLowerCase();
    return areaName.includes(q) || q.includes(areaName);
  });

  if (matchingAreas.length === 0) return [];

  // Collect all entity IDs from matching areas
  const targetIds = new Set<string>();
  for (const area of matchingAreas) {
    for (const eid of area.entityIds) {
      targetIds.add(eid);
    }
  }

  if (targetIds.size === 0) return [];

  // Fetch states only for those entities
  const allStates = await getStates(config);
  return allStates.filter(s => targetIds.has(s.entity_id));
}

// ---------------------------------------------------------------------------
// Service calls (the core of HA control)
// ---------------------------------------------------------------------------

/** Call a Home Assistant service (e.g. light.turn_on, switch.toggle) */
export async function callService(
  config: HomeAssistantConfig,
  domain: string,
  service: string,
  data: Record<string, any> = {}
): Promise<HAState[]> {
  return haFetch<HAState[]>(config, `/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/** Turn on a light (with optional brightness 0-255, color_temp, rgb_color) */
export async function turnOnLight(
  config: HomeAssistantConfig,
  entityId: string,
  options?: { brightness?: number; color_temp?: number; rgb_color?: [number, number, number] }
): Promise<HAState[]> {
  const data: Record<string, any> = { entity_id: entityId };
  if (options?.brightness !== undefined) data.brightness = options.brightness;
  if (options?.color_temp !== undefined) data.color_temp = options.color_temp;
  if (options?.rgb_color) data.rgb_color = options.rgb_color;
  return callService(config, 'light', 'turn_on', data);
}

/** Turn off a light */
export async function turnOffLight(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'light', 'turn_off', { entity_id: entityId });
}

/** Toggle a light */
export async function toggleLight(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'light', 'toggle', { entity_id: entityId });
}

/** Turn on a switch */
export async function turnOnSwitch(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'switch', 'turn_on', { entity_id: entityId });
}

/** Turn off a switch */
export async function turnOffSwitch(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'switch', 'turn_off', { entity_id: entityId });
}

/** Toggle a switch */
export async function toggleSwitch(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'switch', 'toggle', { entity_id: entityId });
}

/** Set climate temperature */
export async function setClimateTemperature(
  config: HomeAssistantConfig,
  entityId: string,
  temperature: number,
  hvacMode?: string
): Promise<HAState[]> {
  const data: Record<string, any> = { entity_id: entityId, temperature };
  if (hvacMode) data.hvac_mode = hvacMode;
  return callService(config, 'climate', 'set_temperature', data);
}

/** Set climate HVAC mode */
export async function setClimateMode(
  config: HomeAssistantConfig,
  entityId: string,
  hvacMode: string
): Promise<HAState[]> {
  return callService(config, 'climate', 'set_hvac_mode', { entity_id: entityId, hvac_mode: hvacMode });
}

/** Open a cover (blinds, garage door, etc.) */
export async function openCover(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'cover', 'open_cover', { entity_id: entityId });
}

/** Close a cover */
export async function closeCover(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'cover', 'close_cover', { entity_id: entityId });
}

/** Activate a scene */
export async function activateScene(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'scene', 'turn_on', { entity_id: entityId });
}

/** Run a script */
export async function runScript(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, entityId.replace('script.', '').includes('.') ? 'script' : 'script', 'turn_on', { entity_id: entityId });
}

/** Lock a lock */
export async function lockEntity(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'lock', 'lock', { entity_id: entityId });
}

/** Unlock a lock */
export async function unlockEntity(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'lock', 'unlock', { entity_id: entityId });
}

/** Set fan speed (0-100 percentage) */
export async function setFanSpeed(config: HomeAssistantConfig, entityId: string, percentage: number): Promise<HAState[]> {
  return callService(config, 'fan', 'set_percentage', { entity_id: entityId, percentage });
}

/** Send TTS notification through HA media players */
export async function sendTTS(
  config: HomeAssistantConfig,
  entityId: string,
  message: string,
  language?: string
): Promise<HAState[]> {
  const data: Record<string, any> = { entity_id: entityId, message };
  if (language) data.language = language;
  return callService(config, 'tts', 'speak', data);
}

/** Fire a HA automation */
export async function triggerAutomation(config: HomeAssistantConfig, entityId: string): Promise<HAState[]> {
  return callService(config, 'automation', 'trigger', { entity_id: entityId });
}

// ---------------------------------------------------------------------------
// Utility: format entity state for display
// ---------------------------------------------------------------------------

export function formatEntityState(entity: HAState): string {
  const name = entity.attributes.friendly_name || entity.entity_id;
  const domain = entity.entity_id.split('.')[0];
  const state = entity.state;

  const extras: string[] = [];

  if (domain === 'light') {
    if (entity.attributes.brightness !== undefined) {
      const pct = Math.round((entity.attributes.brightness / 255) * 100);
      extras.push(`brillo: ${pct}%`);
    }
    if (entity.attributes.color_temp) extras.push(`temp: ${entity.attributes.color_temp}`);
    if (entity.attributes.rgb_color) extras.push(`color: rgb(${entity.attributes.rgb_color.join(',')})`);
  } else if (domain === 'climate') {
    if (entity.attributes.current_temperature !== undefined) {
      extras.push(`actual: ${entity.attributes.current_temperature}°`);
    }
    if (entity.attributes.temperature !== undefined) {
      extras.push(`objetivo: ${entity.attributes.temperature}°`);
    }
    if (entity.attributes.hvac_action) extras.push(`acción: ${entity.attributes.hvac_action}`);
  } else if (domain === 'cover') {
    if (entity.attributes.current_position !== undefined) {
      extras.push(`posición: ${entity.attributes.current_position}%`);
    }
  } else if (domain === 'fan') {
    if (entity.attributes.percentage !== undefined) {
      extras.push(`velocidad: ${entity.attributes.percentage}%`);
    }
  } else if (domain === 'media_player') {
    if (entity.attributes.media_title) extras.push(`reproduciendo: ${entity.attributes.media_title}`);
    if (entity.attributes.volume_level !== undefined) {
      extras.push(`vol: ${Math.round(entity.attributes.volume_level * 100)}%`);
    }
  }

  const extrasStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';
  return `${name} [${entity.entity_id}]: ${state}${extrasStr}`;
}

/** Get a human-readable summary of a domain's entities */
export async function getDomainSummary(config: HomeAssistantConfig, domain: string): Promise<string> {
  const entities = await getEntitiesByDomain(config, domain);
  if (entities.length === 0) return `No se encontraron entidades de tipo "${domain}".`;
  return entities.map(formatEntityState).join('\n');
}
