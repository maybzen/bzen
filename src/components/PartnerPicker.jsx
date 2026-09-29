import { useEffect, useMemo, useRef, useState } from 'react'
import { createPartner, listPartners } from '../lib/api'
import { normalizeVendorName } from '../lib/format'
import { Field, Modal } from './ui'

/**
 * 거래처 검색 선택창.
 * 치면 대장에서 찾아주고, 없으면 "+ 새로 등록"으로 간단 등록창이 뜹니다.
 */
export default function PartnerPicker({ value, onChange, placeholder, autoFocus = false, userId }) {
  const [partners, setPartners] = useState([])
  const [open, setOpen] = useState(false)
  const closeTimer = useRef(null)
  const [regOpen, setRegOpen] = useState(false)
  const [regName, setRegName] = useState('')
  const [regContact, setRegContact] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regMemo, setRegMemo] = useState('')
  const [regSaving, setRegSaving] = useState(false)
  const [regError, setRegError] = useState('')

  const reloadPartners = () => {
    listPartners().then((rows) => setPartners(rows || [])).catch(() => {})
  }

  useEffect(() => {
    reloadPartners()
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
            <li className="border-t border-ink-100 px-3 py-1.5">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setRegName(String(value).trim())
                  setRegContact('')
                  setRegPhone('')
                  setRegMemo('')
                  setRegError('')
                  setRegOpen(true)
                  setOpen(false)
                }}
                className="w-full text-left text-xs text-brand-700 hover:underline"
              >
                + ‘{String(value).trim()}’ 새로 등록
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {regOpen ? (
        <Modal
          open
          onClose={regSaving ? undefined : () => setRegOpen(false)}
          title="거래처 간단 등록"
          footer={
            <>
              <button type="button" className="btn-ghost" onClick={() => setRegOpen(false)} disabled={regSaving}>
                취소
              </button>
              <button type="submit" form="partner-quick-form" className="btn-primary" disabled={regSaving}>
                {regSaving ? '저장 중…' : '등록'}
              </button>
            </>
          }
        >
          <form
            id="partner-quick-form"
            onSubmit={async (e) => {
              e.preventDefault()
              const name = regName.trim()
              if (!name) return setRegError('거래처명을 입력해 주세요.')
              setRegSaving(true)
              setRegError('')
              try {
                await createPartner(
                  {
                    name,
                    contact_person: regContact.trim(),
                    phone_main: regPhone.trim(),
                    memo: regMemo.trim(),
                    group_name: '기타',
                    status: '정상',
                  },
                  userId,
                )
                reloadPartners()
                pick(name)
                setRegOpen(false)
              } catch (err) {
                setRegError(err.message)
              } finally {
                setRegSaving(false)
              }
            }}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            {regError ? (
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-loss">{regError}</p>
              </div>
            ) : null}
            <Field label="거래처명" required className="sm:col-span-2">
              <input className="input" value={regName} onChange={(e) => setRegName(e.target.value)} />
            </Field>
            <Field label="담당자">
              <input className="input" value={regContact} onChange={(e) => setRegContact(e.target.value)} />
            </Field>
            <Field label="연락처">
              <input className="input" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="예: 010-0000-0000" />
            </Field>
            <Field label="메모" className="sm:col-span-2">
              <input className="input" value={regMemo} onChange={(e) => setRegMemo(e.target.value)} />
            </Field>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}
