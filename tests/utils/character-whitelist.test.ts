import { describe, expect, it } from 'vitest'
import { buildCharacterWhitelist } from '../../src/utils/character-whitelist.js'
import type { Character } from '../../src/types/character.js'

function makeCharacter(name: string): Character {
  return {
    id: 'c1',
    storyId: 's1',
    name,
    description: '',
    dialogueStyle: null,
    createdAt: 1,
  }
}

describe('buildCharacterWhitelist', () => {
  it('recognizes official full names', () => {
    const whitelist = buildCharacterWhitelist([makeCharacter('林黛玉')])
    expect(whitelist.isOfficial('林黛玉')).toBe(true)
    expect(whitelist.canonical('林黛玉')).toBe('林黛玉')
  })

  it('recognizes derived aliases for Chinese names', () => {
    const whitelist = buildCharacterWhitelist([makeCharacter('林黛玉')])
    expect(whitelist.isOfficial('黛玉')).toBe(true)
    expect(whitelist.canonical('黛玉')).toBe('林黛玉')
  })

  it('does not derive aliases for short names', () => {
    const whitelist = buildCharacterWhitelist([makeCharacter('宝玉')])
    expect(whitelist.isOfficial('玉')).toBe(false)
    expect(whitelist.canonical('玉')).toBeUndefined()
  })

  it('does not confuse aliases from different characters', () => {
    const whitelist = buildCharacterWhitelist([makeCharacter('林黛玉'), makeCharacter('薛宝钗')])
    // "黛玉" maps to 林黛玉, "宝钗" maps to 薛宝钗.
    expect(whitelist.canonical('黛玉')).toBe('林黛玉')
    expect(whitelist.canonical('宝钗')).toBe('薛宝钗')
  })
})
