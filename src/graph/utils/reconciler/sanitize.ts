import type { StoryState, SanitizationReport } from '../../../types/story-state.js'
import type { Character } from '../../../types/character.js'
import { mergeItemRecordsExact } from '../../../utils/items.js'
import { buildCharacterWhitelist } from '../../../utils/character-whitelist.js'

export function detectAmbiguousItemNames(
  _state: StoryState
): Array<{ location: string; items: string[] }> {
  return []
}

export function sanitizeStoryState(
  state: StoryState,
  characters: Character[],
  options?: {
    preserveExisting?: boolean | undefined
    existingStoryState?: StoryState | undefined
    chapterIndex?: number | undefined
  }
): SanitizationReport {
  const whitelist = buildCharacterWhitelist(characters)

  const establishedNames =
    options?.preserveExisting && options?.existingStoryState
      ? new Set([
          ...Object.keys(options.existingStoryState.characterLocations),
          ...Object.keys(options.existingStoryState.characterStatus),
        ])
      : new Set<string>()

  const removedCharactersSet = new Set<string>()

  const characterLocations: Record<string, string> = {}
  for (const [reference, location] of Object.entries(state.characterLocations)) {
    const entityId = whitelist.canonical(reference)
    if (entityId) {
      characterLocations[entityId] = location
    } else if (establishedNames.has(reference)) {
      characterLocations[reference] = location
    } else {
      removedCharactersSet.add(reference)
    }
  }

  const characterStatus: Record<string, string> = {}
  for (const [reference, status] of Object.entries(state.characterStatus)) {
    const entityId = whitelist.canonical(reference)
    if (entityId) {
      characterStatus[entityId] = status
    } else if (establishedNames.has(reference)) {
      characterStatus[reference] = status
    } else {
      removedCharactersSet.add(reference)
    }
  }

  const removedCharacters = Array.from(removedCharactersSet)

  const keyItemsLocation = mergeItemRecordsExact({}, state.keyItemsLocation)
  const itemLocationConflicts: Array<{ item: string; locations: string[] }> = []
  // Note: plot/secret filtering is intentionally not implemented here because
  // activePlots and revealedSecrets are free-text arrays without structured
  // character associations. Filtering them by substring would violate the
  // "no natural-language string matching for semantics" rule.

  const ambiguousItems = detectAmbiguousItemNames(state)

  return {
    state: {
      ...state,
      characterLocations,
      characterStatus,
      keyItemsLocation,
      activePlots: [...state.activePlots],
      revealedSecrets: [...state.revealedSecrets],
      supersededFacts: [...(state.supersededFacts ?? [])],
      canonicalFacts: [...(state.canonicalFacts ?? [])],
    },
    removedCharacters,
    itemLocationConflicts,
    ambiguousItems,
  }
}

export function formatStateConflicts(report: SanitizationReport): string {
  const lines: string[] = []

  if (report.removedCharacters.length > 0) {
    lines.push('【非官方角色已移除】')
    for (const name of report.removedCharacters) {
      lines.push(`  - ${name}`)
    }
    lines.push(
      '  说明：以上角色不在官方角色、大纲登场角色或前文已建立角色列表中。如果确需登场，请先通过大纲或角色设定明确引入。'
    )
  }

  if (report.itemLocationConflicts.length > 0) {
    lines.push('【物品位置冲突 - 已自动协调】')
    for (const conflict of report.itemLocationConflicts) {
      lines.push(`  - ${conflict.item}: ${conflict.locations.join(' / ')}`)
    }
    lines.push(
      '  说明：系统已按“后写入优先 + 结论性描述优先”的规则保留唯一位置，旧位置已归档到 supersededFacts。'
    )
  }

  if (report.ambiguousItems.length > 0) {
    lines.push('【歧义物品名 - 必须使用统一名称】')
    for (const { location, items } of report.ambiguousItems) {
      lines.push(`  - 位置 "${location}" 对应：${items.join(' / ')}`)
    }
    lines.push(
      '  要求：以上名称可能指向同一物品，本章统一使用最简洁、最标准的名称，避免同一物品多个别名并存。'
    )
  }

  return lines.join('\n')
}
