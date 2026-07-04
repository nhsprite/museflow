import { describe, expect, it, vi } from 'vitest'
import * as contextJudge from '../../src/utils/context-judge.js'
import { agePendingTasks, filterRelevantPendingTasks } from '../../src/utils/pending-tasks.js'
import type { PendingTask } from '../../src/types/story-state.js'
import type { ModelProvider } from '../../src/model/provider.js'

vi.mock('../../src/utils/context-judge.js', () => ({
  batchJudgeTaskRelevance: vi.fn().mockResolvedValue([]),
}))

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

function createProvider(): ModelProvider {
  return { chat: vi.fn() }
}

describe('agePendingTasks', () => {
  it('marks pending tasks with dueChapter at or before current chapter as expired', () => {
    const tasks: PendingTask[] = [
      task({ id: 'due-now', dueChapter: 7 }),
      task({ id: 'overdue', dueChapter: 6 }),
      task({ id: 'future', dueChapter: 8 }),
    ]

    const aged = agePendingTasks(tasks, 7)

    expect(aged.find((t) => t.id === 'due-now')!.status).toBe('expired')
    expect(aged.find((t) => t.id === 'overdue')!.status).toBe('expired')
    expect(aged.find((t) => t.id === 'future')!.status).toBe('pending')
  })

  it('keeps non-pending tasks unchanged', () => {
    const tasks: PendingTask[] = [
      task({ id: 'done', status: 'done', dueChapter: 7 }),
      task({ id: 'postponed', status: 'postponed', dueChapter: 7 }),
      task({ id: 'expired', status: 'expired', dueChapter: 7 }),
    ]

    const aged = agePendingTasks(tasks, 7)

    expect(aged.find((t) => t.id === 'done')!.status).toBe('done')
    expect(aged.find((t) => t.id === 'postponed')!.status).toBe('postponed')
    expect(aged.find((t) => t.id === 'expired')!.status).toBe('expired')
  })

  it('does not modify tasks without dueChapter', () => {
    const tasks: PendingTask[] = [task({ id: 'no-due', dueChapter: undefined })]

    const aged = agePendingTasks(tasks, 7)

    expect(aged.find((t) => t.id === 'no-due')!.status).toBe('pending')
  })
})

describe('filterRelevantPendingTasks', () => {
  it('includes tasks due at the current chapter', async () => {
    const tasks: PendingTask[] = [
      task({ id: 'due-this-chapter', dueChapter: 7, description: '买办登门' }),
      task({ id: 'future', dueChapter: 8, description: '小叔逼宫' }),
    ]

    const relevant = await filterRelevantPendingTasks(tasks, 6, '买办商人陈裕堂主动登门')

    expect(relevant.map((t) => t.id)).toContain('due-this-chapter')
    expect(relevant.map((t) => t.id)).not.toContain('future')
  })

  it('includes tasks judged relevant by the model', async () => {
    const tasks: PendingTask[] = [
      task({ id: 'relevant', dueChapter: undefined, description: '陈裕堂登门拜访苏半城' }),
      task({ id: 'unrelated', dueChapter: undefined, description: '延绥镖局四百两旧线待查' }),
    ]
    vi.mocked(contextJudge.batchJudgeTaskRelevance).mockResolvedValueOnce([true, false])

    const relevant = await filterRelevantPendingTasks(
      tasks,
      6,
      '买办商人陈裕堂主动登门',
      createProvider()
    )

    expect(relevant.map((t) => t.id)).toContain('relevant')
    expect(relevant.map((t) => t.id)).not.toContain('unrelated')
  })

  it('excludes expired or done tasks', async () => {
    const tasks: PendingTask[] = [
      task({ id: 'expired', status: 'expired', dueChapter: 7 }),
      task({ id: 'done', status: 'done', dueChapter: 7 }),
    ]

    const relevant = await filterRelevantPendingTasks(tasks, 6, '任何大纲')

    expect(relevant).toHaveLength(0)
  })
})
