import type { ZeroProgressRejection } from '../../types.js'

function renderEventCounts(counts: ZeroProgressRejection['recentChapterEventCounts']): string {
  return counts
    .map((item) => `- 第 ${item.chapterIndex + 1} 章已接受结构化事件数：${item.acceptedEventCount}`)
    .join('\n')
}

/**
 * 跨章零增量闸（C.2.2）升级后的大纲重生成反馈区块。
 * 只呈现结构化计数与当前大纲文本，不做任何正文语义判断。
 */
export function buildZeroProgressRejectionSection(input: {
  zeroProgressRejection?: ZeroProgressRejection
}): string {
  const rejection = input.zeroProgressRejection
  if (!rejection) return ''

  const currentOutline = rejection.currentOutline
    ? `- currentOutline.title: ${rejection.currentOutline.title}\n- currentOutline.description: ${rejection.currentOutline.description}`
    : ''

  if (rejection.narrativeProgress) {
    return `<narrative_progress_rejection>
【跨章叙事停滞 - 大纲重生成】最近正文持续重复既有局面，结构事件数量不能替代情节推进。
${rejection.narrativeProgress.map((chapter) => `- 第 ${chapter.chapterIndex + 1} 章：${chapter.explanation}（正文段落索引 ${chapter.evidenceParagraphs.join(', ')}）`).join('\n')}
重新组织当前章的目标、阻碍、选择及其后果，承接前文形成新的处境。有效的新信息、关系变化和内在决定也可推进叙事；不强求动作场面。不要仅移动物品、添加名字、延期或换措辞来满足计数，不得篡改已定稿事实。
${currentOutline}
</narrative_progress_rejection>`
  }

  return `<zero_progress_rejection>
【连续零增量章节 - 大纲重生成】截至上一版大纲，已连续 ${rejection.consecutiveZeroIncrementChapters} 章没有结构化状态增量，且未取得审计认可的非状态推进凭证。这可能是已发生的变化漏记，也可能是正文未推进，不能仅凭事件计数断言原因。
${renderEventCounts(rejection.recentChapterEventCounts)}
${rejection.currentNarrativeAssessment ? `本章审计：verdict=${rejection.currentNarrativeAssessment.verdict}，recording=${rejection.currentNarrativeAssessment.recording}；${rejection.currentNarrativeAssessment.explanation}` : ''}
先核对正文已发生的变化：若推进依赖事件协议可记录的事实，应在规划中准确登记并由正文证据支撑，不得为了达到计数而虚构事件。若正文确实停滞，再围绕新的目标、阻碍、信息、选择及其后果组织当前章，压缩重复等待。新的内在决定和关系理解也可构成有效推进，但须由正文相对前文的变化证明，并通过非状态推进审计；不能只重复心理活动或声称有成长。不得用心理描写绕过应记事实、必需情节节点或已定稿前文约束。
${currentOutline}
</zero_progress_rejection>`
}
