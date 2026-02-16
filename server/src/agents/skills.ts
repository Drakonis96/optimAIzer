// ---------------------------------------------------------------------------
// Skills System — Modular SKILL.md loader and manager
// ---------------------------------------------------------------------------
// Skills are Markdown files with YAML frontmatter that define reusable
// agent capabilities. They can include:
// - Custom system prompt instructions
// - Pre-configured MCP server references
// - Trigger conditions (event-driven activation)
// - Tool suggestions and workflows
//
// Format inspired by OpenClaw's SKILL.md but using MCP as the tool backbone.
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillTrigger {
  /** Event types that activate this skill (e.g. 'webhook:github', 'schedule:daily', 'keyword:factura') */
  events: string[];
  /** Optional conditions in natural language */
  conditions?: string;
}

export interface SkillMCPServer {
  /** MCP server ID from the registry */
  id: string;
  /** Whether the server should be auto-connected when the skill is active */
  autoConnect: boolean;
  /** Pre-configured environment variables / config for the server */
  config: Record<string, string>;
}

export interface Skill {
  /** Unique skill identifier (derived from filename or explicitly set) */
  id: string;
  /** Human-readable skill name */
  name: string;
  /** Short description of what the skill does */
  description: string;
  /** Semantic version */
  version: string;
  /** Author name/handle */
  author: string;
  /** Tags for categorization and search */
  tags: string[];
  /** Whether the skill is currently active for an agent */
  enabled: boolean;
  /** Priority for prompt injection order (higher = injected first) */
  priority: number;
  /** Event-driven triggers that auto-activate this skill */
  triggers: SkillTrigger;
  /** MCP servers this skill depends on */
  mcpServers: SkillMCPServer[];
  /** The main instruction body (Markdown content after frontmatter) */
  instructions: string;
  /** Raw source file path (if loaded from file) */
  sourcePath?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  enabled: boolean;
  priority: number;
  triggers: SkillTrigger;
  mcpServerIds: string[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// YAML Frontmatter Parser (lightweight, no external deps)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): { metadata: Record<string, any>; body: string } {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    return { metadata: {}, body: trimmed };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { metadata: {}, body: trimmed };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();
  const metadata = parseSimpleYaml(yamlBlock);

  return { metadata, body };
}

/**
 * Minimal YAML parser supporting:
 * - key: value (strings, numbers, booleans)
 * - key: [item1, item2] (inline arrays)
 * - key:\n  - item1\n  - item2 (block arrays)
 * - key:\n  nested_key: value (one level of nesting)
 * - key:\n  - id: x\n    config:\n      k: v (array of objects)
 */
function parseSimpleYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      i++;
      continue;
    }

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) {
      i++;
      continue;
    }

    const key = trimmedLine.slice(0, colonIndex).trim();
    const rawValue = trimmedLine.slice(colonIndex + 1).trim();

    if (rawValue) {
      // Inline value
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        // Inline array: [item1, item2, item3]
        const inner = rawValue.slice(1, -1).trim();
        result[key] = inner
          ? inner.split(',').map((s) => parseYamlValue(s.trim()))
          : [];
      } else {
        result[key] = parseYamlValue(rawValue);
      }
      i++;
    } else {
      // Multi-line value (block array or nested object)
      i++;
      const indent = getIndent(lines[i] || '');
      if (indent === 0) continue;

      // Check if it's a block array (starts with "- ")
      const nextTrimmed = (lines[i] || '').trim();
      if (nextTrimmed.startsWith('- ')) {
        const items: any[] = [];
        while (i < lines.length) {
          const itemLine = lines[i];
          const itemTrimmed = itemLine.trim();
          if (!itemTrimmed || getIndent(itemLine) < indent) break;

          if (itemTrimmed.startsWith('- ')) {
            const itemValue = itemTrimmed.slice(2).trim();
            // Check if this is an object item (has key: value)
            if (itemValue.includes(':')) {
              const obj: Record<string, any> = {};
              // Parse first key-value in the "- key: value" line
              const firstColon = itemValue.indexOf(':');
              const firstKey = itemValue.slice(0, firstColon).trim();
              const firstVal = itemValue.slice(firstColon + 1).trim();
              obj[firstKey] = parseYamlValue(firstVal);
              i++;
              // Continue reading indented properties of this object
              const objIndent = getIndent(lines[i] || '');
              while (i < lines.length && getIndent(lines[i] || '') >= objIndent && (lines[i] || '').trim() && !(lines[i] || '').trim().startsWith('- ')) {
                const propLine = (lines[i] || '').trim();
                const propColon = propLine.indexOf(':');
                if (propColon !== -1) {
                  const propKey = propLine.slice(0, propColon).trim();
                  const propVal = propLine.slice(propColon + 1).trim();
                  if (propVal) {
                    obj[propKey] = parseYamlValue(propVal);
                  } else {
                    // Nested object (one more level)
                    i++;
                    const nestedObj: Record<string, any> = {};
                    const nestedIndent = getIndent(lines[i] || '');
                    while (i < lines.length && getIndent(lines[i] || '') >= nestedIndent && (lines[i] || '').trim()) {
                      const nestedLine = (lines[i] || '').trim();
                      const nestedColon = nestedLine.indexOf(':');
                      if (nestedColon !== -1) {
                        nestedObj[nestedLine.slice(0, nestedColon).trim()] = parseYamlValue(nestedLine.slice(nestedColon + 1).trim());
                      }
                      i++;
                    }
                    obj[propKey] = nestedObj;
                    continue;
                  }
                }
                i++;
              }
              items.push(obj);
            } else {
              items.push(parseYamlValue(itemValue));
              i++;
            }
          } else {
            break;
          }
        }
        result[key] = items;
      } else {
        // Nested object
        const nestedObj: Record<string, any> = {};
        while (i < lines.length) {
          const nestedLine = lines[i];
          const nestedTrimmed = (nestedLine || '').trim();
          if (!nestedTrimmed || getIndent(nestedLine) < indent) break;
          const nestedColon = nestedTrimmed.indexOf(':');
          if (nestedColon !== -1) {
            const nestedKey = nestedTrimmed.slice(0, nestedColon).trim();
            const nestedVal = nestedTrimmed.slice(nestedColon + 1).trim();
            nestedObj[nestedKey] = nestedVal ? parseYamlValue(nestedVal) : '';
          }
          i++;
        }
        result[key] = nestedObj;
      }
    }
  }

  return result;
}

function getIndent(line: string): number {
  const match = line.match(/^(\s+)/);
  return match ? match[1].length : 0;
}

function parseYamlValue(value: string): any {
  if (!value) return '';
  // Remove surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;
  return value;
}

// ---------------------------------------------------------------------------
// Skill Parser — Convert raw Markdown to Skill object
// ---------------------------------------------------------------------------

export function parseSkillMarkdown(content: string, filename?: string): Skill {
  const { metadata, body } = parseFrontmatter(content);

  const id = metadata.id || (filename ? filename.replace(/\.md$/i, '').replace(/\s+/g, '-').toLowerCase() : `skill-${Date.now()}`);

  const triggers: SkillTrigger = {
    events: [],
    conditions: undefined,
  };

  if (metadata.triggers) {
    if (typeof metadata.triggers === 'object' && !Array.isArray(metadata.triggers)) {
      triggers.events = Array.isArray(metadata.triggers.events)
        ? metadata.triggers.events
        : typeof metadata.triggers.events === 'string'
          ? [metadata.triggers.events]
          : [];
      triggers.conditions = metadata.triggers.conditions || undefined;
    } else if (Array.isArray(metadata.triggers)) {
      triggers.events = metadata.triggers.map(String);
    }
  }

  const mcpServers: SkillMCPServer[] = [];
  if (Array.isArray(metadata.mcp_servers)) {
    for (const server of metadata.mcp_servers) {
      if (typeof server === 'object' && server.id) {
        mcpServers.push({
          id: server.id,
          autoConnect: server.auto_connect !== false,
          config: typeof server.config === 'object' ? server.config : {},
        });
      } else if (typeof server === 'string') {
        mcpServers.push({ id: server, autoConnect: true, config: {} });
      }
    }
  }

  const tags: string[] = Array.isArray(metadata.tags)
    ? metadata.tags.map(String)
    : typeof metadata.tags === 'string'
      ? metadata.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : [];

  return {
    id,
    name: metadata.name || id,
    description: metadata.description || '',
    version: String(metadata.version || '1.0.0'),
    author: metadata.author || 'unknown',
    tags,
    enabled: metadata.enabled !== false,
    priority: typeof metadata.priority === 'number' ? metadata.priority : 50,
    triggers,
    mcpServers,
    instructions: body,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Skill Storage — Per-user, per-agent filesystem storage
// Structure: /data/agents/{user_id}/{agent_id}/skills/{skill_id}.md
// ---------------------------------------------------------------------------

function skillsDir(userId: string, agentId: string): string {
  const resolveDataRoot = (): string => {
    const explicitRoot = (process.env.OPTIMAIZER_AGENTS_DATA_ROOT || '').trim();
    if (explicitRoot) return path.resolve(explicitRoot);
    return path.resolve(__dirname, '../../../data/agents');
  };
  const dir = path.join(resolveDataRoot(), userId, agentId, 'skills');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Save a skill as a .md file in the agent's skills directory.
 */
export function saveSkill(userId: string, agentId: string, skill: Skill): void {
  const dir = skillsDir(userId, agentId);
  const filename = `${skill.id}.md`;
  const content = serializeSkillToMarkdown(skill);
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

/**
 * Load a single skill by ID.
 */
export function getSkill(userId: string, agentId: string, skillId: string): Skill | null {
  const dir = skillsDir(userId, agentId);
  const filePath = path.join(dir, `${skillId}.md`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const skill = parseSkillMarkdown(content, `${skillId}.md`);
    skill.sourcePath = filePath;
    return skill;
  } catch (err) {
    console.warn(`[Skills] Failed to parse skill "${skillId}":`, err);
    return null;
  }
}

/**
 * Get all skills for an agent.
 */
export function getAllSkills(userId: string, agentId: string): Skill[] {
  const dir = skillsDir(userId, agentId);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const skills: Skill[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const skill = parseSkillMarkdown(content, file);
      skill.sourcePath = path.join(dir, file);
      skills.push(skill);
    } catch (err) {
      console.warn(`[Skills] Failed to parse skill file "${file}":`, err);
    }
  }

  return skills.sort((a, b) => b.priority - a.priority);
}

/**
 * Get skill summaries (lightweight, for listings).
 */
export function getSkillSummaries(userId: string, agentId: string): SkillSummary[] {
  return getAllSkills(userId, agentId).map(skillToSummary);
}

/**
 * Delete a skill by ID.
 */
export function deleteSkill(userId: string, agentId: string, skillId: string): boolean {
  const dir = skillsDir(userId, agentId);
  const filePath = path.join(dir, `${skillId}.md`);
  if (!fs.existsSync(filePath)) return false;

  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Toggle a skill's enabled state.
 */
export function toggleSkill(userId: string, agentId: string, skillId: string, enabled: boolean): Skill | null {
  const skill = getSkill(userId, agentId, skillId);
  if (!skill) return null;
  skill.enabled = enabled;
  skill.updatedAt = Date.now();
  saveSkill(userId, agentId, skill);
  return skill;
}

/**
 * Search skills by query (matches name, description, tags, instructions).
 */
export function searchSkills(userId: string, agentId: string, query: string): Skill[] {
  const all = getAllSkills(userId, agentId);
  const q = query.toLowerCase();
  return all.filter((skill) =>
    skill.name.toLowerCase().includes(q) ||
    skill.description.toLowerCase().includes(q) ||
    skill.tags.some((t) => t.toLowerCase().includes(q)) ||
    skill.instructions.toLowerCase().includes(q)
  );
}

// ---------------------------------------------------------------------------
// Skill → Prompt Injection
// ---------------------------------------------------------------------------

/**
 * Build the skills prompt section to inject into the agent's system prompt.
 * Only includes enabled skills, sorted by priority (highest first).
 */
export function buildSkillsPromptSection(userId: string, agentId: string, language: 'es' | 'en' = 'es'): string {
  const skills = getAllSkills(userId, agentId).filter((s) => s.enabled);
  if (skills.length === 0) return '';

  const header = language === 'es'
    ? 'HABILIDADES ACTIVAS (Skills)'
    : 'ACTIVE SKILLS';

  const skillBlocks = skills.map((skill) => {
    const mcpInfo = skill.mcpServers.length > 0
      ? `\n  MCP: ${skill.mcpServers.map((s) => s.id).join(', ')}`
      : '';
    const triggerInfo = skill.triggers.events.length > 0
      ? `\n  ${language === 'es' ? 'Activadores' : 'Triggers'}: ${skill.triggers.events.join(', ')}${skill.triggers.conditions ? ` (${skill.triggers.conditions})` : ''}`
      : '';

    return `### ${skill.name} (v${skill.version})
${skill.description}${mcpInfo}${triggerInfo}

${skill.instructions}`;
  });

  return `\n<skills>\n${header}:\n\n${skillBlocks.join('\n\n---\n\n')}\n</skills>`;
}

/**
 * Find skills that should be triggered by a given event.
 */
export function findSkillsByEvent(userId: string, agentId: string, eventType: string): Skill[] {
  const all = getAllSkills(userId, agentId).filter((s) => s.enabled);
  return all.filter((skill) =>
    skill.triggers.events.some((trigger) => {
      // Exact match
      if (trigger === eventType) return true;
      // Wildcard match: "webhook:*" matches "webhook:github"
      if (trigger.endsWith(':*')) {
        const prefix = trigger.slice(0, -1);
        return eventType.startsWith(prefix);
      }
      // Keyword match: "keyword:factura" matches if eventType contains "factura"
      if (trigger.startsWith('keyword:')) {
        const keyword = trigger.slice(8).toLowerCase();
        return eventType.toLowerCase().includes(keyword);
      }
      return false;
    })
  );
}

/**
 * Find skills that should activate based on a user message (keyword triggers).
 */
export function findSkillsByMessage(userId: string, agentId: string, message: string): Skill[] {
  const all = getAllSkills(userId, agentId).filter((s) => s.enabled);
  const msgLower = message.toLowerCase();

  return all.filter((skill) =>
    skill.triggers.events.some((trigger) => {
      if (trigger.startsWith('keyword:')) {
        const keyword = trigger.slice(8).toLowerCase();
        return msgLower.includes(keyword);
      }
      return false;
    })
  );
}

// ---------------------------------------------------------------------------
// Serialization — Skill object → Markdown with YAML frontmatter
// ---------------------------------------------------------------------------

export function serializeSkillToMarkdown(skill: Skill): string {
  const lines: string[] = ['---'];

  lines.push(`id: ${skill.id}`);
  lines.push(`name: "${skill.name}"`);
  lines.push(`description: "${skill.description}"`);
  lines.push(`version: "${skill.version}"`);
  lines.push(`author: "${skill.author}"`);
  lines.push(`enabled: ${skill.enabled}`);
  lines.push(`priority: ${skill.priority}`);

  if (skill.tags.length > 0) {
    lines.push(`tags: [${skill.tags.map((t) => `"${t}"`).join(', ')}]`);
  } else {
    lines.push('tags: []');
  }

  // Triggers
  if (skill.triggers.events.length > 0) {
    lines.push('triggers:');
    lines.push('  events:');
    for (const event of skill.triggers.events) {
      lines.push(`    - "${event}"`);
    }
    if (skill.triggers.conditions) {
      lines.push(`  conditions: "${skill.triggers.conditions}"`);
    }
  }

  // MCP Servers
  if (skill.mcpServers.length > 0) {
    lines.push('mcp_servers:');
    for (const server of skill.mcpServers) {
      lines.push(`  - id: ${server.id}`);
      lines.push(`    auto_connect: ${server.autoConnect}`);
      if (Object.keys(server.config).length > 0) {
        lines.push('    config:');
        for (const [key, value] of Object.entries(server.config)) {
          lines.push(`      ${key}: "${value}"`);
        }
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(skill.instructions);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function skillToSummary(skill: Skill): SkillSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    author: skill.author,
    tags: skill.tags,
    enabled: skill.enabled,
    priority: skill.priority,
    triggers: skill.triggers,
    mcpServerIds: skill.mcpServers.map((s) => s.id),
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

/**
 * Create a new skill from parameters (used by the agent's create_skill tool).
 */
export function createSkillFromParams(
  userId: string,
  agentId: string,
  params: {
    name: string;
    description: string;
    instructions: string;
    tags?: string[];
    triggers?: string[];
    triggerConditions?: string;
    mcpServers?: Array<{ id: string; config?: Record<string, string> }>;
    priority?: number;
    author?: string;
  }
): Skill {
  const id = params.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || `skill-${Date.now()}`;

  const skill: Skill = {
    id,
    name: params.name,
    description: params.description,
    version: '1.0.0',
    author: params.author || 'agent',
    tags: params.tags || [],
    enabled: true,
    priority: params.priority ?? 50,
    triggers: {
      events: params.triggers || [],
      conditions: params.triggerConditions,
    },
    mcpServers: (params.mcpServers || []).map((s) => ({
      id: s.id,
      autoConnect: true,
      config: s.config || {},
    })),
    instructions: params.instructions,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  saveSkill(userId, agentId, skill);
  return skill;
}
