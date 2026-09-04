// Google Gemini：key 走 query 参数，浏览器可直调。
import type { ParseOptions } from '../types'
import { httpJson } from './rest'

export async function googleCompletion(opts: ParseOptions): Promise<string> {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  const model = opts.model ?? 'gemini-2.5-flash'
  const key = opts.apiKey ?? ''
  const url = `${base}/models/${model}:generateContent${key ? `?key=${encodeURIComponent(key)}` : ''}`
  // 视觉输入：Gemini inlineData 块（图像放在文本之前）
  const parts: unknown[] =
    opts.images && opts.images.length > 0
      ? [
          ...opts.images.map((img) => ({
            inlineData: {
              mimeType: img.mimeType,
              data: img.dataUrl.replace(/^data:[^;]+;base64,/, ''),
            },
          })),
          { text: opts.prompt },
        ]
      : [{ text: opts.prompt }]
  const { json } = await httpJson(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: opts.maxTokens ?? 4000 },
      }),
    },
    opts.signal,
  )
  const text = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })
    ?.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw { kind: 'invalid-json', message: '模型返回为空（candidates[0].content.parts 缺失）' }
  }
  return text
}
