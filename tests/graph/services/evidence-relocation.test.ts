import { describe, expect, it, vi } from 'vitest'
import { relocateEvidence } from '../../../src/graph/services/evidence-relocation.js'
import type { ModelProvider } from '../../../src/model/provider.js'

function makeProvider(response: unknown): ModelProvider {
  return {
    chat: vi.fn(async () => ''),
    chatStructured: vi.fn(async () => response),
  }
}

const CONTENT =
  '第一段：角色维持原状静守。\n\n第二段：使者当面宣读裁断，角色作出了不可逆的决定。\n\n第三段：夜色渐深。'

const ITEM = {
  key: 'evt-1',
  claim: '角色作出不可逆的关键决定',
  rejectedParagraphIndex: 1,
  rejectionReason: '原证据仅描述静守，没有决定发生。',
}

describe('relocateEvidence', () => {
  it('returns the relocated paragraph index when the locator proves the claim elsewhere', async () => {
    const provider = makeProvider({
      judgments: [
        { key: 'evt-1', verdict: 'proven', paragraphIndex: 2, reason: '第二段写出决定发生。' },
      ],
    })

    const result = await relocateEvidence({ provider, chapterContent: CONTENT, items: [ITEM] })

    expect(result.get('evt-1')).toBe(2)
  })

  it('returns an empty map when the locator finds no proving paragraph', async () => {
    const provider = makeProvider({
      judgments: [
        { key: 'evt-1', verdict: 'not_found', paragraphIndex: null, reason: '全文没有决定场景。' },
      ],
    })

    const result = await relocateEvidence({ provider, chapterContent: CONTENT, items: [ITEM] })

    expect(result.size).toBe(0)
  })

  it('rejects indexes that are out of range, non-integer, or identical to the rejected paragraph', async () => {
    for (const paragraphIndex of [0, 4, 1.5, 1]) {
      const provider = makeProvider({
        judgments: [
          { key: 'evt-1', verdict: 'proven', paragraphIndex, reason: '试图锚定无效段落。' },
        ],
      })

      const result = await relocateEvidence({ provider, chapterContent: CONTENT, items: [ITEM] })

      expect(result.size).toBe(0)
    }
  })

  it('fails open with an empty map when the response is incomplete or contains unknown keys', async () => {
    const missing = makeProvider({ judgments: [] })
    expect(
      (await relocateEvidence({ provider: missing, chapterContent: CONTENT, items: [ITEM] })).size
    ).toBe(0)

    const unknownKey = makeProvider({
      judgments: [{ key: 'evt-other', verdict: 'proven', paragraphIndex: 2, reason: '未知 key。' }],
    })
    expect(
      (await relocateEvidence({ provider: unknownKey, chapterContent: CONTENT, items: [ITEM] }))
        .size
    ).toBe(0)
  })

  it('fails open with an empty map when the provider throws', async () => {
    const provider: ModelProvider = {
      chat: vi.fn(async () => ''),
      chatStructured: vi.fn(async () => {
        throw new Error('provider down')
      }),
    }

    const result = await relocateEvidence({ provider, chapterContent: CONTENT, items: [ITEM] })

    expect(result.size).toBe(0)
  })

  it('does not call the provider when there is nothing to relocate or no paragraphs', async () => {
    const provider = makeProvider({ judgments: [] })

    expect((await relocateEvidence({ provider, chapterContent: CONTENT, items: [] })).size).toBe(0)
    expect((await relocateEvidence({ provider, chapterContent: '', items: [ITEM] })).size).toBe(0)
    expect(provider.chatStructured).not.toHaveBeenCalled()
  })
})
