// 主画布：世界渲染 + 相机交互。rAF 每帧直读 store（零 React 重渲染），
// 只有结果版本变化（场景/参数改动）时组件才订阅 configVersion 做 autoFit。
import { useCallback, useEffect, useRef } from 'react'
import { FORCE_COLORS, deriveForces } from '../engine/forces'
import type { ForceVec } from '../engine/types'
import {
  DEFAULT_CAMERA,
  autoFit,
  computeSceneBounds,
  screenToWorld,
  worldToScreen,
  type Camera,
} from '../engine/camera'
import { useSimulationStore } from '../stores/simulationStore'
import { useUIStore } from '../stores/uiStore'
import { useSimulationLoop } from './useSimulationLoop'
import type { EngineResult, ObjectTrack } from '../engine/types'

/** 力箭头视觉比例：米/牛顿（10N ≈ 1.2m ≈ 48px @40px/m） */
const FORCE_SCALE = 0.12
const MIN_FORCE_PX = 4
const TAU = Math.PI * 2

export interface CanvasHandle {
  resetView: () => void
}

interface Props {
  /** 挂载后可用 onReady 暴露 resetView（工具栏"复位视角"按钮） */
  onReady?: (h: CanvasHandle) => void
}

export default function SimulationCanvas({ onReady }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef<Camera>({ ...DEFAULT_CAMERA })
  const configVersion = useSimulationStore((s) => s.configVersion)
  const lastVersion = useRef(-1)
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  // 场景/参数变化 → 重新取景（仅当 autoFit 开启；用户手动缩放后不再覆盖）
  useEffect(() => {
    if (lastVersion.current === configVersion) return
    lastVersion.current = configVersion
    const view = useUIStore.getState().view
    const canvas = canvasRef.current
    const result = useSimulationStore.getState().result
    if (!canvas || !result || !view.autoFit) return
    const dpr = window.devicePixelRatio || 1
    camRef.current = autoFit(computeSceneBounds(result), canvas.width / dpr, canvas.height / dpr)
  }, [configVersion])

  const resetView = useCallback(() => {
    const canvas = canvasRef.current
    const result = useSimulationStore.getState().result
    if (!canvas || !result) return
    const dpr = window.devicePixelRatio || 1
    camRef.current = autoFit(computeSceneBounds(result), canvas.width / dpr, canvas.height / dpr)
  }, [])

  const readyRef = useRef(false)
  useEffect(() => {
    if (readyRef.current) return
    readyRef.current = true
    onReady?.({ resetView })
  }, [onReady, resetView])

  // 尺寸自适应（CSS 尺寸 × DPR）。
  // 注意：autoFit 依赖 canvas 像素尺寸——mount 早期 ResizeObserver 尚未把 canvas
  // 从默认 300×150 调到真实尺寸，若那时就按假视口取景，场景会被压缩在角落。
  // 因此首次拿到真实尺寸后强制重取景一次（此后窗口缩放不再重置用户视角）。
  const firstSized = useRef(false)
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      if (!firstSized.current) {
        firstSized.current = true
        const result = useSimulationStore.getState().result
        const view = useUIStore.getState().view
        if (result && view.autoFit) {
          camRef.current = autoFit(computeSceneBounds(result), rect.width, rect.height)
        }
      }
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // —— 主绘制 ——
  const draw = useCallback((simTime: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.width / dpr
    const H = canvas.height / dpr
    const cam = camRef.current
    const store = useSimulationStore.getState()
    const view = useUIStore.getState().view
    const result = store.result
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (!result) {
      ctx.fillStyle = '#f1f5f9'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '14px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('输入题目或选择一个示例开始模拟', W / 2, H / 2)
      return
    }

    const step = Math.max(0, Math.min(result.steps - 1, Math.round(simTime / result.dt)))
    drawGround(ctx, cam, result, W, H)
    if (view.showGrid) drawGrid(ctx, cam, W, H)
    if (view.showAxes) drawAxes(ctx, cam, W, H)
    if (view.showField) drawFieldHint(ctx, cam, result, W, H)
    drawConstraints(ctx, cam, result, step)
    drawRingOutlines(ctx, cam, result)
    for (const id of result.order) {
      const t = result.tracks[id]!
      drawTrack(ctx, cam, t, step)
    }
    for (const id of result.order) {
      const t = result.tracks[id]!
      drawObject(ctx, cam, t, step)
    }
    if (view.showForces) {
      for (const id of result.order) {
        const t = result.tracks[id]!
        if (t.def.motion.kind === 'static') continue
        const forces = deriveForces(result, id, step)
        drawForces(ctx, cam, forces, view.showNetForce, view.showForceValues)
      }
    }
  }, [])

  useSimulationLoop(draw, true)

  // —— 相机交互 ——
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const before = screenToWorld(camRef.current, mx, my)
      const next = Math.min(400, Math.max(4, camRef.current.scale * Math.exp(-e.deltaY * 0.0015)))
      camRef.current.scale = next
      camRef.current.offX = mx - before.x * next
      camRef.current.offY = my + before.y * next
    }
    const onDown = (e: PointerEvent) => {
      drag.current = { sx: e.clientX, sy: e.clientY, ox: camRef.current.offX, oy: camRef.current.offY }
      canvas.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return
      const cam = camRef.current
      cam.offX = drag.current.ox + (e.clientX - drag.current.sx)
      cam.offY = drag.current.oy + (e.clientY - drag.current.sy)
    }
    const onUp = () => {
      drag.current = null
    }
    const onDbl = (e: MouseEvent) => {
      e.preventDefault()
      resetView()
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('dblclick', onDbl)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('dblclick', onDbl)
    }
  }, [resetView])

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-slate-50 select-none"
      style={{ touchAction: 'none' }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-200">
        滚轮缩放 · 拖拽平移 · 双击复位
      </div>
    </div>
  )
}

/* ================= 子绘制 ================= */

/** 地面（含下方填充纹理） */
function drawGround(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  result: EngineResult,
  W: number,
  H: number,
): void {
  const gy = result.def.world.groundY
  if (gy === undefined) return
  const sy = worldToScreen(cam, 0, gy).y
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, Math.max(0, sy), W, Math.max(0, H - sy))
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, sy)
  ctx.lineTo(W, sy)
  ctx.stroke()
}

function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number): void {
  // 自适应网格步（目标 ≥ ~50px 一条）
  const raw = 50 / cam.scale
  const pow = 10 ** Math.floor(Math.log10(raw))
  const m = raw / pow
  const grid = pow * (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10)
  const top = screenToWorld(cam, 0, 0).y
  const bottom = screenToWorld(cam, 0, H).y
  const left = screenToWorld(cam, 0, 0).x
  const right = screenToWorld(cam, W, 0).x
  ctx.strokeStyle = '#eef2f6'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = Math.floor(left / grid) * grid; x <= right; x += grid) {
    const sx = worldToScreen(cam, x, 0).x
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, H)
  }
  for (let y = Math.floor(bottom / grid) * grid; y <= top; y += grid) {
    const sy = worldToScreen(cam, 0, y).y
    ctx.moveTo(0, sy)
    ctx.lineTo(W, sy)
  }
  ctx.stroke()
}

function drawAxes(ctx: CanvasRenderingContext2D, cam: Camera, W: number, H: number): void {
  const o = worldToScreen(cam, 0, 0)
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  if (o.x >= -8 && o.x <= W + 8) {
    ctx.moveTo(o.x, 0)
    ctx.lineTo(o.x, H)
  }
  if (o.y >= -8 && o.y <= H + 8) {
    ctx.moveTo(0, o.y)
    ctx.lineTo(W, o.y)
  }
  ctx.stroke()
  // 米刻度标签（防糊：仅当缩放到每米足够宽）
  if (cam.scale >= 16) {
    const top = screenToWorld(cam, 0, 0).y
    const bottom = screenToWorld(cam, 0, H).y
    const left = screenToWorld(cam, 0, 0).x
    const right = screenToWorld(cam, W, 0).x
    ctx.fillStyle = '#94a3b8'
    ctx.font = '9px system-ui, sans-serif'
    ctx.textBaseline = 'alphabetic'
    for (let x = Math.ceil(left); x <= Math.floor(right); x++) {
      const sx = worldToScreen(cam, x, 0).x
      if (sx < 22 || sx > W - 22) continue
      ctx.fillText(`${x}`, sx + 2, (o.y >= -2 && o.y <= H + 2 ? o.y : 10) + 10)
    }
    for (let y = Math.ceil(bottom); y <= Math.floor(top); y++) {
      const sy = worldToScreen(cam, 0, y).y
      if (sy < 12 || sy > H - 4) continue
      ctx.fillText(`${y}`, (o.x >= -2 && o.x <= W + 2 ? o.x : 8) + 3, sy + 3)
    }
  }
}

/** 电磁场背景提示层：E 用粉色箭头网格，B 用 ⊙/⊗ 符号网格（垂直纸面出/入） */
function drawFieldHint(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  result: EngineResult,
  W: number,
  H: number,
): void {
  const fields = result.def.world.fields
  if (!fields?.length) return
  // 可视世界范围（无 rect 的全空间场裁剪用）
  const top = screenToWorld(cam, 0, 0).y
  const bottom = screenToWorld(cam, 0, H).y
  const left = screenToWorld(cam, 0, 0).x
  const right = screenToWorld(cam, W, 0).x
  const gridStep = 1.4 // 世界米
  ctx.lineWidth = 1
  for (const f of fields) {
    const minX = f.rect ? Math.max(f.rect.minX, left) : left
    const maxX = f.rect ? Math.min(f.rect.maxX, right) : right
    const minY = f.rect ? Math.max(f.rect.minY, bottom) : bottom
    const maxY = f.rect ? Math.min(f.rect.maxY, top) : top
    if (minX > maxX || minY > maxY) continue
    if (f.rect) {
      // 区域边界（虚线）
      const a = worldToScreen(cam, f.rect.minX, f.rect.minY)
      const b = worldToScreen(cam, f.rect.maxX, f.rect.maxY)
      ctx.strokeStyle = '#94a3b880'
      ctx.setLineDash([5, 4])
      ctx.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y)
      ctx.setLineDash([])
    }
    if (f.electric) {
      const mag = Math.hypot(f.electric.x, f.electric.y)
      if (mag > 1e-9) {
        const ux = f.electric.x / mag
        const uy = f.electric.y / mag
        ctx.strokeStyle = '#db277780'
        ctx.fillStyle = '#db2777'
        ctx.beginPath()
        for (let x = minX; x <= maxX; x += gridStep) {
          for (let y = minY; y <= maxY; y += gridStep) {
            const p0 = worldToScreen(cam, x, y)
            const p1 = worldToScreen(cam, x + ux * 0.55, y + uy * 0.55)
            ctx.moveTo(p0.x, p0.y)
            ctx.lineTo(p1.x, p1.y)
            // 小箭头（朝 E 方向）
            const ang = Math.atan2(p0.y - p1.y, p1.x - p0.x)
            const h = 3.5
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p1.x - h * Math.cos(ang - 0.45), p1.y + h * Math.sin(ang - 0.45))
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p1.x - h * Math.cos(ang + 0.45), p1.y + h * Math.sin(ang + 0.45))
          }
        }
        ctx.stroke()
        // 区域标签
        const lbl = worldToScreen(cam, minX, maxY)
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText('E', lbl.x + 2, lbl.y + 2)
      }
    }
    if (f.magnetic !== undefined) {
      const sym = f.magnetic > 0 ? '⊙' : '⊗' // ⊙ 垂直纸面向外 · ⊗ 向里
      ctx.fillStyle = '#0d9488aa'
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let x = minX; x <= maxX; x += gridStep) {
        for (let y = minY; y <= maxY; y += gridStep) {
          const p = worldToScreen(cam, x, y)
          ctx.fillText(sym, p.x, p.y)
        }
      }
      const lbl = worldToScreen(cam, maxX, maxY)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillStyle = '#0d9488'
      ctx.fillText(`B ${f.magnetic > 0 ? '出' : '入'}`, lbl.x - 2, lbl.y + 2)
    }
  }
}

/** 圆环内壁轮廓（按 圆心+半径 去重：环内多球只画一次） */
function drawRingOutlines(ctx: CanvasRenderingContext2D, cam: Camera, result: EngineResult): void {
  const seen = new Set<string>()
  for (const id of result.order) {
    const t = result.tracks[id]!
    const m = t.def.motion
    if (m.kind !== 'numeric' || m.spec.contact?.type !== 'circle') continue
    const c = m.spec.contact
    const key = `${c.center.x.toFixed(4)},${c.center.y.toFixed(4)},${c.radius.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    const s = worldToScreen(cam, c.center.x, c.center.y)
    const r = c.radius * cam.scale
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 2
    ctx.setLineDash([7, 5])
    ctx.beginPath()
    ctx.arc(s.x, s.y, r, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function drawTrack(ctx: CanvasRenderingContext2D, cam: Camera, t: ObjectTrack, step: number): void {
  if (!useUIStore.getState().view.showTrajectory) return
  const data = t.data
  const n = data.length / 6
  const end = Math.max(0, Math.min(step, n - 1))
  const stride = Math.max(1, Math.floor(end / 900))
  ctx.strokeStyle = t.color + '66'
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.beginPath()
  let moved = false
  for (let i = 0; i <= end; i += stride) {
    const b = i * 6
    const sp = worldToScreen(cam, data[b]!, data[b + 1]!)
    if (!moved) {
      ctx.moveTo(sp.x, sp.y)
      moved = true
    } else ctx.lineTo(sp.x, sp.y)
  }
  ctx.stroke()
}

function drawConstraints(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  result: EngineResult,
  step: number,
): void {
  for (const id of result.order) {
    const t = result.tracks[id]!
    for (const c of t.def.constraints ?? []) {
      const other = result.tracks[c.otherId]
      if (!other) continue
      // 每条边只画一次（按 order 序小端画）
      if (result.order.indexOf(other.id) < result.order.indexOf(id)) continue
      const a = readAt(t, step)
      const b = readAt(other, step)
      const sa = worldToScreen(cam, a.x, a.y)
      const sb = worldToScreen(cam, b.x, b.y)
      const taut = c.kind === 'rod' || Math.hypot(b.x - a.x, b.y - a.y) >= c.length - 1e-6
      ctx.strokeStyle = taut ? '#2563eb' : '#94a3b8'
      ctx.lineWidth = taut ? 2 : 1.5
      ctx.setLineDash(taut ? [] : [4, 4])
      ctx.beginPath()
      ctx.moveTo(sa.x, sa.y)
      ctx.lineTo(sb.x, sb.y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
}

function drawObject(ctx: CanvasRenderingContext2D, cam: Camera, t: ObjectTrack, step: number): void {
  const data = t.data
  const n = data.length / 6
  const i = Math.max(0, Math.min(step, n - 1))
  const sp = worldToScreen(cam, data[i * 6]!, data[i * 6 + 1]!)
  const r = Math.max(3, t.radius * cam.scale)
  ctx.fillStyle = t.color
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.5
  if (t.def.shape === 'rect') {
    // 矩形体（极板/木板）：radius = 半高，rectW = 宽度
    const wHalf = Math.max(r, ((t.def.rectW ?? t.radius * 4) / 2) * cam.scale)
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(sp.x - wHalf, sp.y - r, wHalf * 2, r * 2, 3)
    } else {
      ctx.rect(sp.x - wHalf, sp.y - r, wHalf * 2, r * 2)
    }
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(sp.x, sp.y, r, 0, TAU)
    ctx.fill()
    ctx.stroke()
  }
  // 带电粒子：电荷符号（正 + / 负 −）
  if (t.def.charge !== undefined && t.def.charge !== 0 && r > 7) {
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t.def.charge > 0 ? '+' : '−', sp.x, sp.y + 0.5)
  }
  if (t.label && (r > 5 || t.def.motion.kind === 'static')) {
    ctx.fillStyle = '#334155'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(t.label, sp.x, sp.y - r - 3)
  }
}

function drawForces(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  forces: ForceVec[],
  showNet: boolean,
  showValues: boolean,
): void {
  if (forces.length === 0) return
  const at = forces[0]!.at
  const o = worldToScreen(cam, at.x, at.y)
  const px = (fwx: number, fwy: number) => {
    const mag = Math.hypot(fwx, fwy)
    const len = mag * cam.scale * FORCE_SCALE
    if (mag < 1e-12) return { len: 0, ex: o.x, ey: o.y }
    const ux = fwx / mag
    const uy = fwy / mag
    return { len, ex: o.x + ux * len, ey: o.y - uy * len }
  }
  for (const f of forces) {
    if (f.kind === 'net' && !showNet) continue
    const { len, ex, ey } = px(f.f.x, f.f.y)
    if (len < MIN_FORCE_PX) continue
    const color = FORCE_COLORS[f.kind]!
    const dashed = f.kind === 'net'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = dashed ? 1.8 : 2.8
    ctx.setLineDash(dashed ? [6, 4] : [])
    ctx.beginPath()
    ctx.moveTo(o.x, o.y)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    ctx.setLineDash([])
    // 箭头
    const ang = Math.atan2(ey - o.y, ex - o.x)
    const h = dashed ? 6 : 8
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex - h * Math.cos(ang - 0.4), ey - h * Math.sin(ang - 0.4))
    ctx.lineTo(ex - h * Math.cos(ang + 0.4), ey - h * Math.sin(ang + 0.4))
    ctx.closePath()
    ctx.fill()
    if (showValues && f.magnitude > 0.01) {
      ctx.fillStyle = '#475569'
      ctx.font = '10px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${f.magnitude.toFixed(1)} N`, ex, ey - 5)
    }
  }
}

function readAt(t: ObjectTrack, step: number): { x: number; y: number } {
  const n = t.data.length / 6
  const i = Math.max(0, Math.min(step, n - 1))
  return { x: t.data[i * 6]!, y: t.data[i * 6 + 1]! }
}
