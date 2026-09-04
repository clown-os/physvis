// AI 解析结果的人工校正弹窗。
// 触发：解析失败（schema/物理/mock-miss）或模型自评置信 < 0.7。
// 老师可直接审阅 AI 理解的物体要素表，填一句反馈让模型重解析（校正轮），
// 或选择"照此结果建模"继续。
import { memo, useState } from 'react'
import { useProblemStore } from '../stores/problemStore'
import { useSettingsStore } from '../stores/settingsStore'
import { acceptParsed, reparseWithFeedback } from '../ai/flow'
import type { MotionTypeName } from '../ai/types'
import { Modal, Button, fmtNum } from './ui'

const MOTION_ZH: Record<MotionTypeName, string> = {
  uniform_accel: '匀变速直线',
  free_fall: '自由落体',
  vertical_throw: '竖直上抛',
  projectile: '平抛/斜抛',
  circular: '匀速圆周',
  simple_harmonic: '简谐运动',
  pendulum: '单摆',
  incline: '斜面',
  conveyor: '传送带',
  collision: '碰撞',
  pursuit: '追及',
  multi_object: '多物体',
  charged_particle: '带电粒子（电磁场）',
  ring_motion: '圆环运动',
  vertical_circle: '竖直圆周',
  spring_pair: '弹簧连接体',
  board_block: '板块模型',
  other: '其他',
}

function confColor(c: number): string {
  if (c >= 0.9) return 'text-emerald-600'
  if (c >= 0.7) return 'text-amber-600'
  return 'text-red-600'
}

export const CorrectionModal = memo(function CorrectionModal({ onClose }: { onClose: () => void }) {
  const parsed = useProblemStore((s) => s.parsed)
  const error = useProblemStore((s) => s.error)
  const rounds = useProblemStore((s) => s.correctionRounds)
  const parsing = useProblemStore((s) => s.parsing)
  const clearCorrection = useProblemStore((s) => s.clearCorrection)
  const template = useSettingsStore((s) => s.correctionTemplate)
  const [feedback, setFeedback] = useState(template.replace('{issue}', ''))
  const [acceptError, setAcceptError] = useState<string | null>(null)

  const parsedNow = parsed
  const conf = parsedNow?.confidence ?? 0

  /** 用户主动关闭 = 放弃本次校正（保留原场景）；解析中禁止关闭 */
  const requestClose = (): void => {
    if (parsing) return
    clearCorrection()
    onClose()
  }

  const onAccept = (): void => {
    if (!parsedNow) return
    const res = acceptParsed(parsedNow)
    if (res.ok) onClose()
    else setAcceptError(res.message ?? '场景构建失败')
  }

  const isMock = !parsedNow && error?.kind === 'mock-miss'

  return (
    <Modal
      title={error ? 'AI 解析未通过' : 'AI 建议人工确认'}
      subtitle={
        error ? undefined : (
          <span>
            模型自评置信度{' '}
            <span className={`font-semibold tabular-nums ${confColor(conf)}`}>
              {(conf * 100).toFixed(0)}%
            </span>
            {conf < 0.5 ? ' —— 这道题它不太确定' : ' —— 有歧义或要素不全，请看一眼再放行'}
          </span>
        )
      }
      onClose={requestClose}
      wide
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={requestClose}>
            {parsedNow ? '关闭（保持原题）' : '关闭'}
          </Button>
          <div className="flex gap-2">
            {parsedNow && (
              <>
                <Button variant="outline" size="sm" onClick={onAccept} disabled={parsing} title="照 AI 的理解直接建模（可在参数面板再改）">
                  仍使用此结果 →
                </Button>
                <Button size="sm" disabled={parsing || !feedback.trim()} onClick={() => void reparseWithFeedback(feedback)}>
                  {parsing ? '重新解析中…' : '用我的反馈重新解析'}
                </Button>
              </>
            )}
            {!parsedNow && (
              <Button size="sm" disabled={parsing} onClick={() => void reparseWithFeedback(feedback)}>
                {parsing ? '重新解析中…' : '重试解析'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 失败原因 */}
        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700">
            <p className="font-semibold">原因：{error.message}</p>
            {isMock && <p className="mt-1 text-red-400">本地演示只覆盖内置示例题；其他题目请在设置页配置 API Key 后重试。</p>}
          </div>
        )}

        {rounds.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <p className="mb-1 font-medium text-slate-500">已发出的修正反馈</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {rounds.map((r, i) => (
                <li key={i}>{r.feedback}</li>
              ))}
            </ul>
          </div>
        )}

        {acceptError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {acceptError}
          </div>
        )}

        {/* AI 理解的场景要素（老师核对用） */}
        {parsedNow && (
          <>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">物体</th>
                    <th className="px-2.5 py-1.5 font-medium">形态</th>
                    <th className="px-2.5 py-1.5 font-medium">质量 kg</th>
                    <th className="px-2.5 py-1.5 font-medium">位置 (x, y) m</th>
                    <th className="px-2.5 py-1.5 font-medium">初速 (vx, vy) m/s</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {parsedNow.objects.map((o) => (
                    <tr key={o.id}>
                      <td className="px-2.5 py-1.5">
                        <span className="font-medium">{o.label ?? o.id}</span>
                        <span className="text-slate-400"> ({o.id})</span>
                      </td>
                      <td className="px-2.5 py-1.5">{MOTION_ZH[o.motionType ?? parsedNow.motionType] ?? o.motionType}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{fmtNum(o.mass, 0.01)}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">
                        {fmtNum(o.initialPosition.x, 0.01)}, {fmtNum(o.initialPosition.y, 0.01)}
                      </td>
                      <td className="px-2.5 py-1.5 tabular-nums">
                        {fmtNum(o.initialVelocity.x, 0.01)}, {fmtNum(o.initialVelocity.y, 0.01)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              上面是 AI 从题干里读出的运动要素。要改哪里，用一句话指出（例：
              <span className="text-slate-600">「小球半径请忽略，从 12 m 高处释放」</span>），它会带着反馈重解析。
            </p>
          </>
        )}

        {parsedNow && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="fix-feedback">
              人工修正反馈（发给模型）
            </label>
            <textarea
              id="fix-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="例：小球应受空气阻力 k=0.3 N·s/m；初始位置在 12 m 高处……"
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-800 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
            />
          </div>
        )}
      </div>
    </Modal>
  )
})
