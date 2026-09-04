// provider 分发：mock → 离线实现；deepseek/openai → OpenAI 兼容协议；其余直连。
import type { ParseOptions, ProviderId } from '../types'
import { mockCompletion } from './mock'
import { chatCompletion } from './openaiCompat'
import { anthropicCompletion } from './anthropic'
import { googleCompletion } from './google'

/** 调用当前 provider 取模型原文（未做 JSON 校验——校验在 flow 层） */
export function callProvider(id: ProviderId, opts: ParseOptions): Promise<string> {
  switch (id) {
    case 'mock':
      return mockCompletion(opts)
    case 'deepseek':
    case 'openai':
      return chatCompletion(opts)
    case 'anthropic':
      return anthropicCompletion(opts)
    case 'google':
      return googleCompletion(opts)
    default:
      return Promise.reject({ kind: 'network', message: `未知 Provider：${String(id)}` })
  }
}
