import { describe, expect, it } from 'vitest'
import { buildOutlineBridgeHint, shouldForceTemporaryReplan } from '../../src/utils/outline-bridge.ts'

describe('buildOutlineBridgeHint', () => {
  it('adds a bridge when current chapter ends an entity that next chapter must still resolve', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救。' },
      { number: 30, title: '三界求援', description: '如来佛祖现身，以无上神通辨别六耳猕猴。' },
    ]

    const hint = buildOutlineBridgeHint(outline, 0)

    expect(hint).toContain('<outline_bridge>')
    expect(hint).toContain('伏法')
    expect(hint).toContain('被制服、受控或暂时收押')
    expect(hint).toContain('不得写成彻底死亡、彻底消灭或永久退出故事')
    expect(hint).toContain('第30章')
  })

  it('does not add a bridge for non-conflicting adjacent chapters', () => {
    const outline = [
      { number: 1, title: '启程', description: '主角离开家乡。' },
      { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
    ]

    expect(buildOutlineBridgeHint(outline, 0)).toBe('')
  })

  it('forces temporary replanning when an outline bridge is needed', () => {
    const outline = [
      { number: 29, title: '真假美猴王', description: '六耳猕猴伏法，真宝玉获救。' },
      { number: 30, title: '三界求援', description: '如来佛祖现身，以无上神通辨别六耳猕猴。' },
    ]

    expect(shouldForceTemporaryReplan(outline, 0)).toBe(true)
  })

  it('does not force temporary replanning when no bridge is needed', () => {
    const outline = [
      { number: 1, title: '启程', description: '主角离开家乡。' },
      { number: 2, title: '遇敌', description: '主角遭遇敌人。' },
    ]

    expect(shouldForceTemporaryReplan(outline, 0)).toBe(false)
  })
})
