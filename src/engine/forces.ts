// 受力推导：给定结果与步索引，为每个物体推导该时刻的受力矢量（教学展示用）。
// 纯函数：画布受力层与"受力面板"共用；矢量以世界坐标（N，y 向上）给出。
// 配色约定（与 tailwind.config 物理色板一致）：
//   重力灰 支持力/弹力绿 摩擦红 拉力蓝 外力紫 向心力橙 回复力青 阻力棕 电场力粉 洛伦兹力青绿 合力黑(虚线)
import { readTrack } from './Engine'
import type { EngineResult, ForceKind, ForceVec } from './types'
import type { Vec2 } from './vec'

export const FORCE_COLORS: Record<ForceKind, string> = {
  gravity: '#374151',
  normal: '#16a34a',
  friction: '#dc2626',
  tension: '#2563eb',
  applied: '#9333ea',
  spring: '#06b6d4',
  centripetal: '#ea580c',
  drag: '#78716c',
  electric: '#db2777',
  magnetic: '#0d9488',
  net: '#0f172a',
}

const EPS = 1e-6

export function deriveForces(result: EngineResult, objectId: string, step: number): ForceVec[] {
  const track = result.tracks[objectId]
  if (!track) return []
  const def = track.def
  const s = readTrack(track.data, step)
  const world = result.def.world
  const m = def.mass
  const p: Vec2 = { x: s.x, y: s.y }
  const out: ForceVec[] = []
  const add = (kind: ForceKind, f: Vec2, label: string) => {
    const magnitude = Math.hypot(f.x, f.y)
    if (magnitude < EPS) return
    out.push({ kind, f, magnitude, label, at: p })
  }

  const g: Vec2 = { x: world.gravity.x * m, y: world.gravity.y * m }
  const kind = def.motion.kind

  // —— 空气阻力 F = -k·v ——
  const k = kind === 'numeric' && def.motion.spec.drag ? def.motion.spec.drag.k : 0
  if (k > 0 && (Math.abs(s.vx) > 1e-9 || Math.abs(s.vy) > 1e-9)) {
    add('drag', { x: -k * s.vx, y: -k * s.vy }, '空气阻力')
  }

  // —— 恒定外力 ——
  if (def.appliedForce) add('applied', { ...def.appliedForce }, '外力')

  // —— 电磁场力（带电体；按当前位置所在区域） ——
  const q = def.charge ?? 0
  let inElectric = false
  let inMagnetic = false
  if (q !== 0) {
    for (const f of world.fields ?? []) {
      if (
        f.rect &&
        (s.x < f.rect.minX || s.x > f.rect.maxX || s.y < f.rect.minY || s.y > f.rect.maxY)
      ) {
        continue
      }
      if (f.electric) {
        inElectric = true
        add('electric', { x: q * f.electric.x, y: q * f.electric.y }, '电场力')
      }
      if (f.magnetic) {
        inMagnetic = true
        add('magnetic', { x: q * s.vy * f.magnetic, y: -q * s.vx * f.magnetic }, '洛伦兹力')
      }
    }
  }

  switch (kind) {
    case 'static':
      break
    case 'kinematic': {
      // 匀变速：加速度 = 重力加速度 → 只画重力；否则画合力 F=ma
      // 带电粒子在电场中：电场力已单独画出，不再重复画合力
      const a = def.motion.a
      if (Math.abs(a.x - world.gravity.x) < 1e-9 && Math.abs(a.y - world.gravity.y) < 1e-9) {
        add('gravity', g, '重力')
      } else if (Math.hypot(a.x, a.y) > 1e-9 && !inElectric) {
        add('applied', { x: m * a.x, y: m * a.y }, '合力 F=ma')
      }
      break
    }
    case 'circular': {
      // 匀速圆周：向心力 = mω²r，指向圆心；带电粒子在磁场中即洛伦兹力（已画，跳过向心力）
      if (inMagnetic) break
      const c = def.motion.center
      const dx = c.x - s.x
      const dy = c.y - s.y
      const d = Math.hypot(dx, dy)
      if (d > 1e-9) {
        const f = (m * def.motion.omega * def.motion.omega * def.motion.radius) / d
        add('centripetal', { x: dx * f, y: dy * f }, '向心力')
      }
      break
    }
    case 'harmonic': {
      // 简谐：回复力 F = -mω²·(p - eq)（弹簧 F=-kx，k=mω²）
      const eq = def.motion.equilibrium
      const w2 = def.motion.omega * def.motion.omega
      add('spring', { x: -m * w2 * (s.x - eq.x), y: -m * w2 * (s.y - eq.y) }, '回复力 F=-kx')
      break
    }
    case 'pendulum': {
      add('gravity', g, '重力')
      // 绳拉力沿摆绳指向支点：T = m(g·cosθ + L·θ̇²)，θ 从竖直向下起量
      const pv = def.motion.pivot
      const L = def.motion.length
      const dx = pv.x - s.x
      const dy = pv.y - s.y
      const d = Math.hypot(dx, dy)
      if (d > 1e-9) {
        const cosTh = dy / d
        const thDot2 = (s.vx * s.vx + s.vy * s.vy) / (L * L)
        const T = m * (Math.abs(world.gravity.y) * Math.max(-1, Math.min(1, cosTh)) + L * thDot2)
        add('tension', { x: (dx / d) * T, y: (dy / d) * T }, '绳拉力')
      }
      break
    }
    case 'numeric': {
      add('gravity', g, '重力')
      const contact = def.motion.spec.contact
      if (contact?.type === 'floor' && world.groundY !== undefined) {
        // 贴地：支持力 + 静/动摩擦（与数值积分器同一套判定）
        const gy = world.groundY + def.radius
        if (s.y <= gy + 1e-6) {
          // 板块模型：锚板接地支持力含其上物块总重（与积分器 freeBodyStep 的 extraNormalMass 一致）
          const load = result.def.objects.reduce(
            (s, o) =>
              o.motion.kind === 'numeric' &&
              o.motion.spec.contact?.type === 'plane' &&
              o.motion.spec.contact.anchorId === def.id
                ? s + o.mass
                : s,
            0,
          )
          const N = -g.y + -world.gravity.y * load
          add('normal', { x: 0, y: N }, '支持力')
          const mu = contact.friction
          if (mu > 0 && N > 0) {
            const fNeed = (def.appliedForce?.x ?? 0) + k * -s.vx
            let f: number
            if (Math.abs(s.vx) > 1e-3) f = -Math.sign(s.vx) * mu * N
            else f = -Math.max(-mu * N, Math.min(mu * N, fNeed))
            if (Math.abs(f) > EPS) add('friction', { x: f, y: 0 }, '摩擦力')
          }
        }
      } else if (contact?.type === 'circle') {
        // 圆环内壁：贴壁时环壁支持力指向圆心 N = m·(v²/R - a_in)
        const c = contact.center
        const R = contact.radius - def.radius
        const dx = c.x - s.x
        const dy = c.y - s.y
        const d = Math.hypot(dx, dy)
        if (d > 1e-9 && R - d < def.radius * 0.5 + 1e-6) {
          const nxIn = dx / d // 指向圆心
          const nyIn = dy / d
          const v2 = s.vx * s.vx + s.vy * s.vy
          const aIn = world.gravity.x * nxIn + world.gravity.y * nyIn // 指向圆心为正
          const N = m * Math.max(0, v2 / R - aIn)
          add('normal', { x: nxIn * N, y: nyIn * N }, '支持力')
          const mu = contact.friction ?? 0
          if (mu > 0 && N > 0) {
            const vtx = s.vx - (s.vx * nxIn + s.vy * nyIn) * nxIn
            const vty = s.vy - (s.vx * nxIn + s.vy * nyIn) * nyIn
            const vt = Math.hypot(vtx, vty)
            if (vt > 1e-6) {
              add('friction', { x: -mu * N * (vtx / vt), y: -mu * N * (vty / vt) }, '摩擦力')
            }
          }
        }
      } else if (contact?.type === 'plane') {

        // 斜面/锚板：支持力沿 n（上法向），摩擦沿 u 阻碍相对带速运动
        const ang = contact.angle
        const ux = Math.cos(ang)
        const uy = Math.sin(ang)
        const nx = -Math.sin(ang)
        const ny = Math.cos(ang)
        const anchor = contact.anchorId ? result.tracks[contact.anchorId] : undefined
        const aN =
          world.gravity.x * nx +
          world.gravity.y * ny +
          (((def.appliedForce?.x ?? 0) * nx + (def.appliedForce?.y ?? 0) * ny) / m)
        if (aN < -1e-9) {
          const N = -m * aN
          add('normal', { x: nx * N, y: ny * N }, '支持力')
          const mu = contact.friction
          if (mu > 0) {
            const beltU = contact.beltSpeed ?? 0
            const anchorV = anchor
              ? readTrack(anchor.data, step).vx * ux + readTrack(anchor.data, step).vy * uy
              : 0
            const vU = s.vx * ux + s.vy * uy - beltU - (anchor ? anchorV : 0)
            let f: number
            if (Math.abs(vU) > 1e-3) {
              f = -Math.sign(vU) * mu * N
            } else {
              const aU_w =
                (world.gravity.x + (def.appliedForce?.x ?? 0) / m) * ux +
                (world.gravity.y + (def.appliedForce?.y ?? 0) / m) * uy
              f = -Math.max(-mu * N, Math.min(mu * N, m * aU_w))
            }
            if (Math.abs(f) > EPS) add('friction', { x: ux * f, y: uy * f }, '摩擦力')
          }
        }
      }
      // 弹簧对力（numeric spec.spring：声明方受力 F = -k(d-d₀)·û，指向另一体；两端面板各自列出）
      {
        const sp = def.motion.kind === 'numeric' ? def.motion.spec.spring : undefined
        if (sp) {
          const other = result.tracks[sp.otherId]
          if (other) {
            const so = readTrack(other.data, step)
            const dx = so.x - s.x
            const dy = so.y - s.y
            const d = Math.hypot(dx, dy)
            if (d > 1e-9) {
              const F = sp.k * (d - sp.restLength)
              add('spring', { x: (F * dx) / d, y: (F * dy) / d }, '弹簧弹力')
            }
          }
        }
      }
      break
    }
  }

  // —— 绳/杆约束张力（约化质量近似：T = μ·(a_rel·n̂ + v_rel²/d)） ——
  // 静态锚点（质量无穷）：约化质量退化为物体自身质量
  for (const c of def.constraints ?? []) {
    const other = result.tracks[c.otherId]
    if (!other) continue
    const so = readTrack(other.data, step)
    const dx = so.x - s.x
    const dy = so.y - s.y
    const d = Math.hypot(dx, dy)
    if (d < 1e-9) continue
    const taut = c.kind === 'rod' || d >= c.length - 1e-9
    if (!taut) continue
    const ux = dx / d
    const uy = dy / d
    const mo = other.def.mass
    const isStaticAnchor = !Number.isFinite(mo) || other.def.motion.kind === 'static'
    let T: number
    if (isStaticAnchor) {
      // 定轴绳/杆：向心力要求式 T = m·(v²/L - g·û)（û 从物体指向锚点）
      const v2 = s.vx * s.vx + s.vy * s.vy
      const gU = world.gravity.x * ux + world.gravity.y * uy
      T = m * Math.max(0, v2 / d - gU)
    } else {
      const muRed = (m * mo) / (m + mo)
      const relV = (so.vx - s.vx) * ux + (so.vy - s.vy) * uy
      const relA = (so.ax - s.ax) * ux + (so.ay - s.ay) * uy
      T = muRed * Math.max(0, relA + (relV * relV) / d)
    }
    if (T > EPS) add('tension', { x: ux * T, y: uy * T }, c.kind === 'rope' ? '绳拉力' : '杆力')
  }

  // —— 合力（虚线） ——
  let nx = 0
  let ny = 0
  for (const v of out) {
    nx += v.f.x
    ny += v.f.y
  }
  add('net', { x: nx, y: ny }, '合力')

  return out
}
