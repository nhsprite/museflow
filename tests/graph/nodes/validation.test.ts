import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { normalizeIssues } from '../../../src/utils/agent-output.js'
import type { ModelProvider } from '../../../src/model/provider.js'
import * as validationNode from '../../../src/graph/nodes/validation.js'
import type { ReducedGraphState } from '../../../src/graph/state.js'
import { createEmptyStoryMemory } from '../../../src/story-memory/projector.js'

describe('normalizeIssues', () => {
  it('keeps issue text when no structured model judge is available', async () => {
    const issues = await normalizeIssues(
      [
        {
          type: 'consistency',
          severity: 'error',
          description:
            '本章采用第9章细化版本，与第18章的简化表述不完全一致，但属于合理细化，不构成严重矛盾。',
        },
      ],
      'consistency',
      undefined,
      {
        ruleId: (raw, mappedType) => `${mappedType}.${raw.aspect ?? 'general'}`,
      }
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.ruleId).toBe('consistency.general')
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
      provider,
      {
        ruleId: (raw, mappedType) => `${mappedType}.${raw.aspect ?? 'general'}`,
      }
    )

    expect(issues).toHaveLength(0)
  })
})

describe('continuity context', () => {
  it('renders one active obligation using only its canonical foreshadow record', () => {
    const buildContinuityContext = (
      validationNode as typeof validationNode & {
        buildContinuityContext?: (state: ReducedGraphState) => string
      }
    ).buildContinuityContext
    expect(buildContinuityContext).toBeTypeOf('function')
    if (!buildContinuityContext) return

    const memory = createEmptyStoryMemory()
    memory.foreshadows = {
      'fs-early': {
        id: 'fs-early',
        text: 'canonical planted text',
        kind: 'plot',
        introducedIn: 1,
        expectedFulfillChapter: 5,
        fulfilledIn: null,
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: null,
      },
      'fs-late': {
        id: 'fs-late',
        text: 'duplicate planted text',
        kind: 'plot',
        introducedIn: 2,
        expectedFulfillChapter: 5,
        fulfilledIn: null,
        resolutionPolicy: 'must_resolve',
        required: true,
        beatId: null,
        mergedInto: 'fs-early',
      },
    }

    const context = buildContinuityContext({
      characters: [],
      storyMemory: memory,
      storyState: null,
    } as ReducedGraphState)

    expect(context.match(/fs-early/g)).toHaveLength(1)
    expect(context).toContain('canonical planted text')
    expect(context).not.toContain('fs-late')
    expect(context).not.toContain('duplicate planted text')
  })
})
