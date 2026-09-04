// 解析解（闭式）运动求值器。
// 要点：求值器只负责"无约束公式"在任意时刻 t 的状态；地面截断（落地静止）由
// Engine 在采样循环中统一处理（跨步检测 + 落地后冻结），保证解析/数值两种模式
// 的事件检测共用同一套网格逻辑。解析模式永不产生数值误差。
import type { ObjectDef, WorldSpec } from '../types'

export interface AnalyticState {
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
}

/** 该运动模式是否走解析求解 */
export function isAnalyticMode(def: ObjectDef): boolean {
  const k = def.motion.kind
  return k === 'kinematic' || k === 'circular' || k === 'harmonic' || k === 'pendulum'
}

/**
 * 解析求值（不包含地面截断——截断由 Engine 采样循环处理）。
 */
export function analyticStateAt(def: ObjectDef, t: number): AnalyticState {
  const m = def.motion
  switch (m.kind) {
    case 'static':
    case 'kinematic': {
      // p(t) = p0 + v0·t + ½a·t²（static：a=0,v0=0 自然成立）
      const a = m.kind === 'kinematic' ? m.a : { x: 0, y: 0 }
      const t2 = 0.5 * t * t
      return {
        x: def.p0.x + def.v0.x * t + a.x * t2,
        y: def.p0.y + def.v0.y * t + a.y * t2,
        vx: def.v0.x + a.x * t,
        vy: def.v0.y + a.y * t,
        ax: a.x,
        ay: a.y,
      }
    }
    case 'circular': {
      // p(t) = center + r·(cos(ωt+φ), sin(ωt+φ))；逐阶求导
      const ang = m.omega * t + m.phi0
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const w2 = m.omega * m.omega
      return {
        x: m.center.x + m.radius * c,
        y: m.center.y + m.radius * s,
        vx: -m.radius * m.omega * s,
        vy: m.radius * m.omega * c,
        ax: -m.radius * w2 * c,
        ay: -m.radius * w2 * s,
      }
    }
    case 'harmonic': {
      // 位移 s(t) = A·cos(ωt+φ)（A 可带符号，φ 提供相位）；axis 为单位方向
      const ang = m.omega * t + m.phi0
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const sDisp = m.amplitude * c
      const vMag = -m.amplitude * m.omega * s
      const aMag = -m.amplitude * m.omega * m.omega * c
      return {
        x: m.equilibrium.x + m.axis.x * sDisp,
        y: m.equilibrium.y + m.axis.y * sDisp,
        vx: m.axis.x * vMag,
        vy: m.axis.y * vMag,
        ax: m.axis.x * aMag,
        ay: m.axis.y * aMag,
      }
    }
    case 'pendulum': {
      // θ(t) = θ0·cos(ωt+φ0)（θ0 带符号给出起始摆向，φ0 提供初速相位）
      // 位置：绕支点 pivot 旋转 θ（θ=0 垂直向下），y 向上坐标系
      const ang = m.omega * t + (m.phi0 ?? 0)
      const th = m.theta0 * Math.cos(ang)
      const thDot = -m.theta0 * m.omega * Math.sin(ang)
      const thDotDot = -m.theta0 * m.omega * m.omega * Math.cos(ang)
      const st = Math.sin(th)
      const ct = Math.cos(th)
      const d = m.direction
      // 切向基 eθ = (d·cosθ, sinθ)，eθ' = d/dθ eθ = (−d·sinθ, cosθ)
      // r'' = L(θ''·eθ + (θ')²·eθ')
      const ex = d * ct
      const ey = st
      return {
        x: m.pivot.x + d * m.length * st,
        y: m.pivot.y - m.length * ct,
        vx: m.length * thDot * ex,
        vy: m.length * thDot * ey,
        ax: m.length * (thDotDot * ex - thDot * thDot * d * st),
        ay: m.length * (thDotDot * ey + thDot * thDot * d * ct),
      }
    }
    default: {
      // 数值模式不会进入本函数；防御性返回静止态
      return { x: def.p0.x, y: def.p0.y, vx: def.v0.x, vy: def.v0.y, ax: 0, ay: 0 }
    }
  }
}

/**
 * 解析模式的"自然终止时刻"：
 * - kinematic + landOnGround：落地（y=groundY）时刻；
 * - 其余解析模式永续 → null。
 * 若起于地面以下返回 0（从第一步起冻结）。
 */
export function analyticNaturalEnd(def: ObjectDef, world: WorldSpec): number | null {
  const m = def.motion
  if (m.kind === 'kinematic' && m.landOnGround && world.groundY !== undefined) {
    // 圆心视为接触点：圆心静止于 groundY + radius（接触地面）
    const gy = world.groundY + def.radius
    const y0 = def.p0.y
    const v0y = def.v0.y
    const ay = m.a.y
    // 已贴地且不会上升（静止或向下）→ 立即冻结；从地面向上抛出 → 正常完成往返后落地
    if (y0 < gy - 1e-9) return 0
    if (y0 <= gy + 1e-9 && v0y <= 1e-9 && ay < 1e-9) return 0
    if (ay === 0) {
      // 匀速：仅向下运动时落地
      return v0y < 0 ? (gy - y0) / v0y : null
    }
    // y(t) = y0 + v0y·t + ½ay·t² = gy；两实根取 [0,∞) 内 vy<0 的那一个
    const disc = v0y * v0y - 2 * ay * (y0 - gy)
    if (disc < 0) return null
    const sq = Math.sqrt(disc)
    const r1 = (-v0y - sq) / ay
    const r2 = (-v0y + sq) / ay
    for (const r of r1 <= r2 ? [r1, r2] : [r2, r1]) {
      if (r < 1e-9) continue
      if (v0y + ay * r < 0) return r // 向下穿越地面
    }
    return null
  }
  return null
}
