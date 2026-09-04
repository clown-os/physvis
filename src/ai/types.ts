// AI 解析层类型：Provider 配置、调用选项、解析结果（ParsedResult）。
// BYOK 设计：用户自带 API Key（仅存本机 localStorage），应用零后端直连厂商接口。

import type { SolutionStep } from '../engine/types'

/* ============ Provider ============ */

/** 'mock' 为内置演示实现：无 Key 也能离线走通"解析 → 校正 → 模拟"全流程 */
export type ProviderId = 'mock' | 'deepseek' | 'openai' | 'anthropic' | 'google'

export interface ProviderConfig {
  /** API 根地址（OpenAI 兼容格式含 /v1；anthropic 为 https://api.anthropic.com） */
  baseUrl: string
  apiKey: string
  model: string
}

export const PROVIDER_DEFAULTS: Record<ProviderId, ProviderConfig> = {
  mock: { baseUrl: '', apiKey: '', model: 'mock-本地演示' },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: 'claude-sonnet-4-5',
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    model: 'gemini-2.5-flash',
  },
}

export interface ProviderMeta {
  id: ProviderId
  name: string
  /** 是否需要 baseUrl（mock 不需要） */
  customBaseUrl: boolean
  /** 浏览器直调 CORS 说明（设置页展示） */
  corsNote: string
}

export const PROVIDER_META: ProviderMeta[] = [
  { id: 'mock', name: '本地演示（Mock）', customBaseUrl: false, corsNote: '无 Key 离线演示，内置示例题解析' },
  { id: 'deepseek', name: 'DeepSeek', customBaseUrl: true, corsNote: '浏览器可直接调用' },
  { id: 'openai', name: 'OpenAI', customBaseUrl: true, corsNote: '浏览器直调受限，建议配置本地代理后自定义 baseUrl' },
  { id: 'anthropic', name: 'Anthropic Claude', customBaseUrl: true, corsNote: '需启用 dangerouslyAllowBrowser 请求头（已内置）' },
  { id: 'google', name: 'Google Gemini', customBaseUrl: true, corsNote: '浏览器可直接调用' },
]

/* ============ 解析调用 ============ */

/** 题目来源：直接解析（首轮）或校正后重解析（后续轮） */
export type ParseContext = 'initial' | 'correction'

/** 上传的题目截图（视觉模型识图建模用） */
export interface ImageInput {
  /** base64 数据地址（data:image/png;base64,…） */
  dataUrl: string
  /** MIME 类型（如 image/png） */
  mimeType: string
}

export interface ParseOptions {
  provider: ProviderId
  prompt: string
  apiKey?: string
  baseUrl?: string
  model?: string
  /** 温度等生成参数 */
  maxTokens?: number
  signal?: AbortSignal
  /** 上一次失败原因（回喂重试/校正时用） */
  previousError?: string
  /** 上一轮（被校正）的解析结果 JSON——校正场景要求模型输出修正后的完整 JSON */
  previousRaw?: string
  /** 题目截图（识图建模）：作为视觉输入随 prompt 一起发给模型 */
  images?: ImageInput[]
}

export interface AIParseError {
  message: string
  /** 'network' | 'http' | 'invalid-json' | 'schema' | 'physics' | 'timeout' | 'canceled' */
  kind: string
  /** HTTP 状态（如有） */
  status?: number
  /** 模型返回的原始内容（供调试/校正弹窗展示） */
  raw?: string
}

/* ============ 解析结果（模型输出，zod 校验） ============ */

export type MotionTypeName =
  | 'uniform_accel' // 匀变速（直线，含往返）
  | 'free_fall'
  | 'vertical_throw'
  | 'projectile' // 平抛/斜抛
  | 'circular'
  | 'simple_harmonic'
  | 'pendulum'
  | 'incline'
  | 'conveyor'
  | 'collision'
  | 'pursuit'
  | 'multi_object'
  | 'charged_particle' // 带电粒子在电磁场（区域 E/B 场）
  | 'ring_motion' // 圆环内壁约束/环内碰撞
  | 'vertical_circle' // 竖直平面圆周运动（绳/杆模型）
  | 'spring_pair' // 弹簧连接体
  | 'board_block' // 板块模型（物块在木板上，板在地面）
  | 'other'

export interface ParsedObject {
  id: string
  label?: string
  mass: number
  initialPosition: { x: number; y: number }
  initialVelocity: { x: number; y: number }
  initialAcceleration?: { x: number; y: number }
  radius?: number
  color?: string
  /** 施加的恒定外力（N，如拉力） */
  appliedForce?: { x: number; y: number }
  /** 重力外选项：空气阻力系数 k（F=-kv） */
  airDragK?: number
  /** 恢复系数（碰撞场景） */
  restitution?: number
  /** 运动类型细分（多物体时逐物体） */
  motionType?: MotionTypeName
  /** 圆周运动：圆心 */
  circularCenter?: { x: number; y: number }
  /** 简谐：平衡位置（默认 initialPosition） */
  springEquilibrium?: { x: number; y: number }
  /** 简谐：弹簧劲度系数（N/m），与质量一起决定 ω=√(k/m) */
  springK?: number
  /** 单摆：支点 + 摆长 */
  pendulumPivot?: { x: number; y: number }
  /** 斜面：倾角（度）+ 摩擦系数 */
  incline?: {
    angleDeg: number
    friction: number
    beltSpeed?: number
    /** 板块模型：平面固连于另一物体（锚体，须为数值模式且水平放置），带速随锚体 */
    anchorId?: string
  }
  /** 碰撞对中的对象 id（成对出现） */
  collideWith?: string
  /** 追及相遇中的目标对象 id */
  chaseTarget?: string
  /** 该物体最终是否落回地面（projectile/free_fall 用） */
  landOnGround?: boolean
  /** 电荷量（C，可为负）——带电粒子场景；世界级 fields 给出场区域 */
  charge?: number
  /** 与另一物体的连接弹簧（劲度系数 N/m、原长 m；成对力自动等大反向） */
  spring?: { otherId: string; k: number; restLength: number }
  /** 圆环内壁约束：物体限制在半径 radius 的圆环内（环心 center） */
  ring?: { center: { x: number; y: number }; radius: number; friction?: number; restitution?: number }
  /** 竖直平面圆周运动：绳/杆系于固定支点（长度取初始位置到支点距离） */
  verticalCircle?: { pivot: { x: number; y: number }; kind: 'rope' | 'rod'; length: number }
  /** 与地面接触（板块模型中木板等）：静/动摩擦合一 + 恢复系数 */
  floorContact?: { friction: number; restitution?: number }
}

export interface ParsedResult {
  title?: string
  motionType: MotionTypeName
  scenarioDescription?: string
  confidence: number // 0~1
  timeRange?: { start: number; end: number }
  gravity?: { x: number; y: number }
  groundY?: number | null
  /** true = 分析提示存在空气阻力（需显式关闭？高中默认无阻力） */
  airResistance: boolean
  objects: ParsedObject[]
  /** 约束（绳/杆） */
  constraints?: Array<{
    kind: 'rope' | 'rod'
    objectA: string
    objectB: string
    length: number
  }>
  /** 空间电磁场区域（带电粒子场景）：rect 缺省 = 全空间；可多区域叠加（质谱仪等） */
  fields?: Array<{
    rect?: { minX: number; maxX: number; minY: number; maxY: number }
    /** 匀强电场（V/m） */
    electric?: { x: number; y: number }
    /** 匀强磁场 Bz（T，垂直纸面，正 = 向外） */
    magnetic?: number
  }>
  /** 分步解题讲解：time = 该步骤在画面中发生的时刻（s，按时间升序，与 timeRange 对应） */
  solution?: SolutionStep[]
}

/** 可调参数条目：由场景映射器从解析结果生成（滑块的物化规则闭包） */
export interface AiParamHint {
  key: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  group: string
}

/* ============ 内置示例题 ============ */

export interface ExampleProblem {
  id: string
  title: string
  category: string
  description: string
  difficulty: 1 | 2 | 3
  /** 预计算的解析结果（离线全流程演示用） */
  parsed: ParsedResult
  /** 解析要点（演示在弹窗里给学生看） */
  hints?: string[]
  /** 分步解题讲解（内置示例题离线演示「会做题」；时间锚点与实际仿真对齐） */
  solution?: SolutionStep[]
}
