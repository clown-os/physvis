// 相机：世界坐标（米，y 向上）↔ 屏幕像素（y 向下）变换。
// scale: 像素/米；offX/offY: 世界原点在屏幕中的像素位置。
import type { EngineResult } from './types'
import { readTrack } from './Engine'

export interface Camera {
  /** px per meter */
  scale: number
  /** 世界原点在视口内的像素位置（屏幕系） */
  offX: number
  offY: number
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: cam.offX + wx * cam.scale, y: cam.offY - wy * cam.scale }
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - cam.offX) / cam.scale, y: (cam.offY - sy) / cam.scale }
}

export interface WorldBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** 全轨迹包围盒（含半径与地面线），空场景返回默认范围 */
export function computeSceneBounds(result: EngineResult): WorldBounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const groundY = result.def.world.groundY

  for (const id of result.order) {
    const t = result.tracks[id]!
    const n = t.data.length / 6
    const stride = Math.max(1, Math.floor(n / 600)) // 采样稀疏化（大场景）
    for (let i = 0; i < n; i += stride) {
      const s = readTrack(t.data, i)
      minX = Math.min(minX, s.x - t.radius)
      maxX = Math.max(maxX, s.x + t.radius)
      minY = Math.min(minY, s.y - t.radius)
      maxY = Math.max(maxY, s.y + t.radius)
    }
  }
  if (groundY !== undefined) {
    minY = Math.min(minY, groundY - 0.05)
    if (maxY === -Infinity) maxY = groundY + 10
  }
  // 地面水平线展示范围：含原点
  minX = Math.min(minX, 0)
  maxX = Math.max(maxX, 1)
  if (!Number.isFinite(minX) || !Number.isFinite(maxY)) {
    return { minX: -6, maxX: 6, minY: -1, maxY: 8 }
  }
  return { minX, maxX, minY, maxY }
}

/** 自适应取景：把 bounds 塞进视口（留边距 padRatio），返回新相机 */
export function autoFit(
  bounds: WorldBounds,
  viewportW: number,
  viewportH: number,
  padRatio = 0.12,
): Camera {
  const padX = Math.max(viewportW * padRatio, 40)
  const padY = Math.max(viewportH * padRatio, 40)
  const availW = Math.max(10, viewportW - padX * 2)
  const availH = Math.max(10, viewportH - padY * 2)
  const bw = Math.max(0.5, bounds.maxX - bounds.minX)
  const bh = Math.max(0.5, bounds.maxY - bounds.minY)
  const scale = Math.min(availW / bw, availH / bh)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    scale,
    offX: viewportW / 2 - cx * scale,
    offY: viewportH / 2 + cy * scale,
  }
}

export const DEFAULT_CAMERA: Camera = { scale: 40, offX: 0, offY: 0 }
