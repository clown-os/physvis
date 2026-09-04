// PhysVis 物理引擎主入口：求解器模式选择 + 急切全量预计算缓存。
//
// 架构要点：
// 1. 混合求解：单物体且无非闭式外力 → 解析解（零误差）；否则 Velocity Verlet 数值积分。
//    所有轨道采样到统一网格（固定 dt = ENGINE_DT = 0.01s），图表/事件/轨迹共用。
// 2. run() 在参数变更后同步急切重建整条时间线；数值模式确定性可复现。
// 3. 数值循环单遍推进（asleep 跳过积分），事件在采样循环与轨道后扫描中收集。
// 4. 碰撞/约束冲量成对等大反向 → 系统动量严格守恒。
import { analyticNaturalEnd, analyticStateAt, isAnalyticMode } from './solvers/analytic'
import { solveConstraints, type ConstraintEdge } from './solvers/constraints'
import {
  resolvePair,
  separateOverlap,
  type Collisionable,
  type PrevState,
} from './solvers/collisions'
import {
  freeBodyStep,
  initBody,
  initPlaneBody,
  planeAnchorStep,
  planeBodyStep,
  springPairStep,
  type ExtraAccFn,
  type NBody,
} from './solvers/numeric'
import {
  ENGINE_DT,
  MAX_SIM_SECONDS,
  type EngineResult,
  type ObjectDef,
  type ObjectTrack,
  type PhysicsEvent,
  type RunOptions,
  type ScenarioDefinition,
} from './types'

export type SolverKind = 'analytic' | 'numeric' | 'static'

/** 默认预估时长（纯解析无尽运动时的兜底） */
export const DEFAULT_RUN_SECONDS = 12
/** 连续多少步状态一致判定"停稳"（0.3s） */
const STEADY_STEPS = 30
/** 全部结束后保留的空闲余量（s） */
const IDLE_MARGIN = 0.1

/** 判定单个物体的求解器（解析需满足：解析运动类型 && 无碰撞/约束/被约束引用） */
export function classifyMode(
  def: ObjectDef,
  allDefs: ObjectDef[],
  forceNumeric: boolean,
): SolverKind {
  if (def.motion.kind === 'static') return 'static'
  if (forceNumeric || def.collidable) return 'numeric'
  if (!isAnalyticMode(def)) return 'numeric'
  if (def.constraints && def.constraints.length > 0) return 'numeric'
  const referenced = allDefs.some(
    (d) => d !== def && d.constraints?.some((c) => c.otherId === def.id),
  )
  return referenced ? 'numeric' : 'analytic'
}

function asCollisionable(b: NBody): Collisionable {
  return {
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    mass: b.def.mass,
    radius: b.def.radius,
    asleep: b.asleep,
  }
}

/** resolvePair/separateOverlap 在浅拷贝上运算 → 结果写回真实 body */
function writeBack(body: NBody, s: { x: number; y: number; vx: number; vy: number; asleep: boolean }): void {
  body.x = s.x
  body.y = s.y
  body.vx = s.vx
  body.vy = s.vy
  body.asleep = s.asleep
}

interface NumericRuntime {
  body: NBody
  /** 上一步采样位置（冲击/TOI/绳张紧判定） */
  prevX: number
  prevY: number
  /** 上一步采样速度（锚板耦合的有效加速度反推 / 轨道 ax/ay 采样） */
  prevVx: number
  prevVy: number
  /** 连续静止采样数 */
  runLen: number
  /** 停稳起点步索引 */
  steadyStart: number | null
  /** 已发过 stop 事件 */
  stopSent: boolean
}

export interface EngineState {
  kind: SolverKind
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
}

/** 步索引 → 采样点状态（轨道读取辅助，图表/渲染共用） */
export function readTrack(
  data: Float32Array,
  step: number,
): { x: number; y: number; vx: number; vy: number; ax: number; ay: number } {
  const b = Math.max(0, Math.min(Math.floor(data.length / 6) - 1, step)) * 6
  return {
    x: data[b]!,
    y: data[b + 1]!,
    vx: data[b + 2]!,
    vy: data[b + 3]!,
    ax: data[b + 4]!,
    ay: data[b + 5]!,
  }
}

export function stepIndexFor(t: number, dt: number, steps: number): number {
  const i = Math.round(t / dt)
  return Math.max(0, Math.min(steps - 1, i))
}

export function run(def: ScenarioDefinition, opts: RunOptions = {}): EngineResult {
  const t0 = performance.now()
  const dt = opts.dt ?? ENGINE_DT
  const forceNumeric = opts.forceNumeric ?? false

  const modes = new Map<string, SolverKind>()
  for (const o of def.objects) modes.set(o.id, classifyMode(o, def.objects, forceNumeric))

  const analyticDefs = def.objects.filter((o) => modes.get(o.id) === 'analytic')
  const numericDefs = def.objects.filter((o) => modes.get(o.id) === 'numeric')
  const staticDefs = def.objects.filter((o) => modes.get(o.id) === 'static')

  // —— 解析体落地信息 ——
  const landTimes = new Map<string, number | null>()
  for (const d of analyticDefs) landTimes.set(d.id, analyticNaturalEnd(d, def.world))
  const endlessAnalytic = analyticDefs.filter((d) => landTimes.get(d.id) === null)

  // —— 请求时长：明确给出 or 场景建议 or 猜测（取解析落地最晚 + 余量；纯无尽用默认值）——
  const landMax = Math.max(
    0,
    ...analyticDefs.map((d) => landTimes.get(d.id) ?? 0).filter((t) => t > 0),
  )
  const requested = Math.min(
    MAX_SIM_SECONDS,
    Math.max(
      0.5,
      opts.duration ?? def.duration ?? (landMax > 0 ? landMax + 0.5 : DEFAULT_RUN_SECONDS),
    ),
  )
  const requestedSteps = Math.max(2, Math.ceil(requested / dt))
  const events: PhysicsEvent[] = []

  // ============ 数值体运行时 ============
  const numericIdx = new Map<string, number>()
  const rts: NumericRuntime[] = numericDefs.map((d, i) => {
    numericIdx.set(d.id, i)
    const m = d.motion
    const isAnchored =
      m.kind === 'numeric' && m.spec.contact?.type === 'plane' && m.spec.contact.anchorId !== undefined
    const body =
      m.kind === 'numeric' && m.spec.contact?.type === 'plane' && !isAnchored
        ? initPlaneBody(d)
        : initBody(d)
    return {
      body,
      prevX: body.x,
      prevY: body.y,
      prevVx: body.vx,
      prevVy: body.vy,
      runLen: 0,
      steadyStart: null,
      stopSent: false,
    }
  })

  // 约束边（数值体-数值体 或 数值体-静态锚点；静态锚点物化为质量无穷的伪体）
  const allBodies: NBody[] = rts.map((r) => r.body)
  const anchorBodies = new Map<string, number>() // 静态锚点 id → allBodies 索引
  for (const d of staticDefs) {
    anchorBodies.set(d.id, allBodies.length)
    allBodies.push({
      def: { ...d, mass: Number.POSITIVE_INFINITY },
      x: d.p0.x,
      y: d.p0.y,
      vx: 0,
      vy: 0,
      grounded: false,
      planeS: 0,
      asleep: false,
      extraNormalMass: 0,
      px: d.p0.x,
      py: d.p0.y,
      pvx: 0,
      pvy: 0,
    })
  }
  const edges: ConstraintEdge[] = []
  const constrainedSet = new Set<string>()
  for (const d of numericDefs) {
    for (const c of d.constraints ?? []) {
      const i = numericIdx.get(d.id)!
      const j = numericIdx.get(c.otherId) ?? anchorBodies.get(c.otherId)
      if (j === undefined) continue
      const key = i < j ? `${i}|${j}` : `${j}|${i}`
      if (constrainedSet.has(key)) continue
      constrainedSet.add(key)
      edges.push({ kind: c.kind, i, j, length: c.length })
    }
  }

  // 锚板耦合对：物体（接触 plane.anchorId）→ 锚体运行时（须为数值体）
  const anchoredPairs: Array<{ bi: number; ai: number }> = []
  for (let bi = 0; bi < numericDefs.length; bi++) {
    const d = numericDefs[bi]!
    const m = d.motion
    if (m.kind !== 'numeric' || m.spec.contact?.type !== 'plane') continue
    const anchorId = m.spec.contact.anchorId
    if (anchorId === undefined) continue
    const ai = numericIdx.get(anchorId)
    if (ai === undefined || ai === bi) continue
    anchoredPairs.push({ bi, ai })
  }
  const anchoredSet = new Set(anchoredPairs.map((p) => p.bi))
  const anchorOfSet = new Set(anchoredPairs.map((p) => p.ai))

  // 锚体（板）承受物块重量：接地正压力 N=(M+m)g 与展示层一致
  for (const { bi, ai } of anchoredPairs) {
    rts[ai]!.body.extraNormalMass += rts[bi]!.body.def.mass
  }

  // 弹簧对（任一端声明即可；两端等大反向）
  const springPairs: Array<{ i: number; j: number; k: number; restLength: number }> = []
  {
    const seen = new Set<string>()
    for (const d of numericDefs) {
      const m = d.motion
      if (m.kind !== 'numeric' || !m.spec.spring) continue
      const j = numericIdx.get(m.spec.spring.otherId)
      if (j === undefined) continue
      const i = numericIdx.get(d.id)!
      const key = i < j ? `${i}|${j}` : `${j}|${i}`
      if (seen.has(key)) continue
      seen.add(key)
      springPairs.push({ i, j, k: m.spec.spring.k, restLength: m.spec.spring.restLength })
    }
  }

  // 位置/速度相关附加加速度（场力 + 弹簧对力）
  const extraAcc: ExtraAccFn = (b, x, y, vx, vy) => {
    let ax = 0
    let ay = 0
    const q = b.def.charge ?? 0
    if (q !== 0) {
      for (const f of def.world.fields ?? []) {
        if (
          f.rect &&
          (x < f.rect.minX || x > f.rect.maxX || y < f.rect.minY || y > f.rect.maxY)
        ) {
          continue
        }
        if (f.electric) {
          ax += (q * f.electric.x) / b.def.mass
          ay += (q * f.electric.y) / b.def.mass
        }
        if (f.magnetic) {
          // 洛伦兹力 qv×B（Bz 垂直纸面）：(vy·Bz, -vx·Bz)
          ax += (q * vy * f.magnetic) / b.def.mass
          ay += (q * -vx * f.magnetic) / b.def.mass
        }
      }
    }
    return { x: ax, y: ay }
  }
  // 碰撞对
  const collidePairs: Array<[number, number]> = []
  for (let i = 0; i < numericDefs.length; i++) {
    const di = numericDefs[i]!
    const m1 = di.motion.kind === 'numeric' ? di.motion.spec.contact?.type : undefined
    for (let j = i + 1; j < numericDefs.length; j++) {
      const dj = numericDefs[j]!
      const m2 = dj.motion.kind === 'numeric' ? dj.motion.spec.contact?.type : undefined
      if (m1 === 'plane' || m2 === 'plane') continue
      if (constrainedSet.has(`${i}|${j}`)) continue
      if (!di.collidable || !dj.collidable) continue
      collidePairs.push([i, j])
    }
  }
  const ePair = (i: number, j: number) => {
    const e1 = numericDefs[i]!.restitution ?? 1
    const e2 = numericDefs[j]!.restitution ?? 1
    return Math.max(0, Math.min(1, (e1 + e2) / 2))
  }

  // ============ 主循环：数值推进（单遍，不提前 break） ============
  const numSamples: Float32Array[] = rts.map(() => new Float32Array(requestedSteps * 6))

  for (let k = 0; k < requestedSteps; k++) {
    // 1) 记录当前状态（采样 k）
    for (let bi = 0; bi < rts.length; bi++) {
      const rt = rts[bi]!
      const body = rt.body
      const arr = numSamples[bi]!
      const base = k * 6
      let ax: number
      let ay: number
      if (anchoredSet.has(bi) || anchorOfSet.has(bi)) {
        // 锚板耦合体：采样有效加速度 = 上一采样间隔的 Δv/dt
        // （含摩擦反作用；注意 prevVx 此刻已被上轮步进推进为当前值，须取上一采样速度）
        ax = k === 0 ? 0 : (body.vx - arr[base - 4]) / dt
        ay = k === 0 ? 0 : (body.vy - arr[base - 3]) / dt
      } else {
        const m = body.def.motion
        const kd = m.kind === 'numeric' && m.spec.drag ? m.spec.drag.k : 0
        const e = extraAcc(body, body.x, body.y, body.vx, body.vy)
        ax =
          def.world.gravity.x +
          (kd * -body.vx + (body.def.appliedForce?.x ?? 0)) / body.def.mass +
          e.x
        ay =
          def.world.gravity.y +
          (kd * -body.vy + (body.def.appliedForce?.y ?? 0)) / body.def.mass +
          e.y
        // 弹簧对力（采样时刻构型，供 a-t 图表展示；积分由 springPairStep 精确承担）
        if (bi !== undefined) {
          for (const sp of springPairs) {
            if (sp.i !== bi && sp.j !== bi) continue
            const other = sp.i === bi ? rts[sp.j]!.body : rts[sp.i]!.body
            const dx = other.x - body.x
            const dy = other.y - body.y
            const d = Math.hypot(dx, dy)
            if (d > 1e-9) {
              const F = sp.k * (d - sp.restLength)
              const sign = sp.i === bi ? 1 : -1
              ax += (sign * F * dx) / d / body.def.mass
              ay += (sign * F * dy) / d / body.def.mass
            }
          }
        }
      }
      arr[base] = body.x
      arr[base + 1] = body.y
      arr[base + 2] = body.vx
      arr[base + 3] = body.vy
      arr[base + 4] = ax
      arr[base + 5] = ay
    }

    // 2) 停稳统计（与上一采样对比）
    for (let bi = 0; bi < rts.length; bi++) {
      const rt = rts[bi]!
      if (k === 0) continue
      const arr = numSamples[bi]!
      const base = k * 6
      const same =
        Math.abs(arr[base] - arr[base - 6]) < 1e-9 &&
        Math.abs(arr[base + 1] - arr[base - 5]) < 1e-9 &&
        Math.abs(arr[base + 2] - arr[base - 4]) < 1e-9 &&
        Math.abs(arr[base + 3] - arr[base - 3]) < 1e-9
      rt.runLen = same ? rt.runLen + 1 : 0
      if (rt.runLen >= STEADY_STEPS && rt.steadyStart === null) {
        rt.steadyStart = k - STEADY_STEPS + 1
      }
      if (rt.runLen >= STEADY_STEPS) {
        rt.body.asleep = true
        if (!rt.stopSent && rt.steadyStart !== null) {
          rt.stopSent = true
          events.push({
            kind: 'stop',
            time: rt.steadyStart * dt,
            step: rt.steadyStart,
            objectId: rt.body.def.id,
          })
        }
      }
    }

    if (k === requestedSteps - 1) break

    // 3) 推进（asleep 跳过；锚板耦合体由 3b 推进）
    // 绳/杆约束体子步进（dt/SUB）：约束求解逐子步投影，显著抑制高速弯道段数值能耗
    // （全步长时每次投影会消掉曲率半径级的虚假法向速度 ~O(ω²dt²) 每步，长时间整圈会掉能量）
    const SUB = edges.length > 0 ? 4 : 1
    const h = dt / SUB
    for (let s = 0; s < SUB; s++) {
      for (let bi = 0; bi < rts.length; bi++) {
        const rt = rts[bi]!
        if (rt.body.asleep) continue
        if (anchoredSet.has(bi)) continue
        const m = rt.body.def.motion
        if (m.kind === 'numeric' && m.spec.contact?.type === 'plane') {
          if (s === 0) planeBodyStep(rt.body, def.world, dt) // 平面体保持整步（1-D 面内推进）
        } else {
          const yBefore = rt.body.y
          freeBodyStep(rt.body, def.world, h, yBefore, undefined, extraAcc)
        }
      }
      solveConstraints(allBodies, edges, { h, gravity: def.world.gravity })
    }

    // 3a) 弹簧对：相对坐标解析简谐推进（能量/动量严格守恒，见 springPairStep）。
    // 自由步进保留 COM 运动（重力/场力），相对运动用 ω=√(k/μ) 的闭式解替换。
    for (const sp of springPairs) {
      springPairStep(rts[sp.i]!.body, rts[sp.j]!.body, sp, dt)
    }

    // 3b) 锚板耦合推进（锚体已先推进；摩擦等大反向，动量守恒）
    for (const { bi, ai } of anchoredPairs) {
      const rtB = rts[bi]!
      const rtA = rts[ai]!
      if (rtB.body.asleep && rtA.body.asleep) continue
      const aEffA = rtA.body.asleep ? 0 : (rtA.body.vx - rtA.prevVx) / dt
      planeAnchorStep(rtB.body, rtA.body, def.world, dt, aEffA)
    }

    // 4) 碰撞（TOI 冲量 + 重叠分离多轮 + 约束同层迭代）
    for (const [ai, bj] of collidePairs) {
      const a = rts[ai]!
      const b = rts[bj]!
      const ca: Collisionable & PrevState = { ...asCollisionable(a.body), px: a.prevX, py: a.prevY }
      const cb: Collisionable & PrevState = { ...asCollisionable(b.body), px: b.prevX, py: b.prevY }
      const res = resolvePair(ca, cb, ePair(ai, bj), dt)
      if (res) {
        writeBack(a.body, ca)
        writeBack(b.body, cb)
        events.push({
          kind: 'collision',
          time: k * dt,
          step: k,
          objectId: a.body.def.id,
          objectBId: b.body.def.id,
          magnitude: res.approachSpeed,
        })
      }
    }
    // 绳张紧跨越事件：须在约束求解"拉回绳长"之前检测（求解后 d 恒 = L，永不触发）。
    // 松弛阈值 ROPE_SLACK_EPS：弦量留出余量，避免绷紧摆动中浮点/曲率微小波动误报。
    for (const edge of edges) {
      if (edge.kind !== 'rope') continue
      const a = allBodies[edge.i]!
      const b = allBodies[edge.j]!
      const axPrev = edge.i < rts.length ? rts[edge.i]!.prevX : a.x
      const ayPrev = edge.i < rts.length ? rts[edge.i]!.prevY : a.y
      const bxPrev = edge.j < rts.length ? rts[edge.j]!.prevX : b.x
      const byPrev = edge.j < rts.length ? rts[edge.j]!.prevY : b.y
      const dCur = Math.hypot(b.x - a.x, b.y - a.y)
      const dPrev = Math.hypot(bxPrev - axPrev, byPrev - ayPrev)
      // dCur 在子步投影后恒 ≈ L：用 ≥ L−1e-4 判定"已张紧"，配合松弛下限 1e-3 排除绷紧摆动噪声
      if (dPrev <= edge.length - 1e-3 && dCur >= edge.length - 1e-4) {
        events.push({
          kind: 'ropeTaut',
          time: k * dt,
          step: k,
          objectId: a.def.id,
          objectBId: b.def.id,
        })
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      for (const [ai, bj] of collidePairs) {
        const ba = rts[ai]!.body
        const bb = rts[bj]!.body
        const ca = asCollisionable(ba)
        const cb = asCollisionable(bb)
        if (separateOverlap(ca, cb)) {
          writeBack(ba, ca)
          writeBack(bb, cb)
        }
      }
      solveConstraints(allBodies, edges)
    }

    // 5) 更新 prev（下一迭代的"步起点"）
    for (const rt of rts) {
      rt.prevX = rt.body.x
      rt.prevY = rt.body.y
      rt.prevVx = rt.body.vx
      rt.prevVy = rt.body.vy
    }
  }

  // ============ 步数整理（裁剪/保持） ============
  // 所有物体都可终止（数值停稳 ∪ 解析落地）→ 裁剪到"最后活跃步 + 余量"；否则保持全长
  // 注意：rts 为空时 every() 恒真（纯解析场景由 endlessAnalytic 决定）
  const numericAllSteady = rts.every((rt) => rt.steadyStart !== null)
  const trimOk =
    (numericDefs.length === 0 || numericAllSteady) &&
    endlessAnalytic.length === 0 &&
    staticDefs.length === 0

  let stepsFinal = requestedSteps
  if (trimOk) {
    const lastActive = Math.max(
      0,
      ...rts.map((rt) => rt.steadyStart ?? 0),
      ...analyticDefs.map((d) => Math.max(0, Math.ceil((landTimes.get(d.id) ?? 0) / dt))),
    )
    stepsFinal = Math.min(
      requestedSteps,
      Math.max(2, lastActive + Math.ceil(IDLE_MARGIN / dt) + 2),
    )
  }
  const duration = stepsFinal * dt

  // ============ 轨道装配 ============
  const tracks: Record<string, ObjectTrack> = {}
  const order: string[] = []

  // 解析轨道（填充到 stepsFinal，落地冻结）
  for (const d of analyticDefs) {
    const arr = new Float32Array(stepsFinal * 6)
    const landTime = landTimes.get(d.id) ?? null
    let frozen: ReturnType<typeof analyticStateAt> | null = null
    let landIdx = -1
    let landSpeed = 0
    if (landTime !== null) {
      landIdx = Math.ceil(landTime / dt)
      frozen = analyticStateAt(d, landTime)
      // 落地速率 |v(landTime)|
      landSpeed = Math.hypot(frozen.vx, frozen.vy)
    }
    for (let i = 0; i < stepsFinal; i++) {
      const base = i * 6
      if (landTime !== null && i >= landIdx && frozen) {
        arr[base] = frozen.x
        arr[base + 1] = frozen.y
        arr[base + 2] = 0
        arr[base + 3] = 0
        arr[base + 4] = 0
        arr[base + 5] = 0
      } else {
        const s = analyticStateAt(d, i * dt)
        arr[base] = s.x
        arr[base + 1] = s.y
        arr[base + 2] = s.vx
        arr[base + 3] = s.vy
        arr[base + 4] = s.ax
        arr[base + 5] = s.ay
      }
    }
    if (landTime !== null && landIdx < stepsFinal) {
      events.push({
        kind: 'landing',
        time: landIdx * dt,
        step: landIdx,
        objectId: d.id,
        magnitude: landSpeed,
      })
    }
    tracks[d.id] = {
      id: d.id,
      label: d.label,
      color: d.color,
      radius: d.radius,
      def: d,
      mode: 'analytic',
      ended: landTime !== null,
      data: arr,
    }
    order.push(d.id)
  }

  // 静态轨道
  for (const d of staticDefs) {
    const arr = new Float32Array(stepsFinal * 6)
    for (let i = 0; i < stepsFinal; i++) {
      arr[i * 6] = d.p0.x
      arr[i * 6 + 1] = d.p0.y
    }
    tracks[d.id] = {
      id: d.id,
      label: d.label,
      color: d.color,
      radius: d.radius,
      def: d,
      mode: 'static',
      ended: true,
      data: arr,
    }
    order.push(d.id)
  }

  // 数值轨道（裁剪时复制前 stepsFinal 个采样；停稳尾部由采样保证一致）
  for (let bi = 0; bi < rts.length; bi++) {
    const rt = rts[bi]!
    const d = numericDefs[bi]!
    const full = numSamples[bi]!
    const data =
      stepsFinal * 6 === full.length ? full : full.slice(0, stepsFinal * 6)
    tracks[d.id] = {
      id: d.id,
      label: d.label,
      color: d.color,
      radius: d.radius,
      def: d,
      mode: 'numeric',
      ended: rt.steadyStart !== null,
      data,
    }
    order.push(d.id)
  }

  // ============ 轨道后扫描事件（落地/最高点/相遇） ============
  postScanEvents(tracks, order, def, dt, events)

  // 事件去重 + 排序
  events.sort((a, b) => a.step - b.step || a.kind.localeCompare(b.kind) || (a.objectId ?? '').localeCompare(b.objectId ?? ''))
  const seen = new Set<string>()
  const deduped: PhysicsEvent[] = []
  for (const ev of events) {
    const key = `${ev.kind}|${ev.step}|${ev.objectId ?? ''}|${ev.objectBId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(ev)
  }

  return {
    dt,
    steps: stepsFinal,
    duration,
    ended: numericAllSteady && endlessAnalytic.length === 0,
    tracks,
    order,
    events: deduped,
    def,
    solveMs: performance.now() - t0,
  }
}

/** 轨道后扫描：落地（数值贴地体首次触地）/最高点（vy 正→负）/相遇（非碰撞对穿越） */
function postScanEvents(
  tracks: Record<string, ObjectTrack>,
  order: string[],
  def: ScenarioDefinition,
  dt: number,
  out: PhysicsEvent[],
): void {
  // 数值贴地体：落地 + 最高点（反弹后也会有一次）；圆环体也做最高点检测
  for (const id of order) {
    const t = tracks[id]!
    const m = t.def.motion
    const isFloorNum =
      m.kind === 'numeric' && m.spec.contact?.type === 'floor'
    const isCircleNum =
      m.kind === 'numeric' && m.spec.contact?.type === 'circle'
    if (!isFloorNum && !isCircleNum) continue
    if (isFloorNum && def.world.groundY === undefined) continue
    const gy = def.world.groundY !== undefined ? def.world.groundY + t.radius : NaN
    const data = t.data
    const n = data.length / 6
    // 落地：首次触地（吸附/反弹的瞬间采样恰在地面）
    if (isFloorNum) {
      for (let i = 1; i < n; i++) {
        const y = data[i * 6 + 1]!
        if (y <= gy + 1e-6) {
          const spd = Math.abs(data[(i - 1) * 6 + 3]!)
          out.push({
            kind: 'landing',
            time: i * dt,
            step: i,
            objectId: id,
            magnitude: spd > 1e-3 ? +spd.toFixed(2) : undefined,
          })
          break
        }
      }
    }
    // 最高点（竖直方向 vy 正 → 负）
    for (let i = 1; i < n; i++) {
      const vyPrev = data[(i - 1) * 6 + 3]!
      const vy = data[i * 6 + 3]!
      if (vyPrev > 1e-6 && vy < -1e-6) {
        out.push({ kind: 'apex', time: i * dt, step: i, objectId: id })
        break
      }
    }
  }

  // 解析上抛/斜抛：最高点
  for (const id of order) {
    const t = tracks[id]!
    const m = t.def.motion
    const isVertKin = m.kind === 'kinematic' && m.a.y !== 0
    if (!isVertKin) continue
    const data = t.data
    const n = data.length / 6
    for (let i = 1; i < n; i++) {
      const vyPrev = data[(i - 1) * 6 + 3]!
      const vy = data[i * 6 + 3]!
      if (vyPrev > 1e-6 && vy < -1e-6) {
        out.push({ kind: 'apex', time: i * dt, step: i, objectId: id })
        break
      }
    }
  }

  // 追及相遇：非碰撞对、非约束对，距离穿越 rsum
  for (let a = 0; a < order.length; a++) {
    const idA = order[a]!
    const tA = tracks[idA]!
    const defA = tA.def
    if (defA.collidable || defA.motion.kind === 'static') continue
    for (let b = a + 1; b < order.length; b++) {
      const idB = order[b]!
      const tB = tracks[idB]!
      const defB = tB.def
      if (defB.collidable || defB.motion.kind === 'static') continue
      const linked =
        defA.constraints?.some((c) => c.otherId === idB) ||
        defB.constraints?.some((c) => c.otherId === idA)
      if (linked) continue
      const rsum = tA.radius + tB.radius
      const dA = tA.data
      const dB = tB.data
      const n = dA.length / 6
      for (let i = 1; i < n; i++) {
        const dx0 = dA[(i - 1) * 6]! - dB[(i - 1) * 6]!
        const dy0 = dA[(i - 1) * 6 + 1]! - dB[(i - 1) * 6 + 1]!
        const dPrev = Math.hypot(dx0, dy0)
        const dx = dA[i * 6]! - dB[i * 6]!
        const dy = dA[i * 6 + 1]! - dB[i * 6 + 1]!
        const d = Math.hypot(dx, dy)
        if (dPrev >= rsum - 1e-9 && d < rsum) {
          out.push({
            kind: 'meet',
            time: i * dt,
            step: i,
            objectId: idA,
            objectBId: idB,
            magnitude: +(rsum - d).toFixed(2),
          })
          break
        }
      }
    }
  }
}
