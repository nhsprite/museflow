import { createHash } from 'node:crypto'

export function computePromptHash(...inputs: string[]): string {
  const hash = createHash('sha256')
  for (const input of inputs) hash.update(input)
  return hash.digest('hex').slice(0, 8)
}
