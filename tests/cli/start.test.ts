import { describe, expect, it, vi } from 'vitest'
import { parseOutlineStrategy } from '../../src/cli/commands/start.js'

describe('parseOutlineStrategy', () => {
  it('accepts layered', () => {
    expect(parseOutlineStrategy('layered')).toBe('layered')
  })

  it('accepts legacy', () => {
    expect(parseOutlineStrategy('legacy')).toBe('legacy')
  })

  it('exits on invalid value', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => parseOutlineStrategy('invalid')).toThrow('process.exit')

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
