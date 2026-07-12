import { describe, expect, it } from 'vitest'
import {
  createActPressureConstraint,
  createGenericVerifiedConstraint,
  dedupeVerifiedConstraints,
  filterVerifiedConstraintsForChapter,
  isRegenerableConstraintId,
  renderVerifiedConstraints,
} from '../../src/utils/verified-constraints.js'
import type { StoryArc } from '../../src/types/outline.js'

const storyArc: StoryArc = {
  totalChapters: 3,
  acts: [
    {
      index: 1,
      startChapter: 1,
      endChapter: 1,
      title: 'Act One',
      theme: 'Setup',
      function: 'Close setup',
      mandatoryBeats: [],
    },
    {
      index: 2,
      startChapter: 2,
      endChapter: 3,
      title: 'Act Two',
      theme: 'Escalation',
      function: 'Escalate conflict',
      mandatoryBeats: [],
    },
  ],
  keyBeats: [],
}

describe('verified constraints', () => {
  it('filters act-pressure constraints by metadata instead of display text', () => {
    const genericTextThatLooksLikeActPressure = createGenericVerifiedConstraint(
      '【幕级节拍压力】第 1 幕 text that should remain generic because its kind is generic.'
    )
    const durableBoundary = createGenericVerifiedConstraint(
      'Keep the next-chapter boundary unresolved.'
    )
    const staleActPressure = createActPressureConstraint(
      1,
      'Act one has unresolved beats and should no longer constrain act two.'
    )
    const olderCurrentActPressure = createActPressureConstraint(
      2,
      'Older act two pressure that should be replaced by the latest act two pressure.'
    )
    const latestCurrentActPressure = createActPressureConstraint(2, 'Latest act two pressure.')

    const filtered = filterVerifiedConstraintsForChapter(
      [
        genericTextThatLooksLikeActPressure,
        staleActPressure,
        durableBoundary,
        olderCurrentActPressure,
        latestCurrentActPressure,
      ],
      storyArc,
      1
    )

    expect(filtered).toEqual([
      genericTextThatLooksLikeActPressure,
      durableBoundary,
      latestCurrentActPressure,
    ])
    expect(renderVerifiedConstraints(filtered)).toEqual([
      genericTextThatLooksLikeActPressure.text,
      durableBoundary.text,
      latestCurrentActPressure.text,
    ])
  })

  it('creates generic constraints with an optional structured id', () => {
    expect(createGenericVerifiedConstraint('text only')).toEqual({
      kind: 'generic',
      text: 'text only',
    })
    expect(createGenericVerifiedConstraint('with id', 'memory:task:t-1')).toEqual({
      kind: 'generic',
      id: 'memory:task:t-1',
      text: 'with id',
    })
  })

  it('recognizes regenerable constraint ids by machine-readable prefix', () => {
    expect(isRegenerableConstraintId('memory:task:t-1')).toBe(true)
    expect(isRegenerableConstraintId('foreshadow-boundary:fs-1')).toBe(true)
    expect(isRegenerableConstraintId('routing-resolved-issue')).toBe(false)
  })

  it('dedupes by id or exact text, keeping the last occurrence', () => {
    const carried = createGenericVerifiedConstraint(
      '【伏笔边界】旧文本',
      'foreshadow-boundary:fs-1'
    )
    const fresh = createGenericVerifiedConstraint('【伏笔边界】新文本', 'foreshadow-boundary:fs-1')
    const foreign = createGenericVerifiedConstraint('来自路由的约束')
    const foreignDuplicate = createGenericVerifiedConstraint('来自路由的约束')
    const actPressure = createActPressureConstraint(1, 'act pressure')

    const deduped = dedupeVerifiedConstraints([
      carried,
      foreign,
      actPressure,
      fresh,
      foreignDuplicate,
    ])

    expect(deduped).toEqual([fresh, foreign, actPressure])
  })
})
