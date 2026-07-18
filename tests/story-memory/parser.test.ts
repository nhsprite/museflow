import { describe, it, expect } from 'vitest'
import { parseStoryEventsBlock, parseStoryFinalStateBlock } from '../../src/story-memory/parser.js'

describe('parseStoryEventsBlock', () => {
  it('parses character-location events', () => {
    const text = `=== STORY_EVENTS ===
- character-location: c-linxuan -> l-temple
- foreshadow-fulfill: fs-oath
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 2)
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('character-location')
    expect(events[1]?.type).toBe('foreshadow-fulfill')
  })

  it('normalizes null/none tokens in character-location events', () => {
    const text = `=== STORY_EVENTS ===
- character-location: c-zhoushifu -> null
- character-location: c-laowu -> none
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 2)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'character-location',
      characterId: 'c-zhoushifu',
      locationId: null,
    })
    expect(events[1]).toMatchObject({
      type: 'character-location',
      characterId: 'c-laowu',
      locationId: null,
    })
  })

  it('returns empty array when block is missing', () => {
    const events = parseStoryEventsBlock('正文', 1)
    expect(events).toHaveLength(0)
  })

  it('parses item-location events', () => {
    const text = `=== STORY_EVENTS ===
- item-location: i-sword -> c-linxuan
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('item-location')
  })

  it('parses explicit item holder and location fields', () => {
    const text = `=== STORY_EVENTS ===
- item-location: item-sword / holder=none / location=loc-temple @p3
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 0)

    expect(events[0]).toMatchObject({
      type: 'item-location',
      itemId: 'item-sword',
      holderId: null,
      locationId: 'loc-temple',
      evidence: { paragraphIndex: 3 },
    })
  })

  it('rejects free-form prose in legacy item-location targets', () => {
    const text = `=== STORY_EVENTS ===
- item-location: item-sword -> 登记台右格原位 @p1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 0)

    expect(events).toEqual([])
  })

  it('parses plot-advance events', () => {
    const text = `=== STORY_EVENTS ===
- plot-advance: act-1 / a1-b1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('plot-advance')
  })

  it('parses paragraph evidence markers on story events', () => {
    const text = `=== STORY_EVENTS ===
- plot-advance: act-1 / a1-b1 @p2
=== CHAPTER_CONTENT ===
第一段。

第二段。`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.evidence).toEqual({ paragraphIndex: 2 })
  })

  it('parses character-status events', () => {
    const text = `=== STORY_EVENTS ===
- character-status: c-linxuan / health -> injured
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('character-status')
  })

  it('parses item-state events', () => {
    const text = `=== STORY_EVENTS ===
- item-state: i-sword / condition -> broken
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('item-state')
  })

  it('parses foreshadow-introduce events', () => {
    const text = `=== STORY_EVENTS ===
- foreshadow-introduce: fs-oath / 5
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('foreshadow-introduce')
  })

  it('parses rich foreshadow-introduce metadata', () => {
    const text = `=== STORY_EVENTS ===
- foreshadow-introduce: fs-oath / expected=5 / kind=character_arc / required=false / beat=A1-M2 / text=角色A在场景A中的迟疑暗示后续选择 / question=角色A为何迟疑？ / criteria=通过后续行动揭示迟疑的原因。 @p1
=== CHAPTER_CONTENT ===
角色A在场景A中短暂停顿。`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-oath',
      expectedFulfillChapter: 5,
      kind: 'character_arc',
      required: false,
      beatId: 'A1-M2',
      text: '角色A在场景A中的迟疑暗示后续选择',
      resolutionQuestion: '角色A为何迟疑？',
      fulfillmentCriteria: '通过后续行动揭示迟疑的原因。',
      evidence: { paragraphIndex: 1 },
    })
  })

  it('parses a foreshadow resolution policy machine field', () => {
    const text = `=== STORY_EVENTS ===
- foreshadow-introduce: fs-open / expected=none / policy=should_resolve / required=true
=== CHAPTER_CONTENT ===
正文`

    const events = parseStoryEventsBlock(text, 2)

    expect(events[0]).toMatchObject({
      type: 'foreshadow-introduce',
      foreshadowId: 'fs-open',
      expectedFulfillChapter: null,
      resolutionPolicy: 'should_resolve',
      required: true,
    })
  })

  it('parses task-create and task-resolve events', () => {
    const text = `=== STORY_EVENTS ===
- task-create: t-errand / find the key
- task-resolve: t-errand
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('task-create')
    expect(events[1]?.type).toBe('task-resolve')
  })

  it('ignores unrecognized lines inside the block', () => {
    const text = `=== STORY_EVENTS ===
- character-location: c-linxuan -> l-temple
- unknown-event: something
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
  })

  it('parses machine-readable IDs with numeric suffixes', () => {
    const text = `=== STORY_EVENTS ===
- character-location: c-1 -> l-1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'character-location',
      characterId: 'c-1',
      locationId: 'l-1',
    })
  })

  it('keeps act-<n> plot IDs which are legitimate plot identifiers', () => {
    const text = `=== STORY_EVENTS ===
- plot-advance: act-2 / A2-M3
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'plot-advance', plotId: 'act-2', beatId: 'A2-M3' })
  })

  it('drops character-location events with non-machine characterId or locationId', () => {
    const text = `=== STORY_EVENTS ===
- character-location: 某个中文角色名 -> l-shopfront
- character-location: c-linxuan -> 某个中文地点
- character-location: c-linxuan -> l-temple
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'character-location',
      characterId: 'c-linxuan',
      locationId: 'l-temple',
    })
  })

  it('drops character-status events with non-machine characterId', () => {
    const text = `=== STORY_EVENTS ===
- character-status: 某个中文角色名 / mood -> suspicious
- character-status: c-linxuan / health -> injured
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'character-status',
      characterId: 'c-linxuan',
    })
  })

  it('drops item-state events with non-machine itemId', () => {
    const text = `=== STORY_EVENTS ===
- item-state: 某个中文物品名 / location -> 桌上
- item-state: i-sword / condition -> broken
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'item-state',
      itemId: 'i-sword',
    })
  })

  it('drops foreshadow-fulfill events with non-machine foreshadowId', () => {
    const text = `=== STORY_EVENTS ===
- foreshadow-fulfill: 某个中文描述
- foreshadow-fulfill: fs-oath
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'foreshadow-fulfill', foreshadowId: 'fs-oath' })
  })

  it('does not allow chapter STORY_EVENTS text to emit foreshadow-merge', () => {
    const text = `=== STORY_EVENTS ===
- foreshadow-merge: canonical=fs-early / duplicate=fs-late / reason="same obligation"
- foreshadow-fulfill: fs-early
=== CHAPTER_CONTENT ===
正文`

    const events = parseStoryEventsBlock(text, 4)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'foreshadow-fulfill', foreshadowId: 'fs-early' })
  })

  it('drops plot-advance events with non-machine plotId or beatId', () => {
    const text = `=== STORY_EVENTS ===
- plot-advance: 第一章 / A1-M1
- plot-advance: act-1 / 节拍一
- plot-advance: act-1 / A1-M1
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'plot-advance', plotId: 'act-1', beatId: 'A1-M1' })
  })

  it('drops task events with non-machine taskId', () => {
    const text = `=== STORY_EVENTS ===
- task-create: 某个中文任务名 / find the key
- task-resolve: 未完成
- task-create: t-errand / find the key
- task-resolve: t-errand
=== CHAPTER_CONTENT ===
正文`
    const events = parseStoryEventsBlock(text, 1)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'task-create', taskId: 't-errand' })
    expect(events[1]).toMatchObject({ type: 'task-resolve', taskId: 't-errand' })
  })
})

describe('parseStoryFinalStateBlock', () => {
  it('parses a JSON array of final-state declarations', () => {
    const text = `=== CHAPTER_CONTENT ===
正文
=== STORY_FINAL_STATE ===
[
  {"entityId": "i-box", "attribute": "location", "value": "loc-drawer-right"},
  {"entityId": "c-linxuan", "attribute": "status", "value": "active"}
]`
    const declarations = parseStoryFinalStateBlock(text)
    expect(declarations).toEqual([
      { entityId: 'i-box', attribute: 'location', value: 'loc-drawer-right' },
      { entityId: 'c-linxuan', attribute: 'status', value: 'active' },
    ])
  })

  it('returns empty array when block is missing', () => {
    expect(parseStoryFinalStateBlock('正文')).toEqual([])
  })

  it('returns empty array for an empty block', () => {
    const text = `=== CHAPTER_CONTENT ===
正文
=== STORY_FINAL_STATE ===
`
    expect(parseStoryFinalStateBlock(text)).toEqual([])
  })

  it('tolerates broken JSON by returning empty array', () => {
    const text = `=== STORY_FINAL_STATE ===
[{"entityId": "i-box", "attribute": "location", "value": `
    expect(parseStoryFinalStateBlock(text)).toEqual([])
  })

  it('drops entries with invalid attribute or prose location value', () => {
    const text = `=== STORY_FINAL_STATE ===
[
  {"entityId": "i-box", "attribute": "mood", "value": "happy"},
  {"entityId": "i-box", "attribute": "location", "value": "抽屉更深处"},
  {"entityId": "i-box", "attribute": "location", "value": "loc-drawer-right"}
]`
    const declarations = parseStoryFinalStateBlock(text)
    expect(declarations).toEqual([
      { entityId: 'i-box', attribute: 'location', value: 'loc-drawer-right' },
    ])
  })

  it('accepts prose status values that mirror event values verbatim', () => {
    const text = `=== STORY_FINAL_STATE ===
[
  {"entityId": "i-box", "attribute": "status", "value": "贴身未拆，火漆未动"}
]`
    const declarations = parseStoryFinalStateBlock(text)
    expect(declarations).toEqual([
      { entityId: 'i-box', attribute: 'status', value: '贴身未拆，火漆未动' },
    ])
  })

  it('drops status values that concatenate attribute and value with "="', () => {
    const text = `=== STORY_FINAL_STATE ===
[
  {"entityId": "i-box", "attribute": "status", "value": "papernote-examined=true"},
  {"entityId": "i-box", "attribute": "status", "value": "true"}
]`
    const declarations = parseStoryFinalStateBlock(text)
    expect(declarations).toEqual([{ entityId: 'i-box', attribute: 'status', value: 'true' }])
  })

  it('parses final-state declarations with numeric ID suffixes', () => {
    const text = `=== STORY_FINAL_STATE ===
[
  {"entityId": "c-1", "attribute": "location", "value": "l-1"}
]`
    const declarations = parseStoryFinalStateBlock(text)
    expect(declarations).toEqual([{ entityId: 'c-1', attribute: 'location', value: 'l-1' }])
  })

  it('normalizes null/none tokens in location final-state declarations', () => {
    const text = `=== STORY_FINAL_STATE ===
[
  {"entityId": "c-zhoushifu", "attribute": "location", "value": "null"},
  {"entityId": "c-laowu", "attribute": "location", "value": "none"},
  {"entityId": "c-yezhiqiu", "attribute": "location", "value": null}
]`
    const declarations = parseStoryFinalStateBlock(text)
    expect(declarations).toEqual([
      { entityId: 'c-zhoushifu', attribute: 'location', value: null },
      { entityId: 'c-laowu', attribute: 'location', value: null },
      { entityId: 'c-yezhiqiu', attribute: 'location', value: null },
    ])
  })
})
