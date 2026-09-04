// Mock provider（离线演示）：不调任何网络。
// 输入与内置示例题题干（全文包含匹配）一致时，把对应场景逆向成模型输出。
// 其余输入返回 kind:'mock-miss'，提示选用示例题或配置真实 API。
// 校正轮（第二次解析同一文本）固定返回高置信版本 → 演示"人工反馈 → 修正成功"闭环。
import type { AIParseError, ParseOptions, ParsedResult } from '../types'
import { EXAMPLE_PROBLEMS } from '../../examples/problems'
import { instantiate } from '../../engine/scenarios'
import { applyValues } from '../../engine/scenarios'
import { defToParsed } from '../defToParsed'

function norm(s: string): string {
  return s.replace(/[\s　，。、！？；：""''（）【】《》\-—…·~.。]/g, '').toLowerCase()
}

const samples = EXAMPLE_PROBLEMS.map((ex) => {
  const inst = instantiate(ex.templateId)
  if (!inst) return null
  const def = ex.values ? applyValues(inst.def, inst.params, ex.values) : inst.def
  return { id: ex.id, title: ex.title, text: norm(ex.text), def, mockConfidence: ex.mockConfidence, solution: ex.solution }
}).filter((x): x is NonNullable<typeof x> => x !== null)

let lastSampleId: string | null = null

export async function mockCompletion(opts: ParseOptions): Promise<string> {
  // 找到与题干匹配的内置示例（全文归一化后包含判定）
  const input = norm(opts.prompt)
  const hit = samples
    .filter((s) => input.includes(s.text))
    .sort((a, b) => b.text.length - a.text.length)[0]
  if (!hit) {
    const e: AIParseError = {
      kind: 'mock-miss',
      message:
        `本地演示版只认识内置的 ${EXAMPLE_PROBLEMS.length} 道示例题的文本（请点右上「示例题」挑选并粘贴原文，或复制示例题干试试）。`
        + (opts.images && opts.images.length > 0
          ? '图片识别需要真实视觉模型，mock 通道不读图：请到「设置」配置支持视觉的 API。'
          : '其他题目请在「设置」中配置 DeepSeek/OpenAI 等 API Key。'),
    }
    throw e
  }

  // 第二次解析同一道题：演示"反馈修正后通过"
  const correctionRound = lastSampleId === hit.id
  lastSampleId = hit.id

  const parsed: ParsedResult = defToParsed(hit.def)
  parsed.confidence = hit.mockConfidence !== undefined && !correctionRound ? hit.mockConfidence : 0.97
  parsed.title = `${hit.title}（本地演示解析${correctionRound ? '· 已按反馈修正' : ''}）`
  if (hit.solution?.length) parsed.solution = hit.solution.map((s) => ({ ...s }))
  return JSON.stringify(parsed)
}
