import { describe, expect, it } from 'vitest'
import {
  sanitizeProseExcerpt,
  stripIdentifierParentheticals,
  stripProtocolArtifacts,
} from '../../../../src/graph/services/prose-hygiene/index.js'

describe('stripProtocolArtifacts', () => {
  it('strips a leading STORY_EVENTS block while keeping heading and prose', () => {
    const content = `=== STORY_EVENTS ===
- character-location: c-25 -> l-1 @p1
- plot-advance: act-1 / A1-M2 @p2

# 第17章 尘埃落定

正文第一段。

正文第二段。`

    expect(stripProtocolArtifacts(content)).toBe(
      '# 第17章 尘埃落定\n\n正文第一段。\n\n正文第二段。'
    )
  })

  it('strips a trailing STORY_FINAL_STATE block including its JSON lines', () => {
    const content = `# 第42章 尾声

正文结束。

=== STORY_FINAL_STATE ===
[
  {"entityId": "c-25", "attribute": "location", "value": "l-1"}
]`

    expect(stripProtocolArtifacts(content)).toBe('# 第42章 尾声\n\n正文结束。')
  })

  it('collapses the blank runs left by removed blocks', () => {
    const content = `# 第1章 开始

=== SOME_PROTOCOL ===

第一段。`

    expect(stripProtocolArtifacts(content)).toBe('# 第1章 开始\n\n第一段。')
  })

  it('keeps prose that merely contains equals signs inline', () => {
    const content = '# 第1章\n\n他写下 1=1 的式子，又画了一条 ==== 分割线的一半。'
    expect(stripProtocolArtifacts(content)).toBe(content)
  })
})

describe('stripIdentifierParentheticals', () => {
  it('removes full-width and half-width parenthetical known ids', () => {
    const content = '殷温娇（c-25）回头看向破庙(l-1)，久久无言。'
    expect(stripIdentifierParentheticals(content, ['c-25', 'l-1'])).toBe(
      '殷温娇回头看向破庙，久久无言。'
    )
  })

  it('leaves unknown ids and natural parentheticals untouched', () => {
    const content = '殷温娇（江州人氏）回头看向 c-99。'
    expect(stripIdentifierParentheticals(content, ['c-25'])).toBe(content)
  })
})

describe('sanitizeProseExcerpt', () => {
  it('strips protocol residue and identifier parentheticals together', () => {
    const content = `=== STORY_EVENTS ===
- character-location: c-25 -> l-1 @p1

殷温娇（c-25）走入破庙（l-1）。`

    expect(sanitizeProseExcerpt(content, { entityIds: ['c-25', 'l-1'] })).toBe('殷温娇走入破庙。')
  })
})
