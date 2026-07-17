import { describe, expect, it } from 'vitest'
import { buildCharacterWhitelist } from '../../src/utils/character-whitelist.js'
import type { Character } from '../../src/types/character.js'

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    storyId: 's1',
    name: '林黛玉',
    aliases: ['黛玉'],
    isProtagonist: true,
    description: '',
    dialogueStyle: null,
    createdAt: 1,
    ...overrides,
  }
}

describe('buildCharacterWhitelist', () => {
  it('resolves exact ids, names, and declared aliases to EntityIds', () => {
    const whitelist = buildCharacterWhitelist([makeCharacter()])
    expect(whitelist.canonical('char-1')).toBe('char-1')
    expect(whitelist.isOfficial('林黛玉')).toBe(true)
    expect(whitelist.canonical('林黛玉')).toBe('char-1')
    expect(whitelist.canonical('黛玉')).toBe('char-1')
  })

  it('does not derive aliases from a character name', () => {
    const whitelist = buildCharacterWhitelist([makeCharacter({ aliases: [] })])
    expect(whitelist.canonical('黛玉')).toBeUndefined()
    expect(whitelist.canonical('林姑娘')).toBeUndefined()
  })

  it('keeps the first exact reference mapping when declarations collide', () => {
    const whitelist = buildCharacterWhitelist([
      makeCharacter(),
      makeCharacter({
        id: 'char-2',
        name: '薛宝钗',
        aliases: ['黛玉'],
        isProtagonist: false,
      }),
    ])
    expect(whitelist.canonical('黛玉')).toBe('char-1')
  })
})
