// AI 解析流程编排：文本 → (重试≤2) provider → schema → 物理校验 → 置信判定 → 场景落地。
// 状态全在 problemStore/simulationStore（组件只读）；本模块只做副作用流转。
import { useProblemStore } from '../stores/problemStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSimulationStore } from '../stores/simulationStore'
import { useUIStore } from '../stores/uiStore'
import { buildPrompt } from './promptBuilder'
import { callProvider } from './providers'
import { parseResponse, validatePhysics } from './schema'
import { buildScene, SceneBuildError } from './mapper'
import type { AIParseError, ImageInput, ParsedResult } from './types'

const RETRYABLE = new Set(['invalid-json', 'schema', 'physics'])

interface AttemptOutcome {
  parsed?: ParsedResult
  error?: AIParseError
}

async function attempt(
  text: string,
  context: 'initial' | 'correction',
  images: ImageInput[],
  prev?: AIParseError,
): Promise<AttemptOutcome> {
  const st = useSettingsStore.getState()
  const cfg = st.providers[st.activeProvider]!
  const prompt = buildPrompt({
    text,
    context,
    previousError: prev?.message,
    previousRaw: prev?.raw,
    hasImages: images.length > 0,
  })
  let raw = ''
  try {
    raw = await callProvider(st.activeProvider, {
      provider: st.activeProvider,
      prompt,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      ...(images.length > 0 ? { images } : {}),
    })
    const parsed = parseResponse(raw)
    const issue = validatePhysics(parsed)
    if (issue) throw { kind: 'physics', message: issue, raw } as AIParseError
    return { parsed }
  } catch (e) {
    const err = (e as AIParseError) ?? { kind: 'unknown', message: String(e) }
    return { error: { ...err, raw: err.raw ?? (raw || undefined) } }
  }
}

/** 触发一次完整解析；resolveSuccess/resolveFailure 写入 problemStore */
export async function runParseFlow(): Promise<void> {
  const problem = useProblemStore.getState()
  const text = problem.text.trim()
  const images = problem.images
  if (!text && images.length === 0) {
    problem.resolveFailure({ kind: 'validation', message: '请先输入题目文本（或上传题目截图）' })
    return
  }
  problem.setParsing(true)
  let outcome: AttemptOutcome = {}
  for (let i = 0; i < 2; i++) {
    outcome = await attempt(text, 'initial', images, outcome.error)
    if (outcome.parsed || !outcome.error || !RETRYABLE.has(outcome.error.kind)) break
  }
  const st = useProblemStore.getState()
  if (outcome.parsed) {
    const lowConf = (outcome.parsed.confidence ?? 0) < 0.7
    st.resolveSuccess(outcome.parsed, lowConf)
    if (!lowConf) acceptParsed(outcome.parsed)
  } else {
    st.resolveFailure(outcome.error ?? { kind: 'unknown', message: '未知错误' })
  }
  st.setParsing(false)
}

/** 校正弹窗"重新解析"：携带用户反馈再走一轮（同一函数，上下文 correction） */
export async function reparseWithFeedback(feedback: string): Promise<void> {
  const problem = useProblemStore.getState()
  const text = problem.text.trim()
  const images = problem.images
  if (!feedback.trim()) {
    problem.setNotice('请填写反馈内容（比如"小球半径忽略，从 3 m 高处释放"）')
    return
  }
  problem.setParsing(true)
  problem.addCorrectionRound(feedback, problem.parsed)
  let outcome: AttemptOutcome = {}
  for (let i = 0; i < 2; i++) {
    outcome = await attempt(text, 'correction', images, outcome.error)
    if (outcome.parsed || !outcome.error || !RETRYABLE.has(outcome.error.kind)) break
  }
  const st = useProblemStore.getState()
  if (outcome.parsed) {
    st.resolveSuccess(outcome.parsed, (outcome.parsed.confidence ?? 0) < 0.7)
    if ((outcome.parsed.confidence ?? 0) >= 0.7) {
      st.clearCorrection()
      useUIStore.getState().closeDialog()
      acceptParsed(outcome.parsed)
    }
  } else {
    st.resolveFailure(outcome.error ?? { kind: 'unknown', message: '未知错误' })
  }
  st.setParsing(false)
}

/** 接受（或已通过）当前 ParsedResult → 映射为场景并加载 */
export function acceptParsed(parsed: ParsedResult): { ok: boolean; message?: string } {
  const problem = useProblemStore.getState()
  let build
  try {
    build = buildScene(parsed)
  } catch (e) {
    const msg = e instanceof SceneBuildError ? e.message : `场景构建失败：${e instanceof Error ? e.message : e}`
    problem.resolveFailure({ kind: 'scene', message: msg })
    return { ok: false, message: msg }
  }
  const sim = useSimulationStore.getState()
  sim.loadScene(build.def, build.params, {
    sceneId: 'ai',
    problemText: problem.text.trim() || null,
  })
  problem.setNotice(build.note.length > 0 ? build.note.join('\n') : null)
  problem.clearCorrection()
  useUIStore.getState().setTab('params')
  return { ok: true }
}
