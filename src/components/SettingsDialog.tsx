// 设置弹窗：AI Provider（BYOK，localStorage 持久化）+ 播放偏好 + 校正提示模板。
import { memo, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { PROVIDER_DEFAULTS, PROVIDER_META, type ProviderConfig, type ProviderId } from '../ai/types'
import { callProvider } from '../ai/providers'
import { Modal, Button, cx } from './ui'

function ProviderForm({ id, cfg }: { id: ProviderId; cfg: ProviderConfig }) {
  const setProvider = useSettingsStore((s) => s.setProvider)
  const setActive = useSettingsStore((s) => s.setActiveProvider)
  const [testState, setTestState] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const meta = PROVIDER_META.find((p) => p.id === id)!

  const test = async (): Promise<void> => {
    if (!cfg.apiKey) {
      setTestState('fail')
      setTestMsg('请先填写 API Key')
      return
    }
    setTestState('busy')
    try {
      await callProvider(id, { provider: id, prompt: '{"ping": 1}', apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })
      setTestState('ok')
      setTestMsg('连接成功，模型可正常调用')
    } catch (e) {
      setTestState('fail')
      setTestMsg((e as { message?: string }).message ?? '连接失败')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
          <input
            type="radio"
            name="provider"
            checked={useSettingsStore.getState().activeProvider === id}
            onChange={() => setActive(id)}
            className="accent-blue-600"
          />
          {meta.name}
        </label>
        <span className="text-[10px] text-slate-400">{meta.corsNote}</span>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 pl-6">
        {meta.customBaseUrl && (
          <Field label="API 地址 (baseUrl)" value={cfg.baseUrl} placeholder={PROVIDER_DEFAULTS[id].baseUrl} onV={(v) => setProvider(id, { baseUrl: v })} />
        )}
        <Field label="模型" value={cfg.model} placeholder={PROVIDER_DEFAULTS[id].model} onV={(v) => setProvider(id, { model: v })} />
        <span className={cx(
          'pl-28 text-[10px] leading-relaxed',
          id === 'deepseek' && /deepseek-chat$/i.test(cfg.model.trim()) ? 'text-amber-600' : 'text-slate-400',
        )}>
          {id === 'mock'
            ? 'mock 通道不读图：图片识别需配置真实视觉模型'
            : id === 'deepseek' && /deepseek-chat$/i.test(cfg.model.trim())
              ? '⚠ deepseek-chat 不支持图片输入——上传题目截图前请换成视觉模型（如 deepseek-vl2）'
              : '上传题目截图（识图建模）需该模型支持图片输入'}
        </span>
        <Field label="API Key" value={cfg.apiKey} secret placeholder="sk-…（仅存本机浏览器）" onV={(v) => setProvider(id, { apiKey: v })} />
        <div className="flex items-center gap-2 pt-0.5">
          <Button variant="outline" size="sm" onClick={() => void test()} disabled={testState === 'busy'}>
            {testState === 'busy' ? '测试中…' : '测试连接'}
          </Button>
          {testState !== 'idle' && (
            <span className={cx('text-[11px]', testState === 'ok' ? 'text-emerald-600' : 'text-red-500')}>{testMsg}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onV,
  secret,
  placeholder,
}: {
  label: string
  value: string
  onV: (v: string) => void
  secret?: boolean
  placeholder?: string
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      <span className="w-28 shrink-0">{label}</span>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onV(e.target.value)}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
      />
    </label>
  )
}

const SPEEDS = [0.25, 0.5, 1, 2, 4]

export const SettingsDialog = memo(function SettingsDialog({ onClose }: { onClose: () => void }) {
  const activeProvider = useSettingsStore((s) => s.activeProvider)
  const providers = useSettingsStore((s) => s.providers)
  const defaultSpeed = useSettingsStore((s) => s.defaultSpeed)
  const setDefaultSpeed = useSettingsStore((s) => s.setDefaultSpeed)
  const correctionTemplate = useSettingsStore((s) => s.correctionTemplate)
  const setCorrectionTemplate = useSettingsStore((s) => s.setCorrectionTemplate)
  const [tab, setTab] = useState<'ai' | 'pref'>('ai')

  return (
    <Modal
      title="设置"
      subtitle="API Key 只保存在本机浏览器 localStorage；直连厂商请注意浏览器 CORS（每项下方有说明）"
      onClose={onClose}
      wide
    >
      <div className="mb-4 flex w-48">
        {(
          [
            ['ai', 'AI 通道'],
            ['pref', '偏好与提示词'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cx(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ai' ? (
        <div className="space-y-3">
          {PROVIDER_META.map((m) => (
            <ProviderForm key={m.id} id={m.id} cfg={providers[m.id]!} />
          ))}
          <p className="rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            当前通道：<b className="text-slate-700">{PROVIDER_META.find((m) => m.id === activeProvider)?.name}</b>。
            浏览器直调说明：DeepSeek / Gemini / Anthropic（已带
            <code className="mx-0.5 rounded bg-slate-200 px-1">anthropic-dangerous-direct-browser-access</code>
            头）可直接调用；OpenAI 常被 CORS 拦截，可自建本地代理后把 baseUrl 指向代理（如
            <code className="mx-0.5 rounded bg-slate-200 px-1">http://localhost:8080/v1</code>），Ollama 需设置
            <code className="mx-0.5 rounded bg-slate-200 px-1">OLLAMA_ORIGINS=*</code> 后自定义 baseUrl。
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-600">默认播放速度</span>
            <select
              value={defaultSpeed}
              onChange={(e) => setDefaultSpeed(Number(e.target.value))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="ct">
              人工校正提示模板
            </label>
            <p className="mb-1.5 text-[11px] text-slate-400">
              发送给模型的修正指令前缀，<code className="rounded bg-slate-100 px-1">{'{issue}'}</code>{' '}
              会被替换成你在校正弹窗里填写的反馈。
            </p>
            <textarea
              id="ct"
              value={correctionTemplate}
              onChange={(e) => setCorrectionTemplate(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-200 px-2.5 py-2 text-xs leading-relaxed text-slate-800 focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>
      )}
    </Modal>
  )
})
