// AI 层端到端测试（全部离线，无网络）：
// 1) 模板场景 → defToParsed → buildScene 往返后物理语义保持（可解、事件还在）；
// 2) mock provider 全流程：示例题干 → 解析 →（低置信）→ 反馈重解析 → 场景落地；
// 3) schema/validate 边界。
import { describe, expect, it } from 'vitest'
import { run } from '../../src/engine/Engine'
import { instantiate, applyValues } from '../../src/engine/scenarios'
import { EXAMPLE_PROBLEMS } from '../../src/examples/problems'
import { defToParsed } from '../../src/ai/defToParsed'
import { buildScene, SceneBuildError } from '../../src/ai/mapper'
import { extractJson, parseResponse, validatePhysics } from '../../src/ai/schema'
import { mockCompletion } from '../../src/ai/providers/mock'

describe('defToParsed ↔ buildScene 往返', () => {
  it.each(EXAMPLE_PROBLEMS.map((p) => [p.id, p.title] as const))('%s：往返后可解且无 NaN', (_id, _title) => {
    const ex = EXAMPLE_PROBLEMS.find((p) => p.id === _id)!
    const inst = instantiate(ex.templateId)!
    const def = ex.values ? applyValues(inst.def, inst.params, ex.values) : inst.def
    const parsed = defToParsed(def)
    // 静态支点（被绳/杆约束引用的固定端）反向为 verticalCircle 字段、不输出为独立物体；
    // 往返语义 = buildScene 后物体总数复原（支点重新物化）；装饰性静态体（极板等）保留
    const droppedPivots = def.objects.filter(
      (o) =>
        o.motion.kind === 'static' &&
        def.objects.some((x) => x.constraints?.some((c) => c.otherId === o.id)),
    ).length
    expect(parsed.objects.length + droppedPivots).toBe(def.objects.length)
    expect(validatePhysics(parsed)).toBeNull()
    const build = buildScene(parsed)
    expect(build.def.objects.length).toBe(def.objects.length)
    const r = run(build.def)
    expect(r.steps).toBeGreaterThan(10)
    for (const id of r.order) {
      const d = r.tracks[id]!.data
      for (let i = 0; i < d.length; i += 6) {
        expect(Number.isFinite(d[i]!)).toBe(true)
        expect(Number.isFinite(d[i + 1]!)).toBe(true)
      }
    }
  })

  it('往返保留关键事件（自由落体 landing / 碰撞 collision / 追及无 meet）', () => {
    const freefall = EXAMPLE_PROBLEMS.find((p) => p.id === 'freefall_20m')!
    const f = buildScene(defToParsed(applyValues(instantiate('freefall')!.def, instantiate('freefall')!.params, freefall.values!)))
    expect(run(f.def).events.some((e) => e.kind === 'landing')).toBe(true)

    const collision = EXAMPLE_PROBLEMS.find((p) => p.id.startsWith('collision'))!
    const cInst = instantiate('collision')!
    const cDef = collision.values ? applyValues(cInst.def, cInst.params, collision.values) : cInst.def
    const c = buildScene(defToParsed(cDef))
    const cr = run(c.def)
    expect(cr.events.some((e) => e.kind === 'collision')).toBe(true)
    // 动量守恒（水平桌面：只看 x 方向动量和）
    const last = cr.steps - 1
    const tA = c.def.objects.find((o) => o.id === 'A')!
    const tB = c.def.objects.find((o) => o.id === 'B')!
    const dA = cr.tracks.A!.data
    const dB = cr.tracks.B!.data
    // 落地后静止段会为零动量（完全弹性交换后仍守恒：1·4 = 交换）
    expect(tA.mass * dA[last * 6 + 2]! + tB.mass * dB[last * 6 + 2]!).toBeCloseTo(tA.mass * tA.v0.x, 6)

    const pursuit = buildScene(defToParsed(instantiate('pursuit')!.def))
    const pr = run(pursuit.def)
    expect(pr.events.some((e) => e.kind === 'meet')).toBe(false)
    const idx6 = Math.round(6 / pr.dt)
    const gap =
      pr.tracks.B!.data[idx6 * 6]! - pr.tracks.A!.data[idx6 * 6]!
    expect(gap).toBeCloseTo(64, 0)
  })
})

describe('schema 与物理校验', () => {
  it('剥 markdown 围栏', () => {
    const raw = '好的，以下是结果：\n```json\n{"confidence": 0.9}\n```\n'
    expect(JSON.parse(extractJson(raw)).confidence).toBe(0.9)
  })

  it('拒绝结构错误输出', () => {
    expect(() => parseResponse('{"objects": [{"id": 3}]}')).toThrow(/schema|不符合/)
    expect(() => parseResponse('你好呀')).toThrow(/JSON/)
  })

  it('拒绝物理不合理输出', () => {
    const ok = defToParsed(instantiate('freefall')!.def)
    ok.objects[0]!.mass = -2
    expect(validatePhysics(ok)).toMatch(/质量/)
    ok.objects[0]!.mass = 1
    ok.objects[0]!.initialVelocity = { x: 1e6, y: 0 }
    expect(validatePhysics(ok)).toMatch(/初速度/)
    ok.objects[0]!.initialVelocity = { x: 0, y: 0 }
    ok.groundY = null
    ok.objects[0]!.landOnGround = true
    expect(validatePhysics(ok)).toMatch(/地面/)
  })

  it('mapper 拒绝畸形输入并给中文原因', () => {
    const p = defToParsed(instantiate('circular')!.def)
    p.objects[0]!.circularCenter = { ...p.objects[0]!.initialPosition }
    expect(() => buildScene(p)).toThrow(SceneBuildError)
  })

  it('讲解步骤：示例题 → defToParsed → buildScene 往返保留 solution', () => {
    const ex = EXAMPLE_PROBLEMS.find((p) => p.id === 'freefall_20m')!
    const inst = instantiate(ex.templateId)!
    const def = { ...applyValues(inst.def, inst.params, ex.values!), solution: ex.solution }
    const parsed = defToParsed(def)
    expect(parsed.solution?.length).toBeGreaterThan(0)
    expect(parsed.solution![0]!.time).toBe(0)
    const build = buildScene(parsed)
    expect(build.def.solution).toEqual(parsed.solution)
    expect(build.def.solution![1]!.formula).toMatch(/2\.02/)
  })

  it('讲解步骤：时间乱序被物理校验拒绝', () => {
    const ok = defToParsed(instantiate('freefall')!.def)
    ok.solution = [
      { time: 5, title: 'a', text: 'a' },
      { time: 1, title: 'b', text: 'b' },
    ]
    expect(validatePhysics(ok)).toMatch(/升序/)
    ok.solution = [{ time: 999, title: 'a', text: 'a' }]
    ok.timeRange = { start: 0, end: 12 }
    expect(validatePhysics(ok)).toMatch(/超出/)
  })

  it('mock 解析附带示例题的讲解步骤', async () => {
    const ex = EXAMPLE_PROBLEMS.find((p) => p.id === 'board_slide')!
    const raw = await mockCompletion({ provider: 'mock', prompt: ex.text })
    const parsed = parseResponse(raw)
    expect(parsed.solution?.length).toBeGreaterThanOrEqual(2)
    expect(validatePhysics(parsed)).toBeNull()
  })
})

describe('mock provider + flow 语义（低置信 → 校正 → 通过）', () => {
  const ex = EXAMPLE_PROBLEMS.find((p) => p.mockConfidence !== undefined && p.mockConfidence < 0.7)!

  it('示例题库里存在低置信演示题', () => {
    expect(ex).toBeDefined()
  })

  it('mock 对示例题干返回可解析 JSON，置信低于阈值', async () => {
    const raw = await mockCompletion({ provider: 'mock', prompt: `这是一道物理题：${ex.text}` })
    const parsed = parseResponse(raw)
    expect(validatePhysics(parsed)).toBeNull()
    expect(parsed.confidence).toBeLessThan(0.7)
  })

  it('mock 对陌生题干报 mock-miss', async () => {
    await expect(
      mockCompletion({ provider: 'mock', prompt: '一艘火箭以 3000 m/s 脱离地球引力……' }),
    ).rejects.toMatchObject({ kind: 'mock-miss' })
  })

  it('校正轮（同一题干第二次）置信提升，场景落地可解', async () => {
    // 用另一个低置信示例（前一测试已消耗掉第一个的首轮）
    const lows = EXAMPLE_PROBLEMS.filter((p) => p.mockConfidence !== undefined && p.mockConfidence < 0.7)
    const other = lows.find((p) => p.id !== ex.id) ?? ex
    const first = parseResponse(await mockCompletion({ provider: 'mock', prompt: other.text }))
    expect(first.confidence).toBeLessThan(0.7)
    const second = parseResponse(await mockCompletion({ provider: 'mock', prompt: other.text }))
    expect(second.confidence).toBeGreaterThanOrEqual(0.9)
    const build = buildScene(second)
    const r = run(build.def)
    expect(r.steps).toBeGreaterThan(10)
  })
})
