// def → ParsedResult 逆映射：mock provider 的输出源。
// 模板/示例场景都是本应用的"标准答案"，把它们逆向成 AI 中间表示
// 即可零手写地驱动离线解析演示（含低置信样本 → 校正弹窗）。
import type { ScenarioDefinition } from '../engine/types'
import type { ParsedObject, ParsedResult, MotionTypeName } from './types'

const DEG = Math.PI / 180

function guessMotion(o: ScenarioDefinition['objects'][number], gY: number): MotionTypeName {
  const m = o.motion
  if (m.kind === 'circular') return 'circular'
  if (m.kind === 'harmonic') return 'simple_harmonic'
  if (m.kind === 'pendulum') return 'pendulum'
  if (m.kind === 'static') return 'other'
  if (m.kind === 'numeric') {
    const c = m.spec.contact
    if (c?.type === 'plane' && Math.abs(c.angle) > 1e-9) return 'incline'
    if (c?.type === 'plane' && c.beltSpeed !== undefined) return 'conveyor'
    if (o.collidable) return 'collision'
    return 'multi_object'
  }
  // kinematic
  const ax = m.a.x
  const ay = m.a.y
  const isG = Math.abs(ay + gY) < 0.05 && Math.abs(ax) < 1e-9
  if (isG) {
    if (Math.abs(o.v0.x) > 1e-9 && Math.abs(o.v0.y) > 1e-9) return 'projectile'
    if (Math.abs(o.v0.x) > 1e-9) return 'projectile'
    if (Math.abs(o.v0.y) > 1e-9) return 'vertical_throw'
    return 'free_fall'
  }
  return 'uniform_accel'
}

export function defToParsed(def: ScenarioDefinition): ParsedResult {
  const g = def.world.gravity
  const gY = Math.hypot(g.x, g.y) > 1e-9 && Math.abs(g.x) < 1e-9 ? -g.y : 0
  const grounded = def.objects.some(
    (o) => o.motion.kind === 'kinematic' && o.motion.landOnGround,
  )
  // 全物体竖直加速度为 0 且无碰撞/无重力依赖（直线/追及类）：告诉模型这是无重力二维桌面
  const flat2D =
    def.objects.length > 1 &&
    def.objects.every((o) => {
      if (o.motion.kind === 'kinematic') return o.motion.a.y === 0 && !o.motion.landOnGround
      if (o.motion.kind === 'numeric') {
        const c = o.motion.spec.contact
        return !o.collidable && c?.type === 'plane' && Math.abs(c.angle) < 1e-9
      }
      return false
    })

  // 静态锚点（绳/杆约束的固定端）→ 反向为 verticalCircle，锚点本体不输出为物体
  const staticPivots = new Map<string, ScenarioDefinition['objects'][number]>()
  const pivotRefs = new Set<string>()
  for (const o of def.objects) {
    if (o.motion.kind !== 'static') continue
    const used = def.objects.some((x) => x.constraints?.some((c) => c.otherId === o.id))
    if (used) {
      staticPivots.set(o.id, o)
      for (const x of def.objects) {
        if (x.constraints?.some((c) => c.otherId === o.id)) pivotRefs.add(`${x.id}|${o.id}`)
      }
    }
  }

  const objects: ParsedObject[] = def.objects
    .filter((o) => !(o.motion.kind === 'static' && staticPivots.has(o.id)))
    .map((o) => {
    const base: ParsedObject = {
      id: o.id,
      label: o.label ?? o.id,
      mass: o.mass,
      initialPosition: o.p0,
      initialVelocity: o.v0,
      radius: o.radius,
      landOnGround: false,
    }
    // 竖直圆周：绳/杆系于静态支点
    const vcLink = o.constraints?.find((c) => staticPivots.has(c.otherId))
    if (vcLink) {
      const pivot = staticPivots.get(vcLink.otherId)!
      base.verticalCircle = { pivot: { ...pivot.p0 }, kind: vcLink.kind, length: vcLink.length }
      base.motionType = 'vertical_circle'
    }
    const m = o.motion
    switch (m.kind) {
      case 'kinematic': {
        base.motionType = guessMotion(o, gY)
        const isG = Math.abs(m.a.y + gY) < 0.05 && Math.abs(m.a.x) < 1e-9 && gY > 0
        if (!isG && (m.a.x !== 0 || m.a.y !== 0)) base.initialAcceleration = { ...m.a }
        base.landOnGround = m.landOnGround || undefined
        break
      }
      case 'circular':
        base.motionType = 'circular'
        base.circularCenter = { ...m.center }
        break
      case 'harmonic':
        base.motionType = 'simple_harmonic'
        base.springEquilibrium = { ...m.equilibrium }
        base.springK = Math.round(o.mass * m.omega * m.omega * 100) / 100
        break
      case 'pendulum':
        base.motionType = 'pendulum'
        base.pendulumPivot = { ...m.pivot }
        break
      case 'numeric': {
        const c = m.spec.contact
        if (c?.type === 'circle') {
          base.motionType = 'ring_motion'
          base.ring = {
            center: { ...c.center },
            radius: c.radius,
            restitution: c.restitution,
            ...(c.friction !== undefined ? { friction: c.friction } : {}),
          }
          break
        }
        if (m.spec.spring) {
          base.motionType = 'spring_pair'
          base.spring = { ...m.spec.spring }
          break
        }
        if (c?.type === 'plane' && c.anchorId !== undefined) {
          base.motionType = 'board_block'
          base.incline = { angleDeg: 0, friction: c.friction, anchorId: c.anchorId }
          break
        }
        if (c?.type === 'floor' && c.friction > 0) {
          base.motionType = 'board_block'
          base.floorContact = { friction: c.friction, restitution: c.restitution }
          break
        }
        if (c?.type === 'plane') {
          if (Math.abs(c.angle) > 1e-9) {
            base.motionType = 'incline'
            base.incline = {
              angleDeg: Math.abs(c.angle) / DEG,
              friction: c.friction,
              ...(c.beltSpeed !== undefined ? { beltSpeed: c.beltSpeed } : {}),
            }
          } else {
            base.motionType = 'conveyor'
            base.incline = {
              angleDeg: 0,
              friction: c.friction,
              ...(c.beltSpeed !== undefined ? { beltSpeed: c.beltSpeed } : {}),
            }
          }
          // 初速度投影到斜面方向（def 里已是投影后值）
          break
        }
        if (c?.type === 'floor') {
          base.landOnGround = true
          base.restitution = c.restitution
        }
        if (m.spec.drag && m.spec.drag.k > 0) {
          base.airDragK = m.spec.drag.k
        }
        if (o.collidable) {
          base.motionType = 'collision'
          base.restitution = o.restitution ?? 1
        } else {
          base.motionType = 'multi_object'
        }
        if (o.appliedForce) {
          base.appliedForce = { ...o.appliedForce }
          base.motionType = base.motionType ?? 'uniform_accel'
        }
        break
      }
      case 'static':
        base.motionType = 'other'
        break
    }
    // 带电粒子（电荷 + 世界场区域）：覆盖为 charged_particle
    if (o.charge !== undefined && o.charge !== 0) {
      base.charge = o.charge
      base.motionType = 'charged_particle'
    }
    return base
  })

  // collideWith 补成对（AI 层两两成对；3+ 物体时指向其余全部，mapper 全部开 collidable）
  const colliders = objects.filter((o) => o.motionType === 'collision')
  if (colliders.length >= 2) {
    for (const x of colliders) x.collideWith = colliders.filter((y) => y !== x).map((y) => y.id).join(',')
  }

  // 追及形态：≥2 kinematic 物体同线、其中至少一个匀加速追赶另一个匀速者
  const chasers = def.objects.filter(
    (o) => o.motion.kind === 'kinematic' && o.motion.a.x === 0 && o.v0.x !== 0 && Math.abs(o.v0.y) < 1e-9,
  )
  const accelerators = def.objects.filter(
    (o) => o.motion.kind === 'kinematic' && o.motion.a.x !== 0 && o.motion.a.y === 0,
  )
  const isPursuit = flat2D && chasers.length >= 1 && accelerators.length >= 1
  if (isPursuit) {
    const targets = new Set(accelerators.map((o) => o.id))
    for (const c of chasers) {
      const po = objects.find((o) => o.id === c.id)
      if (po) po.chaseTarget = [...targets].join(',')
    }
  }

  // 动态体之间的绳/杆约束（系于静态支点的已反向为 verticalCircle，不再列出）
  const constraints = def.objects.flatMap((o) =>
    (o.constraints ?? [])
      .filter((c) => !pivotRefs.has(`${o.id}|${c.otherId}`))
      .map((c) => ({
        kind: c.kind,
        objectA: o.id,
        objectB: c.otherId,
        length: c.length,
      })),
  )

  const result: ParsedResult = {
    title: def.title,
    motionType: isPursuit ? 'pursuit' : (objects[0]?.motionType ?? 'multi_object'),
    confidence: 0.97,
    gravity: flat2D || gY === 0 ? { x: 0, y: 0 } : { x: g.x, y: g.y },
    groundY: def.world.groundY ?? null,
    airResistance: objects.some((o) => o.airDragK !== undefined),
    objects,
    ...(constraints.length > 0 ? { constraints } : {}),
    ...(grounded && def.world.groundY != null ? { groundY: def.world.groundY } : {}),
    ...(def.world.fields?.length ? { fields: def.world.fields.map((f) => ({ ...f })) } : {}),
    ...(def.solution?.length ? { solution: def.solution.map((s) => ({ ...s })) } : {}),
  }
  return result
}
