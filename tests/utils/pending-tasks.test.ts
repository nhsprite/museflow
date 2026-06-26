import { describe, expect, it } from 'vitest'
import {
  agePendingTasks,
  filterRelevantPendingTasks,
} from '../../src/utils/pending-tasks.js'
import type { PendingTask } from '../../src/types/story-state.js'

function task(overrides: Partial<PendingTask> = {}): PendingTask {
  return {
    id: 't1',
    assignee: '苏半城',
    description: '明日午时前回话亲王',
    createdChapter: 5,
    status: 'pending',
    ...overrides,
  }
}

describe('agePendingTasks', () => {
  it('marks pending tasks with dueChapter at or before current chapter as expired', () => {
    const tasks: PendingTask[] = [
      task({ id: 'due-now', dueChapter: 7 }),
      task({ id: 'overdue', dueChapter: 6 }),
      task({ id: 'future', dueChapter: 8 }),
    ]

    const aged = agePendingTasks(tasks, 7)

    expect(aged.find(t => t.id === 'due-now')!.status).toBe('expired')
    expect(aged.find(t => t.id === 'overdue')!.status).toBe('expired')
    expect(aged.find(t => t.id === 'future')!.status).toBe('pending')
  })

  it('keeps non-pending tasks unchanged', () => {
    const tasks: PendingTask[] = [
      task({ id: 'done', status: 'done', dueChapter: 7 }),
      task({ id: 'postponed', status: 'postponed', dueChapter: 7 }),
      task({ id: 'expired', status: 'expired', dueChapter: 7 }),
    ]

    const aged = agePendingTasks(tasks, 7)

    expect(aged.find(t => t.id === 'done')!.status).toBe('done')
    expect(aged.find(t => t.id === 'postponed')!.status).toBe('postponed')
    expect(aged.find(t => t.id === 'expired')!.status).toBe('expired')
  })

  it('does not modify tasks without dueChapter', () => {
    const tasks: PendingTask[] = [
      task({ id: 'no-due', dueChapter: undefined }),
    ]

    const aged = agePendingTasks(tasks, 7)

    expect(aged.find(t => t.id === 'no-due')!.status).toBe('pending')
  })
})

describe('filterRelevantPendingTasks', () => {
  it('includes tasks due at the current chapter', () => {
    const tasks: PendingTask[] = [
      task({ id: 'due-this-chapter', dueChapter: 7, description: '买办登门' }),
      task({ id: 'future', dueChapter: 8, description: '小叔逼宫' }),
    ]

    const relevant = filterRelevantPendingTasks(tasks, 6, '买办商人陈裕堂主动登门')

    expect(relevant.map(t => t.id)).toContain('due-this-chapter')
    expect(relevant.map(t => t.id)).not.toContain('future')
  })

  it('includes tasks whose description overlaps with current outline', () => {
    const tasks: PendingTask[] = [
      task({ id: 'overlap', dueChapter: undefined, description: '陈裕堂持汇丰名帖拜访苏半城' }),
      task({ id: 'unrelated', dueChapter: undefined, description: '延绥镖局四百两旧线待查' }),
    ]

    const relevant = filterRelevantPendingTasks(tasks, 6, '买办商人陈裕堂主动登门')

    expect(relevant.map(t => t.id)).toContain('overlap')
    expect(relevant.map(t => t.id)).not.toContain('unrelated')
  })

  it('excludes expired or done tasks', () => {
    const tasks: PendingTask[] = [
      task({ id: 'expired', status: 'expired', dueChapter: 7 }),
      task({ id: 'done', status: 'done', dueChapter: 7 }),
    ]

    const relevant = filterRelevantPendingTasks(tasks, 6, '任何大纲')

    expect(relevant).toHaveLength(0)
  })
})
