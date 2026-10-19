import { useEffect, useRef, useState } from 'react'
import { CARD_USERS, cardUserName } from '../lib/constants'
import { parseCardUsers, userCodesOnly } from '../lib/cardTag'

const KNOWN = new Set(CARD_USERS.map((u) => u.code))
export default function CardUserSelect({ value, onChange, allowCustom = false, className = '' }) {
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

  /* 기타 칸은 직접 입력 중입니다.
     emit() 을 매 글자에 호출하면 setCustom 안에서 trim/필터로 값을 다시 만들어
     "한 글자만 들어가고 흔들리는" 증상이 났습니다(커서가 튀고 글자가 잘림).
     draft 로 먼저 받고 확정/포커스 빠질 때만 부모로 넘깁니다. */
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (open) setDraft(customs.join(','))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const commitCustom = (text) => {
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
  /* 화면에는 이용자 코드만 보여줍니다. 메모 뒷말(법카·청구분)은 상세에서 봅니다 */
  const shown = userCodesOnly(value).join(',')

  return (
    <span ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={shown || label}
        aria-haspopup="true"
        aria-expanded={open}
        className="input w-full truncate px-2 py-2 text-left"
      >
        {shown || '선택 안 함'}
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
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={(e) => commitCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitCustom(e.currentTarget.value)
                      setOpen(false)
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setOpen(false)
                    }
                  }}
                />
                <span className="mt-1 block text-[10px] text-ink-400">
                  입력 후 Enter 또는 칸을 벗어나면 반영됩니다
                </span>
              </span>
            ) : null}
          </span>
        </>
      ) : null}
    </span>
  )
}
