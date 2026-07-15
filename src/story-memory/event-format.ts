import type { StoryEvent } from '../types/story-memory.js'

export function renderNullableId(id: string | null | undefined): string {
  if (id === null || id === undefined) return 'none'
  return id
}

export function renderEventValue(value: unknown): string {
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function renderStoryEventLine(event: StoryEvent): string {
  switch (event.type) {
    case 'character-location':
      return `character-location: ${event.characterId} -> ${renderNullableId(event.locationId)}`
    case 'character-status':
      return `character-status: ${event.characterId} / ${event.attribute} -> ${renderEventValue(event.value)}`
    case 'item-location':
      return `item-location: ${event.itemId} / holder=${renderNullableId(event.holderId)} / location=${renderNullableId(event.locationId)}`
    case 'item-state':
      return `item-state: ${event.itemId} / ${event.attribute} -> ${renderEventValue(event.value)}`
    case 'plot-advance':
      return `plot-advance: ${event.plotId} / ${event.beatId}`
    case 'foreshadow-introduce': {
      const parts: string[] = []
      parts.push(`foreshadow-introduce: ${event.foreshadowId}`)
      const fields: string[] = []
      fields.push(
        `expected=${event.expectedFulfillChapter === null ? 'none' : event.expectedFulfillChapter}`
      )
      if (event.resolutionPolicy !== undefined) {
        fields.push(`policy=${event.resolutionPolicy}`)
      }
      if (event.kind !== undefined) fields.push(`kind=${event.kind}`)
      if (event.required !== undefined) fields.push(`required=${event.required}`)
      if (event.beatId !== undefined)
        fields.push(`beat=${event.beatId === null ? 'none' : event.beatId}`)
      if (event.text !== undefined) fields.push(`text=${event.text}`)
      if (fields.length > 0) parts.push(` / ${fields.join(' / ')}`)
      return parts.join('')
    }
    case 'foreshadow-fulfill':
      return `foreshadow-fulfill: ${event.foreshadowId}`
    case 'foreshadow-deadline-extend':
      return `foreshadow-deadline-extend: ${event.foreshadowId} / newExpected=${event.newExpectedFulfillChapter}`
    case 'foreshadow-policy-set':
      return `foreshadow-policy-set: ${event.foreshadowId} / policy=${event.resolutionPolicy} / expected=${event.expectedFulfillChapter === null ? 'none' : event.expectedFulfillChapter}`
    case 'foreshadow-waive':
      return `foreshadow-waive: ${event.foreshadowId}${event.reason !== undefined ? ` / reason=${event.reason}` : ''}`
    case 'task-create':
      return `task-create: ${event.taskId} / ${event.description}`
    case 'task-resolve':
      return `task-resolve: ${event.taskId}`
    default:
      return ''
  }
}
