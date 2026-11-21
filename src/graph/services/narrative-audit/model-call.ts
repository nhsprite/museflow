import type { ModelProvider, JsonSchema, Message } from '../../../model/provider.js'
import { chatStructuredFallback } from '../../../model/provider.js'

export async function callAudit(
  provider: ModelProvider,
  chapterIndex: number,
  purpose: string,
  messages: Message[],
  schema: JsonSchema,
  validationFailure?: string
): Promise<unknown> {
  const metadata = { purpose, chapterIndex }
  const request = validationFailure
    ? [
        ...messages,
        {
          role: 'user' as const,
          content: JSON.stringify({
            validationFailure,
            instruction:
              '上次结果未通过结构校验。按输入中的显式编号和字段定义重新输出完整 JSON，修正上述问题。',
          }),
        },
      ]
    : messages
  return provider.chatStructured
    ? provider.chatStructured(request, schema, 0.1, metadata)
    : chatStructuredFallback(provider, request, schema, 0.1, metadata)
}
