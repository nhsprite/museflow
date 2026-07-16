import { describe, expect, it } from 'vitest'
import { InvalidArgumentError } from 'commander'
import { parseWriteCount, writeBatchStopReasonLabel } from '../../src/cli/utils/write-batch.js'

describe('parseWriteCount', () => {
  it.each(['1', '5', '12'])('accepts positive integer %s', (value) => {
    expect(parseWriteCount(value)).toBe(Number(value))
  })

  it.each(['0', '-1', '1.5', 'abc', ''])('rejects invalid count %s', (value) => {
    expect(() => parseWriteCount(value)).toThrow(InvalidArgumentError)
  })
})

describe('writeBatchStopReasonLabel', () => {
  it('returns a stable label for every structured stop reason', () => {
    expect(writeBatchStopReasonLabel('requested-count')).toBe('已达到请求章数')
    expect(writeBatchStopReasonLabel('story-complete')).toBe('故事已完成')
    expect(writeBatchStopReasonLabel('rewrite-requested')).toBe('当前章节需要重写')
    expect(writeBatchStopReasonLabel('blocking-issues')).toBe('当前章节存在严重问题')
    expect(writeBatchStopReasonLabel('not-writable')).toBe('故事当前不可继续写作')
    expect(writeBatchStopReasonLabel('no-progress')).toBe('章节未产生进度')
    expect(writeBatchStopReasonLabel('error')).toBe('写作流程出错')
  })
})
