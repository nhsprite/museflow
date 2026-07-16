import { InvalidArgumentError } from 'commander'

export type WriteBatchStopReason =
  | 'requested-count'
  | 'story-complete'
  | 'rewrite-requested'
  | 'blocking-issues'
  | 'not-writable'
  | 'no-progress'
  | 'error'

export interface WriteIterationOutcome {
  completed: boolean
  stopReason?: Exclude<WriteBatchStopReason, 'requested-count' | 'error'>
}

export function parseWriteCount(value: string): number {
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) {
    throw new InvalidArgumentError('连续写作章数必须是正整数')
  }
  return count
}

export function writeBatchStopReasonLabel(reason: WriteBatchStopReason): string {
  switch (reason) {
    case 'requested-count':
      return '已达到请求章数'
    case 'story-complete':
      return '故事已完成'
    case 'rewrite-requested':
      return '当前章节需要重写'
    case 'blocking-issues':
      return '当前章节存在严重问题'
    case 'not-writable':
      return '故事当前不可继续写作'
    case 'no-progress':
      return '章节未产生进度'
    case 'error':
      return '写作流程出错'
  }
}
