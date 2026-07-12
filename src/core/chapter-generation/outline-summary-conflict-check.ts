import type { ModelProvider, Message } from '../../model/provider.js'
import type { ReducedGraphState } from '../../graph/state.js'
import type { Conflict, ConflictSeverity, FactAttribute } from '../../types/story-state.js'
import { logger } from '../../utils/logger.js'
import { extractJsonBlock, repairMalformedJson } from '../../utils/json.js'
import { selectChapterSummaries } from '../../utils/chapter-summaries.js'
import { generateId } from '../../utils/id.js'

const SYSTEM_PROMPT = `You are a continuity checker for a long-form fiction writing system.

Your task: compare the planned outline for the next chapter against the summaries of previously completed chapters. Identify hard contradictions where the planned outline asks a character to perform an action or establish a state that has already been definitively completed in a previous chapter.

A "hard contradiction" occurs when:
- The outline describes a physical action that produces a persistent, unique, or irreversible effect (for example: writing a specific mark in a specific place, breaking an object, leaving a unique trace, killing a character, making a final decision that has already been made).
- A previous chapter summary shows that exact action or effect already happened.
- Repeating it unchanged would create an impossible timeline (the same physical trace cannot be produced twice independently).

Do NOT flag:
- Revisiting the same location or object.
- Recalling, noticing, or examining a previously established detail.
- Repeating a habitual action that does not leave a unique persistent trace.
- Minor wording differences that do not change the underlying event.
- Emotional or internal states unless the outline explicitly reverses a final decision.

Output ONLY a JSON object with a single field "conflicts" containing an array. Each conflict must have these exact fields:
- id: a short unique identifier using only ASCII letters, numbers, hyphens, and underscores
- type: one of "contradiction", "retcon", "extension"
- subject: the character, item, or entity involved (use a concise label)
- attribute: one of "location", "status", "event", "key_event", "occurrence", "result", "decision", "plan"
- oldValue: what was established in previous chapters (quote or paraphrase the established fact)
- newValue: what the outline now asks to do (quote or paraphrase the conflicting outline content)
- outlineReference: the specific phrase in the outline that implies the contradiction
- severity: "blocking" for hard contradictions; "warning" for minor issues (we only act on "blocking")
- description: a brief explanation of why this is a contradiction

If no hard contradictions exist, return {"conflicts": []}.`

function buildPrompt(
  chapterNumber: number,
  outlineTitle: string,
  outlineDescription: string,
  previousSummaries: string
): string {
  return `Next chapter number: ${chapterNumber}
Next chapter title: ${outlineTitle}
Next chapter outline description:
${outlineDescription}

Previously completed chapter summaries:
${previousSummaries}

Please identify any hard contradictions between the next chapter outline and the previously completed summaries. Return JSON only.`
}

function isValidFactAttribute(value: string): value is FactAttribute {
  const valid: readonly FactAttribute[] = [
    'location',
    'status',
    'event',
    'key_event',
    'occurrence',
    'result',
    'decision',
    'plan',
    'origin',
    'maker',
    'giver',
    'holder',
    'identity',
    'known_info',
    'promise',
    'attitude',
    'dialogue',
    'twist',
  ]
  return valid.includes(value as FactAttribute)
}

function isValidConflictSeverity(value: string): value is ConflictSeverity {
  return value === 'blocking' || value === 'warning' || value === 'auto'
}

function normalizeConflicts(parsed: unknown): Conflict[] {
  if (!parsed || typeof parsed !== 'object') return []
  const raw = (parsed as Record<string, unknown>).conflicts
  if (!Array.isArray(raw)) return []

  const conflicts: Conflict[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>

    const attribute =
      typeof candidate.attribute === 'string' && isValidFactAttribute(candidate.attribute)
        ? candidate.attribute
        : 'event'
    const severity =
      typeof candidate.severity === 'string' && isValidConflictSeverity(candidate.severity)
        ? candidate.severity
        : 'warning'

    conflicts.push({
      id:
        typeof candidate.id === 'string' && candidate.id.trim().length > 0
          ? candidate.id.trim()
          : generateId('conflict'),
      type:
        candidate.type === 'retcon' ||
        candidate.type === 'extension' ||
        candidate.type === 'time_jump' ||
        candidate.type === 'alias' ||
        candidate.type === 'contradiction' ||
        candidate.type === 'incomplete'
          ? candidate.type
          : 'contradiction',
      subject: typeof candidate.subject === 'string' ? candidate.subject : '',
      attribute,
      oldValue: typeof candidate.oldValue === 'string' ? candidate.oldValue : '',
      newValue: typeof candidate.newValue === 'string' ? candidate.newValue : '',
      outlineReference:
        typeof candidate.outlineReference === 'string' ? candidate.outlineReference : '',
      severity,
      description: typeof candidate.description === 'string' ? candidate.description : '',
    })
  }

  return conflicts
}

function parseConflicts(response: string): Conflict[] {
  const jsonText = extractJsonBlock(response)
  try {
    const parsed = JSON.parse(jsonText) as unknown
    return normalizeConflicts(parsed)
  } catch {
    try {
      const repaired = repairMalformedJson(jsonText)
      const parsed = JSON.parse(repaired) as unknown
      return normalizeConflicts(parsed)
    } catch {
      return []
    }
  }
}

function formatPreviousSummaries(state: ReducedGraphState, chapterIndex: number): string {
  const summaries = selectChapterSummaries(state.chapters, chapterIndex)
  if (summaries.length === 0) return '(no previous chapters)'

  return summaries
    .map((summary, index) => {
      const chapterNumber = index + 1
      return `Chapter ${chapterNumber}:\n${summary}`
    })
    .join('\n\n')
}

export async function checkOutlineAgainstPastSummaries(
  state: ReducedGraphState,
  chapterIndex: number,
  provider: ModelProvider
): Promise<Conflict[]> {
  if (chapterIndex <= 0) return []

  const outlineItem = state.outline[chapterIndex]
  if (!outlineItem?.description?.trim()) return []

  const previousSummaries = formatPreviousSummaries(state, chapterIndex)
  if (previousSummaries === '(no previous chapters)') return []

  const chapterNumber = chapterIndex + 1
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildPrompt(
        chapterNumber,
        outlineItem.title ?? '',
        outlineItem.description,
        previousSummaries
      ),
    },
  ]

  try {
    const response = await provider.chat(messages, 0.2)
    const conflicts = parseConflicts(response)
    const blocking = conflicts.filter((c) => c.severity === 'blocking')
    if (blocking.length > 0) {
      logger.info(
        `[MuseFlow] 第 ${chapterNumber} 章大纲与已完结章节摘要检测到 ${blocking.length} 个阻断性冲突`
      )
    }
    return conflicts
  } catch (err) {
    logger.warn(
      `[MuseFlow] 大纲与摘要冲突检测失败：${err instanceof Error ? err.message : String(err)}`
    )
    return []
  }
}
