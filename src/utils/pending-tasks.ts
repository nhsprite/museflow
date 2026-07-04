import type { PendingTask } from '../types/story-state.js'
import type { ModelProvider } from '../model/provider.js'
import { batchJudgeTaskRelevance } from './context-judge.js'

export function agePendingTasks(
  tasks: PendingTask[],
  currentDisplayChapter: number
): PendingTask[] {
  return tasks.map((task) => {
    if (task.status !== 'pending') return task
    if (task.dueChapter !== undefined && task.dueChapter <= currentDisplayChapter) {
      return { ...task, status: 'expired' as const }
    }
    return task
  })
}

export async function filterRelevantPendingTasks(
  tasks: PendingTask[],
  currentChapterIndex: number,
  outlineDescription: string,
  provider?: ModelProvider
): Promise<PendingTask[]> {
  const currentDisplayChapter = currentChapterIndex + 1
  const candidateTasks = tasks.filter(
    (task) => task.status === 'pending' && task.dueChapter === undefined
  )

  let relevanceResults: boolean[] = []
  if (provider && candidateTasks.length > 0) {
    relevanceResults = await batchJudgeTaskRelevance(
      provider,
      candidateTasks.map((task) => ({
        taskDescription: task.description,
        outlineDescription,
      }))
    )
  }

  const results: PendingTask[] = []
  let candidateIndex = 0

  for (const task of tasks) {
    if (task.status !== 'pending') continue
    if (task.dueChapter === currentDisplayChapter) {
      results.push(task)
      continue
    }
    if (task.dueChapter === undefined) {
      const isRelevant = relevanceResults[candidateIndex++] ?? false
      if (isRelevant) {
        results.push(task)
      }
    }
  }

  return results
}
