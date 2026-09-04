// 场景模板实现：每个模板是"参数 → ScenarioDefinition + 参数面板元数据"的工厂。
// 物理量约定：滑块参数与 def 字段一一对应；耦合参数（抛体 v0 与 θ、摆的 g 与 ω）通过
// 读回 def 的其他当前值再整体重物化，保证编辑任一滑块不丢其他滑块的信息。
import type { ObjectDef, ParamDef, ScenarioDefinition } from '../types'
import { registerTemplate } from './registry'

const G = 9.8

function rad(v: number): number {
  return (v * Math.PI) / 180
}

/* ---------- 通用小工具 ---------- */

function findObj(def: ScenarioDefinition, id: string): ObjectDef {
  const o = def.objects.find((d) => d.id === id)
  if (!o) throw new Error(`场景中缺少物体 ${id}`)
  return o
}

/** 以不可变方式替换某物体 */
function withObj(
  def: ScenarioDefinition,
  id: string,
  fn: (o: ObjectDef) => ObjectDef,
): ScenarioDefinition {
  return { ...def, objects: def.objects.map((o) => (o.id === id ? fn(o) : o)) }
}

function objValue(
  def: ScenarioDefinition,
  id: string,
  read: (o: ObjectDef) => number,
  fallback: number,
): number {
  const o = def.objects.find((d) => d.id === id)
  return o ? read(o) : fallback
}

function withGravity(def: ScenarioDefinition, g: number): ScenarioDefinition {
  return { ...def, world: { ...def.world, gravity: { x: def.world.gravity.x, y: -g } } }
}

/**
 * 重力加速度 g 滑块（解析"重力主导"场景专用）：
 * 同步改写 kinematic 物体的竖直加速度 a.y（水平 a.x 保留），
 * 保证速度公式 v=v₀+gt 与受力层重力一致。
 */
function gParamSync(kinematicX: number): ParamDef {
  return {
    key: 'g', label: '重力加速度 g', unit: 'm/s²', min: 1, max: 25, step: 0.1,
    group: 'world',
    read: (def) => -def.world.gravity.y,
    apply: (def, v) => ({
      ...withGravity(def, v),
      objects: def.objects.map((o) =>
        o.motion.kind === 'kinematic'
          ? { ...o, motion: { ...o.motion, a: { x: kinematicX, y: -v } } }
          : o,
      ),
    }),
  }
}

/* ================= P0：匀变速直线（含往返） ================= */

registerTemplate({
  id: 'uniform',
  title: '匀变速直线运动',
  emoji: '➡️',
  category: 'p0',
  description: '一维匀变速：a 恒定（可为负→减速/往返）。v=v₀+at，x=v₀t+½at²，v²−v₀²=2ax。',
  create: () => {
    const def: ScenarioDefinition = {
      templateId: 'uniform',
      title: '匀变速直线运动（v₀=8 m/s，a=−2 m/s²）',
      objects: [
        {
          id: 'car', label: '物体',
          p0: { x: 0, y: 2.2 }, v0: { x: 8, y: 0 },
          mass: 2, radius: 0.35, color: '#2563eb',
          motion: { kind: 'kinematic', a: { x: -2, y: 0 }, landOnGround: false },
        },
      ],
      world: { gravity: { x: 0, y: -G }, groundY: 0 },
    }
    const params: ParamDef[] = [
      {
        key: 'v0', label: '初速度 v₀', unit: 'm/s', min: -20, max: 20, step: 0.5,
        group: 'car',
        read: (d) => objValue(d, 'car', (o) => o.v0.x, 8),
        apply: (d, v) => withObj(d, 'car', (o) => ({ ...o, v0: { x: v, y: 0 } })),
      },
      {
        key: 'a', label: '加速度 a', unit: 'm/s²', min: -12, max: 12, step: 0.1,
        group: 'car',
        read: (d) => objValue(d, 'car', (o) => (o.motion.kind === 'kinematic' ? o.motion.a.x : 0), -2),
        apply: (d, v) =>
          withObj(d, 'car', (o) =>
            o.motion.kind === 'kinematic'
              ? { ...o, motion: { ...o.motion, a: { x: v, y: o.motion.a.y } } }
              : o,
          ),
      },
    ]
    return { def, params }
  },
})

/* ================= P0：自由落体 ================= */

registerTemplate({
  id: 'freefall',
  title: '自由落体',
  emoji: '🍎',
  category: 'p0',
  description: '从静止开始只受重力下落：h=½gt²，落地速度 v=√(2gh)。忽略空气阻力。',
  create: () => {
    const def: ScenarioDefinition = {
      templateId: 'freefall',
      title: '自由落体（h=20 m）',
      objects: [
        {
          id: 'ball', label: '小球',
          p0: { x: 0, y: 20 }, v0: { x: 0, y: 0 },
          mass: 0.5, radius: 0.4, color: '#dc2626',
          motion: { kind: 'kinematic', a: { x: 0, y: -G }, landOnGround: true },
        },
      ],
      world: { gravity: { x: 0, y: -G }, groundY: 0 },
    }
    const params: ParamDef[] = [
      {
        key: 'h', label: '下落高度 h', unit: 'm', min: 0.5, max: 60, step: 0.5,
        group: 'ball',
        read: (d) => objValue(d, 'ball', (o) => o.p0.y, 20),
        apply: (d, v) => withObj(d, 'ball', (o) => ({ ...o, p0: { x: o.p0.x, y: v } })),
      },
      gParamSync(0),
    ]
    return { def, params }
  },
})

/* ================= P0：竖直上抛 ================= */

registerTemplate({
  id: 'vthrow',
  title: '竖直上抛',
  emoji: '🚀',
  category: 'p0',
  description: '以初速 v₀ 竖直上抛：到最高点 t=v₀/g、H=v₀²/2g；全程对称，落地总时间 2v₀/g。',
  create: () => {
    // 球心是质量点：p0 是球心坐标。贴地静止 = 球心在 groundY+radius；
    // 「从地面抛出」→ 起点球心贴地（否则 analyticNaturalEnd 判定起点在地面下，直接冻结）
    const R = 0.35
    const def: ScenarioDefinition = {
      templateId: 'vthrow',
      title: '竖直上抛（v₀=15 m/s）',
      objects: [
        {
          id: 'ball', label: '小球',
          p0: { x: 0, y: R }, v0: { x: 0, y: 15 },
          mass: 0.5, radius: R, color: '#7c3aed',
          motion: { kind: 'kinematic', a: { x: 0, y: -G }, landOnGround: true },
        },
      ],
      world: { gravity: { x: 0, y: -G }, groundY: 0 },
    }
    const params: ParamDef[] = [
      {
        key: 'v0', label: '初速度 v₀', unit: 'm/s', min: 1, max: 40, step: 0.5,
        group: 'ball',
        read: (d) => objValue(d, 'ball', (o) => o.v0.y, 15),
        apply: (d, v) => withObj(d, 'ball', (o) => ({ ...o, v0: { x: 0, y: v } })),
      },
      gParamSync(0),
    ]
    return { def, params }
  },
})

/* ================= P0：平抛 / 斜抛 ================= */

registerTemplate({
  id: 'projectile',
  title: '平抛 / 斜抛运动',
  emoji: '🏹',
  category: 'p0',
  description: '水平匀速、竖直自由落体独立叠加。飞行时间只由高度决定：t=√(2h/g)；射程 R=v₀cosθ·t。',
  create: () => {
    const def: ScenarioDefinition = {
      templateId: 'projectile',
      title: '斜抛运动（v₀=20 m/s，θ=45°）',
      objects: [
        {
          id: 'ball', label: '小球',
          p0: { x: 0, y: 8 }, v0: { x: 20 * Math.cos(rad(45)), y: 20 * Math.sin(rad(45)) },
          mass: 0.5, radius: 0.3, color: '#d97706',
          motion: { kind: 'kinematic', a: { x: 0, y: -G }, landOnGround: true },
        },
      ],
      world: { gravity: { x: 0, y: -G }, groundY: 0 },
    }
    const speed = (d: ScenarioDefinition) => objValue(d, 'ball', (o) => Math.hypot(o.v0.x, o.v0.y), 20)
    const angleDeg = (d: ScenarioDefinition) =>
      objValue(d, 'ball', (o) => Math.atan2(o.v0.y, o.v0.x), rad(45)) * (180 / Math.PI)
    const setV = (d: ScenarioDefinition, v: number, thDeg: number): ScenarioDefinition => {
      const a = rad(thDeg)
      return withObj(d, 'ball', (o) => ({ ...o, v0: { x: v * Math.cos(a), y: v * Math.sin(a) } }))
    }
    const params: ParamDef[] = [
      {
        key: 'v0', label: '初速度大小 v₀', unit: 'm/s', min: 1, max: 60, step: 0.5,
        group: 'ball',
        read: (d) => speed(d),
        apply: (d, v) => setV(d, v, angleDeg(d)),
      },
      {
        key: 'theta', label: '抛射角 θ', unit: '°', min: 0, max: 85, step: 1,
        group: 'ball',
        read: (d) => angleDeg(d),
        apply: (d, v) => setV(d, speed(d), v),
      },
      {
        key: 'h', label: '出手高度 h', unit: 'm', min: 0, max: 40, step: 0.5,
        group: 'ball',
        read: (d) => objValue(d, 'ball', (o) => o.p0.y, 8),
        // h=0（地面出手）：球心贴地于 groundY+radius，不能低于接触线（见 analyticNaturalEnd）
        apply: (d, v) => withObj(d, 'ball', (o) => ({ ...o, p0: { x: o.p0.x, y: Math.max(v, o.radius) } })),
      },
      gParamSync(0),
    ]
    return { def, params }
  },
})

/* ================= P0：匀速圆周运动 ================= */

registerTemplate({
  id: 'circular',
  title: '匀速圆周运动',
  emoji: '🔄',
  category: 'p0',
  description: 'v=ωr；向心加速度 a=ω²r=v²/r 始终指向圆心——方向时刻变化，故为变加速曲线运动。',
  create: () => {
    const centerY = 4.5
    const def: ScenarioDefinition = {
      templateId: 'circular',
      title: '匀速圆周运动（r=2 m，ω=2 rad/s）',
      objects: [
        {
          id: 'p', label: '小球',
          p0: { x: 3, y: centerY }, v0: { x: 0, y: 4 },
          mass: 1, radius: 0.3, color: '#2563eb',
          motion: { kind: 'circular', center: { x: 0, y: centerY }, radius: 2, omega: 2, phi0: 0 },
        },
      ],
      world: { gravity: { x: 0, y: -G } },
    }
    const params: ParamDef[] = [
      {
        key: 'r', label: '半径 r', unit: 'm', min: 0.3, max: 8, step: 0.1,
        group: 'p',
        read: (d) => objValue(d, 'p', (o) => (o.motion.kind === 'circular' ? o.motion.radius : 1), 2),
        apply: (d, v) =>
          withObj(d, 'p', (o) => {
            if (o.motion.kind !== 'circular') return o
            const w = o.motion.omega
            return {
              ...o,
              p0: { x: o.motion.center.x + v, y: o.motion.center.y },
              v0: { x: 0, y: v * w },
              motion: { ...o.motion, radius: v },
            }
          }),
      },
      {
        key: 'omega', label: '角速度 ω', unit: 'rad/s', min: 0.2, max: 8, step: 0.1,
        group: 'p',
        read: (d) => objValue(d, 'p', (o) => (o.motion.kind === 'circular' ? o.motion.omega : 2), 2),
        apply: (d, v) =>
          withObj(d, 'p', (o) => {
            if (o.motion.kind !== 'circular') return o
            return {
              ...o,
              v0: { x: 0, y: o.motion.radius * v },
              motion: { ...o.motion, omega: v },
            }
          }),
      },
    ]
    return { def, params }
  },
})

/* ================= P0：弹簧振子（水平简谐） ================= */

registerTemplate({
  id: 'shm',
  title: '弹簧振子 · 简谐运动',
  emoji: '🧲',
  category: 'p0',
  description: '回复力 F=−kx；动力学判据 a=−ω²x。周期 T=2π√(m/k)=2π/ω，与振幅无关。',
  create: () => {
    const eqY = 3
    const def: ScenarioDefinition = {
      templateId: 'shm',
      title: '弹簧振子（A=1.2 m，ω=2.5 rad/s）',
      objects: [
        {
          id: 'block', label: '振子',
          p0: { x: 1.2, y: eqY }, v0: { x: 0, y: 0 },
          mass: 1, radius: 0.3, color: '#059669',
          motion: {
            kind: 'harmonic', axis: { x: 1, y: 0 },
            equilibrium: { x: 0, y: eqY }, amplitude: 1.2, omega: 2.5, phi0: 0,
          },
        },
      ],
      world: { gravity: { x: 0, y: -G } },
    }
    const setAmp = (d: ScenarioDefinition, A: number) =>
      withObj(d, 'block', (o) =>
        o.motion.kind === 'harmonic'
          ? {
              ...o,
              p0: { x: o.motion.equilibrium.x + A, y: o.motion.equilibrium.y },
              motion: { ...o.motion, amplitude: A },
            }
          : o,
      )
    const params: ParamDef[] = [
      {
        key: 'A', label: '振幅 A', unit: 'm', min: 0.05, max: 5, step: 0.05,
        group: 'block',
        read: (d) => objValue(d, 'block', (o) => (o.motion.kind === 'harmonic' ? o.motion.amplitude : 1), 1.2),
        apply: (d, v) => setAmp(d, v),
      },
      {
        key: 'omega', label: '圆频率 ω', unit: 'rad/s', min: 0.3, max: 8, step: 0.1,
        group: 'block',
        read: (d) => objValue(d, 'block', (o) => (o.motion.kind === 'harmonic' ? o.motion.omega : 2.5), 2.5),
        apply: (d, v) =>
          withObj(d, 'block', (o) =>
            o.motion.kind === 'harmonic' ? { ...o, motion: { ...o.motion, omega: v } } : o,
          ),
      },
      {
        key: 'k', label: '等效劲度系数 k=mω²', unit: 'N/m', min: 0.1, max: 300, step: 0.5,
        group: 'block',
        read: (d) => {
          const o = findObj(d, 'block')
          return o.motion.kind === 'harmonic' ? o.mass * o.motion.omega * o.motion.omega : 6
        },
        apply: (d, v) =>
          withObj(d, 'block', (o) =>
            o.motion.kind === 'harmonic'
              ? { ...o, motion: { ...o.motion, omega: Math.sqrt(Math.max(0.01, v) / o.mass) } }
              : o,
          ),
      },
    ]
    return { def, params }
  },
})

/* ================= P0：单摆 ================= */

registerTemplate({
  id: 'pendulum',
  title: '单摆（小角度）',
  emoji: '⏱️',
  category: 'p0',
  description: '小角度近似 θ≈θ₀cos(ωt)，T=2π√(L/g) 与振幅、质量无关（伽利略发现）。',
  create: () => {
    const pivotY = 6
    const L = 3
    const th0 = rad(15)
    const def: ScenarioDefinition = {
      templateId: 'pendulum',
      title: '单摆（L=3 m，θ₀=15°）',
      objects: [
        {
          id: 'bob', label: '摆球',
          p0: { x: L * Math.sin(th0), y: pivotY - L * Math.cos(th0) },
          v0: { x: 0, y: 0 },
          mass: 1, radius: 0.25, color: '#0891b2',
          motion: {
            kind: 'pendulum', pivot: { x: 0, y: pivotY }, length: L,
            theta0: th0, omega: Math.sqrt(G / L), direction: 1,
          },
        },
      ],
      world: { gravity: { x: 0, y: -G }, groundY: 0 },
    }
    /** 摆参数整体重物化（L/θ₀/g 任一变化都保持其余值并重算 ω） */
    const rebuild = (d: ScenarioDefinition, Lv: number, thRad: number, g: number) =>
      withObj(d, 'bob', (o) => {
        if (o.motion.kind !== 'pendulum') return o
        const pv = o.motion.pivot
        return {
          ...o,
          p0: { x: pv.x + Lv * Math.sin(thRad), y: pv.y - Lv * Math.cos(thRad) },
          motion: {
            ...o.motion, length: Lv, theta0: thRad, omega: Math.sqrt(g / Lv),
          },
        }
      })
    const Lof = (d: ScenarioDefinition) =>
      objValue(d, 'bob', (o) => (o.motion.kind === 'pendulum' ? o.motion.length : L), L)
    const th0Deg = (d: ScenarioDefinition) =>
      objValue(d, 'bob', (o) => (o.motion.kind === 'pendulum' ? o.motion.theta0 : 0), 0) * (180 / Math.PI)
    const gOf = (d: ScenarioDefinition) => -d.world.gravity.y
    const withG = (d: ScenarioDefinition, g: number): ScenarioDefinition =>
      withObj(withGravity(d, g), 'bob', (o) => {
        if (o.motion.kind !== 'pendulum') return o
        return { ...o, motion: { ...o.motion, omega: Math.sqrt(g / o.motion.length) } }
      })
    const params: ParamDef[] = [
      {
        key: 'L', label: '摆长 L', unit: 'm', min: 0.3, max: 6, step: 0.1,
        group: 'bob',
        read: (d) => Lof(d),
        apply: (d, v) => rebuild(d, v, rad(th0Deg(d)), gOf(d)),
      },
      {
        key: 'theta0', label: '初始摆角 θ₀', unit: '°', min: 1, max: 45, step: 1,
        group: 'bob',
        read: (d) => th0Deg(d),
        apply: (d, v) => rebuild(d, Lof(d), rad(v), gOf(d)),
      },
      {
        key: 'g', label: '重力加速度 g', unit: 'm/s²', min: 1, max: 25, step: 0.1,
        group: 'world',
        read: (d) => gOf(d),
        apply: (d, v) => withG(d, v),
      },
    ]
    return { def, params }
  },
})

/* ================= P1：斜面滑块 ================= */

registerTemplate({
  id: 'incline',
  title: '斜面滑块',
  emoji: '📐',
  category: 'p1',
  description: '沿面加速度 a=g(sinθ−μcosθ)。μ=tanθ 为临界（匀速或恰好静止）。面为无限理想斜面。',
  create: () => {
    const thDeg = 30
    const th = rad(-thDeg) // 取负角：u=(cosθ,−sinθ)，下滑方向指向 +x
    const ux = Math.cos(th)
    const uy = Math.sin(th)
    const nx = -Math.sin(th)
    const ny = Math.cos(th)
    const R = 0.35
    const s0 = -3.5 // 起点在斜面高处（左上）
    const v0 = 4
    const def: ScenarioDefinition = {
      templateId: 'incline',
      title: '斜面滑块（θ=30°，μ=0.7，v₀=4 m/s）',
      objects: [
        {
          id: 'block', label: '滑块',
          p0: { x: s0 * ux + nx * R, y: s0 * uy + ny * R },
          v0: { x: v0 * ux, y: v0 * uy },
          mass: 2, radius: R, color: '#7c3aed',
          motion: { kind: 'numeric', spec: { contact: { type: 'plane', angle: th, friction: 0.7 } } },
        },
      ],
      world: { gravity: { x: 0, y: -G } },
    }
    /** 倾角变化：保持滑块的空间位置不变，速度重新投影沿新面 */
    const rebuildAngle = (d: ScenarioDefinition, thRad: number) => {
      const uxx = Math.cos(thRad)
      const uyy = Math.sin(thRad)
      const nxx = -Math.sin(thRad)
      const nyy = Math.cos(thRad)
      const o = findObj(d, 'block')
      const sNow = o.p0.x * uxx + o.p0.y * uyy
      const hNow = Math.max(R * 1.001, o.p0.x * nxx + o.p0.y * nyy)
      const speed = Math.hypot(o.v0.x, o.v0.y)
      const dir = o.v0.x * uxx + o.v0.y * uyy >= 0 ? 1 : -1
      return withObj(d, 'block', (bb) => ({
        ...bb,
        p0: { x: sNow * uxx + nxx * hNow, y: sNow * uyy + nyy * hNow },
        v0: { x: dir * speed * uxx, y: dir * speed * uyy },
        motion:
          bb.motion.kind === 'numeric' && bb.motion.spec.contact?.type === 'plane'
            ? {
                ...bb.motion,
                spec: { ...bb.motion.spec, contact: { ...bb.motion.spec.contact, angle: thRad } },
              }
            : bb.motion,
      }))
    }
    const plane = (d: ScenarioDefinition) => {
      const o = findObj(d, 'block')
      return o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'plane'
        ? o.motion.spec.contact
        : null
    }
    const thetaOf = (d: ScenarioDefinition) => Math.abs(plane(d)?.angle ?? 0) * (180 / Math.PI)
    const muOf = (d: ScenarioDefinition) => plane(d)?.friction ?? 0
    const v0Of = (d: ScenarioDefinition) => {
      const o = findObj(d, 'block')
      const p = plane(d)
      const sgn = p && o.v0.x * Math.cos(p.angle) + o.v0.y * Math.sin(p.angle) >= 0 ? 1 : -1
      return sgn * Math.hypot(o.v0.x, o.v0.y)
    }
    const params: ParamDef[] = [
      {
        key: 'theta', label: '倾角 θ', unit: '°', min: 5, max: 60, step: 1,
        group: 'block',
        read: (d) => thetaOf(d),
        apply: (d, v) => rebuildAngle(d, rad(-v)),
      },
      {
        key: 'mu', label: '摩擦系数 μ', unit: '', min: 0, max: 1.5, step: 0.01,
        group: 'block',
        read: (d) => muOf(d),
        apply: (d, v) =>
          withObj(d, 'block', (o) =>
            o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'plane'
              ? {
                  ...o,
                  motion: {
                    ...o.motion,
                    spec: { ...o.motion.spec, contact: { ...o.motion.spec.contact, friction: v } },
                  },
                }
              : o,
          ),
      },
      {
        key: 'v0', label: '初速度（沿斜面）', unit: 'm/s', min: -12, max: 12, step: 0.5,
        group: 'block',
        read: (d) => v0Of(d),
        apply: (d, v) => {
          const p = plane(d)
          if (!p) return d
          const uxx = Math.cos(p.angle)
          const uyy = Math.sin(p.angle)
          return withObj(d, 'block', (o) => ({ ...o, v0: { x: v * uxx, y: v * uyy } }))
        },
      },
    ]
    return { def, params }
  },
})

/* ================= P1：水平传送带 ================= */

registerTemplate({
  id: 'conveyor',
  title: '水平传送带',
  emoji: '🧳',
  category: 'p1',
  description: '静摩擦力驱动货物加速到带速；加速期相对滑动段为滑动摩擦 f=μmg。看 v-t 图拐点。',
  create: () => {
    const def: ScenarioDefinition = {
      templateId: 'conveyor',
      title: '水平传送带（带速 v=2 m/s，μ=0.3）',
      objects: [
        {
          id: 'box', label: '货物',
          p0: { x: -8, y: 0.5 }, v0: { x: 0, y: 0 },
          mass: 5, radius: 0.5, color: '#b45309',
          motion: {
            kind: 'numeric',
            spec: { contact: { type: 'plane', angle: 0, friction: 0.3, beltSpeed: 2 } },
          },
        },
      ],
      world: { gravity: { x: 0, y: -G } },
    }
    const contactOf = (d: ScenarioDefinition) => {
      const o = findObj(d, 'box')
      return o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'plane'
        ? o.motion.spec.contact
        : null
    }
    const params: ParamDef[] = [
      {
        key: 'belt', label: '传送带速度 v', unit: 'm/s', min: -4, max: 6, step: 0.1,
        group: 'box',
        read: (d) => contactOf(d)?.beltSpeed ?? 0,
        apply: (d, v) =>
          withObj(d, 'box', (o) =>
            o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'plane'
              ? {
                  ...o,
                  motion: {
                    ...o.motion,
                    spec: { ...o.motion.spec, contact: { ...o.motion.spec.contact, beltSpeed: v } },
                  },
                }
              : o,
          ),
      },
      {
        key: 'mu', label: '摩擦系数 μ', unit: '', min: 0.01, max: 1.2, step: 0.01,
        group: 'box',
        read: (d) => contactOf(d)?.friction ?? 0.3,
        apply: (d, v) =>
          withObj(d, 'box', (o) =>
            o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'plane'
              ? {
                  ...o,
                  motion: {
                    ...o.motion,
                    spec: { ...o.motion.spec, contact: { ...o.motion.spec.contact, friction: v } },
                  },
                }
              : o,
          ),
      },
    ]
    return { def, params }
  },
})

/* ================= P1：对心碰撞 ================= */

registerTemplate({
  id: 'collision',
  title: '碰撞 · 动量守恒',
  emoji: '💥',
  category: 'p1',
  description: '对心弹性/非弹性碰撞：动量恒守恒 m₁v₁+m₂v₂=m₁v₁′+m₂v₂′；e=1 动能守恒（速度交换），e=0 完全非弹性（共速）。',
  create: () => {
    const mk = (id: string, x: number, vx: number, m: number, color: string): ObjectDef => ({
      id, label: `${id} 球`,
      p0: { x, y: 1.5 }, v0: { x: vx, y: 0 },
      mass: m, radius: 0.5, color,
      motion: { kind: 'numeric', spec: { drag: { k: 0 } } },
      collidable: true, restitution: 1,
    })
    const def: ScenarioDefinition = {
      templateId: 'collision',
      title: '对心碰撞（等质量：A 以 4 m/s 撞静止 B）',
      objects: [mk('A', -4, 4, 1, '#2563eb'), mk('B', 4, 0, 1, '#dc2626')],
      world: { gravity: { x: 0, y: -G }, groundY: 0 },
    }
    const patch = (d: ScenarioDefinition, id: string, partial: Partial<ObjectDef>) =>
      withObj(d, id, (o) => ({ ...o, ...partial }))
    const params: ParamDef[] = [
      {
        key: 'vA', label: 'A 初速度 v_A', unit: 'm/s', min: -10, max: 10, step: 0.1,
        group: 'A',
        read: (d) => objValue(d, 'A', (o) => o.v0.x, 4),
        apply: (d, v) => patch(d, 'A', { v0: { x: v, y: 0 } }),
      },
      {
        key: 'vB', label: 'B 初速度 v_B', unit: 'm/s', min: -10, max: 10, step: 0.1,
        group: 'B',
        read: (d) => objValue(d, 'B', (o) => o.v0.x, 0),
        apply: (d, v) => patch(d, 'B', { v0: { x: v, y: 0 } }),
      },
      {
        key: 'mA', label: 'A 质量 m_A', unit: 'kg', min: 0.1, max: 10, step: 0.1,
        group: 'A',
        read: (d) => objValue(d, 'A', (o) => o.mass, 1),
        apply: (d, v) => patch(d, 'A', { mass: v }),
      },
      {
        key: 'mB', label: 'B 质量 m_B', unit: 'kg', min: 0.1, max: 10, step: 0.1,
        group: 'B',
        read: (d) => objValue(d, 'B', (o) => o.mass, 1),
        apply: (d, v) => patch(d, 'B', { mass: v }),
      },
      {
        key: 'e', label: '恢复系数 e', unit: '', min: 0, max: 1, step: 0.05,
        group: 'world',
        read: (d) => findObj(d, 'A').restitution ?? 1,
        apply: (d, v) => ({
          ...d,
          objects: d.objects.map((o) =>
            o.id === 'A' || o.id === 'B' ? { ...o, restitution: v } : o,
          ),
        }),
      },
    ]
    return { def, params }
  },
})

/* ================= P1：追及相遇 ================= */

registerTemplate({
  id: 'pursuit',
  title: '追及相遇',
  emoji: '🏃',
  category: 'p1',
  description: 'A 匀速追前方 100 m 处从静止匀加速出发的 B。位移相等即相遇；速度相等时刻距离极值。',
  create: () => {
    const y = 2
    const def: ScenarioDefinition = {
      templateId: 'pursuit',
      title: '追及相遇（A 匀速 v=12 m/s，B 匀加速 a=2 m/s²）',
      objects: [
        {
          id: 'A', label: 'A', p0: { x: 0, y }, v0: { x: 12, y: 0 },
          mass: 1, radius: 0.4, color: '#2563eb',
          motion: { kind: 'kinematic', a: { x: 0, y: 0 }, landOnGround: false },
        },
        {
          id: 'B', label: 'B', p0: { x: 100, y }, v0: { x: 0, y: 0 },
          mass: 1, radius: 0.4, color: '#dc2626',
          motion: { kind: 'kinematic', a: { x: 2, y: 0 }, landOnGround: false },
        },
      ],
      world: { gravity: { x: 0, y: -G }, groundY: 0 },
    }
    const params: ParamDef[] = [
      {
        key: 'vA', label: 'A 速度（匀速）', unit: 'm/s', min: 1, max: 40, step: 0.5,
        group: 'A',
        read: (d) => objValue(d, 'A', (o) => o.v0.x, 12),
        apply: (d, v) => withObj(d, 'A', (o) => ({ ...o, v0: { x: v, y: 0 } })),
      },
      {
        key: 'aB', label: 'B 加速度（初速 0）', unit: 'm/s²', min: 0, max: 8, step: 0.1,
        group: 'B',
        read: (d) =>
          objValue(d, 'B', (o) => (o.motion.kind === 'kinematic' ? o.motion.a.x : 0), 2),
        apply: (d, v) =>
          withObj(d, 'B', (o) =>
            o.motion.kind === 'kinematic'
              ? { ...o, motion: { ...o.motion, a: { x: v, y: 0 } } }
              : o,
          ),
      },
      {
        key: 'd0', label: '初始距离 d', unit: 'm', min: 5, max: 400, step: 5,
        group: 'world',
        read: (d) => objValue(d, 'B', (o) => o.p0.x, 100) - objValue(d, 'A', (o) => o.p0.x, 0),
        apply: (d, v) => {
          const ax = objValue(d, 'A', (o) => o.p0.x, 0)
          return withObj(d, 'B', (o) => ({ ...o, p0: { x: ax + v, y: o.p0.y } }))
        },
      },
    ]
    return { def, params }
  },
})

/* ================================================================
   P2：高考电磁场 + 综合力运动模型
   约定：数值粒子按真实 q·E/q·v×B 受力；磁场 B 垂直纸面，正 = 向外(⊙)。
   ================================================================ */

/* ================= P2：带电粒子在匀强电场（平行板偏转） ================= */

registerTemplate({
  id: 'charged_efield',
  title: '带电粒子在匀强电场',
  emoji: '⚡',
  category: 'p2',
  description:
    '平行板偏转模型（忽略重力）：板内做类平抛 a=qE/m，出板后匀速直线。F=qE；q<0（如电子）偏向正极板。',
  create: () => {
    const HALF = 4 // 板半长
    const GAP = 2.5 // 场区半高
    const PY = 3.0 // 极板中心高
    const PH = 0.25
    const M = 0.02 // 20 g 粒子；q/m = 1×10⁻³ C/kg
    const fields = (E: number) => [
      {
        rect: { minX: -HALF, maxX: HALF, minY: -GAP, maxY: GAP },
        electric: { x: 0, y: -E },
      },
    ]
    const def: ScenarioDefinition = {
      templateId: 'charged_efield',
      title: '带电粒子偏转（q=-20 μC，E=1×10³ V/m，v₀=4 m/s）',
      duration: 4.5,
      objects: [
        {
          id: 'p', label: '带电粒子',
          p0: { x: -7.5, y: 0 }, v0: { x: 4, y: 0 },
          mass: M, radius: 0.16, color: '#db2777',
          charge: -20e-6,
          motion: { kind: 'numeric', spec: {} },
        },
        {
          id: 'plateT', label: '上极板 +',
          p0: { x: 0, y: PY }, v0: { x: 0, y: 0 },
          mass: 1, radius: PH, rectW: HALF * 2, shape: 'rect', color: '#cbd5e1',
          motion: { kind: 'static' },
        },
        {
          id: 'plateB', label: '下极板 −',
          p0: { x: 0, y: -PY }, v0: { x: 0, y: 0 },
          mass: 1, radius: PH, rectW: HALF * 2, shape: 'rect', color: '#94a3b8',
          motion: { kind: 'static' },
        },
      ],
      world: { gravity: { x: 0, y: 0 }, fields: fields(1000) },
    }
    const readF = (d: ScenarioDefinition) => (d.world.fields?.[0]?.electric?.y ?? -1000) * -1
    const withE = (d: ScenarioDefinition, E: number): ScenarioDefinition => ({
      ...d,
      world: { ...d.world, fields: fields(E) },
    })
    const params: ParamDef[] = [
      {
        key: 'v0', label: '初速度 v₀', unit: 'm/s', min: 1, max: 10, step: 0.5,
        group: 'p',
        read: (d) => objValue(d, 'p', (o) => o.v0.x, 4),
        apply: (d, v) => withObj(d, 'p', (o) => ({ ...o, v0: { x: v, y: 0 } })),
      },
      {
        key: 'E', label: '场强 E（竖直向下）', unit: 'V/m', min: 0, max: 3000, step: 100,
        group: 'p',
        read: (d) => readF(d),
        apply: (d, v) => withE(d, v),
      },
      {
        key: 'q', label: '电荷量 q', unit: 'μC', min: -60, max: 60, step: 5,
        group: 'p',
        read: (d) => objValue(d, 'p', (o) => o.charge ?? 0, -20e-6) * 1e6,
        apply: (d, v) => withObj(d, 'p', (o) => ({ ...o, charge: v * 1e-6 })),
      },
    ]
    return { def, params }
  },
})

/* ================= P2：带电粒子在匀强磁场（匀速圆周） ================= */

registerTemplate({
  id: 'charged_bfield',
  title: '带电粒子在匀强磁场',
  emoji: '🧭',
  category: 'p2',
  description:
    '垂直进入匀强磁场做匀速圆周：r=mv/(qB)，T=2πm/(qB) 与速度无关。洛伦兹力始终垂直速度、不做功。演示量：m/q=1，r=v/B。',
  create: () => {
    const M = 0.05 // 50 g 带电小球；q/m = 1 C/kg（r = v/B 的整洁演示量）
    // 初态约定：从原点出发竖直向上，洛伦兹力把圆心置于 (r, 0)
    const mk = (v: number, B: number, q: number) => {
      const w = (-q * B) / M // 解析圆周角速度（符号含旋转方向）
      const r = (M * v) / (q * B)
      return {
        motion: {
          kind: 'circular',
          center: { x: r, y: 0 },
          radius: r,
          omega: w,
          phi0: Math.PI,
        },
        p0: { x: 0, y: 0 },
        v0: { x: 0, y: v },
      } as const
    }
    const def: ScenarioDefinition = {
      templateId: 'charged_bfield',
      title: '磁场匀速圆周（v=4 m/s，B=2 T，q=0.05 C）',
      objects: [
        {
          id: 'p', label: '带电粒子',
          ...mk(4, 2, 0.05),
          mass: M, radius: 0.22, color: '#0d9488',
          charge: 0.05,
        },
      ],
      world: { gravity: { x: 0, y: 0 }, fields: [{ magnetic: 2 }] },
    }
    const readQ = (d: ScenarioDefinition) => objValue(d, 'p', (o) => o.charge ?? 0.05, 0.05)
    const readB = (d: ScenarioDefinition) => d.world.fields?.[0]?.magnetic ?? 2
    const readV = (d: ScenarioDefinition) => {
      const o = findObj(d, 'p')
      return o.motion.kind === 'circular' ? o.motion.radius * Math.abs(o.motion.omega) : 4
    }
    const rebuild = (d: ScenarioDefinition, v: number, B: number, q: number): ScenarioDefinition =>
      withObj(d, 'p', (o) => ({ ...o, ...mk(v, B, q) }))
    const params: ParamDef[] = [
      {
        key: 'v0', label: '速率 v（垂直入场）', unit: 'm/s', min: 0.5, max: 10, step: 0.5,
        group: 'p',
        read: (d) => readV(d),
        apply: (d, v) => rebuild(d, v, readB(d), readQ(d)),
      },
      {
        key: 'B', label: '磁感应强度 B（向外 ⊙）', unit: 'T', min: 0.1, max: 6, step: 0.1,
        group: 'p',
        read: (d) => readB(d),
        apply: (d, v) => ({
          ...rebuild(d, readV(d), v, readQ(d)),
          world: { ...d.world, fields: [{ magnetic: v }] },
        }),
      },
      {
        key: 'q', label: '电荷量 q', unit: 'C', min: 0.005, max: 0.2, step: 0.005,
        group: 'p',
        read: (d) => readQ(d),
        apply: (d, v) => rebuild(d, readV(d), readB(d), v),
      },
    ]
    return { def, params }
  },
})

/* ================= P2：组合场（电场加速 + 磁场回旋偏转） ================= */

registerTemplate({
  id: 'charged_combo',
  title: '组合场：电场加速 + 磁场回旋',
  emoji: '🌀',
  category: 'p2',
  description:
    '质谱仪式组合场：左侧匀强电场 +x 加速，跨过分界进入右侧磁场做半圆周（r=mv/qB），穿回左侧又被电场减速、折返——周期往返的回旋运动。演示量 q/m=2 C/kg。',
  create: () => {
    const M = 0.01
    const Q = 0.02 // q/m = 2 C/kg → a_x = 2E
    const def: ScenarioDefinition = {
      templateId: 'charged_combo',
      title: '组合场：电场加速 + 磁场回旋（E=5 V/m，B=2 T）',
      objects: [
        {
          id: 'p', label: '带电粒子',
          p0: { x: -5.2, y: 0 }, v0: { x: 0, y: 0 },
          mass: M, radius: 0.18, color: '#7c3aed',
          charge: Q,
          motion: { kind: 'numeric', spec: {} },
        },
      ],
      world: {
        gravity: { x: 0, y: 0 },
        fields: [
          {
            rect: { minX: -5.3, maxX: -0.05, minY: -6, maxY: 6 },
            electric: { x: 5, y: 0 },
          },
          {
            rect: { minX: 0.05, maxX: 8, minY: -6, maxY: 6 },
            magnetic: 2,
          },
        ],
      },
    }
    const readE = (d: ScenarioDefinition) => d.world.fields?.[0]?.electric?.x ?? 5
    const readB = (d: ScenarioDefinition) => d.world.fields?.[1]?.magnetic ?? 2
    const withE = (d: ScenarioDefinition, E: number): ScenarioDefinition => ({
      ...d,
      world: {
        ...d.world,
        fields: d.world.fields!.map((f, i) =>
          i === 0 && f.electric ? { ...f, electric: { x: E, y: 0 } } : f,
        ),
      },
    })
    const withB = (d: ScenarioDefinition, B: number): ScenarioDefinition => ({
      ...d,
      world: {
        ...d.world,
        fields: d.world.fields!.map((f, i) => (i === 1 && f.magnetic ? { ...f, magnetic: B } : f)),
      },
    })
    const params: ParamDef[] = [
      {
        key: 'E', label: '电场强度 E（+x 加速段）', unit: 'V/m', min: 0, max: 30, step: 0.5,
        group: 'p',
        read: (d) => readE(d),
        apply: (d, v) => withE(d, v),
      },
      {
        key: 'B', label: '磁感应强度 B（向外 ⊙）', unit: 'T', min: 0.1, max: 6, step: 0.1,
        group: 'p',
        read: (d) => readB(d),
        apply: (d, v) => withB(d, v),
      },
      {
        key: 'v0', label: '初始速度（进入加速段）', unit: 'm/s', min: 0, max: 8, step: 0.5,
        group: 'p',
        read: (d) => objValue(d, 'p', (o) => o.v0.x, 0),
        apply: (d, v) => withObj(d, 'p', (o) => ({ ...o, v0: { x: v, y: 0 } })),
      },
    ]
    return { def, params }
  },
})

/* ================= P2：竖直圆环轨道内的小球 ================= */

registerTemplate({
  id: 'ring_ball',
  title: '竖直圆环内壁运动',
  emoji: '⭕',
  category: 'p2',
  description:
    '小球在竖直圆环内壁运动（轨道模型）：贴壁时支持力 N=m(v²/R−a_in) 指向圆心；N→0 即脱离内壁做抛体，落回壁面反弹。验证临界条件与能量转化。',
  create: () => {
    const CY = 4 // 环心高
    const R = 2.5 // 环半径
    const r = 0.35 // 小球半径
    const contact = (radius: number) => ({
      type: 'circle' as const,
      center: { x: 0, y: CY },
      radius,
      restitution: 0.9,
      friction: 0,
    })
    const def: ScenarioDefinition = {
      templateId: 'ring_ball',
      title: '竖直圆环内壁（R=2.5 m，从顶部释放）',
      objects: [
        {
          id: 'ball', label: '小球',
          p0: { x: 0.2, y: CY + (R - r) }, v0: { x: 1.2, y: 0 },
          mass: 0.5, radius: r, color: '#ea580c',
          motion: { kind: 'numeric', spec: { contact: contact(R) } },
        },
      ],
      world: { gravity: { x: 0, y: -G } },
    }
    const params: ParamDef[] = [
      {
        key: 'R', label: '圆环半径 R', unit: 'm', min: 1.2, max: 5, step: 0.1,
        group: 'ball',
        read: (d) => {
          const o = findObj(d, 'ball')
          return o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
            ? o.motion.spec.contact.radius
            : R
        },
        apply: (d, v) =>
          withObj(d, 'ball', (o) =>
            o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
              ? {
                  ...o,
                  p0: { x: 0.2, y: CY + (v - r) },
                  motion: { ...o.motion, spec: { ...o.motion.spec, contact: contact(v) } },
                }
              : o,
          ),
      },
      {
        key: 'v0', label: '释放速度（切向）', unit: 'm/s', min: 0, max: 8, step: 0.2,
        group: 'ball',
        read: (d) => objValue(d, 'ball', (o) => Math.hypot(o.v0.x, o.v0.y), 1.2),
        apply: (d, v) => withObj(d, 'ball', (o) => ({ ...o, v0: { x: v, y: 0 } })),
      },
      {
        key: 'e', label: '环壁恢复系数 e', unit: '', min: 0.2, max: 1, step: 0.05,
        group: 'ball',
        read: (d) => {
          const o = findObj(d, 'ball')
          return o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
            ? o.motion.spec.contact.restitution
            : 0.9
        },
        apply: (d, v) =>
          withObj(d, 'ball', (o) =>
            o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
              ? {
                  ...o,
                  motion: {
                    ...o.motion,
                    spec: { ...o.motion.spec, contact: { ...o.motion.spec.contact, restitution: v } },
                  },
                }
              : o,
          ),
      },
      {
        key: 'mu', label: '环壁摩擦系数 μ', unit: '', min: 0, max: 0.8, step: 0.05,
        group: 'ball',
        read: (d) => {
          const o = findObj(d, 'ball')
          return o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
            ? (o.motion.spec.contact.friction ?? 0)
            : 0
        },
        apply: (d, v) =>
          withObj(d, 'ball', (o) =>
            o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
              ? {
                  ...o,
                  motion: {
                    ...o.motion,
                    spec: { ...o.motion.spec, contact: { ...o.motion.spec.contact, friction: v } },
                  },
                }
              : o,
          ),
      },
    ]
    return { def, params }
  },
})

/* ================= P2：水平圆环内碰撞（两小球） ================= */

registerTemplate({
  id: 'ring_collision',
  title: '圆环内碰撞',
  emoji: '🎱',
  category: 'p2',
  description:
    '俯视水平光滑圆环：两小球沿直径对心相向运动，在环内来回碰撞（弹性 e 可调）。动量守恒、能量无损失的周期性演示。',
  create: () => {
    const r = 0.3
    const contactOf = (radius: number) => ({
      type: 'circle' as const,
      center: { x: 0, y: 0 },
      radius,
      restitution: 1,
    })
    const mk = (id: string, x: number, vx: number, color: string): ObjectDef => ({
      id, label: `${id} 球`,
      p0: { x, y: 0 }, v0: { x: vx, y: 0 },
      mass: 1, radius: r, color,
      motion: { kind: 'numeric', spec: { contact: contactOf(2.6) } },
      collidable: true, restitution: 1,
    })
    const def: ScenarioDefinition = {
      templateId: 'ring_collision',
      title: '圆环内碰撞（R=2.6 m，A/B 对心相撞）',
      objects: [mk('A', -1, 2, '#2563eb'), mk('B', 1, -2, '#dc2626')],
      world: { gravity: { x: 0, y: 0 } },
    }
    const ringOf = (d: ScenarioDefinition) => {
      const o = findObj(d, 'A')
      return o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
        ? o.motion.spec.contact.radius
        : 2.6
    }
    const withRing = (d: ScenarioDefinition, radius: number): ScenarioDefinition => ({
      ...d,
      objects: d.objects.map((o) =>
        o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
          ? { ...o, motion: { ...o.motion, spec: { ...o.motion.spec, contact: contactOf(radius) } } }
          : o,
      ),
    })
    const patch = (d: ScenarioDefinition, id: string, partial: Partial<ObjectDef>) =>
      withObj(d, id, (o) => ({ ...o, ...partial }))
    const params: ParamDef[] = [
      {
        key: 'vA', label: 'A 初速度 v_A', unit: 'm/s', min: 0.5, max: 6, step: 0.1,
        group: 'A',
        read: (d) => objValue(d, 'A', (o) => o.v0.x, 2),
        apply: (d, v) => patch(d, 'A', { v0: { x: v, y: 0 } }),
      },
      {
        key: 'vB', label: 'B 初速度 v_B', unit: 'm/s', min: -6, max: -0.5, step: 0.1,
        group: 'B',
        read: (d) => objValue(d, 'B', (o) => o.v0.x, -2),
        apply: (d, v) => patch(d, 'B', { v0: { x: v, y: 0 } }),
      },
      {
        key: 'e', label: '碰撞/环壁恢复系数 e', unit: '', min: 0.2, max: 1, step: 0.05,
        group: 'world',
        read: (d) => findObj(d, 'A').restitution ?? 1,
        apply: (d, v) => ({
          ...withRing(d, ringOf(d)),
          objects: d.objects.map((o) =>
            o.id === 'A' || o.id === 'B'
              ? {
                  ...o,
                  restitution: v,
                  motion:
                    o.motion.kind === 'numeric' && o.motion.spec.contact?.type === 'circle'
                      ? {
                          ...o.motion,
                          spec: { ...o.motion.spec, contact: { ...o.motion.spec.contact, restitution: v } },
                        }
                      : o.motion,
                }
              : o,
          ),
        }),
      },
      {
        key: 'R', label: '圆环半径 R', unit: 'm', min: 1.6, max: 5, step: 0.1,
        group: 'world',
        read: (d) => ringOf(d),
        apply: (d, v) => withRing(d, v),
      },
    ]
    return { def, params }
  },
})

/* ================= P2：竖直圆周（绳模型） ================= */

registerTemplate({
  id: 'vcircle_rope',
  title: '竖直圆周 · 绳模型',
  emoji: '🪢',
  category: 'p2',
  description:
    '绳只能拉不能撑：恰能过最高点 v=√(gL)（最低点需 v₀=√(5gL)）；不足则中途松绳（张力为 0 → 斜抛 → 再次绷紧），即"脱绳"题型。',
  create: () => {
    const pivot = { x: 0, y: 6.2 }
    const bob = (L: number): Pick<ObjectDef, 'p0' | 'v0' | 'motion' | 'constraints'> => ({
      p0: { x: pivot.x, y: pivot.y - L },
      v0: { x: 10, y: 0 },
      motion: { kind: 'numeric', spec: {} },
      constraints: [{ kind: 'rope' as const, otherId: 'O', length: L }],
    })
    const def: ScenarioDefinition = {
      templateId: 'vcircle_rope',
      title: '竖直圆周·绳（L=1.8 m，v₀=10 m/s，临界 √(5gL)≈9.4 m/s）',
      objects: [
        {
          id: 'ball', label: '小球', mass: 0.5, radius: 0.22, color: '#2563eb',
          ...bob(1.8),
        },
        {
          id: 'O', label: '固定点 O',
          p0: { x: pivot.x, y: pivot.y }, v0: { x: 0, y: 0 },
          mass: 1, radius: 0.18, color: '#64748b',
          motion: { kind: 'static' },
        },
      ],
      world: { gravity: { x: 0, y: -G } },
    }
    const Lof = (d: ScenarioDefinition) => {
      const o = findObj(d, 'ball')
      return o.constraints?.[0]?.length ?? 1.8
    }
    const params: ParamDef[] = [
      {
        key: 'v0', label: '最低点速率 v₀', unit: 'm/s', min: 2, max: 14, step: 0.1,
        group: 'ball',
        read: (d) => objValue(d, 'ball', (o) => Math.hypot(o.v0.x, o.v0.y), 10),
        apply: (d, v) => withObj(d, 'ball', (o) => ({ ...o, v0: { x: v, y: 0 } })),
      },
      {
        key: 'L', label: '绳长 L', unit: 'm', min: 0.6, max: 3.5, step: 0.1,
        group: 'ball',
        read: (d) => Lof(d),
        apply: (d, v) => withObj(d, 'ball', (o) => ({
          ...o,
          p0: { x: pivot.x, y: pivot.y - v },
          constraints: [{ kind: 'rope', otherId: 'O', length: v }],
        })),
      },
      {
        key: 'g', label: '重力加速度 g', unit: 'm/s²', min: 1, max: 25, step: 0.1,
        group: 'world',
        read: (d) => -d.world.gravity.y,
        apply: (d, v) => withGravity(d, v),
      },
    ]
    return { def, params }
  },
})

/* ================= P2：竖直圆周（杆模型） ================= */

registerTemplate({
  id: 'vcircle_rod',
  title: '竖直圆周 · 杆模型',
  emoji: '🎣',
  category: 'p2',
  description:
    '杆既能拉也能撑：过最高点只需 v>0（无临界）。最高点杆可对小球施支持力（"恰好通过"条件与绳模型对比）。',
  create: () => {
    const pivot = { x: 0, y: 6.2 }
    const def: ScenarioDefinition = {
      templateId: 'vcircle_rod',
      title: '竖直圆周·杆（L=1.8 m，v₀=10 m/s）',
      objects: [
        {
          id: 'ball', label: '小球',
          p0: { x: pivot.x, y: pivot.y - 1.8 }, v0: { x: 10, y: 0 },
          mass: 0.5, radius: 0.22, color: '#059669',
          motion: { kind: 'numeric', spec: {} },
          constraints: [{ kind: 'rod', otherId: 'O', length: 1.8 }],
        },
        {
          id: 'O', label: '固定点 O',
          p0: { x: pivot.x, y: pivot.y }, v0: { x: 0, y: 0 },
          mass: 1, radius: 0.18, color: '#64748b',
          motion: { kind: 'static' },
        },
      ],
      world: { gravity: { x: 0, y: -G } },
    }
    const Lof = (d: ScenarioDefinition) => {
      const o = findObj(d, 'ball')
      return o.constraints?.[0]?.length ?? 1.8
    }
    const params: ParamDef[] = [
      {
        key: 'v0', label: '最低点速率 v₀', unit: 'm/s', min: 1, max: 14, step: 0.1,
        group: 'ball',
        read: (d) => objValue(d, 'ball', (o) => Math.hypot(o.v0.x, o.v0.y), 10),
        apply: (d, v) => withObj(d, 'ball', (o) => ({ ...o, v0: { x: v, y: 0 } })),
      },
      {
        key: 'L', label: '杆长 L', unit: 'm', min: 0.6, max: 3.5, step: 0.1,
        group: 'ball',
        read: (d) => Lof(d),
        apply: (d, v) => withObj(d, 'ball', (o) => ({
          ...o,
          p0: { x: pivot.x, y: pivot.y - v },
          constraints: [{ kind: 'rod', otherId: 'O', length: v }],
        })),
      },
      {
        key: 'g', label: '重力加速度 g', unit: 'm/s²', min: 1, max: 25, step: 0.1,
        group: 'world',
        read: (d) => -d.world.gravity.y,
        apply: (d, v) => withGravity(d, v),
      },
    ]
    return { def, params }
  },
})

/* ================= P2：弹簧连接体（两滑块） ================= */

registerTemplate({
  id: 'spring_pair',
  title: '弹簧连接体',
  emoji: '🪗',
  category: 'p2',
  description:
    '光滑水平面上弹簧连接两物块（内力等大反向、动量守恒）：相对简谐振动，角频率 ω=√(k(1/m₁+1/m₂))。从拉长状态静止释放，观察质心不动、两端反向振动。',
  create: () => {
    const mk = (id: string, label: string, x: number, color: string, spring?: boolean): ObjectDef => ({
      id, label,
      p0: { x, y: 0 }, v0: { x: 0, y: 0 },
      mass: 1, radius: 0.3, color,
      motion: spring
        ? { kind: 'numeric', spec: { spring: { otherId: 'B', k: 8, restLength: 2 } } }
        : { kind: 'numeric', spec: {} },
    })
    const def: ScenarioDefinition = {
      templateId: 'spring_pair',
      title: '弹簧连接体（k=8 N/m，拉长 1 m 释放）',
      objects: [mk('A', '甲', -1.5, '#2563eb', true), mk('B', '乙', 1.5, '#dc2626')],
      world: { gravity: { x: 0, y: 0 } },
    }
    const gapOf = (d: ScenarioDefinition) =>
      objValue(d, 'B', (o) => o.p0.x, 1.5) - objValue(d, 'A', (o) => o.p0.x, -1.5)
    const params: ParamDef[] = [
      {
        key: 'k', label: '劲度系数 k', unit: 'N/m', min: 0.5, max: 30, step: 0.5,
        group: 'A',
        read: (d) => {
          const o = findObj(d, 'A')
          return o.motion.kind === 'numeric' && o.motion.spec.spring ? o.motion.spec.spring.k : 8
        },
        apply: (d, v) => withObj(d, 'A', (o) =>
          o.motion.kind === 'numeric' && o.motion.spec.spring
            ? { ...o, motion: { ...o.motion, spec: { ...o.motion.spec, spring: { ...o.motion.spec.spring, k: v } } } }
            : o,
        ),
      },
      {
        key: 'd0', label: '初始间距（静止释放）', unit: 'm', min: 2.2, max: 6, step: 0.1,
        group: 'world',
        read: (d) => gapOf(d),
        apply: (d, v) => ({
          ...d,
          objects: d.objects.map((o) =>
            o.id === 'A' || o.id === 'B'
              ? { ...o, p0: { x: (o.id === 'A' ? -1 : 1) * (v / 2), y: 0 } }
              : o,
          ),
        }),
      },
      {
        key: 'mB', label: '乙质量 m_B', unit: 'kg', min: 0.2, max: 5, step: 0.1,
        group: 'B',
        read: (d) => objValue(d, 'B', (o) => o.mass, 1),
        apply: (d, v) => withObj(d, 'B', (o) => ({ ...o, mass: v })),
      },
    ]
    return { def, params }
  },
})

/* ================= P2：板块模型 ================= */

registerTemplate({
  id: 'board_block',
  title: '板块模型',
  emoji: '🛹',
  category: 'p2',
  description:
    '物块以 v₀ 冲上粗糙地面上的木板（板面 μ₁、地面 μ₂）：两者间摩擦等大反向、系统动量守恒；相对静止后整体减速停下。可加外力 F 考察相对滑动条件。',
  create: () => {
    const M = 2 // 板质量
    const boardY = 0.18 // 板中心高（半高 0.18 → 上表面 0.36）
    const mkBoard = (): Omit<ObjectDef, 'id' | 'label'> => ({
      p0: { x: 0, y: boardY },
      v0: { x: 0, y: 0 },
      mass: M,
      radius: 0.18, rectW: 8, shape: 'rect' as const, color: '#b45309',
      motion: { kind: 'numeric', spec: { contact: { type: 'floor', restitution: 0, friction: 0.1 } } },
    })
    const mkBlock = (): Omit<ObjectDef, 'id' | 'label'> => ({
      p0: { x: -2.6, y: boardY * 2 + 0.3 },
      v0: { x: 5, y: 0 },
      mass: 1, radius: 0.3, color: '#1d4ed8',
      motion: {
        kind: 'numeric' as const,
        spec: {
          contact: { type: 'plane' as const, angle: 0, friction: 0.4, anchorId: 'board' },
        },
      },
    })
    const def: ScenarioDefinition = {
      templateId: 'board_block',
      title: '板块模型（m=1 kg 冲上 M=2 kg 木板：μ₁=0.4，μ₂=0.1）',
      objects: [
        { id: 'block', label: '物块', ...mkBlock() },
        { id: 'board', label: '木板', ...mkBoard() },
      ],
      world: { gravity: { x: 0, y: -G }, groundY: 0 },
    }
    const muOf = (d: ScenarioDefinition, id: string) => {
      const o = findObj(d, id)
      return o.motion.kind === 'numeric' &&
        o.motion.spec.contact &&
        (o.motion.spec.contact.type === 'floor' || o.motion.spec.contact.type === 'plane')
        ? o.motion.spec.contact.friction
        : 0
    }
    const withMu = (d: ScenarioDefinition, id: string, mu: number) =>
      withObj(d, id, (o) =>
        o.motion.kind === 'numeric' &&
        o.motion.spec.contact &&
        (o.motion.spec.contact.type === 'floor' || o.motion.spec.contact.type === 'plane')
          ? { ...o, motion: { ...o.motion, spec: { ...o.motion.spec, contact: { ...o.motion.spec.contact, friction: mu } } } }
          : o,
      )
    const params: ParamDef[] = [
      {
        key: 'v0', label: '物块初速度 v₀', unit: 'm/s', min: 0, max: 8, step: 0.5,
        group: 'block',
        read: (d) => objValue(d, 'block', (o) => o.v0.x, 5),
        apply: (d, v) => withObj(d, 'block', (o) => ({ ...o, v0: { x: v, y: 0 } })),
      },
      {
        key: 'F', label: '物块所受水平外力 F', unit: 'N', min: 0, max: 12, step: 0.5,
        group: 'block',
        read: (d) => objValue(d, 'block', (o) => o.appliedForce?.x ?? 0, 0),
        apply: (d, v) => withObj(d, 'block', (o) => ({
          ...o,
          appliedForce: v > 1e-9 ? { x: v, y: 0 } : undefined,
        })),
      },
      {
        key: 'mu1', label: '板面摩擦系数 μ₁', unit: '', min: 0, max: 0.9, step: 0.01,
        group: 'block',
        read: (d) => muOf(d, 'block'),
        apply: (d, v) => withMu(d, 'block', v),
      },
      {
        key: 'mu2', label: '地面摩擦系数 μ₂', unit: '', min: 0, max: 0.5, step: 0.01,
        group: 'board',
        read: (d) => muOf(d, 'board'),
        apply: (d, v) => withMu(d, 'board', v),
      },
      {
        key: 'M', label: '木板质量 M', unit: 'kg', min: 0.5, max: 6, step: 0.1,
        group: 'board',
        read: (d) => objValue(d, 'board', (o) => o.mass, M),
        apply: (d, v) => withObj(d, 'board', (o) => ({ ...o, mass: v })),
      },
      {
        key: 'm', label: '物块质量 m', unit: 'kg', min: 0.2, max: 4, step: 0.1,
        group: 'block',
        read: (d) => objValue(d, 'block', (o) => o.mass, 1),
        apply: (d, v) => withObj(d, 'block', (o) => ({ ...o, mass: v })),
      },
    ]
    return { def, params }
  },
})
