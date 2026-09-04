// AI 输出校验层：zod schema + JSON 围栏剥离 + 物理合理性检查。
// 模型输出先过 schema（结构/类型），再过 validatePhysics（量级/引用/几何），
// 任何一环失败都构造 AIParseError 回喂模型重试（最多 3 次），仍失败则转人工校正。
import { z } from 'zod'
import type { AIParseError, ParsedObject, ParsedResult } from './types'

const vec = z.object({ x: z.number().finite(), y: z.number().finite() })

const MOTION_TYPES = [
  'uniform_accel',
  'free_fall',
  'vertical_throw',
  'projectile',
  'circular',
  'simple_harmonic',
  'pendulum',
  'incline',
  'conveyor',
  'collision',
  'pursuit',
  'multi_object',
  'charged_particle',
  'ring_motion',
  'vertical_circle',
  'spring_pair',
  'board_block',
  'other',
] as const

const parsedObjectSchema = z
  .object({
    id: z.string().min(1).max(8),
    label: z.string().min(1).max(24).optional(),
    mass: z.number().positive().max(1e4),
    initialPosition: vec,
    initialVelocity: vec,
    initialAcceleration: vec.optional(),
    radius: z.number().positive().max(10).optional(),
    color: z.string().optional(),
    appliedForce: vec.optional(),
    airDragK: z.number().nonnegative().max(500).optional(),
    restitution: z.number().min(0).max(1).optional(),
    motionType: z.enum(MOTION_TYPES).optional(),
    circularCenter: vec.optional(),
    springEquilibrium: vec.optional(),
    springK: z.number().positive().max(1e5).optional(),
    pendulumPivot: vec.optional(),
    incline: z
      .object({
        angleDeg: z.number().min(-89).max(89),
        friction: z.number().min(0).max(3),
        beltSpeed: z.number().min(-20).max(20).optional(),
        anchorId: z.string().min(1).max(8).optional(),
      })
      .optional(),
    collideWith: z.string().optional(),
    chaseTarget: z.string().optional(),
    landOnGround: z.boolean().optional(),
    charge: z.number().min(-1).max(1).optional(),
    spring: z
      .object({
        otherId: z.string().min(1).max(8),
        k: z.number().positive().max(1e5),
        restLength: z.number().positive().max(100),
      })
      .optional(),
    ring: z
      .object({
        center: vec,
        radius: z.number().positive().max(50),
        friction: z.number().min(0).max(3).optional(),
        restitution: z.number().min(0).max(1).optional(),
      })
      .optional(),
    verticalCircle: z
      .object({
        pivot: vec,
        kind: z.enum(['rope', 'rod']),
        length: z.number().positive().max(100),
      })
      .optional(),
    floorContact: z
      .object({
        friction: z.number().min(0).max(3),
        restitution: z.number().min(0).max(1).optional(),
      })
      .optional(),
  })
  .passthrough()

export const parsedResultSchema = z
  .object({
    title: z.string().min(1).max(80).optional(),
    motionType: z.enum(MOTION_TYPES).default('other'),
    scenarioDescription: z.string().max(300).optional(),
    confidence: z.number().min(0).max(1).optional(),
    timeRange: z.object({ start: z.number().min(0), end: z.number().positive() }).optional(),
    gravity: vec.optional(),
    groundY: z.number().nullable().optional(),
    airResistance: z.boolean().default(false),
    objects: z.array(parsedObjectSchema).min(1).max(10),
    constraints: z
      .array(
        z
          .object({
            kind: z.enum(['rope', 'rod']),
            objectA: z.string(),
            objectB: z.string(),
            length: z.number().positive().max(1000),
          })
          .passthrough(),
      )
      .max(8)
      .optional(),
    fields: z
      .array(
        z.object({
          rect: z
            .object({
              minX: z.number(),
              maxX: z.number(),
              minY: z.number(),
              maxY: z.number(),
            })
            .optional(),
          electric: vec.optional(),
          magnetic: z.number().min(-100).max(100).optional(),
        }),
      )
      .max(8)
      .optional(),
    solution: z
      .array(
        z.object({
          time: z.number().min(0).max(1e5),
          title: z.string().min(1).max(60),
          text: z.string().min(1).max(300),
          formula: z.string().max(120).optional(),
        }),
      )
      .max(12)
      .optional(),
  })
  .passthrough()

export function err(kind: string, message: string, raw?: string): AIParseError {
  return { kind, message, raw }
}

/** 从模型原始输出提取 JSON（剥 markdown 围栏/前后解释文字） */
export function extractJson(raw: string): string {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1]!.trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw err('invalid-json', '模型输出中没有找到 JSON 对象', raw)
  }
  return s.slice(start, end + 1)
}

/** 解析并做 schema 校验；失败抛 AIParseError（kind: invalid-json | schema） */
export function parseResponse(raw: string): ParsedResult {
  let json: unknown
  try {
    json = JSON.parse(extractJson(raw))
  } catch (e) {
    throw err('invalid-json', `输出不是合法 JSON：${e instanceof Error ? e.message : e}`, raw)
  }
  const res = parsedResultSchema.safeParse(json)
  if (!res.success) {
    const first = res.error.issues[0]
    const where = first?.path.join('.') ?? '?'
    throw err('schema', `解析结果不符合约定结构（字段 ${where}：${first?.message ?? '未知问题'}），已请模型修正。`, raw)
  }
  const p = res.data as ParsedResult
  p.confidence = p.confidence ?? 0.85
  return p
}

const MAX = { speed: 300, accel: 400, pos: 1e6, radius: 10 }

/** 物理合理性校验；返回错误信息，null = 通过 */
export function validatePhysics(p: ParsedResult): string | null {
  // 先收集全部 id（引用检查需要完整集合），再逐物体校验
  const ids = new Set<string>()
  for (const o of p.objects) {
    if (ids.has(o.id)) return `物体 id「${o.id}」重复`
    ids.add(o.id)
  }
  for (const o of p.objects) {
    for (const [n, v] of [
      ['初始位置 x', o.initialPosition.x],
      ['初始位置 y', o.initialPosition.y],
    ] as const) {
      if (Math.abs(v) > MAX.pos) return `${o.id} 的${n}超出合理范围（|${v}| > ${MAX.pos}）`
    }
    if (Math.hypot(o.initialVelocity.x, o.initialVelocity.y) > MAX.speed) {
      return `${o.id} 的初速度过大（请检查单位是否为 m/s）`
    }
    const a = o.initialAcceleration
    if (a && Math.hypot(a.x, a.y) > MAX.accel) return `${o.id} 的加速度超出合理范围`
    if (o.mass < 1e-6) return `${o.id} 的质量须为正`
    if (o.airDragK && o.airDragK < 0) return `${o.id} 阻力系数不能为负`
    if (o.incline && Math.abs(o.incline.angleDeg) > 89) return `斜面倾角须在 ±89° 内`
    if (o.motionType === 'circular') {
      if (!o.circularCenter) return `${o.id}：圆周运动缺少圆心 circularCenter`
      if (Math.hypot(o.initialPosition.x - o.circularCenter.x, o.initialPosition.y - o.circularCenter.y) < 1e-9) {
        return `${o.id}：圆周运动初始位置不能与圆心重合`
      }
    }
    if (o.motionType === 'simple_harmonic') {
      if (!o.springK && !o.initialAcceleration) {
        return `${o.id}：简谐运动需要给出弹簧劲度系数 springK（或由 k/m 换算出等效加速度初值）`
      }
    }
    if (o.motionType === 'pendulum') {
      if (!o.pendulumPivot) return `${o.id}：单摆缺少支点 pendulumPivot`
      const L = Math.hypot(o.initialPosition.x - o.pendulumPivot.x, o.initialPosition.y - o.pendulumPivot.y)
      if (L < 1e-9) return `${o.id}：摆长不能为 0`
      const th = Math.atan2(o.initialPosition.x - o.pendulumPivot.x, o.pendulumPivot.y - o.initialPosition.y)
      if (Math.abs(th) > 1.5) return `${o.id}：初始摆角过大（小角度近似要求 ≤ ~85°）`
    }
    if (o.landOnGround && p.groundY === null) {
      return `${o.id} 标记了 landOnGround，但场景没有给出地面高度 groundY`
    }
    if (o.spring && !ids.has(o.spring.otherId)) {
      return `${o.id} 的弹簧另一端 ${o.spring.otherId} 不存在`
    }
    if (o.ring && o.ring.radius <= (o.radius ?? 0)) {
      return `${o.id} 的圆环半径须大于物体半径（半径 ${o.ring.radius}）`
    }
    if (o.verticalCircle) {
      const vc = o.verticalCircle
      const d = Math.hypot(o.initialPosition.x - vc.pivot.x, o.initialPosition.y - vc.pivot.y)
      if (Math.abs(d - vc.length) > Math.max(0.5, vc.length * 0.3)) {
        return `${o.id}：竖直圆周的初始位置与支点距离 ${d.toFixed(2)} m 与绳长 ${vc.length} m 不符（应以支点为圆心放在圆周上）`
      }
    }
    if (o.incline?.anchorId && !ids.has(o.incline.anchorId)) {
      return `${o.id} 的锚板 ${o.incline.anchorId} 不存在`
    }
    if (o.floorContact && p.groundY == null) {
      return `${o.id} 声明了 floorContact，但场景没有给出地面高度 groundY`
    }
  }
  if (p.fields) {
    for (const f of p.fields) {
      if (f.rect && (f.rect.minX >= f.rect.maxX || f.rect.minY >= f.rect.maxY)) {
        return '场区域 rect 的边界顺序错误（须 minX<maxX、minY<maxY）'
      }
      if (!f.electric && f.magnetic === undefined) {
        return '场区域必须至少给出 electric 或 magnetic 之一'
      }
    }
    if (!p.objects.some((o) => o.charge !== undefined && o.charge !== 0)) {
      return '场景声明了电磁场 fields，但没有带电物体（objects[].charge）'
    }
  }
  if (p.objects.length > 1) {
    // 两两互斥引用检查
    for (const o of p.objects) {
      if (o.collideWith && !ids.has(o.collideWith)) return `${o.id} 的碰撞对象 collideWith=${o.collideWith} 不存在`
      if (o.chaseTarget && !ids.has(o.chaseTarget)) return `${o.id} 的追及目标 chaseTarget=${o.chaseTarget} 不存在`
    }
    // 初始位置不得与碰撞对象重叠（两个圆心距离 < 半径和的 60% 视为重叠）
    for (let i = 0; i < p.objects.length; i++) {
      const a = p.objects[i]!
      if (!a.collideWith) continue
      const b = p.objects.find((o) => o.id === a.collideWith)
      if (!b) continue
      const gap = Math.hypot(a.initialPosition.x - b.initialPosition.x, a.initialPosition.y - b.initialPosition.y)
      const ra = a.radius ?? 0.4
      const rb = b.radius ?? 0.4
      if (gap < (ra + rb) * 0.6) {
        return `${a.id} 与 ${b.id} 初始位置重叠，碰撞演示应让它们分开一段距离`
      }
    }
  }
  if (p.confidence !== undefined && (p.confidence < 0 || p.confidence > 1)) {
    return '置信度 confidence 必须在 0~1 之间'
  }
  // 讲解步骤：时间须升序（与画面同步的前提），且不超出 timeRange
  if (p.solution?.length) {
    for (let i = 1; i < p.solution.length; i++) {
      if (p.solution[i]!.time < p.solution[i - 1]!.time - 1e-9) {
        return `讲解步骤时间须按升序排列（第 ${i + 1} 步 time=${p.solution[i]!.time} 早于第 ${i} 步）`
      }
    }
    const end = p.timeRange?.end
    if (end !== undefined && p.solution[p.solution.length - 1]!.time > end + 1e-6) {
      return '讲解步骤的时刻超出了场景时间范围 timeRange.end'
    }
  }
  return null
}

export type { ParsedObject }
