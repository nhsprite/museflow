export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

import { extractJsonBlock, repairMalformedJson } from '../utils/json.js'

export interface ModelProvider {
  chat(messages: Message[], temperature?: number): Promise<string>
  chatStructured?<T>(messages: Message[], schema: JsonSchema, temperature?: number): Promise<T>
}

export function getSystemMessage(messages: Message[]): string | undefined {
  const system = messages.find(m => m.role === 'system')
  return system?.content
}

export function getNonSystemMessages(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
}

export async function chatStructuredFallback<T>(
  provider: ModelProvider,
  messages: Message[],
  schema: JsonSchema,
  temperature?: number
): Promise<T> {
  const schemaDescription = JSON.stringify(schema, null, 2)
  const augmentedMessages: Message[] = [
    ...messages,
    {
      role: 'user',
      content: `请严格按照以下 JSON Schema 返回结果，不要包含任何其他文字或 markdown 代码块标记：\n\n${schemaDescription}`,
    },
  ]

  const response = await provider.chat(augmentedMessages, temperature)
  const jsonText = extractJsonBlock(response)

  try {
    return JSON.parse(jsonText) as T
  } catch {
    return JSON.parse(repairMalformedJson(jsonText)) as T
  }
}
