import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import EntryTable from '../components/EntryTable'
import { useToast } from '../components/Toast'
import { EmptyState, Field, InlineAlert, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { CATEGORIES, ENTRY_META } from '../lib/constants'
import { parseAmount, parseCSV } from '../lib/csv'
import { formatKRW } from '../lib/format'
import { createEntries, listEntries } from '../lib/api'

const TYPE_OPTIONS = ['purchase', 'opex']

function cellText(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/** 카드사 HTML 명세서(또는 .xls 위장 HTML)에서 가장 큰 표를 읽습니다. */
function parseHtmlTables(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const tables = [...doc.querySelectorAll('table')]
  let best = []
  for (const t of tables) {
    const rows = [...t.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('th, td')].map((c) => (c.textContent || '').trim()),
    ).filter((r) => r.some((v) => v !== ''))
    if (rows.length > best.length) best = rows
  }
  return best
}

async function parseFile(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.csv')) {
    const text = await file.text()
    return parseCSV(text)
  }
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  // HTML 위장 파일(.xls인데 내용이 표) sniff
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase()
  if (name.endsWith('.html') || name.endsWith('.htm') || head.startsWith('<')) {
    return parseHtmlTables(new TextDecoder('utf-8').decode(buf))
  }
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
  return (rows || []).map((r) => r.map(cellText)).filter((r) => r.some((v) => v !== ''))
}

function normDate(s) {
  const t = String(s ?? '').trim()
  if (!t) return ''
  let m = t.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/)
  if (m) {
    const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    return ''
  }
  m = t.match(/(\d{4})(\d{2})(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/(\d{1,2})[.\-/](\d{1,2})/)
  if (m) {
    const y = new Date().getFullYear()
    const mo = Number(m[1]); const d = Number(m[2])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  return ''
}

function splitVat(total) {
  const supply = Math.round(total / 1.1)
  return { supply, vat: total - supply }
}

const HEADER_KEYWORDS = {
  date: [/일자/, /이용일/, /매출일/, /승인일/, /거래일/, /날짜/, /date/i],
  merchant: [/가맹점/, /상호/, /이용처/, /거래처/, /가맹/, /상점/, /merchant/i],
  amount: [/이용금액/, /청구금액/, /합계/, /금액/, /이용대금/, /결제금액/, /amount/i],
  memo: [/적요/, /내역/, /비고/, /메모/, /내용/, /할부/],
}

function autoMap(headers) {
  const out = { date: -1, merchant: -1, amount: -1, memo: -1 }
  headers.forEach((h, i) => {
    const t = String(h || '')
    if (out.date < 0 && HEADER_KEYWORDS.date.some((re) => re.test(t))) out.date = i
    if (out.merchant < 0 && HEADER_KEYWORDS.merchant.some((re) => re.test(t))) out.merchant = i
    if (out.amount < 0 && HEADER_KEYWORDS.amount.some((re) => re.test(t))) out.amount = i
    if (out.memo < 0 && HEADER_KEYWORDS.memo.some((re) => re.test(t))) out.memo = i
  })
  return out
}

export default function CardImport() {
  const { user } = useAuth()
  const toast = useToast()
  const period = usePeriod('thisMonth', 'bzen.period.cards')

  const [fileName, setFileName] = useState('')
  const [rawRows, setRawRows] = useState([])
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState({ date: -1, merchant: -1, amount: -1, memo: -1 })
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState([])
  const [dupChecking, setDupChecking] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [bulkType, setBulkType] = useState('opex')
  const [bulkCategory, setBulkCategory] = useState('')

  const [registered, setRegistered] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const headers = useMemo(() => (hasHeader && rawRows.length ? rawRows[0] : []), [hasHeader, rawRows])
  const dataRows = useMemo(() => (hasHeader ? rawRows.slice(1) : rawRows), [hasHeader, rawRows])
  const colCount = useMemo(
    () => rawRows.reduce((n, r) => Math.max(n, r.length), 0),
    [rawRows],
  )
  const colLabels = useMemo(() => {
    const labels = []
    for (let i = 0; i < colCount; i += 1) {
      const h = headers[i]
      labels.push(h ? `${String.fromCharCode(65 + (i % 26))} · ${h}` : `열 ${String.fromCharCode(65 + (i % 26))}`)
    }
    return labels
  }, [colCount, headers])

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setParsing(true)
    try {
      const rows = await parseFile(file)
      if (!rows.length) throw new Error('파일에서 표를 찾지 못했습니다.')
      setFileName(file.name)
      setRawRows(rows)
      setMapping(autoMap(rows[0] || []))
      setHasHeader(true)
      setPreview([])
    } catch (err) {
      toast.error(err.message || '파일을 읽지 못했습니다.')
    } finally {
      setParsing(false)
    }
  }

  // 미리보기 생성 + 중복 검사
  useEffect(() => {
    if (!dataRows.length || mapping.date < 0 || mapping.merchant < 0 || mapping.amount < 0) {
      setPreview([])
      return
    }
    let cancelled = false
    setDupChecking(true)
    ;(async () => {
      const base = dataRows.map((r, i) => {
        const total = parseAmount(r[mapping.amount])
        const date = normDate(r[mapping.date])
        const merchant = cellText(r[mapping.merchant])
        const memo = mapping.memo >= 0 ? cellText(r[mapping.memo]) : ''
        const invalid = !date || !merchant || !Number.isFinite(total)
        const { supply, vat } = splitVat(total || 0)
        return {
          key: i,
          date,
          merchant,
          memo,
          total: total || 0,
          supply,
          vat,
          taxFree: false,
          type: 'opex',
          category: '',
          excluded: invalid,
          invalid,
          dup: false,
        }
      })
      const dates = base.map((r) => r.date).filter(Boolean).sort()
      let dupSet = new Set()
      if (dates.length) {
        try {
          const existing = await listEntries({ from: dates[0], to: dates[dates.length - 1], maxRows: 20000 })
          dupSet = new Set(
            existing.map((x) => `${x.entry_date}|${(x.counterparty || '').trim()}|${Number(x.total_amount || 0)}`),
          )
        } catch {
          /* 조회 실패해도 등록은 진행 */
        }
      }
      if (cancelled) return
      setPreview(
        base.map((r) => {
          const dup = !r.invalid && dupSet.has(`${r.date}|${r.merchant}|${r.total}`)
          return { ...r, dup, excluded: r.excluded || dup }
        }),
      )
      setDupChecking(false)
    })()
    return () => {
      cancelled = true
    }
  }, [dataRows, mapping])

  const setRow = (key, patch) => {
    setPreview((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const applyBulk = () => {
    setPreview((rows) =>
      rows.map((r) => {
        if (r.excluded || r.invalid) return r
        const next = { ...r, type: bulkType }
        if (bulkCategory) next.category = bulkCategory
        return next
      }),
    )
  }

  const active = useMemo(() => preview.filter((r) => !r.excluded && !r.invalid), [preview])
  const dupCount = useMemo(() => preview.filter((r) => r.dup).length, [preview])
  const activeTotal = useMemo(() => active.reduce((a, r) => a + r.total, 0), [active])

  const categories = useMemo(() => {
    const set = new Set()
    for (const t of TYPE_OPTIONS) for (const c of CATEGORIES[t] || []) set.add(c)
    return [...set].sort()
  }, [])

  const register = async () => {
    if (!active.length) {
      toast.info('등록할 내역이 없습니다.')
      return
    }
    setRegistering(true)
    try {
      const rows = active.map((r) => ({
        entry_type: r.type,
        source: 'card',
        entry_date: r.date,
        counterparty: r.merchant,
        category: r.category || '',
        description: r.memo || r.merchant,
        supply_amount: r.supply,
        vat_amount: r.vat,
        payment_method: '카드',
        memo: `법인카드 일괄등록${fileName ? ` (${fileName})` : ''}`,
        created_by: user?.id,
      }))
      await createEntries(rows)
      toast.success(`${rows.length}건이 등록되었습니다.`)
      setRawRows([])
      setPreview([])
      setFileName('')
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRegistering(false)
    }
  }

  const loadRegistered = useCallback(async () => {
    setLoadingList(true)
    try {
      setRegistered(await listEntries({ from: period.range.from, to: period.range.to, source: 'card' }))
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoadingList(false)
    }
  }, [period.range.from, period.range.to, toast])

  useEffect(() => {
    loadRegistered()
  }, [loadRegistered, reloadKey])

  const mapSelect = (key, label) => (
    <Field label={label}>
      <select
        className="input"
        value={mapping[key]}
        onChange={(e) => setMapping((m) => ({ ...m, [key]: Number(e.target.value) }))}
      >
        <option value={-1}>선택 안 함</option>
        {colLabels.map((name, i) => (
          <option key={i} value={i}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="법인카드" description="카드사 이용내역 파일을 올려 장부에 일괄 등록합니다." />

      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-primary cursor-pointer">
            <Icon name="upload" size={16} />
            {parsing ? '읽는 중…' : '이용내역 파일 선택'}
            <input
              type="file"
              accept=".csv,.xls,.xlsx,.html,.htm"
              className="hidden"
              disabled={parsing}
              onChange={handleFile}
            />
          </label>
          {fileName ? <span className="text-xs font-medium text-ink-500">{fileName}</span> : null}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          카드사 홈페이지에서 받은 HTML·엑셀·CSV 파일을 그대로 올리세요. 금액은 부가세 포함 합계로 보고
          공급가액/부가세를 자동 분리합니다(행별로 수정 가능). 이미 장부에 있는 내역은 중복으로 표시해
          자동 제외합니다.
        </p>

        {rawRows.length ? (
          <div className="mt-4 border-t border-ink-100 pt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {mapSelect('date', '이용일자 열 (필수)')}
              {mapSelect('merchant', '가맹점 열 (필수)')}
              {mapSelect('amount', '이용금액 열 (필수)')}
              {mapSelect('memo', '적요·메모 열 (선택)')}
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
              />
              첫 행이 제목 행입니다
            </label>
          </div>
        ) : null}
      </div>

      {rawRows.length && mapping.date >= 0 && mapping.merchant >= 0 && mapping.amount >= 0 ? (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-ink-200 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" value={bulkType} onChange={(e) => setBulkType(e.target.value)}>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t === 'purchase' ? '매입으로' : '운영비로'}
                  </option>
                ))}
              </select>
              <select
                className="input w-auto"
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
              >
                <option value="">항목 유지</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-ghost" onClick={applyBulk}>
                일괄 적용
              </button>
              <span className="ml-auto text-xs font-medium text-ink-500">
                등록 {active.length}건 · 합계 {formatKRW(activeTotal)}원
                {dupCount ? ` · 중복 ${dupCount}건 제외` : ''}
                {dupChecking ? ' · 중복 확인 중…' : ''}
              </span>
              <button
                type="button"
                className="btn-primary"
                onClick={register}
                disabled={registering || !active.length}
              >
                {registering ? '등록 중…' : `${active.length}건 등록`}
              </button>
            </div>
          </div>

          <div className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead className="sticky top-0 bg-ink-50">
                <tr>
                  <th className="th w-10">등록</th>
                  <th className="th">이용일자</th>
                  <th className="th">가맹점</th>
                  <th className="th">유형</th>
                  <th className="th">항목</th>
                  <th className="th text-right">공급가액</th>
                  <th className="th text-right">부가세</th>
                  <th className="th">면세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {preview.map((r) => (
                  <tr key={r.key} className={r.excluded ? 'bg-ink-50/60 text-ink-400' : 'hover:bg-ink-50/60'}>
                    <td className="td text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        checked={!r.excluded}
                        onChange={(e) => setRow(r.key, { excluded: !e.target.checked })}
                      />
                    </td>
                    <td className="td">
                      <input
                        type="date"
                        className="input w-auto py-1 text-xs"
                        value={r.date}
                        onChange={(e) => setRow(r.key, { date: e.target.value, invalid: !e.target.value })}
                      />
                    </td>
                    <td className="td max-w-[180px]">
                      <input
                        className="input py-1 text-xs"
                        value={r.merchant}
                        onChange={(e) => setRow(r.key, { merchant: e.target.value })}
                      />
                      {r.dup ? (
                        <span className="chip mt-1 bg-amber-50 text-amber-700">중복 의심</span>
                      ) : null}
                      {r.invalid ? <span className="chip mt-1 bg-rose-50 text-loss">확인 필요</span> : null}
                      {r.total < 0 ? <span className="chip mt-1 bg-ink-100 text-ink-500">취소·환불</span> : null}
                    </td>
                    <td className="td">
                      <select
                        className="input w-auto py-1 text-xs"
                        value={r.type}
                        onChange={(e) => setRow(r.key, { type: e.target.value, category: '' })}
                      >
                        <option value="purchase">매입</option>
                        <option value="opex">운영비</option>
                      </select>
                    </td>
                    <td className="td">
                      <select
                        className="input w-auto py-1 text-xs"
                        value={r.category}
                        onChange={(e) => setRow(r.key, { category: e.target.value })}
                      >
                        <option value="">미분류</option>
                        {(CATEGORIES[r.type] || []).map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="td num">
                      <input
                        type="number"
                        className="input w-28 py-1 text-right text-xs"
                        value={r.supply}
                        onChange={(e) => {
                          const supply = Number(e.target.value) || 0
                          setRow(r.key, r.taxFree ? { supply, vat: 0 } : { supply, vat: r.total - supply })
                        }}
                      />
                    </td>
                    <td className="td num">
                      <input
                        type="number"
                        className="input w-24 py-1 text-right text-xs"
                        value={r.vat}
                        disabled={r.taxFree}
                        onChange={(e) => {
                          const vat = Number(e.target.value) || 0
                          setRow(r.key, { vat, supply: r.total - vat })
                        }}
                      />
                    </td>
                    <td className="td text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        checked={r.taxFree}
                        onChange={(e) => {
                          const taxFree = e.target.checked
                          setRow(r.key, taxFree ? { taxFree, supply: r.total, vat: 0 } : { taxFree })
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : rawRows.length ? (
        <InlineAlert tone="info">이용일자·가맹점·이용금액 열을 지정하면 미리보기가 나타납니다.</InlineAlert>
      ) : null}

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-ink-900">등록된 카드 내역</h2>
            <p className="mt-0.5 text-xs text-ink-500">{period.range.label} · 수정·삭제는 각 장부에서</p>
          </div>
          <PeriodPicker period={period} />
        </header>
        {loadingList ? (
          <LoadingBlock />
        ) : registered.length ? (
          <EntryTable entries={registered} projects={[]} profiles={[]} attachmentsByEntry={{}} showType canEdit={false} />
        ) : (
          <EmptyState
            icon="card"
            title="등록된 카드 내역이 없습니다"
            description="위에서 이용내역 파일을 올려 등록해 보세요."
          />
        )}
      </section>

      <p className="text-center text-xs leading-relaxed text-ink-400">
        {ENTRY_META.purchase.label}·{ENTRY_META.opex.label}로 나뉘어 각 장부에 저장됩니다.
        할부 건은 전체 금액으로 한 번에 등록되니 나눠야 하면 행을 수정해 주세요.
      </p>
    </div>
  )
}
