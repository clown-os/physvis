// 题目输入面板：粘贴物理题（或上传题目截图识图）→ AI 解析。同时承担错误展示与来源标注。
import { memo, useRef, useState } from 'react'
import { useProblemStore } from '../stores/problemStore'
import { useSettingsStore } from '../stores/settingsStore'
import { PROVIDER_META } from '../ai/types'
import type { ImageInput } from '../ai/types'
import { runParseFlow } from '../ai/flow'
import { Button } from './ui'

const SOURCE_LABEL = { manual: '手动输入', example: '示例题', template: '场景模板' }

const MAX_IMAGES = 3
const MAX_BYTES = 4 * 1024 * 1024 // 单张 4 MB

/** 简单视觉能力提示：已知的非视觉模型组合给出提醒 */
function visionWarning(provider: string, model: string): string | null {
  if (provider === 'deepseek' && /deepseek-chat/i.test(model)) {
    return '当前模型 deepseek-chat 不支持图片识别：请到「设置」换成视觉模型（如 deepseek-vl2），或改用 OpenAI / Gemini / Claude 通道。'
  }
  return null
}

export const ProblemInput = memo(function ProblemInput() {
  const text = useProblemStore((s) => s.text)
  const setText = useProblemStore((s) => s.setText)
  const images = useProblemStore((s) => s.images)
  const setImages = useProblemStore((s) => s.setImages)
  const parsing = useProblemStore((s) => s.parsing)
  const source = useProblemStore((s) => s.source)
  const error = useProblemStore((s) => s.error)
  const activeProvider = useSettingsStore((s) => s.activeProvider)
  const providers = useSettingsStore((s) => s.providers)
  const [collapsed, setCollapsed] = useState(false)
  const [fileNotice, setFileNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canParse = (text.trim().length > 0 || images.length > 0) && !parsing
  const providerName = PROVIDER_META.find((p) => p.id === activeProvider)?.name ?? activeProvider
  const vw = visionWarning(activeProvider, providers[activeProvider]?.model ?? '')

  const onPickFile = (files: FileList | null) => {
    setFileNotice(null)
    const file = files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setFileNotice('请选择图片文件（png / jpg 等）')
      return
    }
    if (file.size > MAX_BYTES) {
      setFileNotice('图片超过 4 MB，请压缩后重试')
      return
    }
    if (images.length >= MAX_IMAGES) {
      setFileNotice(`最多上传 ${MAX_IMAGES} 张截图`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const img: ImageInput = { dataUrl, mimeType: file.type }
      setImages([...images, img])
    }
    reader.readAsDataURL(file)
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">问题输入 · AI 建模</h3>
        {source && (
          <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-500">{SOURCE_LABEL[source]}</span>
        )}
      </div>

      {collapsed ? (
        <button type="button" onClick={() => setCollapsed(false)} className="block w-full px-3 pb-3 pt-1 text-left text-xs text-slate-500 hover:text-slate-700">
          <span className="mr-1">▸</span>
          {text ? (
            <span className="line-clamp-2">{text}</span>
          ) : images.length > 0 ? (
            `已上传 ${images.length} 张题目截图，点击展开`
          ) : (
            '粘贴一道高中物理题，点击展开'
          )}
        </button>
      ) : (
        <div className="px-3 pb-3 pt-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'例：以 15 m/s 的初速度将一小球从地面竖直向上抛出，忽略空气阻力，g 取 9.8 m/s²。求小球能到达的最大高度和落回地面的总时间。也可以直接上传题目截图（含示意图），让视觉模型照图建模。'}
            rows={4}
            spellCheck={false}
            className="w-full resize-y rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[13px] leading-relaxed text-slate-800 placeholder:text-slate-300 focus:border-blue-400 focus:bg-white focus:outline-none"
          />
          {images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="group relative">
                  <img
                    src={img.dataUrl}
                    alt={`题目截图 ${i + 1}`}
                    className="h-16 w-16 rounded-md border border-slate-200 object-cover"
                  />
                  <button
                    type="button"
                    title="移除这张截图"
                    onClick={() => setImages(images.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[10px] leading-none text-white hover:bg-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 text-[10px] text-slate-400" title="当前 AI 通道（设置中切换）">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${activeProvider === 'mock' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              <span className="truncate">{providerName}</span>
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  onPickFile(e.target.files)
                  e.target.value = ''
                }}
              />
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} title="上传题目截图（含示意图），视觉模型照图建模">
                📷 传图
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCollapsed(true)}>
                收起
              </Button>
              <Button size="sm" disabled={!canParse} onClick={() => void runParseFlow()} title="交给 AI 解析成可播放场景">
                {parsing ? '解析中…' : '⚡ AI 解析并模拟'}
              </Button>
            </div>
          </div>
          {fileNotice && (
            <p className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">{fileNotice}</p>
          )}
          {vw && (
            <p className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700">{vw}</p>
          )}
          {error && (
            <p className="mt-2 whitespace-pre-line rounded-md border border-red-100 bg-red-50 px-2.5 py-2 text-[11px] leading-relaxed text-red-700">
              {error.message}
            </p>
          )}
        </div>
      )}
    </section>
  )
})
