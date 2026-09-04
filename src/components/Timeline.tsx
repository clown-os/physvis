// 播放控制条 + 事件时间轴：seek 滑条（事件刻度可点）、播放/暂停、
// 逐帧 ±0.01s、速度 0.25–4x、循环、时间读数。
import { memo, useCallback, useRef } from 'react'
import type { PhysicsEventKind } from '../engine/types'
import { ENGINE_DT } from '../engine/types'
import { useSimulationStore } from '../stores/simulationStore'
import { useUIStore } from '../stores/uiStore'

const EVENT_COLORS: Record<PhysicsEventKind, string> = {
  landing: '#2563eb',
  apex: '#0891b2',
  collision: '#dc2626',
  meet: '#7c3aed',
  ropeTaut: '#d97706',
  stop: '#64748b',
}

const EVENT_LABELS: Record<PhysicsEventKind, string> = {
  landing: '落地',
  apex: '最高点',
  collision: '碰撞',
  meet: '相遇',
  ropeTaut: '绳张紧',
  stop: '停稳',
}

const SPEEDS = [0.25, 0.5, 1, 2, 4]

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[13px] leading-none text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export const Timeline = memo(function Timeline() {
  const result = useSimulationStore((s) => s.result)
  const playback = useSimulationStore((s) => s.playback)
  const duration = result?.duration ?? 0

  const setPlayback = useSimulationStore((s) => s.setPlayback)
  const setSimTime = useSimulationStore((s) => s.setSimTime)
  const seek = useSimulationStore((s) => s.seek)
  const stepFrame = useSimulationStore((s) => s.stepFrame)
  const highlight = useUIStore((s) => s.highlightEventIndex)
  const setHighlight = useUIStore((s) => s.setHighlightEvent)

  // 拖动中不与 rAF 播放竞争：拖动时暂停播放
  const dragging = useRef(false)
  const onScrub = useCallback(
    (v: number) => {
      if (!dragging.current) {
        dragging.current = true
        setPlayback({ playing: false })
      }
      setSimTime(v)
    },
    [setPlayback, setSimTime],
  )
  const onScrubEnd = useCallback(
    (v: number) => {
      dragging.current = false
      seek(v)
    },
    [seek],
  )

  // 主播放键：到末尾时显示「重播」——须先回到 0 再播放，
  // 否则播放循环会立即判定 t ≥ duration 而停回末尾（点了没反应）。
  const togglePlay = useCallback(() => {
    if (playback.simTime >= duration - 1e-9) {
      seek(0)
      setPlayback({ playing: true })
    } else {
      setPlayback({ playing: !playback.playing })
    }
  }, [duration, playback.playing, playback.simTime, seek, setPlayback])

  if (!result) {
    return (
      <div className="flex h-10 items-center justify-center text-xs text-slate-400">尚未运行模拟</div>
    )
  }

  const events = result.events
  const atEnd = playback.simTime >= duration - 1e-9
  const eventDots = events
    .map((e, i) => ({ e, i }))
    // 同一步的多种事件只取其一（dots 会重叠）
    .filter((item, idx, arr) => idx === 0 || arr[idx - 1]!.e.step !== item.e.step)

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      {/* 时间轴滑条 */}
      <div className="relative">
        <input
          type="range"
          min={0}
          max={duration}
          step={ENGINE_DT}
          value={Math.min(playback.simTime, duration)}
          onChange={(ev) => onScrub(Number(ev.target.value))}
          onPointerUp={(ev) => onScrubEnd(Number((ev.target as HTMLInputElement).value))}
          aria-label="时间轴"
          className="w-full accent-blue-600"
        />
        {/* 事件刻度（绝对定位在滑条轨道上方） */}
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(50%+0.2rem)] h-1">
          {eventDots.map(({ e, i }) => (
            <button
              key={i}
              type="button"
              title={`${EVENT_LABELS[e.kind]} @ ${e.time.toFixed(2)}s${e.label ? ` · ${e.label}` : ''}`}
              aria-label={`跳转到事件：${EVENT_LABELS[e.kind]} @ ${e.time.toFixed(2)}s`}
              onClick={() => {
                seek(e.time)
                setHighlight(i)
              }}
              className={`pointer-events-auto absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition-transform hover:scale-150 ${
                highlight === i ? 'scale-150' : ''
              }`}
              style={{ left: `${(e.time / duration) * 100}%`, backgroundColor: EVENT_COLORS[e.kind] }}
            />
          ))}
        </div>
      </div>

      {/* 控制行 */}
      <div className="mt-1 flex items-center gap-1 text-sm">
        <IconButton title="回到开头" onClick={() => seek(0)} disabled={playback.simTime <= 0}>
          ⏮
        </IconButton>
        <IconButton title="后退一帧 (0.01s)" onClick={() => stepFrame(-1)} disabled={playback.simTime <= 0}>
          ◀
        </IconButton>
        <button
          type="button"
          onClick={togglePlay}
          className="mx-1 inline-flex h-8 min-w-[3.5rem] items-center justify-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          {playback.playing ? '暂停' : atEnd ? '重播' : '播放'}
        </button>
        <IconButton title="前进一帧 (0.01s)" onClick={() => stepFrame(1)} disabled={atEnd}>
          ▶
        </IconButton>
        <IconButton title="跳到结尾" onClick={() => seek(duration)} disabled={atEnd}>
          ⏭
        </IconButton>

        <span className="ml-2 w-28 shrink-0 text-right tabular-nums text-xs text-slate-600">
          <span className="font-medium text-slate-800">{playback.simTime.toFixed(2)}</span>
          <span className="text-slate-400"> / {duration.toFixed(2)} s</span>
        </span>

        <div className="ml-auto flex items-center gap-2">
          {events.length > 0 && (
            <span className="hidden items-center gap-2 sm:flex" title="事件标记：点时间轴上的圆点跳转">
              {(['landing', 'apex', 'collision', 'meet', 'stop'] as const)
                .filter((k) => events.some((e) => e.kind === k))
                .map((k) => (
                  <span key={k} className="flex items-center gap-1 text-[11px] text-slate-400">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_COLORS[k] }} />
                    {EVENT_LABELS[k]}
                  </span>
                ))}
            </span>
          )}
          <select
            aria-label="播放速度"
            value={playback.speed}
            onChange={(ev) => setPlayback({ speed: Number(ev.target.value) })}
            className="rounded-md border border-slate-200 bg-white px-1 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer select-none items-center gap-1 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={playback.loop}
              onChange={(ev) => setPlayback({ loop: ev.target.checked })}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            循环
          </label>
        </div>
      </div>
    </div>
  )
})
