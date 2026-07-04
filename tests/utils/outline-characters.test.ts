import { describe, expect, it } from 'vitest'
import {
  extractOutlineCharacters,
  mergeCharacterLists,
} from '../../src/utils/outline-characters.js'
import type { Character } from '../../src/types/character.js'

function makeOutline(
  number: number,
  title: string,
  description: string,
  introducedCharacters?: string[]
) {
  return { id: `o${number}`, number, title, description, introducedCharacters }
}

function makeCharacter(name: string): Character {
  return {
    id: `c_${name}`,
    storyId: 's1',
    name,
    description: null,
    dialogueStyle: null,
    createdAt: 1,
  }
}

describe('extractOutlineCharacters', () => {
  it('uses introducedCharacters when available', () => {
    const result = extractOutlineCharacters(
      [makeOutline(7, '买办登场', '买办商人陈裕堂主动登门。', ['陈裕堂', '周掌柜'])],
      6
    )
    expect(result.map((r) => r.name).sort()).toEqual(['周掌柜', '陈裕堂'])
  })

  it('ignores introducedCharacters from future chapters', () => {
    const result = extractOutlineCharacters(
      [
        makeOutline(7, '买办登场', '陈裕堂登场。', ['陈裕堂']),
        makeOutline(14, '洋商入局', '汇丰代表登场。', ['史密斯']),
      ],
      6
    )
    expect(result.map((r) => r.name)).toContain('陈裕堂')
    expect(result.map((r) => r.name)).not.toContain('史密斯')
  })

  it('returns empty array when no introducedCharacters annotations exist', () => {
    const result = extractOutlineCharacters(
      [makeOutline(7, '买办登场', '买办商人陈裕堂主动登门。')],
      6
    )
    expect(result).toEqual([])
  })

  it('filters out empty names only', () => {
    const result = extractOutlineCharacters(
      [makeOutline(7, '买办登场', '陈裕堂登场。', ['', '  ', '陈裕堂', 'a'])],
      6
    )
    expect(result.map((r) => r.name)).toEqual(['a', '陈裕堂'])
  })

  it('deduplicates repeated names across chapters', () => {
    const result = extractOutlineCharacters(
      [
        makeOutline(7, '买办登场', '陈裕堂登场。', ['陈裕堂']),
        makeOutline(8, '再次来访', '陈裕堂再来。', ['陈裕堂']),
      ],
      7
    )
    const chen = result.filter((r) => r.name === '陈裕堂')
    expect(chen).toHaveLength(1)
    expect(chen[0]?.sourceChapter).toBe(7)
  })
})

describe('mergeCharacterLists', () => {
  it('merges official and outline characters without duplicates', () => {
    const official = [makeCharacter('苏半城')]
    const outline = [
      {
        name: '陈裕堂',
        sourceChapter: 7,
        sourceTitle: '买办登场',
        sourceDescription: '陈裕堂登场。',
      },
    ]
    const merged = mergeCharacterLists(official, outline)
    expect(merged.map((c) => c.name)).toEqual(['苏半城', '陈裕堂'])
  })

  it('skips outline characters already in official list', () => {
    const official = [makeCharacter('苏半城'), makeCharacter('陆廷槐')]
    const outline = [
      {
        name: '陆廷槐',
        sourceChapter: 8,
        sourceTitle: '至亲反目',
        sourceDescription: '陆廷槐逼苏半城交权。',
      },
    ]
    const merged = mergeCharacterLists(official, outline)
    expect(merged).toHaveLength(2)
  })
})
