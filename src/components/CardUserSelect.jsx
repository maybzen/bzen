import { useEffect, useRef, useState } from 'react'
import { CARD_USERS, cardUserName } from '../lib/constants'

const KNOWN = new Set(CARD_USERS.map((u) => u.code))

export function parseCardUsers(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 법인카드 이용자 다중 선택 (ALL은 단독). allowCustom이면 목록 외 직접 입력 가능 */
export default function CardUserSelect({ value, onChange, allowCustom = false }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const codes = parseCardUsers(value)
  const customs = codes.filter((c) => !KNOWN.has(c))

  /* Esc 로 닫기 + 바깥 클릭 닫기 */
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open])

  const emit = (std, custom) => {
    const order = CARD_USERS.map((u) => u.code)
    const sorted = [...std].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    onChange([...sorted, ...custom].filter(Boolean).join(','))
  }

  const toggle = (code) => {
    const std = codes.filter((c) => KNOWN.has(c))
    let next
    if (code === 'ALL') {
      next = std.length === 1 && std[0] === 'ALL' ? [] : ['ALL']
    } else {
      const withoutAll = std.filter((c) => c !== 'ALL')
      next = withoutAll.includes(code) ? withoutAll.filter((c) => c !== code) : [...withoutAll, code]
    }
    emit(next, customs)
  }

  const setCustom = (text) => {
    const parts = String(text || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((c) => !KNOWN.has(c))
    emit(
      codes.filter((c) => KNOWN.has(c)),
      parts,
    )
  }

  const label = codes.length
    ? codes.map((c) => (cardUserName(c) ? `${c} ${cardUserName(c)}` : c)).join(', ')
    : '선택'

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        className="input w-full truncate py-2 text-left"
      >
        {codes.join(',') || '선택 안 함'}
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="닫기"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <span className="absolute left-0 top-full z-50 mt-1 flex max-h-64 w-52 flex-col gap-0.5 overflow-auto rounded-lg border border-ink-200 bg-white p-1.5 shadow-pop">
            {CARD_USERS.map((u) => (
              <label
                key={u.code}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-ink-50"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-brand-600"
                  checked={codes.includes(u.code)}
                  onChange={() => toggle(u.code)}
                />
                <span className="font-bold text-ink-800">{u.code}</span>
                <span className="truncate text-ink-500">{u.name}</span>
              </label>
            ))}
            {allowCustom ? (
              <span className="border-t border-ink-100 px-2 pb-1 pt-2">
                <span className="mb-1 block text-[11px] font-semibold text-ink-500">
                  기타 (직접 입력, 쉼표로 여러 개)
                </span>
                <input
                  className="input py-1.5 text-xs"
                  placeholder="예: SHINE"
                  value={customs.join(',')}
                  onChange={(e) => setCustom(e.target.value)}
                />
              </span>
            ) : null}
          </span>
        </>
      ) : null}
    </span>
  )
}
