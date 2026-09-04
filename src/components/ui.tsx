// 手写原子 UI（Tailwind 类名拼接），替代 shadcn 依赖。
import { useEffect, type ReactNode } from 'react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type BtnVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle'

const BTN: Record<BtnVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  subtle: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        BTN[variant],
        className,
      )}
      {...props}
    />
  )
}

/** 分段切换（右侧工作区 Tab / 视图开关） */
export function SegTabs<T extends string>({
  tabs,
  value,
  onChange,
  size = 'md',
}: {
  tabs: Array<{ id: T; label: ReactNode; hint?: string }>
  value: T
  onChange: (id: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="flex rounded-lg bg-slate-200/70 p-0.5" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          title={t.hint}
          onClick={() => onChange(t.id)}
          className={cx(
            'flex-1 whitespace-nowrap rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
            value === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  title?: string
}) {
  return (
    <span
      className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-600"
      title={title}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cx(
          'relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors',
          checked ? 'bg-blue-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all',
            checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
      {label}
    </span>
  )
}

/** 数值格式化：按 step 精度（滑块+数值框共用） */
export function fmtNum(v: number, step: number): string {
  if (!Number.isFinite(v)) return '—'
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.05 ? 2 : step >= 0.01 ? 2 : 3
  const s = v.toFixed(decimals)
  return s.replace(/\.?0+$/, '') || '0'
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
