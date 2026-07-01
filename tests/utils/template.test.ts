import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/template.js'

describe('renderTemplate', () => {
  it('interpolates variables', () => {
    const result = renderTemplate('Hello {NAME}, you have {COUNT} messages.', {
      NAME: 'Alice',
      COUNT: 3,
    })
    expect(result).toBe('Hello Alice, you have 3 messages.')
  })

  it('replaces all occurrences of a variable', () => {
    const result = renderTemplate('{X} and {X}', { X: 'twice' })
    expect(result).toBe('twice and twice')
  })

  it('leaves unknown placeholders untouched', () => {
    const result = renderTemplate('Known {KNOWN} and unknown {UNKNOWN}.', { KNOWN: 'yes' })
    expect(result).toBe('Known yes and unknown {UNKNOWN}.')
  })

  it('handles empty variables object', () => {
    const result = renderTemplate('No changes.', {})
    expect(result).toBe('No changes.')
  })

  it('escapes regex special characters in variable keys', () => {
    const result = renderTemplate('value is {A.B} and {X+Y}', { 'A.B': 'dot', 'X+Y': 'plus' })
    expect(result).toBe('value is dot and plus')
  })
})
