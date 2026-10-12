import { useState } from 'react'
import Icon from './Icon'
import { useToast } from './Toast'
import { Field, InlineAlert, Spinner } from './ui'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/format'

/**
 * 전체 백업 (관리자 전용).
 * 주요 테이블을 엑셀(.xlsx) 시트별로 내려받습니다. 기간을 정하면 날짜가 있는
 * 시트(장부·수금·휴무·명세서)만 그 범위로 자르고, 나머지는 전체를 담습니다.
 * 첨부파일 원본(이미지·PDF)은 제외되고 목록만 포함됩니다.
 */

const TABLES = [
  { key: 'entries', label: '장부', dateKey: 'entry_date' },
  { key: 'projects', label: '프로젝트' },
  { key: 'collections', label: '수금', dateKey: 'collected_on' },
  { key: 'leave_entries', label: '휴무', dateKey: 'entry_date' },
  { key: 'payroll_slips', label: '급여명세서', dateKey: 'ym', month: true },
  { key: 'profiles', label: '구성원계정' },
  { key: 'external_members', label: '외부인력' },
  { key: 'counterparties', label: '거래처' },
  { key: 'partner_contacts', label: '거래처담당자' },
  { key: 'project_partners', label: '프로젝트거래처연결' },
  { key: 'fund_accounts', label: '자금계좌' },
  { key: 'fund_loans', label: '자금대출' },
  { key: 'fund_cards', label: '자금카드' },
  { key: 'fund_snapshots', label: '자금잔고기록' },
  { key: 'card_bills', label: '카드청구서' },
  { key: 'bank_transactions', label: '통장내역' },
  { key: 'attachments', label: '첨부목록' },
  { key: 'checklist_items', label: '체크리스트' },
]

async function fetchAll(table) {
  const out = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
    from += 1000
    if (from > 200000) break
  }
  return out
}

function inRange(row, def, from, to) {
  if (!def.dateKey || (!from && !to)) return true
  const raw = String(row?.[def.dateKey] || '')
  if (!raw) return false
  const v = def.month ? raw.slice(0, 7) : raw.slice(0, 10)
  const f = def.month ? String(from || '').slice(0, 7) : from
  const t = def.month ? String(to || '').slice(0, 7) : to
  if (f && v < f) return false
  if (t && v > t) return false
  return true
}

/* 중첩 객체는 문자열로 풀어서 시트에 넣습니다 */
function flatten(rows) {
  return (rows || []).map((r) => {
    const o = {}
    for (const [k, v] of Object.entries(r || {})) {
      o[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
    }
    return o
  })
}

export default function BackupPanel() {
  const toast = useToast()
  const [checked, setChecked] = useState(() => TABLES.map((t) => t.key))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const toggle = (key) => {
    setChecked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }
  const toggleAll = () => {
    setChecked((prev) => (prev.length === TABLES.length ? [] : TABLES.map((t) => t.key)))
  }

  const run = async () => {
    const defs = TABLES.filter((t) => checked.includes(t.key))
    if (!defs.length) {
      toast.error('백업할 시트를 1개 이상 선택해 주세요.')
      return
    }
    if (from && to && from > to) {
      toast.error('시작일이 종료일보다 늦습니다.')
      return
    }
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const skipped = []
      for (const def of defs) {
        setStatus(`${def.label} 읽는 중…`)
        try {
          // eslint-disable-next-line no-await-in-loop
          const rows = await fetchAll(def.key)
          const kept = rows.filter((r) => inRange(r, def, from, to))
          const ws = XLSX.utils.json_to_sheet(flatten(kept))
          XLSX.utils.book_append_sheet(wb, ws, def.label.slice(0, 28))
        } catch (err) {
          skipped.push(`${def.label} (${err?.message || '조회 실패'})`)
        }
      }
      const stamp = todayISO().replaceAll('-', '')
      const range = from || to ? `_${from || '시작'}-${to || '현재'}` : '_전체'
      XLSX.writeFile(wb, `비젠백업${range}_${stamp}.xlsx`)
      setStatus('')
      if (skipped.length) {
        toast.error(`일부 시트 제외됨: ${skipped.join(', ')}`)
      } else {
        toast.success(`${defs.length}개 시트를 백업했습니다.`)
      }
    } catch (err) {
      setStatus('')
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="시작일" hint="비우면 처음부터">
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="종료일" hint="비우면 오늘까지">
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-ink-500">시트 선택 ({checked.length}/{TABLES.length})</p>
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-bold text-brand-700 hover:underline"
          >
            {checked.length === TABLES.length ? '전체 해제' : '전체 선택'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TABLES.map((t) => (
            <label
              key={t.key}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-800 transition hover:bg-ink-50/60"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={checked.includes(t.key)}
                onChange={() => toggle(t.key)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>
      {status ? <p className="text-xs text-ink-500">{status}</p> : null}
      <InlineAlert tone="info">
        날짜가 있는 시트(장부·수금·휴무·명세서)만 기간이 적용됩니다. 첨부파일 원본은 제외되고 목록만
        담깁니다.
      </InlineAlert>
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={run} disabled={busy}>
          {busy ? <Spinner size={15} /> : <Icon name="download" size={15} />}
          {busy ? '백업 중…' : '엑셀로 내려받기'}
        </button>
      </div>
    </div>
  )
}
