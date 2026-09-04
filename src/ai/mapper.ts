// 场景映射器：ParsedResult（AI 中间表示）→ ScenarioDefinition + 参数面板。
// 关键设计：把模型输出的教学语义落到引擎可表达的形态——物体交互(摩擦/阻力/传送带/碰撞/
// 追及/约束)一律数值积分；单物体教科书形态(匀变/抛体/圆周/简谐/摆)用解析解。
// 映射失败抛 SceneBuildError（kind 'scene'，中文说明，转人工校正）。
import type {
  ObjectDef,
  ParamDef,
  ScenarioDefinition,
  ContactPlane,
  MotionMode,
} from '../engine/types'

type NumericSpec = Extract<MotionMode, { kind: 'numeric' }>['spec']
import { DEFAULT_GRAVITY } from '../engine/types'
import type { ParsedObject, ParsedResult } from './types'

export class SceneBuildError extends Error {
  kind = 'scene' as const
  constructor(message: string) {
    super(message)
  }
}

export interface SceneBuild {
  def: ScenarioDefinition
  params: ParamDef[]
  /** 映射过程中的近似/假设提示（展示一次给用户） */
  note: string[]
}

const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#b45309', '#64748b']
const R = 0.35
const DEG = Math.PI / 180

function fail(msg: string): never {
  throw new SceneBuildError(msg)
}

function defaultRadius(mass: number): number {
  if (mass >= 4) return 0.5
  if (mass <= 0.3) return 0.28
  return 0.35
}

/* ============ 物体运动形态解析 ============ */

interface ObjPlan {
  obj: ParsedObject
  def: ObjectDef
  /** 模式名（调试/UI 徽标用） */
  modeName: string
}

function planObject(
  o: ParsedObject,
  parsed: ParsedResult,
  idx: number,
  note: string[],
  vcAnchors: Map<string, string>,
): ObjPlan {
  const worldG = parsed.gravity ?? DEFAULT_GRAVITY
  const gMag = Math.hypot(worldG.x, worldG.y)
  const gDriven = gMag > 1e-6 && Math.abs(worldG.x) < gMag * 1e-3 // 近似竖直重力
  const m = o.motionType ?? parsed.motionType
  const base: Omit<ObjectDef, 'motion'> = {
    id: o.id,
    label: o.label ?? o.id,
    p0: o.initialPosition,
    v0: o.initialVelocity,
    mass: o.mass,
    radius: o.radius ?? defaultRadius(o.mass),
    color: o.color ?? PALETTE[idx % PALETTE.length]!,
  }
  const numericWith = (spec: NumericSpec): ObjectDef => ({
    ...base,
    motion: { kind: 'numeric', spec },
  })
  const withCharge = (d: ObjectDef): ObjectDef => {
    if (o.charge !== undefined && o.charge !== 0) d.charge = o.charge
    return d
  }

  // —— 接触/阻力/碰撞/追及/电磁/圆环/约束 → 数值积分 ——
  const plane = o.incline
  const hasDrag = !!o.airDragK && o.airDragK > 1e-9
  const hasForce = !!o.appliedForce && Math.hypot(o.appliedForce.x, o.appliedForce.y) > 1e-9
  const hasCharge = o.charge !== undefined && o.charge !== 0
  const hasRing = !!o.ring
  const hasVC = !!o.verticalCircle
  const hasSpring = !!o.spring
  const hasFloorC = !!o.floorContact
  const interactive =
    plane || hasDrag || hasForce || !!o.collideWith || !!o.chaseTarget ||
    hasCharge || hasRing || hasVC || hasSpring || hasFloorC ||
    parsed.constraints?.some((c) => c.objectA === o.id || c.objectB === o.id)

  if (
    interactive || m === 'incline' || m === 'conveyor' || m === 'collision' || m === 'pursuit' ||
    m === 'charged_particle' || m === 'ring_motion' || m === 'vertical_circle' ||
    m === 'spring_pair' || m === 'board_block'
  ) {
    if (plane) {
      // 斜面（含传送带/锚板）。映射到引擎约定：负角 u=(cosθ,−sinθ) 下滑指向 +x；物体贴面
      const th = -plane.angleDeg * DEG
      const ux = Math.cos(th)
      const uy = Math.sin(th)
      const nx = -Math.sin(th)
      const ny = Math.cos(th)
      const spec: ContactPlane = { type: 'plane', angle: th, friction: plane.friction }
      if (plane.beltSpeed !== undefined) spec.beltSpeed = plane.beltSpeed
      if (plane.anchorId !== undefined) spec.anchorId = plane.anchorId // 板块模型：平面随锚体
      // 把模型给的位置贴到斜面上（沿面坐标保留，法向嵌入则抬到表面）
      const sAlong = o.initialPosition.x * ux + o.initialPosition.y * uy
      let nOff = o.initialPosition.x * nx + o.initialPosition.y * ny
      const rr = o.radius ?? R
      if (nOff < rr) {
        nOff = rr
        if (plane.anchorId === undefined) note.push(`滑块 ${o.id} 已贴放到斜面上（半径 ${rr.toFixed(2)} m）`)
      }
      const d: ObjectDef = numericWith({ contact: spec })
      d.p0 = { x: sAlong * ux + nOff * nx, y: sAlong * uy + nOff * ny }
      // 初速度投影到斜面方向
      d.v0 = {
        x: (o.initialVelocity.x * ux + o.initialVelocity.y * uy) * ux,
        y: (o.initialVelocity.x * ux + o.initialVelocity.y * uy) * uy,
      }
      return { obj: o, def: withCharge(d), modeName: plane.anchorId !== undefined ? '锚板·数值' : '斜面·数值' }
    }
    if (hasVC) {
      // 竖直平面圆周（绳/杆）：静态支点在 buildScene 物化，此处只挂约束
      const vc = o.verticalCircle!
      const anchorId = vcAnchors.get(o.id)!
      const d = numericWith({})
      d.constraints = [{ kind: vc.kind, otherId: anchorId, length: vc.length }]
      return { obj: o, def: withCharge(d), modeName: vc.kind === 'rope' ? '竖直圆周·绳' : '竖直圆周·杆' }
    }
    if (hasRing) {
      const rg = o.ring!
      const d = numericWith({
        contact: {
          type: 'circle',
          center: rg.center,
          radius: rg.radius,
          restitution: rg.restitution ?? 0.9,
          ...(rg.friction !== undefined ? { friction: rg.friction } : {}),
        },
      })
      return { obj: o, def: withCharge(d), modeName: '圆环·数值' }
    }
    if (hasSpring) {
      const sp = o.spring!
      const d = numericWith({ spring: { otherId: sp.otherId, k: sp.k, restLength: sp.restLength } })
      return { obj: o, def: withCharge(d), modeName: '弹簧对·数值' }
    }
    if (hasFloorC) {
      // 贴地体（板块模型中的木板）
      const fc = o.floorContact!
      const d = numericWith({ contact: { type: 'floor', restitution: fc.restitution ?? 0, friction: fc.friction } })
      return { obj: o, def: withCharge(d), modeName: '贴地体·数值' }
    }
    if (hasCharge) {
      const d = numericWith({})
      return { obj: o, def: withCharge(d), modeName: '带电粒子·数值' }
    }
    // 带阻力/外力的下落物体：无平面接触则可能落回地面（地面反弹按 restitution）
    const spec: { drag?: { k: number }; contact?: { type: 'floor'; restitution: number; friction: number } } = {}
    if (hasDrag) spec.drag = { k: o.airDragK! }
    if (o.landOnGround && parsed.groundY != null) {
      spec.contact = { type: 'floor', restitution: o.restitution ?? 0, friction: 0 }
    }
    const d = numericWith(spec as NumericSpec)
    if (hasForce) d.appliedForce = o.appliedForce
    if (o.collideWith) {
      d.collidable = true
      d.restitution = o.restitution ?? 1
    }
    return { obj: o, def: d, modeName: '数值' }
  }

  // —— 单物体教科书形态（解析解） ——
  switch (m) {
    case 'circular': {
      const c = o.circularCenter ?? fail(`物体 ${o.id}：圆周运动缺少圆心`)
      const rvx = o.initialPosition.x - c.x
      const rvy = o.initialPosition.y - c.y
      const r = Math.hypot(rvx, rvy)
      if (r < 1e-9) fail(`物体 ${o.id}：圆周半径为零（初始位置与圆心重合）`)
      const vx0 = o.initialVelocity.x
      const vy0 = o.initialVelocity.y
      if (Math.hypot(vx0, vy0) < 1e-9) {
        fail(`物体 ${o.id}：匀速圆周运动需要给出切向初速度（或 ω/周期换算成速度填入 initialVelocity）`)
      }
      // 速度沿切向分量（法向分量丢弃——圆周运动不允许径向初速度）
      const tx = -rvy / r
      const ty = rvx / r
      const vTan = vx0 * tx + vy0 * ty
      if (Math.abs(vTan) < 1e-6) fail(`物体 ${o.id}：初速度与圆周半径垂直的切向分量不能为零`)
      const sign = vTan < 0 ? -1 : 1
      const om = Math.abs(vTan) / r
      const def: ObjectDef = {
        ...base,
        v0: { x: sign * om * r * tx, y: sign * om * r * ty },
        motion: {
          kind: 'circular',
          center: c,
          radius: r,
          omega: om * sign,
          phi0: Math.atan2(rvy, rvx) + (sign < 0 ? Math.PI : 0),
        },
      }
      return { obj: o, def, modeName: '匀速圆周·解析' }
    }
    case 'simple_harmonic': {
      const eq = o.springEquilibrium ?? fail(`物体 ${o.id}：简谐运动缺少平衡位置 springEquilibrium`)
      const sx = o.initialPosition.x - eq.x
      const sy = o.initialPosition.y - eq.y
      const A0 = Math.hypot(sx, sy)
      if (A0 < 1e-9) fail(`物体 ${o.id}：振子在平衡位置释放不会振动（请把初始位置放离平衡位置）`)
      const mass = o.mass
      let om: number
      if (o.springK !== undefined) om = Math.sqrt(o.springK / mass)
      else if (o.initialAcceleration) {
        const aAlong = (o.initialAcceleration.x * sx + o.initialAcceleration.y * sy) / A0
        if (Math.abs(aAlong) < 1e-9) fail(`物体 ${o.id}：沿位移方向初加速度为零，无法推出圆频率 ω`)
        om = Math.sqrt(Math.abs(aAlong) / A0)
      } else {
        fail(`物体 ${o.id}：简谐运动需要 springK 或初始加速度来推出圆频率 ω`)
      }
      if (om <= 1e-6) fail(`物体 ${o.id}：圆频率 ω 必须为正`)
      const ax = sx / A0
      const ay = sy / A0
      // 相位：s(t)=A·cos(ωt+φ)，由 s0、v0 解 φ
      const s0 = A0
      const vAlong = (o.initialVelocity.x * sx + o.initialVelocity.y * sy) / A0
      const phi = Math.atan2(-vAlong / (s0 * om), 1) // cos φ = s0/A → 归一后 =1
      const def: ObjectDef = {
        ...base,
        p0: o.initialPosition,
        motion: {
          kind: 'harmonic',
          axis: { x: ax, y: ay },
          equilibrium: eq,
          amplitude: A0,
          omega: om,
          phi0: phi,
        },
      }
      return { obj: o, def, modeName: '简谐·解析' }
    }
    case 'pendulum': {
      const pv = o.pendulumPivot ?? fail(`物体 ${o.id}：单摆缺少支点 pendulumPivot`)
      const L = Math.hypot(o.initialPosition.x - pv.x, o.initialPosition.y - pv.y)
      if (L < 1e-9) fail(`物体 ${o.id}：摆长为零（初始位置与支点重合）`)
      if (Math.hypot(o.initialVelocity.x, o.initialVelocity.y) > 1e-3) {
        fail(`物体 ${o.id}：当前仅支持从静止释放的单摆（初始速度须为零）。若题中摆球有初速，请改用手动模板。`)
      }
      const th0 = Math.atan2(o.initialPosition.x - pv.x, pv.y - o.initialPosition.y)
      if (Math.abs(th0) < 1e-3) fail(`物体 ${o.id}：初始摆角为零，摆不会摆动（请把初始位置偏离竖直下方）`)
      const gMagL = gDriven ? gMag : DEFAULT_GRAVITY.y * -1
      const def: ObjectDef = {
        ...base,
        v0: { x: 0, y: 0 },
        motion: {
          kind: 'pendulum',
          pivot: pv,
          length: L,
          theta0: th0,
          omega: Math.sqrt(gMagL / L),
          direction: 1,
        },
      }
      return { obj: o, def, modeName: '单摆·解析' }
    }
    default: {
      // kinematic：匀变/自由落体/上抛/抛体
      const a = o.initialAcceleration
        ? { ...o.initialAcceleration }
        : { x: worldG.x, y: worldG.y }
      const land = o.landOnGround ?? (parsed.groundY != null && gDriven && a.y < -1e-6)
      const def: ObjectDef = {
        ...base,
        motion: { kind: 'kinematic', a, landOnGround: land },
      }
      return { obj: o, def, modeName: '匀变速·解析' }
    }
  }
}

/* ============ 构建完整场景 ============ */

export function buildScene(parsed: ParsedResult): SceneBuild {
  const note: string[] = []
  if (!parsed.objects.length) fail('解析结果中没有物体（objects 为空）')
  // 竖直圆周：为每个 verticalCircle 物体分配唯一静态支点 id（避开题目自身 id）
  const vcAnchors = new Map<string, string>()
  const takenIds = new Set(parsed.objects.map((o) => o.id))
  for (const o of parsed.objects) {
    if (!o.verticalCircle) continue
    let aid = `O_${o.id}`
    let n = 1
    while (takenIds.has(aid)) aid = `O_${o.id}_${n++}`
    takenIds.add(aid)
    vcAnchors.set(o.id, aid)
  }
  const plans = parsed.objects.map((o, i) => planObject(o, parsed, i, note, vcAnchors))
  // 物化静态支点（绳/杆约束的固定端）
  for (const o of parsed.objects) {
    const vc = o.verticalCircle
    if (!vc) continue
    plans.push({
      obj: o,
      def: {
        id: vcAnchors.get(o.id)!,
        label: '固定支点',
        p0: { ...vc.pivot },
        v0: { x: 0, y: 0 },
        mass: 1,
        radius: 0.18,
        color: '#64748b',
        motion: { kind: 'static' },
      },
      modeName: '支点·静态',
    })
  }

  // 碰撞对象补齐成对（模型只标了单向也生效；整场景 motionType=collision 全部开碰撞）
  const allCollide = parsed.motionType === 'collision'
  for (const p of plans) {
    if (p.obj.collideWith || allCollide) {
      p.def.collidable = true
      p.def.restitution = p.obj.restitution ?? 1
    }
  }
  // 约束两端
  for (const c of parsed.constraints ?? []) {
    const a = plans.find((p) => p.def.id === c.objectA)
    const b = plans.find((p) => p.def.id === c.objectB)
    if (!a || !b) fail(`约束 ${c.objectA}–${c.objectB}：物体不存在（检查 id）`)
    const link = { kind: c.kind, otherId: b!.def.id, length: c.length } as const
    if (a!.def.motion.kind !== 'numeric') {
      a!.def = { ...a!.def, motion: { kind: 'numeric', spec: {} } }
      note.push(`物体 ${a!.def.id} 已转数值积分以承载绳/杆约束`)
    }
    a!.def.constraints = [...(a!.def.constraints ?? []), link]
    if (b!.def.motion.kind !== 'numeric') {
      b!.def = { ...b!.def, motion: { kind: 'numeric', spec: {} } }
      note.push(`物体 ${b!.def.id} 已转数值积分以承载绳/杆约束`)
    }
  }

  const title =
    parsed.title ??
    `${parsed.motionType} · ${parsed.objects.map((o) => o.label ?? o.id).join('、')}`
  // 落地解析体钳制：起点不得低于地面接触线（圆心 groundY+radius），
  // 否则 analyticNaturalEnd 判定"起点在地面下"→ 立即冻结，整段时长坍缩成 ~0.12 s。
  // （物理上等价于"从贴地处释放"，位移/时刻公式不变。）
  if (parsed.groundY != null) {
    for (const p of plans) {
      const d = p.def
      if (d.motion.kind === 'kinematic' && d.motion.landOnGround) {
        const gy = parsed.groundY + d.radius
        if (d.p0.y < gy - 1e-9) {
          p.def = { ...d, p0: { ...d.p0, y: gy } }
          note.push(`物体 ${d.id} 的释放点低于地面，已按贴地释放处理`)
        }
      }
    }
  }
  const def: ScenarioDefinition = {
    templateId: 'ai',
    title,
    objects: plans.map((p) => p.def),
    world: {
      gravity: parsed.gravity ?? DEFAULT_GRAVITY,
      ...(parsed.groundY != null ? { groundY: parsed.groundY } : {}),
      // 空间电磁场区域（带电粒子场景；结构同引擎 FieldRegion，直接透传）
      ...(parsed.fields?.length ? { fields: parsed.fields.map((f) => ({ ...f })) } : {}),
    },
    // 分步解题讲解（与画面时间同步；直接透传）
    ...(parsed.solution?.length ? { solution: parsed.solution.map((s) => ({ ...s })) } : {}),
  }
  const params = makeParams(def)
  return { def, params, note }
}

/* ============ 通用参数面板生成（从 def 反推可调参数） ============ */

function findObj(def: ScenarioDefinition, id: string): ObjectDef {
  const o = def.objects.find((d) => d.id === id)
  if (!o) throw new SceneBuildError(`场景中缺少物体 ${id}`)
  return o
}

function withObj(def: ScenarioDefinition, id: string, fn: (o: ObjectDef) => ObjectDef): ScenarioDefinition {
  return { ...def, objects: def.objects.map((o) => (o.id === id ? fn(o) : o)) }
}

function makeParams(def: ScenarioDefinition): ParamDef[] {
  // 参数面板由各物体形态的"读/改"对构成；def 是唯一事实源。
  const all: ParamDef[] = []
  const gravityN = def.world.gravity

  // —— 世界：重力加速度 g（竖直重力且存在被 g 驱动的解析体时） ——
  const gDrivenObjects = def.objects.filter((o) => {
    if (o.motion.kind === 'pendulum') return true
    if (o.motion.kind === 'kinematic') {
      return (
        Math.abs(gravityN.y) > 1e-6 &&
        Math.abs(o.motion.a.y - gravityN.y) < 0.02 &&
        Math.abs(gravityN.x) < 1e-6 &&
        Math.abs(o.motion.a.x) < 1e-6
      )
    }
    return false
  })
  if (gDrivenObjects.length > 0 && gravityN.x === 0 && gravityN.y < -1e-6) {
    const setG = (d: ScenarioDefinition, g: number): ScenarioDefinition => ({
      ...d,
      world: { ...d.world, gravity: { x: 0, y: -g } },
      objects: d.objects.map((o) => {
        if (o.motion.kind === 'pendulum') {
          return { ...o, motion: { ...o.motion, omega: Math.sqrt(g / o.motion.length) } }
        }
        if (o.motion.kind === 'kinematic' && Math.abs(o.motion.a.y + Math.abs(gravityN.y)) < 0.02 && o.motion.a.x === 0) {
          return { ...o, motion: { ...o.motion, a: { x: 0, y: -g } } }
        }
        return o
      }),
    })
    all.push({
      key: 'g', label: '重力加速度 g', unit: 'm/s²',
      min: 1, max: 25, step: 0.1, group: 'world',
      read: (d) => -d.world.gravity.y,
      apply: (d, v) => setG(d, Math.min(25, Math.max(0.1, v))),
    })
  }

  const gNow = -gravityN.y

  // —— 世界：电磁场强度（沿场矢量的原方向缩放） ——
  if (def.world.fields?.length) {
    const eField = def.world.fields.find((f) => f.electric)
    const bField = def.world.fields.find((f) => f.magnetic !== undefined)
    if (eField) {
      const magOf = (f: { electric?: { x: number; y: number } }) =>
        Math.hypot(f.electric?.x ?? 0, f.electric?.y ?? 0) || 1
      all.push({
        key: 'E', label: '电场强度 E', unit: 'V/m',
        min: 0, max: 5000, step: 50, group: 'field',
        read: (d) => {
          const f = d.world.fields?.find((x) => x.electric)
          return f ? magOf(f) : 0
        },
        apply: (d, v) => ({
          ...d,
          world: {
            ...d.world,
            fields: d.world.fields!.map((f) =>
              f.electric
                ? { ...f, electric: { x: (f.electric.x / magOf(f)) * v, y: (f.electric.y / magOf(f)) * v } }
                : f,
            ),
          },
        }),
      })
    }
    if (bField) {
      all.push({
        key: 'B', label: '磁感应强度 B', unit: 'T',
        min: 0.1, max: 10, step: 0.1, group: 'field',
        read: (d) => {
          const f = d.world.fields?.find((x) => x.magnetic !== undefined)
          return f ? Math.abs(f.magnetic!) : 0
        },
        apply: (d, v) => ({
          ...d,
          world: {
            ...d.world,
            fields: d.world.fields!.map((f) =>
              f.magnetic !== undefined ? { ...f, magnetic: Math.sign(f.magnetic) * v } : f,
            ),
          },
        }),
      })
    }
  }

  for (const o of def.objects) {
    const grp = o.id
    // —— 质量 ——
    all.push({
      key: `${grp}.mass`, label: '质量 m', unit: 'kg',
      min: 0.05, max: 50, step: 0.05, group: grp,
      read: (d) => findObj(d, grp).mass,
      apply: (d, v) => withObj(d, grp, (x) => ({ ...x, mass: Math.max(0.01, v) })),
    })

    // —— 电荷量（μC 显示，C 存储） ——
    if (o.charge !== undefined && o.charge !== 0) {
      all.push({
        key: `${grp}.charge`, label: '电荷量 q', unit: 'μC',
        min: -60, max: 60, step: 1, group: grp,
        read: (d) => (findObj(d, grp).charge ?? 0) * 1e6,
        apply: (d, v) => withObj(d, grp, (x) => ({ ...x, charge: v * 1e-6 })),
      })
    }

    switch (o.motion.kind) {
      case 'kinematic': {
        const a = o.motion.a
        const kx = Math.abs(a.x) > 1e-9 ? a.x : (Math.abs(o.v0.x) > 1e-9 && Math.abs(a.y) < 1e-9 ? Math.sign(o.v0.x) : 0)
        const ky = Math.abs(a.y) > 1e-9 ? a.y : 0
        const mainAxis = Math.abs(kx) > Math.abs(ky) || (kx !== 0 && ky === 0)
        if (mainAxis) {
          // 初速度（一维，带符号）
          all.push({
            key: `${grp}.vx`, label: '初速度 v₀', unit: 'm/s',
            min: -60, max: 60, step: 0.1, group: grp,
            read: (d) => findObj(d, grp).v0.x,
            apply: (d, v) => withObj(d, grp, (x) => ({ ...x, v0: { x: v, y: x.v0.y } })),
          })
          if (a.x !== 0) {
            all.push({
              key: `${grp}.ax`, label: '加速度 a', unit: 'm/s²',
              min: -30, max: 30, step: 0.05, group: grp,
              read: (d) => {
                const oo = findObj(d, grp)
                return oo.motion.kind === 'kinematic' ? oo.motion.a.x : 0
              },
              apply: (d, v) =>
                withObj(d, grp, (x) =>
                  x.motion.kind === 'kinematic'
                    ? { ...x, motion: { ...x.motion, a: { x: v, y: x.motion.a.y } } }
                    : x,
                ),
            })
          }
        } else {
          // 竖直主运动（上抛/自由落体）—— g 滑块在上方世界组已覆盖；这里补初速度
          all.push({
            key: `${grp}.vy`, label: '初速度 v₀', unit: 'm/s',
            min: -60, max: 60, step: 0.1, group: grp,
            read: (d) => findObj(d, grp).v0.y,
            apply: (d, v) => withObj(d, grp, (x) => ({ ...x, v0: { x: x.v0.x, y: v } })),
          })
          if (Math.abs(ky) < 1e-9) {
            all.push({
              key: `${grp}.ay`, label: '竖直加速度 a', unit: 'm/s²',
              min: -30, max: 30, step: 0.05, group: grp,
              read: (d) => {
                const oo = findObj(d, grp)
                return oo.motion.kind === 'kinematic' ? oo.motion.a.y : 0
              },
              apply: (d, v) =>
                withObj(d, grp, (x) =>
                  x.motion.kind === 'kinematic'
                    ? { ...x, motion: { ...x.motion, a: { x: x.motion.a.x, y: v } } }
                    : x,
                ),
            })
          }
        }
        break
      }
      case 'circular': {
        const setR = (d: ScenarioDefinition, r: number): ScenarioDefinition =>
          withObj(d, grp, (x) => {
            if (x.motion.kind !== 'circular') return x
            const c0 = x.motion.center
            const dist = Math.hypot(x.p0.x - c0.x, x.p0.y - c0.y) || 1
            const px = c0.x + ((x.p0.x - c0.x) / dist) * r
            const py = c0.y + ((x.p0.y - c0.y) / dist) * r
            return {
              ...x,
              p0: { x: px, y: py },
              v0: { x: -x.motion.omega * (py - c0.y), y: x.motion.omega * (px - c0.x) },
              motion: { ...x.motion, radius: r },
            }
          })
        all.push({
          key: `${grp}.r`, label: '半径 r', unit: 'm',
          min: 0.2, max: 10, step: 0.1, group: grp,
          read: (d) => {
            const oo = findObj(d, grp)
            return oo.motion.kind === 'circular' ? oo.motion.radius : 1
          },
          apply: (d, v) => setR(d, Math.max(0.05, v)),
        })
        all.push({
          key: `${grp}.omega`, label: '角速度 ω', unit: 'rad/s',
          min: 0.1, max: 10, step: 0.05, group: grp,
          read: (d) => {
            const oo = findObj(d, grp)
            return oo.motion.kind === 'circular' ? Math.abs(oo.motion.omega) : 2
          },
          apply: (d, v) =>
            withObj(d, grp, (x) => {
              if (x.motion.kind !== 'circular') return x
              const s = Math.sign(x.motion.omega) || 1
              return { ...x, motion: { ...x.motion, omega: s * Math.max(0.05, v) } }
            }),
        })
        break
      }
      case 'harmonic': {
        const setA = (d: ScenarioDefinition, A: number): ScenarioDefinition =>
          withObj(d, grp, (x) =>
            x.motion.kind === 'harmonic'
              ? {
                  ...x,
                  p0: { x: x.motion.equilibrium.x + A * x.motion.axis.x, y: x.motion.equilibrium.y + A * x.motion.axis.y },
                  motion: { ...x.motion, amplitude: Math.max(0.01, A) },
                }
              : x,
          )
        all.push({
          key: `${grp}.A`, label: '振幅 A', unit: 'm',
          min: 0.02, max: 5, step: 0.02, group: grp,
          read: (d) => {
            const oo = findObj(d, grp)
            return oo.motion.kind === 'harmonic' ? oo.motion.amplitude : 0.5
          },
          apply: (d, v) => setA(d, v),
        })
        all.push({
          key: `${grp}.omega`, label: '圆频率 ω', unit: 'rad/s',
          min: 0.1, max: 10, step: 0.05, group: grp,
          read: (d) => {
            const oo = findObj(d, grp)
            return oo.motion.kind === 'harmonic' ? oo.motion.omega : 2
          },
          apply: (d, v) =>
            withObj(d, grp, (x) =>
              x.motion.kind === 'harmonic' ? { ...x, motion: { ...x.motion, omega: Math.max(0.05, v) } } : x,
            ),
        })
        break
      }
      case 'pendulum': {
        const rebuild = (d: ScenarioDefinition, L: number, thRad: number, g: number): ScenarioDefinition =>
          withObj(d, grp, (x) => {
            if (x.motion.kind !== 'pendulum') return x
            const pv = x.motion.pivot
            return {
              ...x,
              p0: { x: pv.x + L * Math.sin(thRad), y: pv.y - L * Math.cos(thRad) },
              motion: { ...x.motion, length: L, theta0: thRad, omega: Math.sqrt(Math.max(0.1, g) / L) },
            }
          })
        const Lof = (d: ScenarioDefinition) => {
          const oo = findObj(d, grp)
          return oo.motion.kind === 'pendulum' ? oo.motion.length : 1
        }
        const th0of = (d: ScenarioDefinition) => {
          const oo = findObj(d, grp)
          return oo.motion.kind === 'pendulum' ? (oo.motion.theta0 / DEG) : 10
        }
        all.push({
          key: `${grp}.L`, label: '摆长 L', unit: 'm',
          min: 0.3, max: 8, step: 0.1, group: grp,
          read: (d) => Lof(d),
          apply: (d, v) => rebuild(d, Math.max(0.1, v), th0of(d) * DEG, gNow > 0 ? gNow : 9.8),
        })
        all.push({
          key: `${grp}.theta0`, label: '摆角 θ₀', unit: '°',
          min: 1, max: 45, step: 1, group: grp,
          read: (d) => th0of(d),
          apply: (d, v) => rebuild(d, Lof(d), Math.min(80, Math.max(0.5, v)) * DEG, gNow > 0 ? gNow : 9.8),
        })
        break
      }
      case 'numeric': {
        const spec = o.motion.spec
        if (spec.contact?.type === 'plane') {
          const cp = spec.contact
          all.push({
            key: `${grp}.mu`, label: '摩擦系数 μ', unit: '',
            min: 0, max: 1.5, step: 0.01, group: grp,
            read: (d) => {
              const oo = findObj(d, grp)
              return oo.motion.kind === 'numeric' && oo.motion.spec.contact?.type === 'plane'
                ? oo.motion.spec.contact.friction
                : 0
            },
            apply: (d, v) =>
              withObj(d, grp, (x) =>
                x.motion.kind === 'numeric' && x.motion.spec.contact?.type === 'plane'
                  ? {
                      ...x,
                      motion: {
                        ...x.motion,
                        spec: { ...x.motion.spec, contact: { ...x.motion.spec.contact, friction: Math.max(0, v) } },
                      },
                    }
                  : x,
              ),
          })
          if (Math.abs(cp.angle) > 1e-6) {
            // 斜面倾角（保持滑块位置在面上不变）
            const setTh = (d: ScenarioDefinition, thRad: number): ScenarioDefinition =>
              withObj(d, grp, (x) => {
                if (x.motion.kind !== 'numeric' || x.motion.spec.contact?.type !== 'plane') return x
                const ux = Math.cos(thRad)
                const uy = Math.sin(thRad)
                const nx = -Math.sin(thRad)
                const ny = Math.cos(thRad)
                const sNow = x.p0.x * ux + x.p0.y * uy
                const hNow = Math.max(x.radius * 1.02, x.p0.x * nx + x.p0.y * ny)
                const spd = Math.hypot(x.v0.x, x.v0.y)
                const dir = x.v0.x * ux + x.v0.y * uy >= 0 ? 1 : -1
                return {
                  ...x,
                  p0: { x: sNow * ux + hNow * nx, y: sNow * uy + hNow * ny },
                  v0: { x: dir * spd * ux, y: dir * spd * uy },
                  motion: {
                    ...x.motion,
                    spec: { ...x.motion.spec, contact: { ...x.motion.spec.contact, angle: thRad } },
                  },
                }
              })
            all.push({
              key: `${grp}.theta`, label: '倾角 θ', unit: '°',
              min: 0.5, max: 60, step: 0.5, group: grp,
              read: (d) => {
                const oo = findObj(d, grp)
                return oo.motion.kind === 'numeric' && oo.motion.spec.contact?.type === 'plane'
                  ? Math.abs(oo.motion.spec.contact.angle) / DEG
                  : 30
              },
              apply: (d, v) => setTh(d, -Math.min(60, Math.max(0.5, v)) * DEG),
            })
          }
          if (cp.beltSpeed !== undefined) {
            all.push({
              key: `${grp}.belt`, label: '传送带速度 v', unit: 'm/s',
              min: -8, max: 8, step: 0.1, group: grp,
              read: (d) => {
                const oo = findObj(d, grp)
                return oo.motion.kind === 'numeric' && oo.motion.spec.contact?.type === 'plane'
                  ? oo.motion.spec.contact.beltSpeed ?? 0
                  : 0
              },
              apply: (d, v) =>
                withObj(d, grp, (x) =>
                  x.motion.kind === 'numeric' && x.motion.spec.contact?.type === 'plane'
                    ? {
                        ...x,
                        motion: {
                          ...x.motion,
                          spec: {
                            ...x.motion.spec,
                            contact: { ...x.motion.spec.contact, beltSpeed: v },
                          },
                        },
                      }
                    : x,
                ),
            })
          }
        }
        if (spec.drag?.k) {
          all.push({
            key: `${grp}.drag`, label: '阻力系数 k', unit: 'N·s/m',
            min: 0.001, max: 30, step: 0.05, group: grp,
            read: (d) => {
              const oo = findObj(d, grp)
              return oo.motion.kind === 'numeric' ? oo.motion.spec.drag?.k ?? 0 : 0
            },
            apply: (d, v) =>
              withObj(d, grp, (x) =>
                x.motion.kind === 'numeric'
                  ? {
                      ...x,
                      motion: {
                        ...x.motion,
                        spec: { ...x.motion.spec, drag: { k: Math.max(0, v) } },
                      },
                    }
                  : x,
              ),
          })
        }
        if (spec.contact?.type === 'circle') {
          all.push({
            key: `${grp}.ringR`, label: '圆环半径 R', unit: 'm',
            min: 0.5, max: 10, step: 0.1, group: grp,
            read: (d) => {
              const oo = findObj(d, grp)
              return oo.motion.kind === 'numeric' && oo.motion.spec.contact?.type === 'circle'
                ? oo.motion.spec.contact.radius
                : 2
            },
            apply: (d, v) =>
              withObj(d, grp, (x) =>
                x.motion.kind === 'numeric' && x.motion.spec.contact?.type === 'circle'
                  ? {
                      ...x,
                      motion: {
                        ...x.motion,
                        spec: {
                          ...x.motion.spec,
                          contact: { ...x.motion.spec.contact, radius: Math.max(x.radius + 0.2, v) },
                        },
                      },
                    }
                  : x,
              ),
          })
        }
        if (spec.contact?.type === 'floor') {
          all.push({
            key: `${grp}.muFloor`, label: '地面摩擦 μ', unit: '',
            min: 0, max: 1.5, step: 0.01, group: grp,
            read: (d) => {
              const oo = findObj(d, grp)
              return oo.motion.kind === 'numeric' && oo.motion.spec.contact?.type === 'floor'
                ? oo.motion.spec.contact.friction
                : 0
            },
            apply: (d, v) =>
              withObj(d, grp, (x) =>
                x.motion.kind === 'numeric' && x.motion.spec.contact?.type === 'floor'
                  ? {
                      ...x,
                      motion: {
                        ...x.motion,
                        spec: { ...x.motion.spec, contact: { ...x.motion.spec.contact, friction: Math.max(0, v) } },
                      },
                    }
                  : x,
              ),
          })
        }
        if (spec.spring) {
          all.push({
            key: `${grp}.k`, label: '劲度系数 k', unit: 'N/m',
            min: 0.5, max: 30, step: 0.5, group: grp,
            read: (d) => {
              const oo = findObj(d, grp)
              return oo.motion.kind === 'numeric' ? oo.motion.spec.spring?.k ?? 0 : 0
            },
            apply: (d, v) =>
              withObj(d, grp, (x) =>
                x.motion.kind === 'numeric' && x.motion.spec.spring
                  ? {
                      ...x,
                      motion: {
                        ...x.motion,
                        spec: { ...x.motion.spec, spring: { ...x.motion.spec.spring, k: Math.max(0.1, v) } },
                      },
                    }
                  : x,
              ),
          })
        }
        if (o.collidable) {
          all.push({
            key: `${grp}.vx`, label: '初速度（水平）', unit: 'm/s',
            min: -30, max: 30, step: 0.1, group: grp,
            read: (d) => findObj(d, grp).v0.x,
            apply: (d, v) => withObj(d, grp, (x) => ({ ...x, v0: { x: v, y: x.v0.y } })),
          })
        }
        break
      }
      case 'static':
        break
    }
  }

  // 碰撞恢复系数（多碰撞体）
  const collidables = def.objects.filter((o) => o.collidable)
  if (collidables.length >= 2) {
    all.push({
      key: 'e', label: '恢复系数 e', unit: '',
      min: 0, max: 1, step: 0.02, group: 'world',
      read: (d) => d.objects.find((o) => o.collidable)?.restitution ?? 1,
      apply: (d, v) => ({
        ...d,
        objects: d.objects.map((o) => (o.collidable ? { ...o, restitution: v } : o)),
      }),
    })
  }
  return all
}

