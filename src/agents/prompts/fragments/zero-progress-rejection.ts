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
【连续零增量章节 - 大纲重生成】截至上一版大纲，已连续 ${rejection.consecutiveZeroIncrementChapters} 章没有产生任何故事状态或情节增量（角色位置/状态、物品持有人/状态、伏笔埋设/兑现/延期、任务开启/关闭、mandatory beat 推进全部为零）：
${renderEventCounts(rejection.recentChapterEventCounts)}
上一版大纲把本章组织成了无事件章节。本轮必须围绕一个可观察的变化重新组织本章：让角色或物品的位置/状态发生转移、埋下或兑现伏笔、开启或关闭任务、或实质推进当前幕的 mandatory beat，使本章至少产生一条成立的结构化事件；仅描写氛围、等待、既有信息复述或心理活动而不改变任何状态，同样会被判为零增量并再次打回。情节处于等待期时用时间跳跃压缩等待，让下一个实质事件在本章发生。
${currentOutline}
</zero_progress_rejection>`
}
