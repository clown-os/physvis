// 三家 REST provider 的极简适配（BYOK 直连，无后端）。
// 统一错误：HTTP 非 2xx → AIParseError{kind:'http',status}；网络异常 → kind:'network'。
import type { AIParseError } from '../types'

export function httpError(status: number, body: string, url: string): AIParseError {
  const snippet = body.slice(0, 300).replace(/\s+/g, ' ')
  const detail = status === 401 ? '（API Key 无效或缺失）'
    : status === 403 ? '（无权限，浏览器直调可能被该厂商 CORS 拦截——见设置页说明）'
    : status === 429 ? '（请求过于频繁/额度不足）'
    : ''
  return { kind: 'http', status, message: `HTTP ${status} ${detail}\n${url}\n${snippet}` }
}

export async function httpJson(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<{ json: unknown; raw: string }> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    throw { kind: aborted ? 'canceled' : 'network', message: aborted ? '已取消' : `网络请求失败：${e instanceof Error ? e.message : e}（若为 CORS 错误请查看设置页各厂商说明）` } as AIParseError
  }
  const raw = await res.text()
  if (!res.ok) throw httpError(res.status, raw, url)
  try {
    return { json: JSON.parse(raw), raw }
  } catch {
    throw { kind: 'invalid-json', message: '服务端返回的不是合法 JSON', raw } as AIParseError
  }
}
