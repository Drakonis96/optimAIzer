// ---------------------------------------------------------------------------
// Skills Registry — Built-in skill loader and catalog
// ---------------------------------------------------------------------------
// Loads pre-packaged skills from the builtins/ directory and provides
// functions to install them into agent-specific skill storage, list
// available skills, and build prompt sections for both agents and chats.
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { Skill, SkillSummary, parseSkillMarkdown, saveSkill, getAllSkills, getSkill } from '../skills';

// ---------------------------------------------------------------------------
// Built-in skills directory
// ---------------------------------------------------------------------------

/**
 * Resolve the builtins directory.
 * In dev (tsx watch): __dirname = .../server/src/agents/skills  → builtins/ is right here.
 * In prod (node dist/): __dirname = .../server/dist/agents/skills → builtins is at
 * .../server/src/agents/skills/builtins (sibling of dist) OR copied alongside dist.
 */
function resolveBuiltinsDir(): string {
  // 1) Direct sibling (dev mode or if builtins copied next to dist)
  const local = path.resolve(__dirname, 'builtins');
  if (fs.existsSync(local)) return local;

  // 2) Source tree fallback (production: __dirname is dist/agents/skills,
  //    source builtins are at src/agents/skills/builtins)
  const srcFallback = path.resolve(__dirname, '../../../src/agents/skills/builtins');
  if (fs.existsSync(srcFallback)) return srcFallback;

  // 3) Docker / project root fallback
  const projectRoot = path.resolve(__dirname, '../../../../');
  const dockerFallback = path.join(projectRoot, 'server/src/agents/skills/builtins');
  if (fs.existsSync(dockerFallback)) return dockerFallback;

  // Return local even if it doesn't exist — getBuiltinSkills handles missing dir
  return local;
}

const BUILTINS_DIR = resolveBuiltinsDir();

/**
 * Load all built-in skills from the builtins/ directory.
 * These are the pre-packaged skills that ship with optimAIzer.
 */
export function getBuiltinSkills(): Skill[] {
  if (!fs.existsSync(BUILTINS_DIR)) return [];

  const files = fs.readdirSync(BUILTINS_DIR).filter((f) => f.endsWith('.skill.md'));
  const skills: Skill[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(BUILTINS_DIR, file), 'utf-8');
      const skill = parseSkillMarkdown(content, file.replace('.skill.md', '.md'));
      skill.sourcePath = path.join(BUILTINS_DIR, file);
      skills.push(skill);
    } catch (err) {
      console.warn(`[SkillsRegistry] Failed to parse builtin skill "${file}":`, err);
    }
  }

  return skills.sort((a, b) => b.priority - a.priority);
}

/**
 * Get a specific built-in skill by ID.
 */
export function getBuiltinSkill(skillId: string): Skill | null {
  const skills = getBuiltinSkills();
  return skills.find((s) => s.id === skillId) || null;
}

/**
 * Get summaries of all built-in skills (lightweight for listings).
 */
export function getBuiltinSkillSummaries(): SkillSummary[] {
  return getBuiltinSkills().map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    author: skill.author,
    tags: skill.tags,
    enabled: skill.enabled,
    priority: skill.priority,
    category: skill.category || getSkillCategory(skill),
    triggers: skill.triggers,
    mcpServerIds: skill.mcpServers.map((s) => s.id),
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Skill Categories
// ---------------------------------------------------------------------------

export type SkillCategory = 'integration' | 'productivity' | 'finance' | 'lifestyle' | 'knowledge' | 'developer' | 'general' | 'custom';

/**
 * Categorize a skill based on its metadata.
 */
export function getSkillCategory(skill: Skill): SkillCategory {
  if (skill.category && skill.category !== 'general') return skill.category as SkillCategory;
  // Fallback for skills without fine-grained category
  if (skill.sourcePath?.includes('builtins')) {
    const integrationIds = [
      'google-calendar', 'icloud-calendar', 'gmail',
      'home-assistant', 'radarr', 'sonarr',
      'telegram', 'vision', 'transcription',
    ];
    return integrationIds.includes(skill.id) ? 'integration' : 'general';
  }
  return 'custom';
}

/**
 * Get builtin skills filtered by category.
 */
export function getBuiltinSkillsByCategory(category: SkillCategory): Skill[] {
  return getBuiltinSkills().filter((s) => getSkillCategory(s) === category);
}

// ---------------------------------------------------------------------------
// Install built-in skills to an agent
// ---------------------------------------------------------------------------

/**
 * Install a built-in skill into an agent's skill storage.
 * If the skill already exists, it will be updated only if the builtin version is newer.
 */
export function installBuiltinSkill(
  userId: string,
  agentId: string,
  skillId: string,
  forceOverwrite = false
): Skill | null {
  const builtin = getBuiltinSkill(skillId);
  if (!builtin) return null;

  const existing = getSkill(userId, agentId, skillId);
  if (existing && !forceOverwrite) {
    // Only update if builtin has a newer version
    if (existing.version >= builtin.version) return existing;
  }

  // Preserve enabled state from existing if present
  if (existing) {
    builtin.enabled = existing.enabled;
  }

  saveSkill(userId, agentId, builtin);
  return builtin;
}

/**
 * Install all built-in skills for an agent.
 * Only installs skills that don't already exist (respects user customizations).
 */
export function installAllBuiltinSkills(userId: string, agentId: string): Skill[] {
  const builtins = getBuiltinSkills();
  const installed: Skill[] = [];

  for (const skill of builtins) {
    const result = installBuiltinSkill(userId, agentId, skill.id);
    if (result) installed.push(result);
  }

  return installed;
}

/**
 * Install integration skills that match agent configuration.
 * Only installs skills for integrations that are actually configured.
 */
export function installMatchingIntegrationSkills(
  userId: string,
  agentId: string,
  config: {
    hasGoogleCalendar?: boolean;
    hasICloudCalendar?: boolean;
    hasGmail?: boolean;
    hasHomeAssistant?: boolean;
    hasRadarr?: boolean;
    hasSonarr?: boolean;
    hasTelegram?: boolean;
    hasVision?: boolean;
    hasTranscription?: boolean;
    hasTerminalAccess?: boolean;
    hasCodeExecution?: boolean;
  }
): Skill[] {
  const installed: Skill[] = [];

  const installIfMatch = (condition: boolean | undefined, skillId: string) => {
    if (condition) {
      const result = installBuiltinSkill(userId, agentId, skillId);
      if (result) installed.push(result);
    }
  };

  // Integration skills
  installIfMatch(config.hasGoogleCalendar, 'google-calendar');
  installIfMatch(config.hasICloudCalendar, 'icloud-calendar');
  installIfMatch(config.hasGmail, 'gmail');
  installIfMatch(config.hasHomeAssistant, 'home-assistant');
  installIfMatch(config.hasRadarr, 'radarr');
  installIfMatch(config.hasSonarr, 'sonarr');
  installIfMatch(config.hasTelegram, 'telegram');

  // These are always useful
  installIfMatch(true, 'vision');
  installIfMatch(true, 'transcription');

  // Conditional general skills
  installIfMatch(config.hasTerminalAccess, 'system-admin');
  installIfMatch(config.hasCodeExecution, 'code-assistant');

  return installed;
}

// ---------------------------------------------------------------------------
// Build prompt section for skills (enhanced version for both agents and chats)
// ---------------------------------------------------------------------------

/**
 * Build a skills prompt section from a list of skills.
 * Works for both agents (with full tool context) and regular chats (instructions only).
 */
export function buildSkillsPromptFromList(
  skills: Skill[],
  language: 'es' | 'en' = 'es',
  options: { compact?: boolean; maxSkills?: number } = {}
): string {
  const enabledSkills = skills.filter((s) => s.enabled);
  if (enabledSkills.length === 0) return '';

  const { compact = false, maxSkills = 20 } = options;
  const selectedSkills = enabledSkills.slice(0, maxSkills);

  const header = language === 'es'
    ? 'HABILIDADES ACTIVAS (Skills)'
    : 'ACTIVE SKILLS';

  const skillBlocks = selectedSkills.map((skill) => {
    const triggerInfo = skill.triggers.events.length > 0
      ? `\n  ${language === 'es' ? 'Activadores' : 'Triggers'}: ${skill.triggers.events.slice(0, 5).join(', ')}${skill.triggers.events.length > 5 ? '...' : ''}${skill.triggers.conditions ? ` (${skill.triggers.conditions})` : ''}`
      : '';

    if (compact) {
      return `### ${skill.name} (v${skill.version})\n${skill.description}${triggerInfo}\n\n${truncateInstructions(skill.instructions, 500)}`;
    }

    const mcpInfo = skill.mcpServers.length > 0
      ? `\n  MCP: ${skill.mcpServers.map((s) => s.id).join(', ')}`
      : '';

    return `### ${skill.name} (v${skill.version})\n${skill.description}${mcpInfo}${triggerInfo}\n\n${skill.instructions}`;
  });

  return `\n<skills>\n${header}:\n\n${skillBlocks.join('\n\n---\n\n')}\n</skills>`;
}

/**
 * Build skills prompt for a regular chat (non-agent).
 * Selects only skills relevant to the conversation topic.
 */
export function buildChatSkillsPrompt(
  skills: Skill[],
  userMessage: string,
  language: 'es' | 'en' = 'es'
): string {
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return '';

  // Find skills triggered by the message
  const msgLower = userMessage.toLowerCase();
  const triggered = enabled.filter((skill) =>
    skill.triggers.events.some((trigger) => {
      if (trigger.startsWith('keyword:')) {
        const keyword = trigger.slice(8).toLowerCase();
        return msgLower.includes(keyword);
      }
      return false;
    })
  );

  // If no specific skills triggered, use top-priority general skills (compact)
  if (triggered.length === 0) {
    return '';
  }

  return buildSkillsPromptFromList(triggered, language, { compact: true, maxSkills: 3 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateInstructions(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // Find a clean break point
  const truncated = text.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline > maxChars * 0.6) {
    return truncated.slice(0, lastNewline) + '\n\n[... instrucciones truncadas]';
  }
  return truncated + '\n\n[... instrucciones truncadas]';
}

// ---------------------------------------------------------------------------
// On-demand auto-install — keyword-triggered skill discovery
// ---------------------------------------------------------------------------

/**
 * Automatically install built-in skills whose keyword triggers match the
 * user message, but only if they aren't already installed for the agent.
 * Returns the list of newly installed skills (empty if none matched).
 */
export function autoInstallSkillsByMessage(
  userId: string,
  agentId: string,
  message: string
): Skill[] {
  const msgLower = message.toLowerCase();
  const builtins = getBuiltinSkills();
  const installed = getAllSkills(userId, agentId);
  const installedIds = new Set(installed.map((s) => s.id));

  const newlyInstalled: Skill[] = [];

  for (const builtin of builtins) {
    if (installedIds.has(builtin.id)) continue;

    const matches = builtin.triggers.events.some((trigger) => {
      if (trigger.startsWith('keyword:')) {
        const keyword = trigger.slice(8).toLowerCase();
        return msgLower.includes(keyword);
      }
      return false;
    });

    if (matches) {
      const result = installBuiltinSkill(userId, agentId, builtin.id);
      if (result) {
        newlyInstalled.push(result);
        installedIds.add(builtin.id);
      }
    }
  }

  if (newlyInstalled.length > 0) {
    console.log(
      `[SkillsRegistry] Auto-installed ${newlyInstalled.length} skill(s) for agent ${agentId}: ${newlyInstalled.map((s) => s.id).join(', ')}`
    );
  }

  return newlyInstalled;
}
