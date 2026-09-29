import { useEffect, useMemo, useRef, useState } from 'react'
import { listPartners } from '../lib/api'
import { normalizeVendorName } from '../lib/format'

/**
 * 거래처 검색 선택창.
 * 치면 대장에서 찾아주고, 없으면 "저장 시 새로 등록"으로 표시합니다.
 * 실제 등록은 저장할 때 ensurePartnerByName으로 처리하세요.
 */
export default function PartnerPicker({ value, onChange, placeholder, autoFocus = false }) {
  const [partners, setPartners] = useState([])
  const [open, setOpen] = useState(false)
  const closeTimer = useRef(null)

  useEffect(() => {
    listPartners().then((rows) => setPartners(rows || [])).catch(() => {})
  }, [])

  const q = normalizeVendorName(value)
  const matches = useMemo(() => {
    if (!q) return (partners || []).slice(0, 6)
    return (partners || [])
      .filter((p) => normalizeVendorName(p.name).includes(q))
      .slice(0, 6)
  }, [partners, q])
  const exact = useMemo(
    () => (partners || []).some((p) => normalizeVendorName(p.name) === q && q),
    [partners, q],
  )

  const pick = (name) => {
    onChange?.({ target: { value: name } })
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        className="input"
        value={value || ''}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange?.(e)
          setOpen(true)
        }}
        onFocus={() => {
          if (closeTimer.current) clearTimeout(closeTimer.current)
          setOpen(true)
        }}
        onBlur={() => {
          closeTimer.current = setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && (matches.length > 0 || String(value || '').trim()) ? (
        <ul className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-ink-200 bg-white py-1 shadow-pop">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.name)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-brand-50"
              >
                <span className="truncate font-semibold text-ink-800">{p.name}</span>
                {p.contact_person ? (
                  <span className="shrink-0 text-[11px] text-ink-400">{p.contact_person}</span>
                ) : null}
              </button>
            </li>
          ))}
          {!exact && String(value || '').trim() ? (
            <li className="border-t border-ink-100 px-3 py-1.5 text-xs text-ink-500">
              + ‘{String(value).trim()}’ <span className="text-brand-700">(저장 시 새로 등록)</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
