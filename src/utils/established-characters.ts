import type { Character } from '../types/character.js'
import type { StoryState } from '../types/story-state.js'

function stripParentheticalAliases(name: string): string {
  return name.replace(/[（(][^）)]+[）)]/g, '').trim()
}

function extractNameFromSummaryEntry(entry: string): string | null {
  const name = stripParentheticalAliases(entry.split(/[:：]/)[0] ?? '').trim()
  return name.length >= 2 && name.length <= 8 ? name : null
}

function extractNamesFromSummary(summaryText: string): string[] {
  try {
    const data = JSON.parse(summaryText) as Record<string, unknown>
    const names = new Set<string>()

    const characters = data['characters']
    if (Array.isArray(characters)) {
      for (const entry of characters) {
        if (typeof entry === 'string') {
          const name = extractNameFromSummaryEntry(entry)
          if (name) names.add(name)
        }
      }
    }

    const characterFacts = data['characterFacts']
    if (Array.isArray(characterFacts)) {
      for (const entry of characterFacts) {
        if (entry && typeof entry === 'object') {
          const character = (entry as Record<string, unknown>)['character']
          if (typeof character === 'string') {
            const name = stripParentheticalAliases(character).trim()
            if (name.length >= 2 && name.length <= 8) names.add(name)
          }
        }
      }
    }

    return Array.from(names)
  } catch {
    return []
  }
}

export function extractEstablishedCharacters(
  summaries: string[],
  storyState?: StoryState | null,
): Character[] {
  const seen = new Map<string, string>()

  summaries.forEach((summary, index) => {
    for (const name of extractNamesFromSummary(summary)) {
      if (!seen.has(name)) {
        seen.set(name, `第${index + 1}章摘要中已出现`)
      }
    }
  })

  if (storyState) {
    for (const name of Object.keys(storyState.characterLocations)) {
      const base = stripParentheticalAliases(name).trim()
      if (base.length >= 2 && base.length <= 8 && !seen.has(base)) {
        seen.set(base, '故事状态（上一章结束）中已建立')
      }
    }
    for (const name of Object.keys(storyState.characterStatus)) {
      const base = stripParentheticalAliases(name).trim()
      if (base.length >= 2 && base.length <= 8 && !seen.has(base)) {
        seen.set(base, '故事状态（上一章结束）中已建立')
      }
    }
    for (const task of storyState.pendingTasks ?? []) {
      const base = stripParentheticalAliases(task.assignee).trim()
      if (base.length >= 2 && base.length <= 8 && !seen.has(base)) {
        seen.set(base, '前章遗留差事中已出现')
      }
    }
  }

  return Array.from(seen.entries()).map(([name, source]) => ({
    id: `established_${name}`,
    storyId: '',
    name,
    description: `【前文已建立角色】${source}`,
    dialogueStyle: null,
    createdAt: 0,
  }))
}
