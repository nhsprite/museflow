export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

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

function repairMalformedJson(raw: string): string {
  return raw
    .replace(/```json?/g, '')
    .replace(/```/g, '')
    .replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/'([^']*)'/g, '"$1"')
}

function extractJsonBlock(raw: string): string {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim()
  }
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  return jsonMatch ? jsonMatch[0] : raw.trim()
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
