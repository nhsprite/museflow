export const FIX_OUTPUT_RULES = `<fix_output_rules>
<mandatory>【必须】修复输出要求</mandatory>
- 只输出修改后的正文内容或指定句子/段落。
- 不要输出任何辅助性内容，包括但不限于问题分析、修复建议、修改方案、检查表、清单或表格。
- 修改时必须彻底替换原句/原段落，绝不允许原句和新句同时存在。
- 修改后通读上下文，确保没有句子重复出现。
</fix_output_rules>`

export const SEVERITY_INSTRUCTIONS = `<severity_instructions>
- 只有真正影响阅读理解的严重问题才报 error。
- 一般性质量问题或轻微不一致报 warning。
- 建议性意见报 info。
- 请严格控制 error 数量。
- 正面评价必须放入 strengths，严禁放入 issues。
- 如果某个维度没有问题，直接不写对应的 issue，不要写"未发现问题"的 issue。
- Do not emit issues that merely state a dimension is fine, good, satisfactory, or has no problems.
</severity_instructions>`
