// ---------------------------------------------------------------------------
// Smart Memory — LLM-powered relevance scoring for memory retrieval
// ---------------------------------------------------------------------------
// Instead of returning a fixed number of recalled conversation snippets,
// this module asks the configured LLM to score each candidate memory for
// relevance to the current user query, then returns only the truly useful
// ones.  This dramatically reduces noise in the context window and keeps
// the agent focused on what matters.
// ---------------------------------------------------------------------------

import { createProvider } from '../providers';
import { Provider } from '../types';

export interface MemoryCandidate {
  /** Original index in the candidate list */
  index: number;
  /** Role label (user / assistant / system) */
  role: string;
  /** Human-readable date */
  date: string;
  /** Truncated content */
  content: string;
}

export interface ScoredMemory extends MemoryCandidate {
  /** 0 – 10 relevance score assigned by the LLM */
  relevance: number;
  /** Short rationale from the LLM (optional) */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Prompt template for the scoring LLM call
// ---------------------------------------------------------------------------

function buildScoringPrompt(
  userQuery: string,
  candidates: MemoryCandidate[],
  language: 'es' | 'en'
): string {
  const candidateBlock = candidates
    .map(
      (c) =>
        `[${c.index}] (${c.role} @ ${c.date}) ${c.content}`
    )
    .join('\n');

  if (language === 'es') {
    return `Eres un sistema de puntuación de relevancia de memoria. Tu ÚNICA tarea es evaluar qué recuerdos de conversaciones pasadas son relevantes para la consulta actual del usuario.

CONSULTA ACTUAL DEL USUARIO:
"${userQuery}"

RECUERDOS CANDIDATOS:
${candidateBlock}

INSTRUCCIONES:
1. Evalúa cada recuerdo del 0 al 10 según su relevancia REAL para la consulta actual.
2. 0 = completamente irrelevante, 10 = directamente responde o es esencial.
3. Sé estricto: sólo puntúa alto (≥6) si el recuerdo aporta información realmente útil.
4. Responde SÓLO con un JSON array. Sin explicaciones adicionales.

FORMATO DE RESPUESTA (JSON estricto):
[{"index": 0, "relevance": 7, "reason": "razón breve"}, ...]

Responde ÚNICAMENTE con el JSON array:`;
  }

  return `You are a memory relevance scoring system. Your ONLY task is to evaluate which memories from past conversations are relevant to the user's current query.

CURRENT USER QUERY:
"${userQuery}"

CANDIDATE MEMORIES:
${candidateBlock}

INSTRUCTIONS:
1. Score each memory from 0 to 10 based on its ACTUAL relevance to the current query.
2. 0 = completely irrelevant, 10 = directly answers or is essential.
3. Be strict: only score high (≥6) if the memory provides truly useful information.
4. Respond ONLY with a JSON array. No additional explanations.

RESPONSE FORMAT (strict JSON):
[{"index": 0, "relevance": 7, "reason": "brief reason"}, ...]

Respond ONLY with the JSON array:`;
}

// ---------------------------------------------------------------------------
// Parse the LLM scoring response into structured data
// ---------------------------------------------------------------------------

function parseScoringResponse(
  raw: string,
  candidates: MemoryCandidate[]
): ScoredMemory[] {
  // Try to extract JSON array from the response
  const jsonMatch = raw.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return fallbackScoring(candidates);

  try {
    const parsed: Array<{ index: number; relevance: number; reason?: string }> =
      JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed)) return fallbackScoring(candidates);

    const candidateMap = new Map(candidates.map((c) => [c.index, c]));
    const scored: ScoredMemory[] = [];

    for (const item of parsed) {
      const candidate = candidateMap.get(item.index);
      if (!candidate) continue;
      scored.push({
        ...candidate,
        relevance: Math.max(0, Math.min(10, Math.round(item.relevance ?? 0))),
        reason: typeof item.reason === 'string' ? item.reason.slice(0, 120) : undefined,
      });
    }

    return scored;
  } catch {
    return fallbackScoring(candidates);
  }
}

/**
 * Fallback: if LLM response can't be parsed, assign uniform mid-score so
 * the caller can still use the top-N approach.
 */
function fallbackScoring(candidates: MemoryCandidate[]): ScoredMemory[] {
  return candidates.map((c) => ({ ...c, relevance: 5 }));
}

// ---------------------------------------------------------------------------
// Main entry point — score & filter memories using the agent's LLM
// ---------------------------------------------------------------------------

export interface SmartMemoryOptions {
  /** Provider to use for scoring (same as agent's provider) */
  provider: Provider;
  /** Model to use for scoring (same as agent's model) */
  model: string;
  /** Minimum relevance score to include (default 5) */
  minRelevance?: number;
  /** Max memories to return after filtering (default: same as limit) */
  maxReturn?: number;
  /** Language for the scoring prompt */
  language?: 'es' | 'en';
}

/**
 * Given a user query and a list of candidate memory snippets, uses the LLM
 * to score each memory's relevance and returns only the ones above the
 * threshold, sorted by relevance.
 *
 * Falls back to returning all candidates (unfiltered) if the LLM call fails.
 */
export async function scoreAndFilterMemories(
  userQuery: string,
  candidates: MemoryCandidate[],
  options: SmartMemoryOptions
): Promise<ScoredMemory[]> {
  if (candidates.length === 0) return [];

  const minRelevance = options.minRelevance ?? 5;
  const maxReturn = options.maxReturn ?? candidates.length;
  const language = options.language ?? 'es';

  try {
    const provider = createProvider(options.provider);
    const scoringPrompt = buildScoringPrompt(userQuery, candidates, language);

    const response = await provider.chat({
      model: options.model,
      messages: [{ role: 'user', content: scoringPrompt }],
      maxTokens: 1024,
      temperature: 0.1, // Low temp for consistent scoring
    });

    const scored = parseScoringResponse(response, candidates);

    // Filter by minimum relevance and cap the count
    return scored
      .filter((m) => m.relevance >= minRelevance)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxReturn);
  } catch (error: any) {
    console.warn(
      `[SmartMemory] LLM scoring failed, falling back to unfiltered candidates: ${error?.message || error}`
    );
    // Fallback: return all candidates as-is (backwards-compatible behavior)
    return candidates.map((c) => ({ ...c, relevance: 5 }));
  }
}
