import type { Character } from '../types/character.js'
import type { StoryState } from '../types/story-state.js'
import type { StoryMemory } from '../types/story-memory.js'
import { isMachineReadableId } from '../story-memory/identifier.js'

function extractNamesFromSummary(summaryText: string): string[] {
  try {
    const data = JSON.parse(summaryText) as Record<string, unknown>
    const names = new Set<string>()

    const characterFacts = data['characterFacts']
    if (Array.isArray(characterFacts)) {
      for (const entry of characterFacts) {
        if (entry && typeof entry === 'object') {
          const character = (entry as Record<string, unknown>)['character']
          if (typeof character === 'string') {
            const name = character.trim()
            if (name.length > 0) names.add(name)
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
  storyMemory?: StoryMemory | null
): Character[] {
  const seen = new Map<string, string>()

  // 实体注册表（B.3）是权威来源之一：经 entity-register 注册的角色拥有可读名
  // （占位名 name===id 的未注册实体不纳入），优先于摘要 JSON 的 characterFacts。
  if (storyMemory) {
    for (const character of Object.values(storyMemory.entities.characters)) {
      const name = character.name.trim()
      if (name.length > 0 && !isMachineReadableId(name) && !seen.has(name)) {
        seen.set(name, '实体注册表中已登记')
      }
    }
  }

  summaries.forEach((summary, index) => {
    for (const name of extractNamesFromSummary(summary)) {
      if (!seen.has(name)) {
        seen.set(name, `第${index + 1}章摘要中已出现`)
      }
    }
  })

  if (storyState) {
    for (const name of Object.keys(storyState.characterLocations)) {
      const base = name.trim()
      if (base.length > 0 && !seen.has(base)) {
        seen.set(base, '故事状态（上一章结束）中已建立')
      }
    }
    for (const name of Object.keys(storyState.characterStatus)) {
      const base = name.trim()
      if (base.length > 0 && !seen.has(base)) {
        seen.set(base, '故事状态（上一章结束）中已建立')
      }
    }
    for (const task of storyState.pendingTasks ?? []) {
      const base = task.assignee.trim()
      if (base.length > 0 && !seen.has(base)) {
        seen.set(base, '前章遗留差事中已出现')
      }
    }
  }

  return Array.from(seen.entries()).map(([name, source]) => ({
    id: `established_${name}`,
    storyId: '',
    name,
    aliases: [],
    isProtagonist: false,
    description: `【前文已建立角色】${source}`,
    dialogueStyle: null,
    createdAt: 0,
  }))
}
