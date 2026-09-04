// 图表数据提取：把引擎 Float32Array 轨道转为 Chart.js 系列。
// 长时程场景降采样到 ~每图 600 点（窗口 min/max 保尖峰：反弹/碰撞瞬间不错过）。
import type { EngineResult } from '../../engine/types'

export type Quantity = 'px' | 'py' | 'vx' | 'vy' | 'ax' | 'ay'

const COMP: Record<Quantity, number> = { px: 0, py: 1, vx: 2, vy: 3, ax: 4, ay: 5 }

export interface SeriesPoint {
  x: number
  y: number
}

const MAX_POINTS = 600

/** 某物体某物理量的全系列（含降采样） */
export function trackSeries(
  result: EngineResult,
  objectId: string,
  qty: Quantity,
): SeriesPoint[] {
  const t = result.tracks[objectId]
  if (!t) return []
  const data = t.data
  const c = COMP[qty]
  const n = data.length / 6
  if (n <= MAX_POINTS) {
    const out: SeriesPoint[] = new Array(n)
    for (let i = 0; i < n; i++) out[i] = { x: i * result.dt, y: data[i * 6 + c]! }
    return out
  }
  // 窗口 min/max（直接作用 Float32Array，避免整条拷贝）
  const win = Math.ceil(n / MAX_POINTS)
  const out: SeriesPoint[] = []
  for (let i = 0; i < n; i += win) {
    const end = Math.min(n, i + win)
    let minI = i
    let maxI = i
    for (let j = i + 1; j < end; j++) {
      const v = data[j * 6 + c]!
      if (v < data[minI * 6 + c]!) minI = j
      if (v > data[maxI * 6 + c]!) maxI = j
    }
    if (minI === maxI) {
      out.push({ x: minI * result.dt, y: data[minI * 6 + c]! })
    } else if (minI < maxI) {
      out.push({ x: minI * result.dt, y: data[minI * 6 + c]! }, { x: maxI * result.dt, y: data[maxI * 6 + c]! })
    } else {
      out.push({ x: maxI * result.dt, y: data[maxI * 6 + c]! }, { x: minI * result.dt, y: data[minI * 6 + c]! })
    }
  }
  return out
}
