// 物理引擎核心正确性测试：解析解公式、数值积分 parity、动量/能量守恒、事件检测。
import { describe, expect, it } from 'vitest'
import { run, readTrack, stepIndexFor } from '../../src/engine/Engine'
import type { ObjectDef, ScenarioDefinition } from '../../src/engine/types'
import { ENGINE_DT } from '../../src/engine/types'
import { autoFit, computeSceneBounds } from '../../src/engine/camera'
import { instantiate, applyValues } from '../../src/engine/scenarios'

const G = 9.8
const dt = ENGINE_DT

function def(
  id: string,
  partial: Partial<ObjectDef> & {
    p0: { x: number; y: number }
    v0: { x: number; y: number }
    motion: ObjectDef['motion']
  },
): ObjectDef {
  return {
    id,
    label: id,
    mass: 1,
    radius: 0,
    color: '#000',
    collidable: false,
    ...partial,
  }
}

function scene(objects: ObjectDef[], over: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    templateId: 'test',
    objects,
    world: { gravity: { x: 0, y: -G }, groundY: 0 },
    ...over,
  }
}

describe('解析解（kinematic）', () => {
  it('自由落体：h=½gt²，v=gt', () => {
    const s = scene([
      def('ball', {
        p0: { x: 0, y: 20 },
        v0: { x: 0, y: 0 },
        motion: { kind: 'kinematic', a: { x: 0, y: -G }, landOnGround: true },
      }),
    ])
    const r = run(s, { duration: 3 })
    const t1 = readTrack(r.tracks.ball!.data, stepIndexFor(1, dt, r.steps))
    expect(t1.y).toBeCloseTo(20 - 4.9, 6)
    expect(t1.vy).toBeCloseTo(-G, 6)
    // 落地时刻 t=√(2h/g)
    const tLand = Math.sqrt((2 * 20) / G)
    expect(r.events.some((e) => e.kind === 'landing')).toBe(true)
    const land = r.events.find((e) => e.kind === 'landing')!
    expect(land.time).toBeCloseTo(tLand, 1) // 网格对齐 ±0.01
    // 落地后冻结
    const after = readTrack(r.tracks.ball!.data, Math.min(r.steps - 1, Math.ceil(3 / dt)))
    expect(after.y).toBeCloseTo(0, 6)
    expect(after.vy).toBeCloseTo(0, 9)
    expect(after.ax).toBeCloseTo(0, 9)
  })

  it('竖直上抛：对称性 + 最高点事件', () => {
    const v0 = 15
    const s = scene([
      def('ball', {
        p0: { x: 0, y: 0 },
        v0: { x: 0, y: v0 },
        motion: { kind: 'kinematic', a: { x: 0, y: -G }, landOnGround: true },
      }),
    ])
    const r = run(s, { duration: 4 })
    // 最高点：t=v0/g，高度 v0²/2g
    const tApex = v0 / G
    const idxApex = stepIndexFor(tApex, dt, r.steps)
    const atApex = readTrack(r.tracks.ball!.data, idxApex)
    expect(atApex.y).toBeCloseTo((v0 * v0) / (2 * G), 2)
    expect(Math.abs(atApex.vy)).toBeLessThan(0.15)
    expect(r.events.some((e) => e.kind === 'apex')).toBe(true)
    // 往返：落回地面总时间 2v0/g
    const land = r.events.find((e) => e.kind === 'landing')!
    expect(land.time).toBeCloseTo((2 * v0) / G, 1)
  })

  it('平抛：射程 R = v0·√(2h/g)', () => {
    const vx = 10
    const h = 20
    const s = scene([
      def('ball', {
        p0: { x: 0, y: h },
        v0: { x: vx, y: 0 },
        motion: { kind: 'kinematic', a: { x: 0, y: -G }, landOnGround: true },
      }),
    ])
    const r = run(s, { duration: 4 })
    const tLand = Math.sqrt((2 * h) / G)
    const R = vx * tLand
    const end = readTrack(r.tracks.ball!.data, r.steps - 1)
    expect(end.x).toBeCloseTo(R, 1) // 网格截断 ±0.1m
    expect(end.y).toBeCloseTo(0, 6)
    const land = r.events.find((e) => e.kind === 'landing')!
    expect(land.time).toBeCloseTo(tLand, 1)
    // 水平匀速
    const mid = readTrack(r.tracks.ball!.data, stepIndexFor(1, dt, r.steps))
    expect(mid.vx).toBeCloseTo(vx, 9)
  })
})

describe('数值积分 parity（同一场景解析 vs 数值）', () => {
  it('平抛 + 地面摩擦：着陆前数值与解析同轨（drift < 1e-4）', () => {
    // 数值体的"落地冻结"语义不同（吸附滑行减速 vs 解析瞬时停），因此逐样本
    // parity 只比较着陆前；落地时刻/终态单独验证
    const mk = (numeric: boolean): ScenarioDefinition =>
      scene([
        def('ball', {
          p0: { x: 0, y: 10 },
          v0: { x: 5, y: 3 },
          motion: numeric
            ? {
                kind: 'numeric',
                spec: { contact: { type: 'floor', restitution: 0, friction: 2 } },
              }
            : { kind: 'kinematic', a: { x: 0, y: -G }, landOnGround: true },
        }),
      ])
    const a = run(mk(false), { duration: 3 })
    const b = run(mk(true), { duration: 3 })
    const landEv = a.events.find((e) => e.kind === 'landing')
    expect(landEv).toBeDefined()
    const landIdx = landEv!.step
    for (let i = 0; i < landIdx; i++) {
      const sa = readTrack(a.tracks.ball!.data, i)
      const sb = readTrack(b.tracks.ball!.data, i)
      expect(Math.abs(sa.x - sb.x)).toBeLessThan(1e-4)
      expect(Math.abs(sa.y - sb.y)).toBeLessThan(1e-4)
      expect(Math.abs(sa.vx - sb.vx)).toBeLessThan(1e-4)
      expect(Math.abs(sa.vy - sb.vy)).toBeLessThan(1e-4)
    }
    // 落地时刻：落在同一网格步（±1 步）
    const landB = b.events.find((e) => e.kind === 'landing')
    expect(landB).toBeDefined()
    expect(Math.abs(landB!.step - landIdx)).toBeLessThanOrEqual(1)
    // 终态：均贴地静止
    const aEnd = readTrack(a.tracks.ball!.data, a.steps - 1)
    const bEnd = readTrack(b.tracks.ball!.data, b.steps - 1)
    expect(aEnd.y).toBeCloseTo(0, 6)
    expect(bEnd.y).toBeCloseTo(0, 6)
    expect(Math.abs(aEnd.vy)).toBeLessThan(1e-6)
    expect(Math.abs(bEnd.vy)).toBeLessThan(1e-6)
    expect(b.ended).toBe(true)
  })

  it('有阻力场景：数值速度单调衰减（物理趋势正确）', () => {
    const s = scene([
      def('ball', {
        p0: { x: 0, y: 0 },
        v0: { x: 20, y: 0 },
        motion: {
          kind: 'numeric',
          spec: { drag: { k: 0.5 }, contact: { type: 'floor', restitution: 0, friction: 0 } },
        },
      }),
    ])
    const r = run(s, { duration: 6 })
    // 阻尼振动速度衰减：检查 vx 前半段递减
    const v0s = readTrack(r.tracks.ball!.data, 0).vx
    const v1s = readTrack(r.tracks.ball!.data, stepIndexFor(1, dt, r.steps)).vx
    const v2s = readTrack(r.tracks.ball!.data, stepIndexFor(2, dt, r.steps)).vx
    expect(v0s).toBeCloseTo(20, 3)
    expect(v1s).toBeLessThan(v0s)
    expect(v2s).toBeLessThan(v1s)
    expect(r.steps).toBeGreaterThan(50)
  })
})

describe('匀速圆周（解析）', () => {
  it('速率恒定 + 向心加速度指向圆心', () => {
    const r0 = 2
    const omega = 2
    const s = scene([
      def('p', {
        p0: { x: 3 + r0, y: 0 },
        v0: { x: 0, y: r0 * omega },
        motion: {
          kind: 'circular',
          center: { x: 3, y: 0 },
          radius: r0,
          omega,
          phi0: 0,
        },
      }),
    ])
    const r = run(s, { duration: 2 }) // 约 0.64 个周期
    for (let i = 0; i < r.steps; i += 25) {
      const st = readTrack(r.tracks.p!.data, i)
      const speed = Math.hypot(st.vx, st.vy)
      expect(speed).toBeCloseTo(r0 * omega, 5)
      // 向心加速度指向圆心（与向心矢量平行同向）
      const dx = 3 - st.x
      const dy = 0 - st.y
      expect(st.ax * dy - st.ay * dx).toBeCloseTo(0, 4) // 平行（Float32 存储容差）
      expect(st.ax * dx + st.ay * dy).toBeGreaterThan(0) // 与向心同向
    }
  })
})

describe('简谐（解析）', () => {
  it('a = -ω²x；周期 T=2π/ω 后回到初态', () => {
    const A = 1.2
    const omega = 2.5
    const s = scene([
      def('m', {
        p0: { x: A, y: 0 },
        v0: { x: 0, y: 0 },
        motion: {
          kind: 'harmonic',
          axis: { x: 1, y: 0 },
          equilibrium: { x: 0, y: 0 },
          amplitude: A,
          omega,
          phi0: 0,
        },
      }),
    ])
    const T = (2 * Math.PI) / omega
    const r = run(s, { duration: 3 }) // 时长须超过一个周期 T≈2.51s
    for (let i = 0; i < r.steps; i += 20) {
      const st = readTrack(r.tracks.m!.data, i)
      expect(st.ax).toBeCloseTo(-omega * omega * st.x, 6)
    }
    const sT = readTrack(r.tracks.m!.data, stepIndexFor(T, dt, r.steps))
    expect(sT.x).toBeCloseTo(A, 2)
    expect(Math.abs(sT.vx)).toBeLessThan(0.05)
  })
})

describe('碰撞（数值）', () => {
  it('等质量完全弹性对心碰撞：速度交换 + 动量守恒', () => {
    const mkBall = (id: string, x: number, vx: number): ObjectDef =>
      def(id, {
        p0: { x, y: 2 },
        v0: { x: vx, y: 0 },
        mass: 1,
        radius: 1,
        motion: { kind: 'numeric', spec: { drag: { k: 0 } } },
        collidable: true,
        restitution: 1,
      })
    const s = scene([mkBall('A', -3, 4), mkBall('B', 3, -4)])
    const r = run(s, { duration: 2 })
    const n = r.steps
    // 碰撞前动量 = 后动量（全程恒量 = 0）
    for (let i = 0; i < n; i += 20) {
      const a = readTrack(r.tracks.A!.data, i)
      const b = readTrack(r.tracks.B!.data, i)
      expect(a.vx + b.vx).toBeCloseTo(0, 6)
    }
    // 碰撞后速度交换
    const aEnd = readTrack(r.tracks.A!.data, n - 1)
    const bEnd = readTrack(r.tracks.B!.data, n - 1)
    expect(aEnd.vx).toBeCloseTo(-4, 1)
    expect(bEnd.vx).toBeCloseTo(4, 1)
    // 事件存在
    expect(r.events.some((e) => e.kind === 'collision')).toBe(true)
    // 能量守恒（无地面损耗场景，完全弹性）
    const ke0 = 0.5 * (16 + 16)
    const keEnd = 0.5 * (aEnd.vx * aEnd.vx + bEnd.vx * bEnd.vx)
    expect(keEnd).toBeCloseTo(ke0, 0) // 相对 1e0 容差：位置修正损耗微小
  })

  it('动能检查：1kg 球 5m/s 撞 3kg 静止球（一维公式验证）', () => {
    // 弹性碰撞公式：v1'=(m1-m2)/(m1+m2)v1, v2'=2m1/(m1+m2)v1
    const mk = (id: string, x: number, m: number, vx: number): ObjectDef =>
      def(id, {
        p0: { x, y: 2 },
        v0: { x: vx, y: 0 },
        mass: m,
        radius: 0.5,
        motion: { kind: 'numeric', spec: { drag: { k: 0 } } },
        collidable: true,
        restitution: 1,
      })
    const s = scene([mk('A', -1, 1, 5), mk('B', 1, 3, 0)])
    const r = run(s, { duration: 1.5 })
    const endA = readTrack(r.tracks.A!.data, r.steps - 1)
    const endB = readTrack(r.tracks.B!.data, r.steps - 1)
    expect(endA.vx).toBeCloseTo(-2.5, 1)
    expect(endB.vx).toBeCloseTo(2.5, 1)
  })
})

describe('绳约束（数值）', () => {
  it('张紧后沿绳同速 + 动量守恒', () => {
    const mk = (id: string, x: number, vx: number, m: number): ObjectDef =>
      def(id, {
        p0: { x, y: 3 },
        v0: { x: vx, y: 0 },
        mass: m,
        radius: 0.2,
        motion: { kind: 'numeric', spec: { drag: { k: 0 } } },
        constraints: [
          { kind: 'rope', otherId: id === 'A' ? 'B' : 'A', length: 5 },
        ],
      })
    const s = scene([mk('A', 0, 4, 1), mk('B', 3, 0, 3)])
    const r = run(s, { duration: 3 })
    // 动量守恒
    const n = r.steps
    for (let i = 0; i < n; i += 30) {
      const a = readTrack(r.tracks.A!.data, i)
      const b = readTrack(r.tracks.B!.data, i)
      expect(a.vx * 1 + b.vx * 3).toBeCloseTo(4, 5)
      // 距离不超过绳长
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(5 + 1e-6)
    }
    // 张紧后同速：终态 vA≈vB
    const eA = readTrack(r.tracks.A!.data, n - 1)
    const eB = readTrack(r.tracks.B!.data, n - 1)
    expect(eA.vx).toBeCloseTo(eB.vx, 2)
    // 张紧事件
    expect(r.events.some((e) => e.kind === 'ropeTaut')).toBe(true)
  })
})

describe('斜面（数值 1-D 平面接触）', () => {
  // 平面几何：u=(cosθ,sinθ) 为切向（+u 即下滑方向），n=(-sinθ,cosθ) 为上法向；
  // 物体圆心 p = s·u + r·n。取 θ=-30°：u=(0.866,-0.5)，重力切向分量 = -g·u_y = +g·sin30°
  const th = -Math.PI / 6
  const ux = Math.cos(th)
  const uy = Math.sin(th)
  const nx = -Math.sin(th)
  const ny = Math.cos(th)
  const R = 0.2
  const s0 = 0.4
  const mk = (mu: number): ObjectDef =>
    def('block', {
      p0: { x: s0 * ux + nx * R, y: s0 * uy + ny * R },
      v0: { x: 0, y: 0 },
      mass: 2,
      radius: R,
      motion: { kind: 'numeric', spec: { contact: { type: 'plane', angle: th, friction: mu } } },
    })

  const along = (st: { x: number; y: number }, x0: number, y0: number): number =>
    (st.x - x0) * ux + (st.y - y0) * uy // 位移沿 u 的分量（Δp = Δs·u）

  it('无摩擦斜面：a = g·sinθ（1s 位移 ½a·t²，速度 at）', () => {
    const r = run(scene([mk(0)]), { duration: 1.5 })
    const p0 = r.tracks.block!.def.p0
    const aExp = G * 0.5 // sin30°
    const at1 = readTrack(r.tracks.block!.data, stepIndexFor(1, dt, r.steps))
    expect(along(at1, p0.x, p0.y)).toBeCloseTo(0.5 * aExp, 4)
    // 速度沿 u：v = a·t
    const vAlong = at1.vx * ux + at1.vy * uy
    expect(vAlong).toBeCloseTo(aExp, 4)
    // 贴合面：位置始终 = (s0+Δs)·u + r·n
    const s = s0 + along(at1, p0.x, p0.y)
    expect(at1.x).toBeCloseTo(s * ux + nx * R, 4)
    expect(at1.y).toBeCloseTo(s * uy + ny * R, 4)
  })

  it('摩擦滑动 a = g(sinθ − μcosθ)；μ>tanθ 静止', () => {
    // μ=0.1：下滑，a = g(sin30° − μ·cos30°)
    const aExp = G * (0.5 - 0.1 * Math.cos(Math.PI / 6))
    const r1 = run(scene([mk(0.1)]), { duration: 1.5 })
    const p1 = r1.tracks.block!.def.p0
    const b1 = readTrack(r1.tracks.block!.data, stepIndexFor(1, dt, r1.steps))
    expect(along(b1, p1.x, p1.y)).toBeCloseTo(0.5 * aExp, 3)
    const vAlong = b1.vx * ux + b1.vy * uy
    expect(vAlong).toBeCloseTo(aExp, 3)
    // μ=1 > tan30°：静止不动并判定结束
    const r2 = run(scene([mk(1)]), { duration: 1 })
    const b0 = readTrack(r2.tracks.block!.data, 0)
    const bEnd = readTrack(r2.tracks.block!.data, r2.steps - 1)
    expect(Math.hypot(bEnd.x - b0.x, bEnd.y - b0.y)).toBeLessThan(1e-9)
    expect(r2.ended).toBe(true)
  })
})

describe('追及相遇事件', () => {
  it('匀速追及：8t = 10 相遇', () => {
    const mk = (id: string, x: number, vx: number): ObjectDef =>
      def(id, {
        p0: { x, y: 1 },
        v0: { x: vx, y: 0 },
        radius: 0.01,
        motion: { kind: 'kinematic', a: { x: 0, y: 0 }, landOnGround: false },
      })
    const s = scene([mk('A', 0, 8), mk('B', 10, 0)])
    const r = run(s, { duration: 2 })
    const meet = r.events.find((e) => e.kind === 'meet')
    expect(meet).toBeDefined()
    expect(meet!.time).toBeCloseTo(1.25, 1)
  })
})

describe('相机', () => {
  it('autoFit 把场景装入视口', () => {
    const s = scene([
      def('p', {
        p0: { x: 0, y: 0 },
        v0: { x: 0, y: 0 },
        radius: 0,
        motion: { kind: 'kinematic', a: { x: 0, y: 0 }, landOnGround: false },
      }),
    ])
    const r = run(s, { duration: 0.5 })
    const cam = autoFit(computeSceneBounds(r), 800, 600)
    expect(cam.scale).toBeGreaterThan(0)
    expect(Number.isFinite(cam.offX)).toBe(true)
    expect(Number.isFinite(cam.offY)).toBe(true)
  })
})

describe('回归：贴地起抛（radius 情形）', () => {
  // 曾出现：起点球心低于 groundY+radius → analyticNaturalEnd 判"起点在地面下"
  // → 立即冻结 → duration 坍缩为 ~0.12 s（vthrow / h=0 斜抛均曾中招）
  it('竖直上抛（球心贴地起抛）：完整往返 + 冻结在地面接触位', () => {
    const R = 0.35
    const s = scene(
      [
        def('ball', {
          p0: { x: 0, y: R },
          v0: { x: 0, y: 15 },
          radius: R,
          motion: { kind: 'kinematic', a: { x: 0, y: -G }, landOnGround: true },
        }),
      ],
      { world: { gravity: { x: 0, y: -G }, groundY: 0 } },
    )
    const r = run(s)
    expect(r.duration).toBeGreaterThan(2.8) // 2v₀/g ≈ 3.06 s，不得坍缩
    const apex = r.events.find((e) => e.kind === 'apex')
    expect(apex).toBeDefined()
    expect(apex!.time).toBeCloseTo(15 / G, 1) // ≈1.53 s
    const land = r.events.find((e) => e.kind === 'landing')
    expect(land).toBeDefined()
    expect(land!.time).toBeCloseTo((2 * 15) / G, 1) // ≈3.06 s
    const tr = r.tracks.ball!
    const hi = readTrack(tr.data, stepIndexFor(1.53, dt, r.steps))
    expect(hi.y).toBeCloseTo(R + (15 * 15) / (2 * G), 1) // H = v₀²/2g 之上加半径
    const end = readTrack(tr.data, Math.min(r.steps - 1, Math.ceil(3.2 / dt)))
    expect(end.y).toBeCloseTo(R, 6) // 冻结在接触位
    expect(end.vy).toBeCloseTo(0, 6)
  })

  it('h=0 地面出手的斜抛（示例 projectile_45 路径）：贴地起抛不坍缩', () => {
    // 与 examples/problems.ts projectile_45 相同输入：v₀=20, θ=45°, h=0
    const t = instantiate('projectile')!
    const defScene = applyValues(t.def, t.params, { v0: 20, theta: 45, h: 0 })
    const ball = defScene.objects[0]!
    // apply 将 h=0 钳到贴地（球心 = groundY + radius）
    expect(ball.p0.y).toBeCloseTo(ball.radius, 9)
    const r = run(defScene)
    const tLand = (2 * 20 * Math.sin(Math.PI / 4)) / G // ≈2.89 s
    expect(r.duration).toBeGreaterThan(tLand)
    const land = r.events.find((e) => e.kind === 'landing')
    expect(land).toBeDefined()
    expect(land!.time).toBeCloseTo(tLand, 1)
    // 射程 ≈ v₀cosθ·tLand = 20·(√2/2)·2.887 ≈ 40.8 m
    const end = readTrack(r.tracks.ball!.data, Math.min(r.steps - 1, Math.ceil(3 / dt)))
    expect(end.x).toBeCloseTo(20 * Math.cos(Math.PI / 4) * tLand, 1)
  })
})

/* ============ P2：区域场力 / 洛伦兹 / 圆环 / 锚板 / 弹簧对 ============ */

describe('P2 电磁场（带电粒子）', () => {
  it('带电粒子在匀强电场（charged_efield）：板内 a=qE/m，出板后匀速直线', () => {
    const inst = instantiate('charged_efield')!
    const p = inst.def.objects.find((o) => o.id === 'p')!
    const q = p.charge!
    const m = p.mass
    const E = inst.def.world.fields![0]!.electric!.y // E 竖直向下（负），q<0 → 加速度向上
    const aExp = (q * E) / m
    expect(aExp).toBeGreaterThan(0)
    const r = run(inst.def)
    const rect = inst.def.world.fields![0]!.rect!
    const N = r.steps
    let inside = false
    let afterExit = false
    for (let k = 0; k < N; k++) {
      const st = readTrack(r.tracks.p!.data, k)
      // 水平匀速全程成立（区域场不产生 x 向力）
      expect(st.vx).toBeCloseTo(4, 5)
      // 区域边界按引擎判定取安全内带（引擎出区条件：x > maxX 或 y 出界）
      const inRect =
        st.x > rect.minX + 0.05 && st.x < rect.maxX - 0.05 && st.y > rect.minY + 0.1 && st.y < rect.maxY - 0.1
      if (inRect) {
        inside = true
        expect(st.ay).toBeCloseTo(aExp, 4)
      } else if (st.x > rect.maxX + 0.03) {
        afterExit = true
        expect(Math.abs(st.ay)).toBeLessThan(1e-6)
      }
    }
    expect(inside).toBe(true)
    expect(afterExit).toBe(true)
    // 类平抛：进入电场前 y 不偏（x<−4 段 vy≈0）
    const pre = readTrack(r.tracks.p!.data, 40)
    expect(Math.abs(pre.vy)).toBeLessThan(1e-6)
  })

  it('带电粒子在匀强磁场（charged_bfield）：r=mv/(qB)，周期 T=2πm/(qB)，速率不变', () => {
    const inst = instantiate('charged_bfield')!
    const p = inst.def.objects.find((o) => o.id === 'p')!
    const m = p.mass
    const q = p.charge!
    const v0 = p.v0.y
    const B = inst.def.world.fields![0]!.magnetic!
    const c = p.motion.kind === 'circular' ? p.motion : null
    expect(c).not.toBeNull()
    const rExp = (m * v0) / (q * B)
    expect(c!.radius).toBeCloseTo(rExp, 9) // 模板按真实公式物化
    const T = (2 * Math.PI * m) / (q * B)
    const r = run(inst.def)
    for (let k = 0; k < r.steps; k += 25) {
      const st = readTrack(r.tracks.p!.data, k)
      const dist = Math.hypot(st.x - c!.center.x, st.y - c!.center.y)
      expect(dist).toBeCloseTo(rExp, 3) // 轨道半径保持
      expect(Math.hypot(st.vx, st.vy)).toBeCloseTo(v0, 4) // 速率不变（洛伦兹力不做功）
    }
    // 整周期回到初态（采样落在离精确周期 ≤ 半步长处）
    const back = readTrack(r.tracks.p!.data, Math.round(T / dt))
    expect(back.x).toBeCloseTo(0, 1)
    expect(back.y).toBeCloseTo(0, 1)
    expect(back.vy).toBeCloseTo(v0, 1)
  })

  it('组合场（charged_combo）：电场段加速度 a=qE/m、磁场段 a⊥v 且速率守恒', () => {
    const inst = instantiate('charged_combo')!
    const q = 0.02
    const m = 0.01
    const aExp = (q * 5) / m // E=5 V/m 默认
    const r = run(inst.def)
    let sawE = false
    let sawB = false
    let vAtB: number | null = null
    for (let k = 0; k < r.steps; k++) {
      const st = readTrack(r.tracks.p!.data, k)
      if (st.x > -5.2 && st.x < -0.1) {
        sawE = true
        expect(st.ax).toBeCloseTo(aExp, 3)
        expect(Math.abs(st.ay)).toBeLessThan(1e-9)
      }
      if (st.x > 0.2) {
        sawB = true
        // 洛伦兹力始终垂直速度：a·v ≈ 0
        expect(st.ax * st.vx + st.ay * st.vy).toBeCloseTo(0, 3)
        const sp = Math.hypot(st.vx, st.vy)
        if (vAtB === null) vAtB = sp
        else expect(Math.abs(sp - vAtB)).toBeLessThan(0.15)
      }
    }
    expect(sawE).toBe(true)
    expect(sawB).toBe(true)
  })
})

describe('P2 圆环接触', () => {
  it('竖直圆环内小球（ring_ball）：始终被约束在环内壁内且贴壁可达', () => {
    const inst = instantiate('ring_ball')!
    const p = inst.def.objects[0]!
    const cy = p.motion.kind === 'numeric' && p.motion.spec.contact?.type === 'circle'
      ? p.motion.spec.contact.center.y
      : 4
    const Rwall = p.motion.kind === 'numeric' && p.motion.spec.contact?.type === 'circle'
      ? p.motion.spec.contact.radius - p.radius
      : 2
    const r = run(inst.def)
    let maxDist = 0
    let minY = Infinity
    for (let k = 1; k < r.steps; k += 5) {
      // 从 k=1 起：k=0 是模板初态（顶缘外侧 9mm 处起步，下一步即被夹紧回内壁）
      const st = readTrack(r.tracks.ball!.data, k)
      const dist = Math.hypot(st.x, st.y - cy)
      maxDist = Math.max(maxDist, dist)
      minY = Math.min(minY, st.y)
      expect(dist).toBeLessThanOrEqual(Rwall + 1e-4)
    }
    expect(maxDist).toBeGreaterThan(Rwall - 0.05) // 确实贴壁下滑过
    expect(minY).toBeGreaterThan(cy - Rwall - 1e-4)
  })

  it('水平圆环内碰撞（ring_collision）：多次碰撞事件 + 弹性往返速率不变', () => {
    const inst = instantiate('ring_collision')!
    const R = 2.6
    const rBall = 0.3
    const r = run(inst.def)
    const cols = r.events.filter((e) => e.kind === 'collision')
    expect(cols.length).toBeGreaterThanOrEqual(2)
    for (let k = 0; k < r.steps; k += 10) {
      const a = readTrack(r.tracks.A!.data, k)
      const b = readTrack(r.tracks.B!.data, k)
      expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(R - rBall + 1e-6)
      expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(R - rBall + 1e-6)
    }
    // 无重力/无壁摩擦：速率保持 |v₀|（壁面弹性反弹）
    const mid = readTrack(r.tracks.A!.data, Math.round(2 / dt))
    expect(Math.hypot(mid.vx, mid.vy)).toBeCloseTo(2, 2)
  })
})

describe('P2 竖直圆周（数值约束）', () => {
  const pivotY = 6.2

  it('绳模型：v₀>√(5gL) 全程绷紧过顶；v₀<临界则脱绳（ropeTaut）+ 到不了最高点', () => {
    const inst = instantiate('vcircle_rope')!
    const L = 1.8
    // 默认 v₀=10 > √(5gL)≈9.39：完整整圈
    const r1 = run(inst.def)
    let maxY1 = -Infinity
    let maxD1 = 0
    for (let k = 0; k < r1.steps; k += 4) {
      const st = readTrack(r1.tracks.ball!.data, k)
      maxY1 = Math.max(maxY1, st.y)
      maxD1 = Math.max(maxD1, Math.hypot(st.x, st.y - pivotY))
    }
    expect(maxD1).toBeLessThanOrEqual(L + 0.02)
    expect(maxY1).toBeGreaterThanOrEqual(pivotY + L - 0.03) // 越过最高点
    expect(r1.events.some((e) => e.kind === 'ropeTaut')).toBe(false)
    // v₀=8 < √(4gL)≈8.40：到不了最高点，中途脱绳再绷紧
    const def8 = applyValues(inst.def, inst.params, { v0: 8 })
    const r2 = run(def8)
    let maxY2 = -Infinity
    for (let k = 0; k < r2.steps; k += 4) {
      const st = readTrack(r2.tracks.ball!.data, k)
      maxY2 = Math.max(maxY2, st.y)
    }
    expect(r2.events.some((e) => e.kind === 'ropeTaut')).toBe(true)
    expect(maxY2).toBeLessThan(pivotY + L - 0.2)
    // 绳长约束只在张紧期间有效，松弛后允许 >L（斜抛段）
    expect(maxY2).toBeGreaterThan(4.4) // 至少摆出明显幅度
  })

  it('杆模型：整圈不脱离（|d−L| 始终 ≈0），最高点处由杆支撑', () => {
    const inst = instantiate('vcircle_rod')!
    const L = 1.8
    const r = run(inst.def)
    let maxY = -Infinity
    for (let k = 0; k < r.steps; k += 4) {
      const st = readTrack(r.tracks.ball!.data, k)
      const d = Math.hypot(st.x, st.y - pivotY)
      expect(Math.abs(d - L)).toBeLessThan(0.02) // 刚性杆：距离恒定
      maxY = Math.max(maxY, st.y)
    }
    expect(maxY).toBeGreaterThanOrEqual(pivotY + L - 0.03) // 过顶
  })
})

describe('P2 弹簧连接体 / 板块模型', () => {
  it('弹簧连接体（spring_pair）：质心静止 + 相对简谐周期 T=2π√(μ/k)', () => {
    const inst = instantiate('spring_pair')!
    const k = 8
    const m = 1
    const mu = m / 2 // 等质量 μ=m/2
    const wRel = Math.sqrt(k / mu) // = √(k(1/m₁+1/m₂)) = 4
    const T = (2 * Math.PI) / wRel
    const r = run(inst.def)
    for (let i = 0; i < r.steps; i += 25) {
      const a = readTrack(r.tracks.A!.data, i)
      const b = readTrack(r.tracks.B!.data, i)
      // 系统动量恒 0、质心不动（顺序积分的 O(dt²) 非对称随 t 缓慢积累，阈值放宽）
      expect(Math.abs(a.vx + b.vx)).toBeLessThan(0.1)
      expect(Math.abs(a.x + b.x)).toBeLessThan(0.1)
    }
    // 一个相对周期后回到释放位形（A 在最左）
    const back = readTrack(r.tracks.A!.data, Math.round(T / dt))
    expect(back.x).toBeCloseTo(-1.5, 1)
    const backB = readTrack(r.tracks.B!.data, Math.round(T / dt))
    expect(backB.x).toBeCloseTo(1.5, 1)
  })

  it('板块模型（board_block）：地面光滑时系统动量守恒、终态共速 v=mv₀/(m+M)', () => {
    const inst = instantiate('board_block')!
    const def0 = applyValues(inst.def, inst.params, { mu2: 0 })
    const r = run(def0)
    const mA = 1
    const mB = 2
    let pMin = Infinity
    for (let k = 0; k < r.steps; k += 20) {
      const bl = readTrack(r.tracks.block!.data, k)
      const bd = readTrack(r.tracks.board!.data, k)
      // 物块始终停在板上表面（不穿透）：y = 板上表面 + 半径
      expect(bl.y).toBeCloseTo(0.18 * 2 + 0.3, 2)
      const p = mA * bl.vx + mB * bd.vx
      pMin = Math.min(pMin, p)
      expect(p).toBeCloseTo(5, 3) // 总动量恒等 v₀m
    }
    void pMin
    // 相对滑动结束后共速 v = 5/3
    const blEnd = readTrack(r.tracks.block!.data, r.steps - 1)
    const bdEnd = readTrack(r.tracks.board!.data, r.steps - 1)
    expect(blEnd.vx).toBeCloseTo(5 / 3, 1)
    expect(bdEnd.vx).toBeCloseTo(5 / 3, 1)
    expect(Math.abs(blEnd.vx - bdEnd.vx)).toBeLessThan(0.02)
  })

  it('板块模型：地面粗糙（μ₂=0.1）全程减速→最终整体静止；摩擦耗散符合预期', () => {
    const inst = instantiate('board_block')!
    const r = run(inst.def)
    // t≈1 s（仍相对滑动）：物块 a=-μ₁g、木板 a=(μ₁mg-μ₂(M+m)g)/M
    const mA = 1
    const mB = 2
    const at1 = readTrack(r.tracks.block!.data, Math.round(1 / dt))
    const bd1 = readTrack(r.tracks.board!.data, Math.round(1 / dt))
    const pExt = 5 - 0.1 * (mA + mB) * G * 1 // 地面摩擦冲量
    expect(mA * at1.vx + mB * bd1.vx).toBeCloseTo(pExt, 1)
    expect(at1.vx).toBeCloseTo(5 - 0.4 * G * 1, 1)
    // 终态：整体静止（块与板同速停，无残余微滑移）
    const blEnd = readTrack(r.tracks.block!.data, r.steps - 1)
    const bdEnd = readTrack(r.tracks.board!.data, r.steps - 1)
    expect(Math.abs(blEnd.vx)).toBeLessThan(1e-6)
    expect(Math.abs(bdEnd.vx)).toBeLessThan(1e-6)
    expect(Math.abs(blEnd.vx - bdEnd.vx)).toBeLessThan(1e-6)
  })
})
