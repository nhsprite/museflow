import { randomBytes } from 'node:crypto'
import { dirname, extname } from 'node:path'

export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36)
  const random = randomBytes(6).toString('hex')
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`
}
