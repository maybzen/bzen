import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPartner, listPartners } from '../lib/api'
import { normalizeVendorName } from '../lib/format'
import { findSimilarParties } from '../lib/validate'
import { linkedRaws, linkNames, loadAliases, rootOf, unlinkName } from '../lib/aliases'
import { refreshLedgerIndex } from '../lib/ledgerIndex'
import { Field, Modal } from './ui'

/**
 * 거래처 검색 선택창.
 * 치면 대장에서 찾아주고, 없으면 "+ 새로 등록"으로 간단 등록창이 뜹니다.
 * 등록 대장에 없어도 장부에서 쓰던 비슷한 이름이 있으면 연동 버튼으로 보여줍니다.
 */
export default function PartnerPicker({ value, onChange, placeholder, autoFocus = false, userId, ledgerEntries = [], excludeId = '' }) {
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
  /* 한 화면에 이 창이 여러 개(발주처·대행업체 등) 있어도 id 가 겹치지 않게 합니다.
     겹치면 등록 버튼이 다른 폼을 제출해 오류가 납니다. */
  const quickFormId = `partner-quick-${useId()}`

  const reloadPartners = () => {
    listPartners().then((rows) => setPartners(rows || [])).catch(() => {})
  }

  const [aliasTick, setAliasTick] = useState(0)
  const [linkError, setLinkError] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)

  useEffect(() => {
    reloadPartners()
    loadAliases()
      .then(() => setAliasTick((t) => t + 1))
      .catch(() => {})
  }, [])

  const q = normalizeVendorName(value)
  /* 검색은 이름 + 담당자 + 구분까지. "인력" 같은 구분어로도协力사를 찾게 합니다. */
  const matches = useMemo(() => {
    const rows = partners || []
    if (!q) return rows.slice(0, 8)
    return rows
      .filter((p) => {
        const name = normalizeVendorName(p.name)
        if (name.includes(q)) return true
        if (name.startsWith(q)) return true
        return normalizeVendorName(p.group_name || '').includes(q)
          || normalizeVendorName(p.contact_person || '').includes(q)
      })
      .sort((a, b) => {
        /* 이름 앞부분이 맞는 쪽을 먼저 (사단/㈜ 같은 표기 차이 대비) */
        const an = normalizeVendorName(a.name).startsWith(q) ? 0 : 1
        const bn = normalizeVendorName(b.name).startsWith(q) ? 0 : 1
        return an - bn
      })
      .slice(0, 8)
  }, [partners, q])
  const exact = useMemo(
    () => (partners || []).some((p) => normalizeVendorName(p.name) === q && q),
    [partners, q],
  )

  /* 장부에서 쓰던 비슷한 이름 (대장 미등록 포함). 연동하면 둘 다 남긴 채 같은 곳으로 묶입니다. */
  const rawInput = String(value || '').trim()
  const linked = useMemo(() => (rawInput ? linkedRaws(rawInput) : []), [rawInput, aliasTick])
  const ledgerSimilar = useMemo(() => {
    if (!rawInput || !(ledgerEntries || []).length) return []
    try {
      const myRoot = rootOf(rawInput)
      return findSimilarParties(ledgerEntries, rawInput, { excludeId })
        .filter(([name]) => {
          // 이미 연동된 표기는 제안에서 뺍니다 (공존 중)
          const r = rootOf(name)
          return !(myRoot && r && myRoot === r)
        })
        .slice(0, 5)
    } catch {
      return []
    }
  }, [ledgerEntries, rawInput, excludeId, aliasTick])

  const runLink = async (name) => {
    setLinkError('')
    setLinkBusy(true)
    try {
      const ok = await linkNames(rawInput, name, userId)
      if (!ok) setLinkError('이미 같은 표기라 연동할 게 없습니다.')
      setAliasTick((t) => t + 1)
      refreshLedgerIndex()
    } catch (err) {
      setLinkError(err?.message || '연동하지 못했습니다.')
    } finally {
      setLinkBusy(false)
    }
  }

  const runUnlink = async () => {
    setLinkError('')
    setLinkBusy(true)
    try {
      await unlinkName(rawInput)
      setAliasTick((t) => t + 1)
      refreshLedgerIndex()
    } catch (err) {
      setLinkError(err?.message || '해제하지 못했습니다.')
    } finally {
      setLinkBusy(false)
    }
  }

  const pick = (name) => {
    onChange?.({ target: { value: name } })
    setOpen(false)
  }

  /** 간단 등록 창을 엽니다. presetName 이 있으면 이름이 미리 채워집니다. */
  const openQuickRegister = (presetName) => {
    setRegName(presetName || '')
    setRegContact('')
    setRegPhone('')
    setRegMemo('')
    setRegError('')
    setRegOpen(true)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        className="input"
        value={value || ''}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-expanded={open}
        aria-autocomplete="list"
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
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-ink-200 bg-white py-1 shadow-pop">
          {!q ? (
            <li className="px-3 py-1.5 text-[10px] font-medium text-ink-400">
              거래처명·담당자·구분으로 찾습니다
            </li>
          ) : null}
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onPointerDown={(e) => {
                  // 모바일 터치에서도 blur보다 먼저 선택되도록 pointerdown에서 확정
                  e.preventDefault()
                  pick(p.name)
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-brand-50"
              >
                <span className="truncate font-semibold text-ink-800">{p.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {/* cooperation category label — helps you tell client from vendor at a glance */}
                  {p.group_name && p.group_name !== '기타' ? (
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
                      {p.group_name}
                    </span>
                  ) : null}
                  {p.contact_person ? (
                    <span className="text-[11px] text-ink-400">{p.contact_person}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
          <li className="border-t border-ink-100 px-3 py-1.5">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                openQuickRegister('')
              }}
              className="w-full text-left text-[11px] font-semibold text-ink-500 hover:text-brand-700 hover:underline"
            >
              + 거래처 새로 등록 (이름만 넣어도 됩니다)
            </button>
          </li>
          {!exact && String(value || '').trim() ? (
            <li className="border-t border-ink-100 px-3 py-1.5">
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault()
                  openQuickRegister(String(value).trim())
                }}
                className="w-full text-left text-xs text-brand-700 hover:underline"
              >
                + ‘{String(value).trim()}’ 새로 등록
              </button>
            </li>
          ) : null}
          {ledgerSimilar.length || linked.length ? (
            <li className="border-t border-ink-100 px-3 py-1.5">
              <p className="mb-1 text-[10px] font-bold text-ink-400">장부에서 쓰던 비슷한 이름</p>
              {linked.length ? (
                <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-600">
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-700">연동됨</span>
                  <span className="min-w-0 flex-1 truncate">{linked.join(' · ')}</span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={runUnlink}
                    disabled={linkBusy}
                    className="shrink-0 font-bold text-ink-400 hover:underline disabled:opacity-50"
                  >
                    해제
                  </button>
                </p>
              ) : null}
              {ledgerSimilar.length ? (
                <div className="flex flex-wrap gap-1">
                  {ledgerSimilar.map(([name, count]) => (
                    <span
                      key={name}
                      className="flex items-center gap-1 rounded-full bg-ink-100 py-0.5 pl-2 pr-1 text-[11px] font-semibold text-ink-700"
                    >
                      <span className="max-w-[140px] truncate" title={`장부 ${count}건에서 이렇게 씀`}>
                        {name} · {count}건
                      </span>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => runLink(name)}
                        disabled={linkBusy}
                        title="두 표기를 연동합니다. 둘 다 장부에 남고 같은 곳으로 묶입니다."
                        className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
                      >
                        연동
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              {linkError ? <p className="mt-1 text-[11px] font-medium text-loss">{linkError}</p> : null}
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
              <button type="submit" form={quickFormId} className="btn-primary" disabled={regSaving}>
                {regSaving ? '저장 중…' : '등록'}
              </button>
            </>
          }
        >
          <form
            id={quickFormId}
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
