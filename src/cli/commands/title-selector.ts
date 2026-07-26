import inquirer from 'inquirer'
import { getGenreSkill } from '../../genres/registry.js'
import type { JsonSchema, ModelProvider } from '../../model/provider.js'
import type { WorldDirection, WritingConstraints } from '../../types/story.js'

export interface TitleOption {
  title: string
  synopsis?: string
  writingConstraints?: WritingConstraints
  worldDirection: WorldDirection
}

const TITLE_OPTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '书名，要新颖、有吸引力、符合题材' },
          synopsis: {
            type: 'string',
            description: '新书简介，2-4句，概括主角处境、核心冲突、主要看点和叙事承诺',
          },
          writingConstraints: {
            type: 'object',
            description:
              '从故事概要中提取的全书写作形式硬约束；只有用户明确要求某种叙事形式、章节开头形式或全书写法时填写',
            properties: {
              chapterOpening: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['letter', 'diary', 'document', 'custom'],
                    description: '每章开头形式',
                  },
                  required: { type: 'boolean', description: '是否为每章必须遵守的硬约束' },
                  instruction: {
                    type: 'string',
                    description: '给章节写作者的具体执行要求',
                  },
                },
                required: ['type', 'required', 'instruction'],
              },
              globalRules: {
                type: 'array',
                items: { type: 'string' },
                description: '其他全书层面的写作形式或风格硬约束',
              },
            },
          },
          worldDirection: {
            type: 'object',
            properties: {
              coreConflict: { type: 'string', description: '核心冲突描述' },
              worldFeatures: {
                type: 'array',
                minItems: 2,
                maxItems: 4,
                items: { type: 'string' },
                description: '2-4个独特的世界观元素',
              },
              powerSystem: {
                type: 'string',
                description: '独立的力量/规则体系（可选）',
              },
              hasPowerSystem: {
                type: 'boolean',
                description:
                  '该方案是否有独立的力量/规则体系；没有时请设为 false 并将 powerSystem 留空',
              },
            },
            required: ['coreConflict', 'worldFeatures'],
          },
        },
        required: ['title', 'synopsis', 'worldDirection'],
      },
      description: '3-5个不同的候选方案',
    },
  },
  required: ['options'],
}

const TITLE_SELECTION_PROMPT = `你是一位资深的书名策划师。根据以下故事概要，提供 3-5 个候选书名和对应的世界观方向。

故事概要：{idea}
总章节数：{totalChapters}
题材：{genre}

要求：
- 书名要新颖、有吸引力、符合题材
- 世界观方向要各有特色，角度不同
- synopsis 是新书简介，需用 2-4 句概括主角处境、核心冲突、主要看点和叙事承诺；不要复述用户输入，也不要剧透结局
- 如果故事概要中明确提出全书写作形式要求（例如每章开头形式、嵌套叙事形式、固定叙述框架），必须提取到 writingConstraints；没有明确要求时可以省略 writingConstraints
- 候选书名应使用不同的核心意象和修辞风格，避免多个选项重复使用同一字或同类比喻
- coreConflict 点出核心矛盾
- worldFeatures 列出 2-4 个独特的世界观元素
- 必须返回 3-5 个不同的候选方案
- 每个候选方案必须包含 hasPowerSystem 字段（boolean）：若有独立的力量/规则体系则设为 true，并在 powerSystem 中描述；若没有则设为 false 并将 powerSystem 留空，相关细节请放入 worldFeatures`

function getGenreConstraints(genre: string): string {
  const skill = getGenreSkill(genre)
  const displayName = skill?.displayName || genre

  if (skill?.constraints) {
    return `题材约束：这是${displayName}题材。${skill.constraints}`
  }

  return `题材约束：这是${displayName}题材，请确保世界观和冲突符合该题材的典型特征。`
}

function hasCompleteTitleOptions(value: unknown): value is TitleOption[] {
  if (!Array.isArray(value) || value.length < 3) return false
  return value.every(
    (option) =>
      option &&
      typeof option === 'object' &&
      typeof (option as TitleOption).title === 'string' &&
      typeof (option as TitleOption).synopsis === 'string' &&
      (option as TitleOption).synopsis!.trim().length > 0 &&
      Boolean((option as TitleOption).worldDirection)
  )
}

export async function generateTitleOptions(
  provider: ModelProvider,
  idea: string,
  genre: string,
  totalChapters: number
): Promise<TitleOption[]> {
  const skill = getGenreSkill(genre)
  const displayName = skill?.displayName || genre

  const userContent = TITLE_SELECTION_PROMPT.replace('{idea}', idea)
    .replace('{totalChapters}', String(totalChapters))
    .replace('{genre}', `${genre}（${displayName}）`)

  const genreConstraint = getGenreConstraints(genre)

  const messages = [
    {
      role: 'system' as const,
      content: `你是一位资深的小说策划师，擅长起书名和构建世界观。\n\n${genreConstraint}`,
    },
    { role: 'user' as const, content: userContent },
  ]

  const MAX_RETRIES = 2
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const parsed = await provider.chatStructured!<{ options?: unknown }>(
      messages,
      TITLE_OPTION_SCHEMA,
      0.8
    )

    if (hasCompleteTitleOptions(parsed.options)) {
      return parsed.options
    }

    if (attempt < MAX_RETRIES) {
      const optionCount = Array.isArray(parsed.options) ? parsed.options.length : 0
      const missingSynopsisCount = Array.isArray(parsed.options)
        ? parsed.options.filter(
            (option: unknown) =>
              !option ||
              typeof option !== 'object' ||
              typeof (option as TitleOption).synopsis !== 'string' ||
              !(option as TitleOption).synopsis!.trim()
          ).length
        : 0
      messages.push({
        role: 'user' as const,
        content: `上一次的方案不完整：候选数量 ${optionCount} 个，缺少新书简介的候选 ${missingSynopsisCount} 个。请严格按照要求返回 3-5 个不同的候选书名、新书简介和世界方向，不要省略 synopsis。`,
      })
    }
  }

  throw new Error(
    'AI 返回的标题选项数量不足或缺少新书简介：多次尝试后仍未满足要求。请检查模型是否支持结构化输出，或稍后重试。'
  )
}

export async function selectTitleOption(
  options: TitleOption[],
  genre: string = 'default'
): Promise<TitleOption> {
  const choices: Array<{ name: string; value: number } | InstanceType<typeof inquirer.Separator>> =
    [
      ...options.map((opt, index) => ({
        name: formatOptionForDisplay(opt, index + 1, genre),
        value: index,
      })),
      new inquirer.Separator(),
      { name: '重新生成选项', value: -1 },
    ]

  const answer = await (inquirer.prompt as any)([
    {
      type: 'rawlist',
      name: 'selectedIndex',
      message: '请选择书名和世界观方向：',
      choices,
      pageSize: 10,
    },
  ])

  const selectedIndex = answer.selectedIndex as number

  if (selectedIndex === -1) {
    throw new Error('REGENERATE')
  }

  const selected = options[selectedIndex]
  if (!selected) {
    throw new Error('无效的选择')
  }

  return selected
}

function formatOptionForDisplay(option: TitleOption, number: number, _genre?: string): string {
  const features = option.worldDirection.worldFeatures.join('、')
  const powerSystem = option.worldDirection.powerSystem?.trim()
  // 以结构化字段为准：hasPowerSystem=false 或 powerSystem 为空即不展示规则体系
  const isEmptyPowerSystem = !powerSystem || option.worldDirection.hasPowerSystem === false
  const powerLine = !isEmptyPowerSystem ? `规则体系：${powerSystem} | ` : ''
  const synopsisLine = option.synopsis?.trim() ? `简介：${option.synopsis.trim()} | ` : ''
  const chapterOpeningInstruction =
    option.writingConstraints?.chapterOpening?.required === true
      ? option.writingConstraints.chapterOpening.instruction.trim()
      : ''
  const writingConstraintsLine = chapterOpeningInstruction
    ? `写作形式：${chapterOpeningInstruction} | `
    : ''
  return `${number}. ${option.title} | ${synopsisLine}${writingConstraintsLine}${powerLine}核心冲突：${option.worldDirection.coreConflict} | 世界观特色：${features}`
}
