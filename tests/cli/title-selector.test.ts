import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockChat = vi.fn()
const mockChatStructured = vi.fn()

// Mock inquirer before importing title-selector
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn().mockResolvedValue({ selectedIndex: 0 }),
    Separator: vi.fn().mockImplementation(() => ({ type: 'separator', separator: true })),
  },
}))

// Mock the model registry with a singleton provider so tests can inspect/replace chatStructured
vi.mock('../../src/model/registry.js', () => ({
  createProvider: () => ({
    chat: mockChat,
    chatStructured: mockChatStructured,
  }),
}))

import { generateTitleOptions, selectTitleOption, type TitleOption } from '../../src/cli/commands/title-selector.ts'
import { createProvider } from '../../src/model/registry.js'

describe('title-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatStructured.mockResolvedValue({
      options: [
        {
          title: '《逆天改命》',
          worldDirection: {
            powerSystem: '凡境→灵境→仙境',
            coreConflict: '资源争夺、宗门秘宝',
            worldFeatures: ['中土大陆', '灵气衰退'],
          },
        },
        {
          title: '《凡人之躯》',
          worldDirection: {
            powerSystem: '炼体、炼气、炼神三阶段',
            coreConflict: '人与天斗、阶级固化',
            worldFeatures: ['偏远山村', '世俗王朝'],
          },
        },
        {
          title: '《破妄之剑》',
          worldDirection: {
            powerSystem: '剑修为尊；剑意凝兵',
            coreConflict: '正邪两道、师门恩怨',
            worldFeatures: ['万剑山脉', '剑冢禁地'],
          },
        },
      ],
    })
  })

  describe('TitleOption types', () => {
    it('has correct shape for title option', () => {
      const option: TitleOption = {
        title: '《逆天改命》',
        worldDirection: {
          powerSystem: '凡境→灵境→仙境',
          coreConflict: '资源争夺、宗门秘宝',
          worldFeatures: ['中土大陆', '灵气衰退'],
        },
      }
      expect(option.title).toBe('《逆天改命》')
      expect(option.worldDirection.powerSystem).toBe('凡境→灵境→仙境')
      expect(option.worldDirection.worldFeatures).toHaveLength(2)
    })
  })

  describe('generateTitleOptions', () => {
    it('returns array of TitleOption with 3-5 items', async () => {
      const options = await generateTitleOptions(
        '一个少年获得修真能力后崛起为最强者的故事',
        'xianxia',
        10
      )

      expect(options).toBeInstanceOf(Array)
      expect(options.length).toBeGreaterThanOrEqual(3)
      expect(options.length).toBeLessThanOrEqual(5)

      const firstOption = options[0]
      expect(firstOption).toHaveProperty('title')
      expect(firstOption).toHaveProperty('worldDirection')
      expect(firstOption.worldDirection).toHaveProperty('powerSystem')
      expect(firstOption.worldDirection).toHaveProperty('coreConflict')
      expect(firstOption.worldDirection).toHaveProperty('worldFeatures')
      expect(firstOption.worldDirection.worldFeatures).toBeInstanceOf(Array)
    })

    it('parses AI response correctly', async () => {
      const options = await generateTitleOptions(
        '一个少年获得修真能力后崛起为最强者的故事',
        'xianxia',
        10
      )

      const firstOption = options.find(o => o.title.includes('逆天改命'))
      expect(firstOption).toBeDefined()
      expect(firstOption!.worldDirection.powerSystem).toContain('凡境')
    })

    it('retries when AI returns fewer than 3 options', async () => {
      mockChatStructured
        .mockResolvedValueOnce({ options: [{ title: '单选项', worldDirection: { coreConflict: '单一冲突', worldFeatures: ['元素一'] } }] })
        .mockResolvedValueOnce({ options: [
          { title: '《选项一》', worldDirection: { coreConflict: '冲突一', worldFeatures: ['元素一'] } },
          { title: '《选项二》', worldDirection: { coreConflict: '冲突二', worldFeatures: ['元素二'] } },
          { title: '《选项三》', worldDirection: { coreConflict: '冲突三', worldFeatures: ['元素三'] } },
        ]})

      const options = await generateTitleOptions(
        '一个少年获得修真能力后崛起为最强者的故事',
        'xianxia',
        10
      )

      expect(options).toHaveLength(3)
      expect(mockChatStructured).toHaveBeenCalledTimes(2)
    })

    it('throws after exhausting retries', async () => {
      mockChatStructured.mockResolvedValue({ options: [{ title: '单选项', worldDirection: { coreConflict: '单一冲突', worldFeatures: ['元素一'] } }] })

      await expect(generateTitleOptions('idea', 'default', 10)).rejects.toThrow('标题选项数量不足')
    })
  })

  describe('selectTitleOption', () => {
    let inquirer: typeof import('inquirer')

    beforeEach(async () => {
      inquirer = await import('inquirer')
      vi.mocked(inquirer.default.prompt).mockResolvedValue({ selectedIndex: 0 })
      vi.mocked(inquirer.default.Separator).mockImplementation(() => ({ type: 'separator', separator: true }))
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns a TitleOption when user selects one', async () => {
      const options: TitleOption[] = [
        {
          title: '《逆天改命》',
          worldDirection: {
            powerSystem: '凡境→灵境→仙境',
            coreConflict: '资源争夺',
            worldFeatures: ['中土大陆'],
          },
        },
      ]

      const result = await selectTitleOption(options)
      expect(result.title).toBe('《逆天改命》')
    })

    it('displays "规则体系" label when power system is present', async () => {
      const options: TitleOption[] = [
        {
          title: '《逆天改命》',
          worldDirection: {
            powerSystem: '凡境→灵境→仙境',
            coreConflict: '资源争夺',
            worldFeatures: ['中土大陆'],
          },
        },
      ]

      await selectTitleOption(options, 'xianxia')

      const promptArg = vi.mocked(inquirer.default.prompt).mock.calls[0]?.[0]
      const question = promptArg?.[0]
      expect(question?.choices?.[0]?.name).toContain('规则体系：凡境→灵境→仙境')
    })

    it('hides power system line when powerSystem is empty or starts with "无体系"', async () => {
      const options: TitleOption[] = [
        {
          title: '《血符京华》',
          worldDirection: {
            powerSystem: '无体系，萨满巫术以血祭反噬',
            coreConflict: '复仇唤醒血脉诅咒',
            worldFeatures: ['咒道', '阴兵'],
          },
        },
      ]

      await selectTitleOption(options, 'horror')

      const promptArg = vi.mocked(inquirer.default.prompt).mock.calls[0]?.[0]
      const question = promptArg?.[0]
      expect(question?.choices?.[0]?.name).not.toContain('规则体系')
      expect(question?.choices?.[0]?.name).not.toContain('修炼体系')
      expect(question?.choices?.[0]?.name).toContain('核心冲突：复仇唤醒血脉诅咒')
    })

    it('displays "规则体系" label for non-xianxia/fantasy genres when system is present', async () => {
      const options: TitleOption[] = [
        {
          title: '《诅咒规则》',
          worldDirection: {
            powerSystem: '血咒需至亲之血为引，每次反噬心智',
            coreConflict: '复仇唤醒血脉诅咒',
            worldFeatures: ['咒道', '阴兵'],
          },
        },
      ]

      await selectTitleOption(options, 'horror')

      const promptArg = vi.mocked(inquirer.default.prompt).mock.calls[0]?.[0]
      const question = promptArg?.[0]
      expect(question?.choices?.[0]?.name).toContain('规则体系：血咒需至亲之血为引，每次反噬心智')
      expect(question?.choices?.[0]?.name).not.toContain('修炼体系')
    })

    it('uses an inquirer separator before the regenerate option', async () => {
      const options: TitleOption[] = [
        {
          title: '《逆天改命》',
          worldDirection: {
            powerSystem: '凡境→灵境→仙境',
            coreConflict: '资源争夺',
            worldFeatures: ['中土大陆'],
          },
        },
      ]

      await selectTitleOption(options)

      expect(inquirer.default.Separator).toHaveBeenCalledTimes(1)

      const promptArg = vi.mocked(inquirer.default.prompt).mock.calls[0]?.[0]
      expect(Array.isArray(promptArg)).toBe(true)

      const question = promptArg?.[0]
      expect(question?.choices).toEqual([
        expect.objectContaining({ value: 0 }),
        { type: 'separator', separator: true },
        expect.objectContaining({ name: '重新生成选项', value: -1 }),
      ])
    })

    it('throws REGENERATE error when user chooses regenerate', async () => {
      vi.mocked(inquirer.default.prompt).mockResolvedValue({ selectedIndex: -1 })

      const options: TitleOption[] = [
        {
          title: '《逆天改命》',
          worldDirection: {
            powerSystem: '凡境→灵境→仙境',
            coreConflict: '资源争夺',
            worldFeatures: ['中土大陆'],
          },
        },
      ]

      await expect(selectTitleOption(options)).rejects.toThrow('REGENERATE')
    })
  })
})
