export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ModelProvider {
  chat(messages: Message[], temperature?: number): Promise<string>
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
