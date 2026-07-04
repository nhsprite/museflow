import { describe, expect, it } from 'vitest'
import { extractEstablishedCharacters } from '../../src/utils/established-characters.js'
import type { StoryState } from '../../src/types/story-state.js'

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
})
