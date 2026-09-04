// 版本化 localStorage 持久化（设置/Key/校正模板等）。
// 规则：
// - 所有键统一前缀 `physvis:`，避免与其他应用冲突；
// - 每份数据带 schemaVersion，读入时版本不符 → 丢弃并回退默认（静默升级）；
// - 读写全程 try/catch（隐私模式/配额超限不崩溃）。
const PREFIX = 'physvis:'

interface Envelope<T> {
  v: number
  data: T
}

export function loadPersisted<T>(key: string, version: number): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const env = JSON.parse(raw) as Envelope<T>
    if (typeof env !== 'object' || env === null || env.v !== version) return null
    return env.data
  } catch {
    return null
  }
}

export function savePersisted<T>(key: string, version: number, data: T): void {
  try {
    const env: Envelope<T> = { v: version, data }
    localStorage.setItem(PREFIX + key, JSON.stringify(env))
  } catch {
    // 忽略（存储不可用/满）
  }
}

export function clearPersisted(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // 忽略
  }
}
