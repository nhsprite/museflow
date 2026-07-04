import type { ModelProvider, Message } from '../../model/provider.js'
import type { Conflict } from '../../types/story-state.js'
import type { ChapterOutline } from '../../types/outline.js'
import type { StoryState } from '../../types/story-state.js'
import { logger } from '../../utils/logger.js'
import { extractJsonBlock, repairMalformedJson } from '../../utils/json.js'

export interface OutlineRevisionProposal {
  revisedDescription: string
  explanation: string
  revisedTitle?: string
}

const SYSTEM_PROMPT = `You are an outline reconciliation assistant for a long-form fiction writing system.

The author is writing a multi-chapter story. We have detected that the planned outline for one chapter conflicts with established canonical facts from previous chapters.

Your task: propose a minimal revision to the chapter outline description that resolves the blocking conflicts while preserving the chapter's intended narrative function.

Guidelines:
1. Do not invent new characters, items, or locations unless necessary to resolve the conflict.
2. Prefer modifying how events happen rather than deleting the chapter's purpose.
3. If the outline implies an action that contradicts a character's established plan or constraint, revise the action to align with the canonical fact, or add a clear transitional motivation.
4. Keep the revised description concise (one paragraph, similar length to the original).
5. If the original chapter title no longer matches the revised description (for example, the title names an event or character that no longer appears in the revised description), provide a new "revisedTitle". Otherwise leave "revisedTitle" empty or omit it.
6. Return ONLY a JSON object with three fields: "revisedDescription" (string), "explanation" (string), and optionally "revisedTitle" (string).

The explanation should briefly state what changed and why it resolves the conflict, without story-specific jargon.`

function buildPrompt(
  outline: ChapterOutline[],
  chapterIndex: number,
  conflicts: Conflict[],
  storyState: StoryState
): string {
  const chapterOutline = outline[chapterIndex]
  const currentDescription = chapterOutline?.description ?? ''
  const currentTitle = chapterOutline?.title ?? ''
  const chapterNumber = chapterIndex + 1

  const conflictLines = conflicts
    .filter((c) => c.severity === 'blocking')
    .map((c, idx) => {
      return `${idx + 1}. [${c.type}] ${c.subject} / ${c.attribute}\n   Canonical: ${c.oldValue}\n   Outline implies: ${c.newValue}\n   Reason: ${c.description}`
    })
    .join('\n\n')

  const stateSnapshot = formatStateSnapshot(storyState)

  return `Chapter number: ${chapterNumber}
Current outline title: ${currentTitle}
Current outline description:\n${currentDescription}\n\nBlocking conflicts detected:\n${conflictLines}\n\nRelevant story state:\n${stateSnapshot}\n\nPlease propose a revised outline description (and a new title only if the current title no longer fits) that resolves the conflicts. Return JSON only.`
}

function formatStateSnapshot(storyState: StoryState): string {
  const parts: string[] = []

  const locations = Object.entries(storyState.characterLocations)
  if (locations.length > 0) {
    parts.push('Character locations:')
    for (const [name, location] of locations) {
      parts.push(`  ${name}: ${location}`)
    }
  }

  const statuses = Object.entries(storyState.characterStatus)
  if (statuses.length > 0) {
    parts.push('Character statuses:')
    for (const [name, status] of statuses) {
      parts.push(`  ${name}: ${status}`)
    }
  }

  if (storyState.activePlots.length > 0) {
    parts.push('Active plots:')
    for (const plot of storyState.activePlots) {
      parts.push(`  - ${plot}`)
    }
  }

  return parts.length > 0 ? parts.join('\n') : '(none)'
}

function normalizeProposal(parsed: unknown): OutlineRevisionProposal | null {
  if (
    parsed &&
    typeof parsed === 'object' &&
    'revisedDescription' in parsed &&
    'explanation' in parsed &&
    typeof parsed.revisedDescription === 'string' &&
    typeof parsed.explanation === 'string'
  ) {
    const proposal: OutlineRevisionProposal = {
      revisedDescription: parsed.revisedDescription.trim(),
      explanation: parsed.explanation.trim(),
    }
    if ('revisedTitle' in parsed && typeof parsed.revisedTitle === 'string') {
      const trimmed = parsed.revisedTitle.trim()
      if (trimmed.length > 0) {
        proposal.revisedTitle = trimmed
      }
    }
    return proposal
  }
  return null
}

function parseProposal(response: string): OutlineRevisionProposal | null {
  const jsonText = extractJsonBlock(response)
  try {
    const parsed = JSON.parse(jsonText) as unknown
    const proposal = normalizeProposal(parsed)
    if (proposal) return proposal
  } catch {
    try {
      const repaired = repairMalformedJson(jsonText)
      const parsed = JSON.parse(repaired) as unknown
      const proposal = normalizeProposal(parsed)
      if (proposal) return proposal
    } catch {
      // fall through
    }
  }
  return null
}

export async function generateOutlineRevisionProposal(
  outline: ChapterOutline[],
  chapterIndex: number,
  conflicts: Conflict[],
  storyState: StoryState,
  provider: ModelProvider
): Promise<OutlineRevisionProposal | null> {
  const blockingConflicts = conflicts.filter((c) => c.severity === 'blocking')
  if (blockingConflicts.length === 0) return null

  const chapterOutline = outline[chapterIndex]
  if (!chapterOutline) return null

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildPrompt(outline, chapterIndex, blockingConflicts, storyState) },
  ]

  try {
    const response = await provider.chat(messages, 0.3)
    return parseProposal(response)
  } catch (err) {
    logger.debug(
      `[OutlineRevision] Failed to generate proposal: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}
