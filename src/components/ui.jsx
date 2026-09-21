import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { formatKRW, formatPercent } from '../lib/format'

/* ------------------------------- Modal ------------------------------- */

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-2xl',
  lg: 'sm:max-w-4xl',
  xl: 'sm:max-w-6xl',
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 flex max-h-[92vh] w-full flex-col animate-fade-in overflow-hidden rounded-t-2xl bg-white shadow-pop sm:rounded-2xl ${SIZES[size] || SIZES.md}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-ink-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
            aria-label="닫기"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-200 bg-ink-50/70 px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/* ----------------------------- ConfirmDialog ----------------------------- */

export function ConfirmDialog({
  open,
  title = '삭제하시겠습니까?',
  message,
  confirmLabel = '삭제',
  cancelLabel = '취소',
  tone = 'danger',
  busy = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              tone === 'danger'
                ? 'btn bg-loss px-3.5 py-2.5 text-white hover:bg-red-700'
                : 'btn-primary'
            }
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '처리 중…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-700">{message}</p>
    </Modal>
  )
}

/* -------------------------------- Chip -------------------------------- */

export function Chip({ children, className = '' }) {
  return <span className={`chip ${className}`}>{children}</span>
}

/* ------------------------------- Spinner ------------------------------- */

export function Spinner({ size = 22, className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.6" opacity="0.18" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LoadingBlock({ label = '불러오는 중…', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-2.5 py-16 text-sm text-ink-500 ${className}`}>
      <Spinner size={20} />
      {label}
    </div>
  )
}

/* ----------------------------- EmptyState ----------------------------- */

export function EmptyState({ icon = 'file', title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <Icon name={icon} size={22} />
      </span>
      <p className="mt-3.5 text-sm font-semibold text-ink-700">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/* ----------------------------- PageHeader ----------------------------- */

export function PageHeader({ title, description, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {children ? <div className="no-print flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}

/* ------------------------------- Field -------------------------------- */

export function Field({ label, hint, required, error, children, className = '' }) {
  return (
    <div className={className}>
      {label ? (
        <label className="label">
          {label}
          {required ? <span className="ml-0.5 text-loss">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-loss">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  )
}

/* ------------------------------- StatCard ------------------------------ */

const TONES = {
  sale: { accent: 'text-brand-700', bg: 'bg-brand-50', icon: 'trending-up' },
  purchase: { accent: 'text-amber-700', bg: 'bg-amber-50', icon: 'cart' },
  opex: { accent: 'text-rose-700', bg: 'bg-rose-50', icon: 'receipt' },
  profit: { accent: 'text-emerald-700', bg: 'bg-emerald-50', icon: 'coins' },
  loss: { accent: 'text-red-700', bg: 'bg-red-50', icon: 'coins' },
  neutral: { accent: 'text-ink-700', bg: 'bg-ink-100', icon: 'chart' },
}

export function StatCard({
  label,
  value,
  unit = '원',
  delta,
  deltaSuffix = '전기 대비',
  tone = 'neutral',
  icon,
  hint,
}) {
  const style = TONES[tone] || TONES.neutral
  const up = typeof delta === 'number' && delta >= 0

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-ink-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.bg} ${style.accent}`}>
          <Icon name={icon || style.icon} size={16} />
        </span>
      </div>

      <p className="mt-2.5 flex items-baseline gap-1">
        <span className="font-num text-xl font-extrabold tabular-nums tracking-tight text-ink-900 sm:text-2xl">
          {typeof value === 'number' ? formatKRW(value) : value}
        </span>
        {unit ? <span className="text-xs font-semibold text-ink-500">{unit}</span> : null}
      </p>

      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {typeof delta === 'number' ? (
          <span
            className={`inline-flex items-center gap-0.5 font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}
          >
            <Icon name={up ? 'arrow-up' : 'arrow-down'} size={13} strokeWidth={2.4} />
            {formatPercent(Math.abs(delta))}
          </span>
        ) : (
          <span className="text-ink-400">—</span>
        )}
        <span className="text-ink-400">{deltaSuffix}</span>
      </div>

      {hint ? <p className="mt-1.5 text-xs text-ink-400">{hint}</p> : null}
    </div>
  )
}

/* --------------------------- SegmentedControl --------------------------- */

export function SegmentedControl({ options, value, onChange, size = 'md', className = '' }) {
  return (
    <div className={`inline-flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1 ${className}`}>
      {options.map((opt) => {
        const active = opt.key === value
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`rounded-md font-semibold transition ${
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
            } ${active ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------ Toast-less ----------------------------- */

export function InlineAlert({ tone = 'info', children, className = '' }) {
  const styles = {
    info: 'bg-brand-50 text-brand-800 border-brand-100',
    warn: 'bg-amber-50 text-amber-800 border-amber-100',
    error: 'bg-rose-50 text-rose-800 border-rose-100',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  }
  const icons = { info: 'info', warn: 'alert', error: 'alert', success: 'check' }
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-xs leading-relaxed ${styles[tone]} ${className}`}
    >
      <Icon name={icons[tone]} size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
