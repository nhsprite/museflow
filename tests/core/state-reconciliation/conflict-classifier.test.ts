import { describe, expect, it } from 'vitest'
import { classifyConflict, classifyConflicts } from '../../../src/core/state-reconciliation/conflict-classifier.js'
import type { Conflict } from '../../../src/types/story-state.js'

function makeConflict(overrides: Partial<Conflict>): Conflict {
  return {
    id: 'test',
    type: 'retcon',
    subject: '血封信笺',
    attribute: '所在位置',
    oldValue: '妆台抽屉',
    newValue: '刑部证物房',
    outlineReference: '',
    severity: 'auto',
    description: '',
    ...overrides,
  }
}

describe('conflict-classifier', () => {
  it('classifies location retcon as auto', () => {
    const conflict = makeConflict({ type: 'retcon', attribute: '所在位置' })
    const result = classifyConflict(conflict)
    expect(result.type).toBe('retcon')
    expect(result.severity).toBe('auto')
  })

  it('classifies status retcon as warning by default', () => {
    const conflict = makeConflict({ type: 'retcon', attribute: '状态' })
    const result = classifyConflict(conflict)
    expect(result.type).toBe('retcon')
    expect(result.severity).toBe('warning')
  })

  it('elevates contradiction to blocking', () => {
    const conflict = makeConflict({ type: 'retcon', description: '已死角色再次出现' })
    const result = classifyConflict(conflict)
    expect(result.type).toBe('contradiction')
    expect(result.severity).toBe('blocking')
  })

  it('preserves explicit contradiction severity', () => {
    const conflict = makeConflict({ type: 'contradiction', severity: 'blocking' })
    const result = classifyConflict(conflict)
    expect(result.type).toBe('contradiction')
    expect(result.severity).toBe('blocking')
  })

  it('classifies all conflicts in array', () => {
    const conflicts = [
      makeConflict({ id: '1', attribute: '所在位置' }),
      makeConflict({ id: '2', attribute: '状态' }),
    ]
    const results = classifyConflicts(conflicts)
    expect(results).toHaveLength(2)
    expect(results[0].severity).toBe('auto')
    expect(results[1].severity).toBe('warning')
  })
})
