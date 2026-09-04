// 圆形碰撞检测与响应（仅自由 2-D 数值体参与；约束体/平面体不碰撞）。
// 步骤语义：freeBodyStep 已把两体推进到"候选末状态"；
// 若末状态重叠：先线性插值 TOI（穿越检测），在接触点施加冲量 + 恢复系数，
// 再沿剩余时间继续推进——从而在 dt=0.01 下也能正确捕捉 10 m/s 级的迎面碰撞。
// 动量守恒：成对冲量严格等大反向，构造上守恒。

export interface Collisionable {
  x: number
  y: number
  vx: number
  vy: number
  mass: number
  radius: number
  asleep: boolean
}

export interface PrevState {
  px: number
  py: number
}

export interface ImpulseResult {
  /** 相对法向速度（碰撞前，正值=接近） */
  approachSpeed: number
  /** 冲量大小（N·s） */
  impulse: number
}

const EPS = 1e-9

/**
 * 尝试解析一对圆形碰撞。
 * @param a b       当前（末）状态
 * @param prevA prevB 本步起始状态
 * @param e         恢复系数（0~1）
 * @returns 发生碰撞并施加冲量时返回冲量信息，否则 null
 */
export function resolvePair(
  a: Collisionable & PrevState,
  b: Collisionable & PrevState,
  e: number,
  dt: number,
): ImpulseResult | null {
  const rsum = a.radius + b.radius

  // —— 1) 穿越（TOI）检测：本步开始时分离、结束时重叠 ——
  const d0x = b.px - a.px
  const d0y = b.py - a.py
  const d0 = Math.hypot(d0x, d0y)
  const d1x = b.x - a.x
  const d1y = b.y - a.y
  const d1 = Math.hypot(d1x, d1y)

  let f: number // 接触时刻在步内的位置 [0,1]
  if (d0 >= rsum - EPS && d1 < rsum) {
    // 步中穿越：线性插值求 TOI
    f = (d0 - rsum) / Math.max(EPS, d0 - d1)
    f = Math.min(1, Math.max(0, f))
  } else if (d0 < rsum - EPS) {
    // 初始即重叠（配置重叠）：直接在最深处修正
    f = 0
  } else {
    return null
  }

  // —— 2) 接触点几何与法向 ——
  const ax = a.px + (a.x - a.px) * f
  const ay = a.py + (a.y - a.py) * f
  const bx = b.px + (b.x - b.px) * f
  const by = b.py + (b.y - b.py) * f
  let nx = bx - ax
  let ny = by - ay
  let d = Math.hypot(nx, ny)
  if (d < EPS) {
    // 完全重合：取运动方向近似法向
    nx = a.x - a.px
    ny = a.y - a.py
    d = Math.hypot(nx, ny)
    if (d < EPS) {
      nx = 1
      ny = 0
      d = 1
    }
  }
  nx /= d
  ny /= d

  // —— 3) 碰撞时刻的速度（线性插值起始/末速度）——
  const avx = a.vx
  const avy = a.vy
  const bvx = b.vx
  const bvy = b.vy
  const vrel = (bvx - avx) * nx + (bvy - avy) * ny
  const invMa = 1 / Math.max(EPS, a.mass)
  const invMb = 1 / Math.max(EPS, b.mass)
  const invSum = invMa + invMb

  const approach = -Math.min(vrel, 0)
  const j = (1 + Math.max(0, e)) * approach / invSum

  // —— 4) 施加冲量 ——
  a.vx = avx - (j * invMa) * nx
  a.vy = avy - (j * invMa) * ny
  b.vx = bvx + (j * invMb) * nx
  b.vy = bvy + (j * invMb) * ny
  a.asleep = false
  b.asleep = false

  // —— 5) 位置：接触点处起、沿新速度推进剩余时间 ——
  const rest = (1 - f) * dt
  a.x = ax + a.vx * rest
  a.y = ay + a.vy * rest
  b.x = bx + b.vx * rest
  b.y = by + b.vy * rest

  return { approachSpeed: approach, impulse: j }
}

/** 深度重叠修正：分离重叠但不施加冲量（多次迭代稳定堆叠） */
export function separateOverlap(a: Collisionable, b: Collisionable): boolean {
  const rsum = a.radius + b.radius
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const overlap = rsum - d
  if (overlap <= EPS) return false
  let nx = dx
  let ny = dy
  if (d < EPS) {
    nx = 1
    ny = 0
  } else {
    nx /= d
    ny /= d
  }
  const invMa = 1 / Math.max(EPS, a.mass)
  const invMb = 1 / Math.max(EPS, b.mass)
  const total = invMa + invMb
  const shiftA = (overlap * invMa) / total
  const shiftB = (overlap * invMb) / total
  a.x -= nx * shiftA
  a.y -= ny * shiftA
  b.x += nx * shiftB
  b.y += ny * shiftB
  return true
}
