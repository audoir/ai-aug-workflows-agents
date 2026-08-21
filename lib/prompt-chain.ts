// ─── Workflow: Prompt chaining — the programmatic "gate" ─────────────────────
// Anthropic's prompt-chaining pattern decomposes a task into a sequence of
// LLM calls, with a programmatic check ("gate") on an intermediate step to
// make sure the process is still on track before continuing. Here, the gate
// checks the outline produced by step 1 before step 2 writes the full
// document from it.

export const MIN_SECTIONS = 3;
export const MIN_WORDS = 40;
export const MAX_WORDS = 600;

const HEADING_PATTERN = /^(#{1,6}\s|\d+[.)]\s|[-*]\s)/;
const PLACEHOLDER_PATTERN =
  /\b(TBD|TODO|FIXME|XXX)\b|\[\s*(insert|placeholder|tk)\b[^\]]*\]/i;

export interface GateMetrics {
  sectionCount: number;
  wordCount: number;
  hasPlaceholders: boolean;
}

export interface GateResult {
  passed: boolean;
  metrics: GateMetrics;
  issues: string[];
}

/**
 * Inspects an outline's structure directly: how many section headings it
 * has, its word count, and whether it still contains placeholder text.
 */
function computeGateMetrics(outline: string): GateMetrics {
  const lines = outline
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const sectionCount = lines.filter((l) => HEADING_PATTERN.test(l)).length;
  const wordCount = outline.trim().split(/\s+/).filter(Boolean).length;
  const hasPlaceholders = PLACEHOLDER_PATTERN.test(outline);

  return { sectionCount, wordCount, hasPlaceholders };
}

/**
 * Runs the gate check against an outline and evaluates the resulting
 * metrics against fixed, easy-to-explain criteria. Returns which criteria (if
 * any) failed, so a failing outline can be sent back to the LLM with
 * specific feedback for a second attempt.
 */
export function evaluateGate(outline: string): GateResult {
  const metrics = computeGateMetrics(outline);

  const issues: string[] = [];
  if (metrics.sectionCount < MIN_SECTIONS) {
    issues.push(
      `Only ${metrics.sectionCount} section heading(s) found — need at least ${MIN_SECTIONS}.`,
    );
  }
  if (metrics.wordCount < MIN_WORDS) {
    issues.push(
      `Outline is too short (${metrics.wordCount} words) — need at least ${MIN_WORDS}.`,
    );
  }
  if (metrics.wordCount > MAX_WORDS) {
    issues.push(
      `Outline is too long (${metrics.wordCount} words) — should be under ${MAX_WORDS}.`,
    );
  }
  if (metrics.hasPlaceholders) {
    issues.push(
      "Outline still contains placeholder text (e.g. TBD/TODO/[insert ...]) that must be filled in.",
    );
  }

  return { passed: issues.length === 0, metrics, issues };
}

export function formatGateSummary(
  attempt: number,
  result: GateResult,
): string {
  const header = `Attempt ${attempt} — computed metrics: ${result.metrics.sectionCount} section(s), ${result.metrics.wordCount} words, placeholders: ${result.metrics.hasPlaceholders ? "yes" : "no"}`;

  if (result.passed) {
    return `✅ ${header}\nGate check **passed** — proceeding to write the full document.`;
  }

  return `⚠️ ${header}\nGate check **failed**:\n${result.issues.map((i) => `- ${i}`).join("\n")}`;
}

