import { describe, expect, it } from 'vitest'
import { buildCharacterWhitelist, classifyCharacterName } from '../../src/utils/character-whitelist.js'

describe('buildCharacterWhitelist', () => {
  it('collects official names and aliases', () => {
    const list = buildCharacterWhitelist([
      { id: '1', storyId: 's', name: '苏半城', description: '主角，陆廷樾之妻', createdAt: 1 },
      { id: '2', storyId: 's', name: '何氏（奶娘）', description: '奶娘', createdAt: 2 },
    ])
    expect(list.isOfficial('苏半城')).toBe(true)
    expect(list.isOfficial('何氏')).toBe(true)
    expect(list.isOfficial('何氏（奶娘）')).toBe(true)
    expect(list.isOfficial('陆廷樾')).toBe(false)
  })

  it('does not treat description mentions as aliases', () => {
    const list = buildCharacterWhitelist([
      { id: '1', storyId: 's', name: '苏半城', description: '沈鹤卿的小叔媳妇', createdAt: 1 },
    ])
    expect(list.isOfficial('苏半城')).toBe(true)
    expect(list.isOfficial('沈鹤卿')).toBe(false)
  })
})

describe('classifyCharacterName', () => {
  it('flags invented names not in whitelist', () => {
    const list = buildCharacterWhitelist([
      { id: '1', storyId: 's', name: '苏半城', description: '', createdAt: 1 },
    ])
    expect(classifyCharacterName('苏半城', list)).toBe('official')
    expect(classifyCharacterName('苏孟祥', list)).toBe('invented')
  })
})
