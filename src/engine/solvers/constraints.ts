// 绳/杆距离约束（位置级投影 + 速度级动量守恒修正）。
// 教学约定：绳张紧瞬间沿绳方向两物体速度趋于一致（完全非弹性张紧），动量守恒；
// 绳允许松弛（d < L 无约束），杆恒等长。
// 动量守恒：成对修正严格等大反向。
import type { NBody } from './numeric'

export interface ConstraintEdge {
  kind: 'rope' | 'rod'
  /** 两端物体索引（对应引擎数值体数组） */
  i: number
  j: number
  /** 约束长度（m） */
  length: number
}

export interface ConstraintSolveResult {
  /** 本步是否有绳从松弛变张紧 */
  taut: boolean
}

const EPS = 1e-9

/**
 * 位置级投影 + 速度修正（一次 pass，调用方多次迭代）。
 *
 * 子步模式（h 传入）对"步前已张紧"的约束改用**角坐标半隐式积分**：
 * 位置投影 + 消法向速度的方案每子步会把切线速度沿"新法向"的分量 v·sin(Δθ)
 * 一并消掉（切向吸血鬼），高速整圈长期看能量持续流失；角坐标积分对
 * 张紧相的动力学是精确的（θ、ω 一阶辛格式），能量有界不漂移，
 * 并可用张力 T = μ·(Lω² + a_rel·r̂) 判定绳是否松弛（T<0 → 脱绳）。
 * 质心速度严格守恒（逆质量表述，静态锚点 invM=0 退化正确）。
 */
export function applyEdgeOnce(
  bodies: NBody[],
  edge: ConstraintEdge,
  h?: number,
  gravity?: { x: number; y: number },
): void {
  const a = bodies[edge.i]
  const b = bodies[edge.j]
  if (!a || !b) return

  let dx = b.x - a.x
  let dy = b.y - a.y
  let d = Math.hypot(dx, dy)
  const L = edge.length

  const invMa = 1 / Math.max(EPS, a.def.mass)
  const invMb = 1 / Math.max(EPS, b.def.mass)
  const invSum = invMa + invMb
  const shareA = invMa / invSum // = mb/(ma+mb)
  const shareB = invMb / invSum // = ma/(ma+mb)

  // —— 步前状态（px/py/pvx/pvy 为子步起点；静态锚点恒等于其位置/零速度） ——
  const dPrev = Math.hypot(b.px - a.px, b.py - a.py)
  const wasTaut = edge.kind === 'rod' || dPrev >= L - 1e-4

  if (h !== undefined && h > 0 && wasTaut) {
    // —— 张紧相：角坐标积分（半隐式欧拉，辛格式：能量有界不漂移） ——
    const th = Math.atan2(b.px - a.px, a.py - b.py) // θ：竖直向下起量，顺时针为正
    const tx = Math.cos(th)
    const ty = Math.sin(th)
    const w0 = ((b.pvx - a.pvx) * tx + (b.pvy - a.pvy) * ty) / L // 切向相对角速度
    // 相对外部加速度（静态锚点被销钉固定：无加速度；重力对两自由体相互抵消）
    const gx = gravity?.x ?? 0
    const gy = gravity?.y ?? 0
    const aRelX = (invMb === 0 ? 0 : gx + (b.def.appliedForce?.x ?? 0) * invMb) -
      (invMa === 0 ? 0 : gx + (a.def.appliedForce?.x ?? 0) * invMa)
    const aRelY = (invMb === 0 ? 0 : gy + (b.def.appliedForce?.y ?? 0) * invMb) -
      (invMa === 0 ? 0 : gy + (a.def.appliedForce?.y ?? 0) * invMa)
    // 角加速度 = 切向加速度 / 绳长（单位：rad/s²）
    const w1 = w0 + ((aRelX * tx + aRelY * ty) / L) * h
    const th1 = th + w1 * h
    const rx = Math.sin(th1)
    const ry = -Math.cos(th1) // r̂：从 a 指向 b 的单位向量
    // 张力（正 = 拉）；绳 T<0 → 脱绳，保留自由步进结果
    const T = (L * w1 * w1 + aRelX * rx + aRelY * ry) / invSum
    if (edge.kind === 'rope' && T < 0) return
    // 质心位置/速度（逆质量权重；静态锚点即其自身）
    const cx = (invMb * a.x + invMa * b.x) / invSum
    const cy = (invMb * a.y + invMa * b.y) / invSum
    const vcx = (invMb * a.pvx + invMa * b.pvx) / invSum
    const vcy = (invMb * a.pvy + invMa * b.pvy) / invSum
    // 速度沿"新"切线方向（旧切线会残留指向外的小径向分量）
    const ntx = Math.cos(th1)
    const nty = Math.sin(th1)
    const vRel = L * w1
    a.x = cx - shareA * L * rx
    a.y = cy - shareA * L * ry
    b.x = cx + shareB * L * rx
    b.y = cy + shareB * L * ry
    a.vx = vcx - shareA * vRel * ntx
    a.vy = vcy - shareA * vRel * nty
    b.vx = vcx + shareB * vRel * ntx
    b.vy = vcy + shareB * vRel * nty
    a.asleep = false
    b.asleep = false
    return
  }

  // —— 位置投影（松弛→张紧 或 无子步信息的兜底路径） ——
  let needsVel = false
  if (edge.kind === 'rod') {
    if (d > EPS) {
      const corr = d - L
      dx /= d
      dy /= d
      a.x += dx * ((corr * invMa) / invSum)
      a.y += dy * ((corr * invMa) / invSum)
      b.x -= dx * ((corr * invMb) / invSum)
      b.y -= dy * ((corr * invMb) / invSum)
    }
    needsVel = true
  } else if (d > L + EPS) {
    const over = d - L
    dx /= d
    dy /= d
    a.x += dx * ((over * invMa) / invSum)
    a.y += dy * ((over * invMa) / invSum)
    b.x -= dx * ((over * invMb) / invSum)
    b.y -= dy * ((over * invMb) / invSum)
    needsVel = true
  }
  if (!needsVel) return

  // —— 速度修正：去掉沿约束方向的分离速度（张紧/刚性）——
  dx = b.x - a.x
  dy = b.y - a.y
  d = Math.hypot(dx, dy)
  if (d < EPS) return
  const nx = dx / d
  const ny = dy / d
  const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (edge.kind === 'rod' || vrel > 0) {
    // 杆恒需消去；绳仅在分离趋势（张紧）时消去——松弛绳张紧瞬间完全非弹性
    const lambda = -vrel / invSum
    a.vx -= (lambda * invMa) * nx
    a.vy -= (lambda * invMa) * ny
    b.vx += (lambda * invMb) * nx
    b.vy += (lambda * invMb) * ny
    a.asleep = false
    b.asleep = false
  }
}

/** 迭代求解所有约束（多次 pass 提升收敛）；返回张紧事件标记（本次步首次）。
 *  opts.h 传入时对已张紧约束按子步角坐标积分（见 applyEdgeOnce）。 */
export function solveConstraints(
  bodies: NBody[],
  edges: ConstraintEdge[],
  opts?: { h?: number; gravity?: { x: number; y: number } },
  passes = 6,
): { ropeTautIndexes: number[] } {
  const taut: number[] = []
  for (let p = 0; p < passes; p++) {
    for (const [k, e] of edges.entries()) {
      const a = bodies[e.i]
      const b = bodies[e.j]
      if (!a || !b) continue
      const dBefore = Math.hypot(b.x - a.x, b.y - a.y)
      const wasTaut = e.kind === 'rod' || dBefore > e.length - EPS
      applyEdgeOnce(bodies, e, opts?.h, opts?.gravity)
      const dAfter = Math.hypot(b.x - a.x, b.y - a.y)
      if (e.kind === 'rope' && !wasTaut && dAfter > e.length - EPS) {
        taut.push(k)
      }
    }
  }
  return { ropeTautIndexes: taut }
}
