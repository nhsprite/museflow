import { describe, expect, it } from 'vitest'
import { extractEstablishedCharacters } from '../../src/utils/established-characters.js'
import type { StoryState } from '../../src/types/story-state.js'
import type { StoryMemory } from '../../src/types/story-memory.js'

describe('extractEstablishedCharacters', () => {
  const summary1 = JSON.stringify({
    characters: ['苏半城（陆廷樾之妻）：帽儿胡同陆宅灵堂', '陆福：陆宅管家'],
    characterFacts: [{ character: '陆廷樾', facts: [] }],
  })
  const summary2 = JSON.stringify({
    characters: ['苏孟祥：苏家大掌柜'],
  })

  it('extracts names from structured chapter summary fields only', () => {
    const result = extractEstablishedCharacters([summary1, summary2])
    const names = result.map((c) => c.name).sort()
    expect(names).toEqual(['陆廷樾'])
    expect(result[0]).toMatchObject({ aliases: [], isProtagonist: false })
  })

  it('extracts names from storyState and pending tasks', () => {
    const storyState: StoryState = {
      characterLocations: { 陆廷樑: '灵堂', '何氏（奶娘）': '东厢' },
      characterStatus: { 陆廷桦: '阴沉' },
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [
        { id: 't1', assignee: '陈裕堂', description: '候见', status: 'pending', createdChapter: 1 },
      ],
      currentScene: '',
      storyTime: '',
    }
    const result = extractEstablishedCharacters([], storyState)
    const names = result.map((c) => c.name).sort()
    expect(names).toEqual(['何氏（奶娘）', '陆廷桦', '陆廷樑', '陈裕堂'])
  })

  it('deduplicates names already in summaries', () => {
    const storyState: StoryState = {
      characterLocations: { 苏半城: '正房' },
      characterStatus: {},
      keyItemsLocation: {},
      keyItemsState: {},
      activePlots: [],
      revealedSecrets: [],
      pendingTasks: [],
      currentScene: '',
      storyTime: '',
    }
    const result = extractEstablishedCharacters([summary1], storyState)
    const names = result.map((c) => c.name).sort()
    expect(names).toEqual(['苏半城', '陆廷樾'])
  })

  it('treats the entity registry (B.3) as an authoritative source, skipping placeholder names', () => {
    const storyMemory: StoryMemory = {
      version: '3',
      lastChapterIndex: 5,
      entities: {
        characters: {
          // 注册实体：可读名，纳入
          'c-minor-1': {
            id: 'c-minor-1',
            name: '沈七',
            locationId: null,
            status: {},
            introducedIn: 5,
          },
          // 占位名（name===id 的机器 id）：未注册，不纳入
          'c-25': {
            id: 'c-25',
            name: 'c-25',
            locationId: null,
            status: {},
            introducedIn: 0,
          },
        },
        items: {
          // 物品注册不进入角色清单
          'item-token-1': {
            id: 'item-token-1',
            name: '告身',
            holderId: null,
            locationId: null,
            state: {},
            introducedIn: 5,
          },
        },
        locations: {},
        factions: {},
        plots: {},
      },
      events: [],
      foreshadows: {},
      beats: {},
      tasks: {},
    }
    const result = extractEstablishedCharacters([], null, storyMemory)
    expect(result.map((c) => c.name)).toEqual(['沈七'])
    expect(result[0]?.description).toContain('实体注册表中已登记')
  })
})
