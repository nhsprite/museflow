import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { normalizeIssues } from '../../../src/utils/agent-output.js'
import type { ModelProvider } from '../../../src/model/provider.js'

describe('normalizeIssues', () => {
  it('keeps issue text when no structured model judge is available', async () => {
    const issues = await normalizeIssues(
      [
        {
          type: 'consistency',
          severity: 'error',
          description: '本章采用第9章细化版本，与第18章的简化表述不完全一致，但属于合理细化，不构成严重矛盾。',
        },
      ],
      'consistency',
      undefined
    )

    expect(issues).toHaveLength(1)
  })

  it('drops withdrawn issues only through structured model judgment', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(),
      chatStructured: vi
        .fn()
        .mockResolvedValueOnce({ results: [true] })
        .mockResolvedValueOnce({ results: [false] }),
    }

    const issues = await normalizeIssues(
      [
        {
          type: 'consistency',
          severity: 'error',
          description: '此条 issue 已被模型结构化判定为撤回。',
        },
      ],
      'consistency',
      provider
    )

    expect(issues).toHaveLength(0)
  })
})
