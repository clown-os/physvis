// OpenAI 兼容协议（OpenAI / DeepSeek / 本地 Ollama 同构）。
import type { ParseOptions } from '../types'
import { httpJson } from './rest'

export async function chatCompletion(opts: ParseOptions): Promise<string> {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  const model = opts.model ?? 'deepseek-chat'
  // 视觉输入（题目截图）：OpenAI 兼容协议的 image_url 内容块
  const userContent: unknown =
    opts.images && opts.images.length > 0
      ? [
          { type: 'text', text: opts.prompt },
          ...opts.images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ]
      : opts.prompt
  const { json } = await httpJson(
    `${base}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: opts.maxTokens ?? 4000,
        messages: [{ role: 'user', content: userContent }],
      }),
    },
    opts.signal,
  )
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw { kind: 'invalid-json', message: '模型返回为空（choices[0].message.content 缺失）' } as import('../types').AIParseError
  }
  return content
}
