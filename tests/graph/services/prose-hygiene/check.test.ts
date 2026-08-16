import { describe, expect, it } from 'vitest'
import {
  buildProseHygieneContext,
  checkProseHygiene,
  detectChapterSelfReferences,
  detectInternalIdentifiers,
  detectProtocolBlocks,
} from '../../../../src/graph/services/prose-hygiene/index.js'
import type { StoryMemory } from '../../../../src/types/story-memory.js'

const CLEAN_BODY = `# 第3章 夜访县衙

沈青梧提着灯笼穿过回廊，夜风把灯焰压得只剩豆大一点。

县令早已候在堂下，见他来了，只抬了抬手，示意左右退下。`

describe('detectProtocolBlocks', () => {
  it('flags a chapter body starting with a STORY_EVENTS protocol block', () => {
    const content = `=== STORY_EVENTS ===
- character-location: c-25 -> l-1 @p1

# 第17章 尘埃落定

正文第一段。`

    const issues = detectProtocolBlocks(content)

    expect(issues.map((i) => i.code)).toEqual(['prose.protocol-block', 'prose.protocol-block'])
    expect(issues[0]?.severity).toBe('error')
    expect(issues[0]?.excerpt).toBe('=== STORY_EVENTS ===')
    expect(issues[1]?.excerpt).toBe('- character-location: c-25 -> l-1 @p1')
    expect(issues[0]?.span.start).toBe(0)
  })

  it('flags STORY_FINAL_STATE markers leaked after the prose', () => {
    const content = `# 第42章 尾声

正文结束。

=== STORY_FINAL_STATE ===
[]`

    const issues = detectProtocolBlocks(content)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.excerpt).toBe('=== STORY_FINAL_STATE ===')
  })

  it('flags every event-line variant of the output protocol', () => {
    const lines = [
      '- character-status: c-1 / 状态 -> 受伤 @p2',
      'item-location: item-1 / holder=c-1 / location=none @p3',
      'plot-advance: act-1 / A1-M2 @p4',
      'foreshadow-fulfill: fs-1 @p5',
      'task-create: task-1 / 送信 @p6',
    ]
    const issues = detectProtocolBlocks(`# 第1章\n\n${lines.join('\n')}`)

    expect(issues).toHaveLength(lines.length)
    expect(issues.every((i) => i.code === 'prose.protocol-block')).toBe(true)
  })

  it('does not flag clean prose', () => {
    expect(detectProtocolBlocks(CLEAN_BODY)).toEqual([])
  })
})

describe('detectInternalIdentifiers', () => {
  it('flags a known entity id used as a prose token', () => {
    const content = `# 第30章 夜谈

她想起殷温娇（c-25）临走时说的话，久久没有作声。`

    const issues = detectInternalIdentifiers(content, ['c-25'])

    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('prose.internal-identifier')
    expect(issues[0]?.severity).toBe('error')
    expect(issues[0]?.excerpt).toBe('c-25')
    expect(content.slice(issues[0]!.span.start, issues[0]!.span.end)).toBe('c-25')
  })

  it('flags bare known ids and known beat ids', () => {
    const content = `# 第8章 布局

他暗中记下 c-25 与 A1-M2 的对应关系。`

    const issues = detectInternalIdentifiers(content, ['c-25', 'A1-M2'])

    expect(issues.map((i) => i.excerpt).sort()).toEqual(['A1-M2', 'c-25'])
  })

  it('ignores unknown ids and id-shaped substrings of longer tokens', () => {
    const content = `# 第30章 夜谈

他写下 c-251 的编号，又提到一个陌生的 c-99。`

    expect(detectInternalIdentifiers(content, ['c-25'])).toEqual([])
  })

  it('ignores ids shorter than three characters and empty id sets', () => {
    const content = '正文里有 a1 与 x-。'
    expect(detectInternalIdentifiers(content, ['a1', 'x-'])).toEqual([])
    expect(detectInternalIdentifiers(content, [])).toEqual([])
  })
})

describe('detectChapterSelfReferences', () => {
  const valid = new Set([1, 2, 3, 27, 42])

  it('flags narrative references to chapter numbers, Arabic and Chinese numerals', () => {
    const content = `# 第37章 回京

他的行程仍止于第27章寅时起，此后诸事便再无记载。

翻看旧档，第二十七章所记与眼前所见截然不同。`

    const issues = detectChapterSelfReferences(content, valid)

    expect(issues).toHaveLength(2)
    expect(issues[0]?.excerpt).toBe('第27章')
    expect(issues[1]?.excerpt).toBe('第二十七章')
    expect(issues.every((i) => i.code === 'prose.chapter-self-reference')).toBe(true)
    expect(issues.every((i) => i.severity === 'error')).toBe(true)
  })

  it('flags chapter-id tokens', () => {
    const content = `# 第3章 夜访

记录停在 chapter-27 那一页。`

    const issues = detectChapterSelfReferences(content, valid)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.excerpt).toBe('chapter-27')
  })

  it('exempts the chapter heading itself', () => {
    expect(detectChapterSelfReferences(CLEAN_BODY, valid)).toEqual([])
    expect(detectChapterSelfReferences('# 第二十七章 旧档\n\n正文。', valid)).toEqual([])
  })

  it('ignores chapter numbers outside the valid set', () => {
    const content = `# 第1章 开始

他随口说了句第二百章以后的事。`

    expect(detectChapterSelfReferences(content, valid)).toEqual([])
  })
})

describe('checkProseHygiene', () => {
  it('aggregates all deterministic detectors and sorts by span', () => {
    const content = `=== STORY_EVENTS ===

# 第17章 尘埃落定

殷温娇（c-25）的行程仍止于第16章寅时起。`

    const issues = checkProseHygiene(content, {
      entityIds: ['c-25'],
      chapterNumber: 17,
      totalChapters: 60,
    })

    expect(issues.map((i) => i.code)).toEqual([
      'prose.protocol-block',
      'prose.internal-identifier',
      'prose.chapter-self-reference',
    ])
    expect(issues.every((i) => i.severity === 'error')).toBe(true)
    const starts = issues.map((i) => i.span.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('stays inert when the context carries no identifier sets', () => {
    const content = `# 第2章 过渡

正文里提到第1章与 c-25 都不会被判定。`

    expect(checkProseHygiene(content, {})).toEqual([])
  })

  it('returns no issues for empty content', () => {
    expect(checkProseHygiene('', { entityIds: ['c-25'] })).toEqual([])
    expect(checkProseHygiene('   \n  ', { entityIds: ['c-25'] })).toEqual([])
  })
})

describe('buildProseHygieneContext', () => {
  it('collects entity, foreshadow, task and beat ids from story-memory and the story arc', () => {
    const memory = {
      version: '3',
      lastChapterIndex: 0,
      entities: {
        characters: {
          'c-25': { id: 'c-25', name: '殷温娇', locationId: null, status: {}, introducedIn: 0 },
        },
        items: {},
        locations: { 'l-1': { id: 'l-1', name: '京城', introducedIn: 0 } },
        factions: {},
        plots: {},
      },
      events: [],
      foreshadows: { 'fs-1': { id: 'fs-1' } },
      beats: { 'A1-M1': { id: 'A1-M1' } },
      tasks: { 'task-1': { id: 'task-1' } },
    } as unknown as StoryMemory
    const storyArc = {
      totalChapters: 10,
      acts: [
        {
          index: 1,
          startChapter: 1,
          endChapter: 5,
          title: '起',
          theme: '',
          function: '',
          mandatoryBeats: ['节拍一', '节拍二'],
        },
      ],
      keyBeats: [{ id: 'kb-1', beat: '关键', deadlineAct: 1 }],
    } as never

    const ctx = buildProseHygieneContext({
      storyMemory: memory,
      storyArc,
      chapterNumber: 3,
      totalChapters: 10,
    })

    expect(ctx.entityIds).toEqual(expect.arrayContaining(['c-25', 'l-1', 'fs-1', 'task-1']))
    expect(ctx.beatIds).toEqual(expect.arrayContaining(['A1-M1', 'A1-M2', 'kb-1']))
    expect(ctx.chapterNumber).toBe(3)
    expect(ctx.totalChapters).toBe(10)
  })

  it('tolerates missing story-memory and story arc', () => {
    const ctx = buildProseHygieneContext({ chapterNumber: 1 })
    expect(ctx.entityIds).toEqual([])
    expect(ctx.beatIds).toEqual([])
  })
})
