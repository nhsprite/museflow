export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ModelProvider {
  chat(messages: Message[]): Promise<string>
}
