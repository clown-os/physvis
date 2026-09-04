// Anthropic Claude：浏览器直调需显式声明 dangerouslyAllowBrowser 请求头。
import type { AIParseError, ParseOptions } from '../types'
import { httpJson } from './rest'

export async function anthropicCompletion(opts: ParseOptions): Promise<string> {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  // 视觉输入：Anthropic Messages 的图像块（base64 数据块放在文本之前）
  const content: unknown =
    opts.images && opts.images.length > 0
      ? [
          ...opts.images.map((img) => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mimeType,
              data: img.dataUrl.replace(/^data:[^;]+;base64,/, ''),
            },
          })),
          { type: 'text', text: opts.prompt },
        ]
      : opts.prompt
  const { json } = await httpJson(
    `${base}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: opts.model ?? 'claude-sonnet-4-5',
        max_tokens: opts.maxTokens ?? 4000,
        temperature: 0.2,
        messages: [{ role: 'user', content }],
      }),
    },
    opts.signal,
  )
  const parts = (json as { content?: Array<{ type?: string; text?: unknown }> })?.content
  const text = parts?.find((p) => p.type === 'text')?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw { kind: 'invalid-json', message: '模型返回为空（content[].text 缺失）' } as AIParseError
  }
  return text
}
