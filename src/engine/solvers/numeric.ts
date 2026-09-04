// 数值积分器：Velocity Verlet + 接触面处理（地面 / 斜面 / 传送带 / 圆环内壁 / 锚板）。
// 教学稳定性设计：
// - 贴地/贴斜面物体采用"1-D 沿面动力学"，从根源消除贴地抖动；
// - 自由体撞地反弹仅当冲击速度超过阈值，低速接触直接吸附（不产生微弹跳）；
// - 摩擦静/动合一（高中教学近似，μs≈μk）：|v_rel| 小且切向力在 μN 内 → 黏滞，否则动摩擦。
// - 位置/速度相关力（场力、弹簧对力）由 Engine 经 extraAcc 闭包注入：
//   Verlet 起点与中段（试验位置+试验速度）各求值一次，保持二阶精度。
import type { ContactCircle, ContactFloor, ContactPlane, ObjectDef, WorldSpec } from '../types'

export interface NBody {
  def: ObjectDef
  x: number
  y: number
  vx: number
  vy: number
  /** 自由体是否贴地（y = groundY + r） */
  grounded: boolean
  /** 平面接触体：沿平面切向的弧坐标（p = s·u + r·n） */
  planeS: number
  /** 完全停稳（不再积分；被碰撞撞击时唤醒） */
  asleep: boolean
  /**
   * 叠压于其上的物块总质量（kg）：板块模型中锚板接地摩擦的
   * 正压力须计入承重 N = (M + Σm)·g；Engine 在步进前累加。
   */
  extraNormalMass: number
  /** 子步起点位置/速度（绳/杆约束张紧相角坐标积分用；静态锚点恒为其位置/零） */
  px: number
  py: number
  pvx: number
  pvy: number
}

/** 冲击判定阈值：低于此法向速度视为静止接触（吸附而非反弹），避免微弹跳 */
export const CONTACT_IMPACT_MIN = 0.3

export function initBody(def: ObjectDef): NBody {
  return {
    def,
    x: def.p0.x,
    y: def.p0.y,
    vx: def.v0.x,
    vy: def.v0.y,
    grounded: false,
    planeS: 0,
    asleep: false,
    extraNormalMass: 0,
    px: def.p0.x,
    py: def.p0.y,
    pvx: def.v0.x,
    pvy: def.v0.y,
  }
}

/** 平面接触体初态：位置投影到面上（p = s·u + r·n），速度投影到切向 */
export function initPlaneBody(def: ObjectDef): NBody {
  const b = initBody(def)
  const plane = planeContact(b.def)
  if (!plane) return b
  const { ux, uy, nx, ny } = planeBasis(plane.angle)
  const s = b.x * ux + b.y * uy // 切向弧坐标
  const d = b.x * nx + b.y * ny - def.radius // 相对面（过原点）的沿 n 偏移
  if (d < 1e-9) {
    // 初始在面下：吸附回面
    b.x = s * ux + nx * def.radius
    b.y = s * uy + ny * def.radius
  }
  const vu = b.vx * ux + b.vy * uy
  b.vx = vu * ux
  b.vy = vu * uy
  b.planeS = s
  b.grounded = true
  return b
}

/** 平面接触的几何基（u 切向单位向量，n 上法向；倾角与 +x 夹角） */
export function planeBasis(angle: number): { ux: number; uy: number; nx: number; ny: number } {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { ux: c, uy: s, nx: -s, ny: c }
}

function floorContact(def: ObjectDef): ContactFloor | undefined {
  const m = def.motion
  return m.kind === 'numeric' && m.spec.contact?.type === 'floor'
    ? (m.spec.contact as ContactFloor)
    : undefined
}

function planeContact(def: ObjectDef): ContactPlane | undefined {
  const m = def.motion
  return m.kind === 'numeric' && m.spec.contact?.type === 'plane'
    ? (m.spec.contact as ContactPlane)
    : undefined
}

function circleContact(def: ObjectDef): ContactCircle | undefined {
  const m = def.motion
  return m.kind === 'numeric' && m.spec.contact?.type === 'circle'
    ? (m.spec.contact as ContactCircle)
    : undefined
}

function dragCoeff(def: ObjectDef): number {
  const m = def.motion
  return m.kind === 'numeric' && m.spec.drag ? m.spec.drag.k : 0
}

/** 总加速度（重力 + 线性阻力 + 恒定外力），x 分量 */
function axOf(def: ObjectDef, world: WorldSpec, vx: number): number {
  const k = dragCoeff(def)
  return world.gravity.x + (k * -vx + (def.appliedForce?.x ?? 0)) / def.mass
}
function ayOf(def: ObjectDef, world: WorldSpec, vy: number): number {
  const k = dragCoeff(def)
  return world.gravity.y + (k * -vy + (def.appliedForce?.y ?? 0)) / def.mass
}

export interface StepHooks {
  /** 真实冲击（冲击速度足够大） */
  onImpact?: (body: NBody, impactSpeed: number) => void
  /** 完全停稳 */
  onRest?: (body: NBody) => void
}

/** 位置/速度相关的附加加速度（场力、弹簧对力）——由 Engine 构造 */
export type ExtraAccFn = (
  b: NBody,
  x: number,
  y: number,
  vx: number,
  vy: number,
) => { x: number; y: number }

/**
 * 自由体（2-D）Velocity Verlet 一步 + 地面/圆环接触。
 * @param prevY 上一步的 y（冲击判定）
 */
export function freeBodyStep(
  b: NBody,
  world: WorldSpec,
  dt: number,
  prevY: number,
  hooks?: StepHooks,
  extraAcc?: ExtraAccFn,
): void {
  if (b.asleep) return
  b.px = b.x
  b.py = b.y
  b.pvx = b.vx
  b.pvy = b.vy
  const floor = floorContact(b.def)
  const circle = circleContact(b.def)
  const gy = world.groundY !== undefined ? world.groundY + b.def.radius : undefined
  const groundedBefore = b.grounded

  // —— Verlet 试探推进（附加力在起点与中点各求值一次） ——
  const e0 = extraAcc?.(b, b.x, b.y, b.vx, b.vy) ?? { x: 0, y: 0 }
  const ax0 = axOf(b.def, world, b.vx) + e0.x
  const ay0 = ayOf(b.def, world, b.vy) + e0.y
  const x1 = b.x + b.vx * dt + 0.5 * ax0 * dt * dt
  const y1 = b.y + b.vy * dt + 0.5 * ay0 * dt * dt
  // 中点半隐式速度估（对速度相关的阻力更稳）；位置相关附加力用试验位置重估
  const vxe = b.vx + ax0 * dt
  const vye = b.vy + ay0 * dt
  const e1 = extraAcc?.(b, x1, y1, vxe, vye) ?? { x: 0, y: 0 }
  const ax1 = axOf(b.def, world, vxe) + e1.x
  const ay1 = ayOf(b.def, world, vye) + e1.y
  b.x = x1
  b.y = y1
  b.vx += 0.5 * (ax0 + ax1) * dt
  b.vy += 0.5 * (ay0 + ay1) * dt
  b.grounded = false

  // —— 地面接触 ——
  if (floor && gy !== undefined && b.y < gy) {
    const wasAbove = prevY >= gy - 1e-12 || !groundedBefore
    const impactSpeed = -b.vy // 当前向下速度
    const e = floor.restitution
    if (wasAbove && impactSpeed > CONTACT_IMPACT_MIN && e > 0) {
      // 高速真实冲击 → 反弹
      b.y = gy
      b.vy = e * b.vy
      hooks?.onImpact?.(b, impactSpeed)
    } else {
      // 低速/静止 → 吸附停住
      b.y = gy
      b.vy = 0
      if (wasAbove && impactSpeed > 1e-6) hooks?.onImpact?.(b, impactSpeed)
    }
    b.grounded = true
  }

  // —— 圆环内壁接触（在贴地摩擦之前；环内无"地面"概念） ——
  if (circle) {
    const R = circle.radius - b.def.radius
    let dx = b.x - circle.center.x
    let dy = b.y - circle.center.y
    let d = Math.hypot(dx, dy)
    if (d < 1e-12) {
      // 恰在圆心（退化）：推出到最近点
      dx = 1
      dy = 0
      d = 1
    }
    if (d >= R) {
      // 越界：投影回内壁
      b.x = circle.center.x + (dx / d) * R
      b.y = circle.center.y + (dy / d) * R
      const nx = dx / d // 外法向
      const ny = dy / d
      const vr = b.vx * nx + b.vy * ny // 外法向速度
      const e = circle.restitution
      // 真实冲击判定：本步起点在环内（自由飞行撞壁）才算冲击；
      // 贴壁滑行中每步的数值径向漂移不是冲击 → 只消去外法向分量（连续接触，
      // 避免高速下滑段假反弹造成能量流失）
      const wasAtWall = Math.hypot(b.px - circle.center.x, b.py - circle.center.y) >= R - 1e-9
      if (vr > CONTACT_IMPACT_MIN && e > 0 && !wasAtWall) {
        // 真实冲击 → 法向反弹
        b.vx -= (1 + e) * vr * nx
        b.vy -= (1 + e) * vr * ny
        hooks?.onImpact?.(b, vr)
      } else {
        // 低速吸附/贴壁滑行：只消去外法向分量
        b.vx -= vr * nx
        b.vy -= vr * ny
      }
      // 壁摩擦（切向减速）
      const mu = circle.friction ?? 0
      if (mu > 0) {
        const vtx = b.vx - (b.vx * nx + b.vy * ny) * nx
        const vty = b.vy - (b.vx * nx + b.vy * ny) * ny
        const vt = Math.hypot(vtx, vty)
        if (vt > 1e-6) {
          // 正压力 N = m·(v²/R - 重力向心分量)
          const v2 = b.vx * b.vx + b.vy * b.vy
          const aIn = world.gravity.x * -nx + world.gravity.y * -ny // 指向圆心为正
          const N = b.def.mass * Math.max(0, v2 / R - aIn)
          const dec = Math.min(vt, ((mu * N) / b.def.mass) * dt)
          b.vx -= (vtx / vt) * dec
          b.vy -= (vty / vt) * dec
        }
      }
    }
  }

  // —— 贴地摩擦 ——
  if (b.grounded && floor) {
    if (floor.friction > 0 && world.gravity.y < 0) {
      const mu = floor.friction
      const N = -world.gravity.y * (b.def.mass + b.extraNormalMass) // 正压力（含板上承重）
      // 切向净外力（恒定外力 + 阻力）—— 需要静摩擦抵消的量
      const fNeed = (b.def.appliedForce?.x ?? 0) + dragCoeff(b.def) * -b.vx
      const vAbs = Math.abs(b.vx)
      if (vAbs < 1e-3) {
        if (Math.abs(fNeed) <= mu * N) {
          b.vx = 0 // 静摩擦黏滞
        } else {
          const dir = Math.sign(fNeed)
          b.vx += (dir * (Math.abs(fNeed) - mu * N) / b.def.mass) * dt
        }
      } else {
        // 动摩擦：按 μN 减速至停
        const dec = Math.min(vAbs, ((mu * N) / b.def.mass) * dt)
        b.vx -= Math.sign(b.vx) * dec
      }
    } else if (Math.abs(b.vx) < 1e-6) {
      b.vx = 0
    }
    if (Math.abs(b.vx) < 1e-3 && !b.asleep) {
      b.asleep = true
      hooks?.onRest?.(b)
    }
  }
}

/**
 * 弹簧对一步（相对坐标解析解）：相对间距按约化质量简谐 ω=√(k/μ) 闭式推进，
 * 能量严格守恒（无显式欧拉的数值放大）；质心位置/速度取自由步进结果
 * （保留重力/场力等外部作用），两端按质量反比分摊 → 系统动量严格守恒。
 * px/py/pvx/pvy 须为本步起点状态（freeBodyStep 入口已记录）。
 */
export function springPairStep(
  a: NBody,
  b: NBody,
  sp: { k: number; restLength: number },
  h: number,
): void {
  const ma = a.def.mass
  const mb = b.def.mass
  if (!Number.isFinite(ma) || !Number.isFinite(mb) || ma <= 0 || mb <= 0) return
  const M = ma + mb
  const mu = (ma * mb) / M
  const w = Math.sqrt(Math.max(1e-9, sp.k / mu))
  // 步前相对量（沿 û 的伸缩自由度 + 垂直分量）
  const rx = b.px - a.px
  const ry = b.py - a.py
  const d0 = Math.hypot(rx, ry)
  if (d0 < 1e-9) return
  const ux = rx / d0
  const uy = ry / d0
  const e0 = d0 - sp.restLength
  const vrx = b.pvx - a.pvx
  const vry = b.pvy - a.pvy
  const eDot0 = vrx * ux + vry * uy
  const vpx = vrx - ux * eDot0 // 垂直相对速度（中心力无扭矩 → 守恒）
  const vpy = vry - uy * eDot0
  // 解析相对简谐：e(t)=e0·cosωt+(ė0/ω)·sinωt
  const cw = Math.cos(w * h)
  const sw = Math.sin(w * h)
  const e1 = e0 * cw + (eDot0 / w) * sw
  const eDot1 = -e0 * w * sw + eDot0 * cw
  const rx1 = ux * (sp.restLength + e1) + vpx * h
  const ry1 = uy * (sp.restLength + e1) + vpy * h
  const vrx1 = ux * eDot1 + vpx
  const vry1 = uy * eDot1 + vpy
  // 质心（取自由步进后状态：重力/场力的 COM 作用保留）
  const cx = (ma * a.x + mb * b.x) / M
  const cy = (ma * a.y + mb * b.y) / M
  const vcx = (ma * a.vx + mb * b.vx) / M
  const vcy = (ma * a.vy + mb * b.vy) / M
  const shareA = mb / M
  const shareB = ma / M
  a.x = cx - shareA * rx1
  a.y = cy - shareA * ry1
  b.x = cx + shareB * rx1
  b.y = cy + shareB * ry1
  a.vx = vcx - shareA * vrx1
  a.vy = vcy - shareA * vry1
  b.vx = vcx + shareB * vrx1
  b.vy = vcy + shareB * vry1
  a.asleep = false
  b.asleep = false
}

/**
 * 锚板耦合步进（板块模型）：物体贴在另一数值体的水平上表面（y = anchor.y + r_a），
 * 随锚体平移；两者间摩擦静/动合一，等大反向冲量严格动量守恒。
 * 锚体须在本次步进中先被 freeBodyStep 推进（Engine 保证顺序），
 * anchorEffA = 锚体本步有效加速度（Engine 由 Δv/dt 反推传入）。
 */
export function planeAnchorStep(
  b: NBody,
  anchor: NBody,
  world: WorldSpec,
  dt: number,
  anchorEffA: number,
): void {
  if (b.asleep && anchor.asleep) return
  b.px = b.x
  b.py = b.y
  const plane = planeContact(b.def)
  if (!plane) return
  const mu = plane.friction
  const r = b.def.radius
  // 吸附到锚体上表面（水平面；板模型只支持 angle=0）
  const topY = anchor.y + anchor.def.radius
  b.y = topY + r
  if (mu <= 0) {
    // 光滑板面：无摩擦耦合（位置跟随，速度不受锚体影响）
    b.planeS = b.x - anchor.x
    b.grounded = true
    return
  }
  const N = -world.gravity.y * b.def.mass // 正压力（水平板面）
  const fMax = mu * N
  const vRel = b.vx - anchor.vx
  // 物体自身外力切向加速度（水平分量为 0 时只有恒定外力贡献）
  const aU_w = world.gravity.x + (b.def.appliedForce?.x ?? 0) / b.def.mass
  let f: number // 摩擦对物体（+x 方向为正）
  if (Math.abs(vRel) > 1e-3) {
    // 动摩擦：若摩擦冲量足以在本步内消除滑移 → 一步到 vRel=0（避免 ±fMax 极限环）；
    // 否则维持满额动摩擦
    const killImpulse = vRel / ((1 / b.def.mass + 1 / anchor.def.mass) * dt)
    f = Math.abs(killImpulse) <= fMax ? -killImpulse : -Math.sign(vRel) * fMax
  } else {
    // 静摩擦黏滞：既平衡板系加速度差，又在本步内消去相对速度
    // （-m·vRel/dt 项使 b.vx 一步收敛到 anchor.vx，避免锚体停稳后残余滑移造成永久微振荡）
    const fNeed = b.def.mass * (anchorEffA - aU_w) - (b.def.mass * vRel) / dt
    if (Math.abs(fNeed) <= fMax) {
      f = fNeed
    } else {
      f = Math.sign(fNeed) * fMax // 超出静摩擦极限 → 打滑
    }
  }
  // 物体：外力 + 摩擦推进；锚体：等大反向（动量守恒）
  const dvB = (aU_w + f / b.def.mass) * dt
  const dvA = (-f / anchor.def.mass) * dt
  b.vx += dvB
  anchor.vx += dvA
  b.x += 0.5 * (2 * b.vx - dvB) * dt // 半隐式位置更新（用更新后速度回推中点）
  b.planeS = b.x - anchor.x
  b.grounded = true
  if (Math.abs(f) > 1e-9) {
    b.asleep = false
    anchor.asleep = false
  }
}

/**
 * 平面/传送带接触体：1-D 沿面动力学。
 * 物体始终吸附面上；摩擦使 v 收敛到带速或静平衡。
 */
export function planeBodyStep(b: NBody, world: WorldSpec, dt: number): void {
  if (b.asleep) return
  const plane = planeContact(b.def)
  if (!plane) return
  const { ux, uy, nx, ny } = planeBasis(plane.angle)
  const r = b.def.radius

  const vu = b.vx * ux + b.vy * uy
  // 外力切向/法向加速度（重力 + 恒定外力 + 阻力）
  const ax0 = axOf(b.def, world, b.vx)
  const ay0 = ayOf(b.def, world, b.vy)
  const aU_w = ax0 * ux + ay0 * uy
  const aN_w = ax0 * nx + ay0 * ny
  const Nacc = Math.max(0, -aN_w) // 压向平面当量（摩擦上限）
  const mu = plane.friction

  const beltU = plane.beltSpeed ?? 0
  let vRel = vu - beltU
  let aU = aU_w
  if (mu > 0) {
    const fMax = mu * Nacc
    if (Math.abs(vRel) > 1e-3) {
      // 动摩擦：阻碍相对运动（物体向带速收敛）
      aU -= Math.sign(vRel) * fMax
    } else if (Math.abs(aU_w) <= fMax) {
      // 静摩擦黏滞：净切向在 μN 内则不动（无带时即静止）
      aU = beltU === undefined || beltU === 0 ? 0 : aU_w
      vRel = 0
    } else {
      // 超出静摩擦极限，开始打滑
      aU = aU_w - Math.sign(aU_w) * fMax
    }
  } else {
    // 光滑面：无摩擦，切向重力全部生效
    aU = aU_w
  }

  // 切向 1-D 积分
  const s0 = b.planeS
  const v0 = vu
  b.planeS = s0 + v0 * dt + 0.5 * aU * dt * dt
  const v1 = v0 + aU * dt
  b.x = b.planeS * ux + nx * r
  b.y = b.planeS * uy + ny * r
  b.vx = v1 * ux
  b.vy = v1 * uy
  b.grounded = true
}
