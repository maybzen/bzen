import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { formatKRW, formatPercent } from '../lib/format'

/* ------------------------------- Modal ------------------------------- */

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-2xl',
  lg: 'sm:max-w-4xl',
  xl: 'sm:max-w-6xl',
}

/**
 * 열려 있는 모달 스택. ConfirmDialog 를 Modal 위에 띄울 때(모달 2중)
 * Esc 를 눌렀을 때 둘 다 동시에 닫히지 않고 맨 위 모달만 닫히게 합니다.
 */
const modalStack = []
/* 화면 전체 스크롤 잠금 카운터. 중첩 모달이 역순으로 닫혀도 잠금이 남지 않습니다. */
let scrollLockCount = 0
let prevBodyOverflow = ''

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}
function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) document.body.style.overflow = prevBodyOverflow || ''
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', overflowVisible = false }) {
  const panelRef = useRef(null)
  const titleId = useMemo(() => `modal-title-${Math.random().toString(36).slice(2, 9)}`, [])

  useEffect(() => {
    if (!open) return undefined
    const token = {}
    const isTop = () => !modalStack.length || modalStack[modalStack.length - 1] === token

    const focusables = () => {
      const root = panelRef.current
      if (!root) return []
      return [...root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null || el === document.activeElement)
    }

    const previouslyFocused = document.activeElement
    /* 열리면 첫 입력칸으로 포커스를 옮깁니다 (안 옮기면 Tab 이 배경으로 갑니다) */
    const t = window.setTimeout(() => {
      const list = focusables()
      const first = list.find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) || list[0]
      first?.focus()
    }, 0)

    const onKey = (e) => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
        return
      }
      /* Tab 은 모달 안에서만 돌게 합니다 (포커스 트랩) */
      if (e.key === 'Tab') {
        const list = focusables()
        if (!list.length) return
        const first = list[0]
        const last = list[list.length - 1]
        const active = document.activeElement
        if (!panelRef.current?.contains(active)) {
          e.preventDefault()
          first.focus()
        } else if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    modalStack.push(token)
    document.addEventListener('keydown', onKey, true)
    lockBodyScroll()
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      const i = modalStack.indexOf(token)
      if (i >= 0) modalStack.splice(i, 1)
      unlockBodyScroll()
      /* 닫히면 원래 있던 곳으로 포커스를 되돌립니다 */
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`relative z-10 flex max-h-[92vh] w-full flex-col animate-fade-in ${overflowVisible ? 'overflow-visible' : 'overflow-hidden'} rounded-t-2xl bg-white shadow-pop sm:rounded-2xl ${SIZES[size] || SIZES.md}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-bold text-ink-900">{title}</h2>
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
      onClose={busy ? undefined : onClose}
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
      <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{message}</p>
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

/** label 을 붙일 수 있는 태그 (div 래퍼에는 htmlFor 를 걸면 안 됩니다) */
const LABELABLE = new Set(['input', 'select', 'textarea'])

/** 자식 안에서 입력칸·버튼 딱 하나만 찾아냅니다. 없으면 null. */
function findOnlyFormControl(children) {
  const list = Children.toArray(children).flat(3)
  const controls = list.filter(
    (c) => isValidElement(c) && (LABELABLE.has(c.type) || c.type === 'AmountInput'),
  )
  return controls.length === 1 ? controls[0] : null
}

export function Field({ label, hint, required, error, children, className = '' }) {
  const inputId = useMemo(() => `field-${Math.random().toString(36).slice(2, 9)}`, [])
  /*label 과 입력칸 연결.
     자식이 여러 개이거나 div 같은 래퍼여도, 그 안에 입력칸이 하나면
     거기까지 id 를 밀어 넣어 클릭하면 입력칸으로 focus 되게 합니다. */
  let linked = children
  try {
    const child = Children.only(children)
    if (isValidElement(child)) {
      const props = child.props || {}
      const target = LABELABLE.has(child.type) ? child : findOnlyFormControl(props.children)
      if (target) {
        const controlId = target.props.id || inputId
        if (child === target) {
          // 직접 자식이 입력칸이면 id만 붙이고 자식(option 등)은 그대로 둡니다
          linked = cloneElement(child, { id: controlId })
        } else {
          // 래퍼 속 입력칸에만 id를 붙이고 나머지 자식(드롭다운 버튼·목록)은 그대로 둡니다
          const patch = (node) => {
            if (!isValidElement(node)) return node
            if (node === target) return cloneElement(node, { id: controlId })
            if (node.props?.children == null) return node
            return cloneElement(node, {}, ...[].concat(Children.map(node.props.children, patch) ?? []))
          }
          linked = patch(child)
          if (!linked.props.id) linked = cloneElement(linked, { id: inputId })
        }
      }
    }
  } catch {
    /* 여러 자식: 연결 생략 */
  }
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={inputId}>
          {label}
          {required ? <span className="ml-0.5 text-loss">*</span> : null}
        </label>
      ) : null}
      {linked}
      {error ? (
        <p className="mt-1 text-xs font-medium text-loss">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  )
}

/* ---------------------------- AmountInput ---------------------------- */

/**
 * 금액 입력창. 치는 대로 1,234,567 콤마가 찍히고,
 * onChange에는 숫자만 남긴 합성 이벤트({ target: { value } })가 넘어갑니다.
 * 기존 숫자 input 자리에 그대로 꽂으면 됩니다.
 */
export function AmountInput({ value, onChange, allowNegative = true, ...rest }) {
  const raw = value === '' || value === null || value === undefined ? '' : String(value)
  const digits = raw.replace(/[^0-9.\-]/g, '')
  let shown = ''
  if (digits !== '' && digits !== '-' && digits !== '.' && digits !== '-.') {
    const n = Number(digits)
    if (!Number.isNaN(n)) shown = n.toLocaleString('ko-KR')
  } else if (digits === '-') {
    shown = '-'
  }
  return (
    <input
      {...rest}
      inputMode="numeric"
      value={shown}
      placeholder={rest.placeholder ?? '0'}
      onChange={(e) => {
        let d = String(e.target.value).replace(/[^0-9.\-]/g, '')
        if (!allowNegative) d = d.replace(/-/g, '')
        onChange?.({ target: { value: d } })
      }}
    />
  )
}

/* ------------------------------- StatCard ------------------------------ */

const TONES = {
  /* 대표 강조(브랜드 파랑) */
  brand: { accent: 'text-brand-700', bg: 'bg-brand-50', icon: 'coins' },
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
  to,
  onClick,
  selected,
}) {
  const style = TONES[tone] || TONES.neutral
  const up = typeof delta === 'number' && delta >= 0
  /* 비용 카드는 늘면 나쁜 것이므로 색을 뒤집습니다 (매출·이익은 그대로) */
  const costLike = tone === 'purchase' || tone === 'opex' || tone === 'loss'
  const good = costLike ? !up : up

  const body = (
    <>
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
            className={`inline-flex items-center gap-0.5 font-semibold ${good ? 'text-emerald-600' : 'text-red-600'}`}
          >
            <Icon name={up ? 'arrow-up' : 'arrow-down'} size={13} strokeWidth={2.4} />
            {formatPercent(Math.abs(delta))}
          </span>
        ) : (
          <span className="text-ink-400">—</span>
        )}
        <span className="text-ink-400">{deltaSuffix}</span>
        {to ? <span className="ml-auto font-semibold text-brand-700">자세히 →</span> : null}
      </div>

      {hint ? <p className="mt-1.5 text-xs text-ink-400">{hint}</p> : null}
    </>
  )

  if (!to && !onClick) return <div className="card p-4 sm:p-5">{body}</div>
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title="클릭해서 목록 필터"
        aria-pressed={selected === undefined ? undefined : Boolean(selected)}
        className={`card block w-full p-4 text-left transition hover:shadow-pop sm:p-5 ${
          selected ? 'ring-2 ring-brand-500' : ''
        }`}
      >
        {body}
      </button>
    )
  }
  return (
    <Link to={to} className="card block p-4 transition hover:shadow-pop sm:p-5">
      {body}
    </Link>
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
    /* 'warning' 으로 쓰인 곳이 남아 있어 함께 받습니다 (예전 이름) */
    warning: 'bg-amber-50 text-amber-800 border-amber-100',
    error: 'bg-rose-50 text-rose-800 border-rose-100',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  }
  const icons = { info: 'info', warn: 'alert', warning: 'alert', error: 'alert', success: 'check' }
  const style = styles[tone] || styles.info
  const icon = icons[tone] || icons.info
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-xs leading-relaxed ${style} ${className}`}
    >
      <Icon name={icon} size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
