import { describe, expect, it } from 'vitest'
import { buildCharacterWhitelist } from '../../src/utils/character-whitelist.js'
import type { Character } from '../../src/types/character.js'

function character(name: string, description = ''): Character {
  return { id: '1', storyId: 's', name, description, createdAt: 1 }
}

describe('buildCharacterWhitelist', () => {
  it('accepts official names exactly as listed', () => {
    const list = buildCharacterWhitelist([character('主角'), character('侍女')])
    expect(list.isOfficial('主角')).toBe(true)
    expect(list.isOfficial('侍女')).toBe(true)
  })

  it('flags names that are not in the whitelist', () => {
    const list = buildCharacterWhitelist([character('主角')])
    expect(list.isOfficial('路人甲')).toBe(false)
    expect(list.isOfficial(' invented 角色')).toBe(false)
  })

  it('treats parenthetical aliases as official variants', () => {
    const list = buildCharacterWhitelist([character('何氏（奶娘）')])
    expect(list.isOfficial('何氏（奶娘）')).toBe(true)
    expect(list.isOfficial('何氏')).toBe(true)
    expect(list.canonical('何氏（奶娘）')).toBe('何氏')
  })

  it('trims whitespace around names', () => {
    const list = buildCharacterWhitelist([character('  主角  ')])
    expect(list.isOfficial('主角')).toBe(true)
    expect(list.canonical('  主角  ')).toBe('主角')
  })

  it('returns the canonical name for aliases', () => {
    const list = buildCharacterWhitelist([character('苏氏（夫人）')])
    expect(list.canonical('苏氏（夫人）')).toBe('苏氏')
    expect(list.canonical('苏氏')).toBe('苏氏')
    expect(list.canonical('未知')).toBeUndefined()
  })
})
