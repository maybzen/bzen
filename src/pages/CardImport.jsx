import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import { AttachmentCell, AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, Field, InlineAlert, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { CATEGORIES, ENTRY_META } from '../lib/constants'
import { parseAmount, parseCSV } from '../lib/csv'
import { formatKRW, toISODate } from '../lib/format'
import {
  createEntries,
  deleteEntry,
  listAttachments,
  listEntries,
  listProfiles,
  listProjects,
  updateEntry,
} from '../lib/api'

const TYPE_OPTIONS = ['purchase', 'opex']

/** 카드사 프리셋: 파일 양식에 맞는 열 지정 */
const COMPANY_PRESETS = {
  auto: { label: '자동 감지', cardLabel: '' },
  busan: {
    label: '부산은행 2381 (직원용)',
    cardLabel: '법카 2381',
    mapping: { date: 1, merchant: 11, amount: 9, memo: -1, currency: -1, foreign: -1, fee: 6, payable: 7 },
  },
  woori: {
    label: '우리은행 3842 (대표님용)',
    cardLabel: '법카 3842',
    // 제목행 자동 탐색 + 아래 열 사용 (외화 3종은 국내분 기준 최유력 위치)
    mapping: { date: 0, merchant: 8, amount: 9, memo: -1, currency: -1, foreign: 15, fee: -1, payable: 16 },
  },
}

/** 제목·반복 헤더 행 판별 (우리은행처럼 중간에 제목이 반복되는 양식용) */
function isTitleRow(cells) {
  const text = cells.join(' ')
  return /이용일자|가맹점|당월결제|청구합계|이용대금 상세내역|법인카드|원금|수수료|납부하실/.test(text)
}

function detectCompany(rows) {
  const head = rows.slice(0, 30).map((r) => r.join(' ')).join('\n')
  if (/청구합계/.test(head)) return 'busan'
  if (/이용가맹점/.test(head)) return 'woori'
  return 'auto'
}

function findHeaderRow(rows) {
  const i = rows.findIndex((r) => /이용가맹점/.test(r.join(' ')))
  return i >= 0 ? i : 0
}

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
  currency: [/통화/, /통화코드/, /currency/i],
  foreign: [/현지/, /현지금액/, /외화/, /local/i],
  fee: [/수수료/, /fee/i],
  payable: [/납부/, /청구예정/, /결제예정/, /payable/i],
}

function autoMap(headers) {
  const out = { date: -1, merchant: -1, amount: -1, memo: -1, currency: -1, foreign: -1, fee: -1, payable: -1 }
  const keys = Object.keys(HEADER_KEYWORDS)
  headers.forEach((h, i) => {
    const t = String(h || '')
    for (const key of keys) {
      if (out[key] < 0 && HEADER_KEYWORDS[key].some((re) => re.test(t))) out[key] = i
    }
  })
  return out
}

/** 외화 표기: USD 12.99 */
function fmtFx(currency, amount) {
  if (!amount) return ''
  const n = Number(amount) || 0
  return `${currency || ''} ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim()
}

export default function CardImport() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const period = usePeriod('thisMonth', 'bzen.period.cards')

  const [fileName, setFileName] = useState('')
  const [rawRows, setRawRows] = useState([])
  const [hasHeader, setHasHeader] = useState(true)
  const [headerRow, setHeaderRow] = useState(0)
  const [company, setCompany] = useState('auto')
  const [cardLabel, setCardLabel] = useState('')
  const [mapping, setMapping] = useState({ date: -1, merchant: -1, amount: -1, memo: -1, currency: -1, foreign: -1, fee: -1, payable: -1 })
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState([])
  const [skippedTitles, setSkippedTitles] = useState(0)
  const [dupChecking, setDupChecking] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [bulkType, setBulkType] = useState('opex')
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkProject, setBulkProject] = useState('')
  const [projects, setProjects] = useState([])

  const [registered, setRegistered] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [regProjects, setRegProjects] = useState([])
  const [regProfiles, setRegProfiles] = useState([])
  const [regAttachments, setRegAttachments] = useState({})
  const [rowEdits, setRowEdits] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewerFiles, setViewerFiles] = useState(null)

  const setCell = (id, patch) => {
    setRowEdits((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } }))
  }

  const cancelRow = (id) => {
    setRowEdits((m) => {
      const next = { ...m }
      delete next[id]
      return next
    })
  }

  const memoUser = (memo) => {
    const m = String(memo || '').match(/이용자\s+([^·]+)/)
    return m ? m[1].trim() : ''
  }

  const withMemoUser = (memo, user) => {
    const base = String(memo || '').replace(/\s*·\s*이용자\s+[^·]*/, '').trim()
    const u = String(user || '').trim()
    return u ? `${base} · 이용자 ${u}` : base
  }

  const saveRow = async (entry) => {
    const patch = rowEdits[entry.id]
    if (!patch) return
    const work = { ...entry, ...patch }
    if (!work.entry_date || !String(work.counterparty || '').trim()) {
      toast.error('이용일자와 가맹점을 입력해 주세요.')
      return
    }
    setSavingId(entry.id)
    try {
      const payload = {
        entry_date: work.entry_date,
        counterparty: String(work.counterparty).trim(),
        project_id: work.project_id || null,
        entry_type: work.entry_type,
        category: work.category || '',
        supply_amount: Number(work.supply_amount) || 0,
        vat_amount: Number(work.vat_amount) || 0,
        memo: withMemoUser(entry.memo, patch.cardUser !== undefined ? patch.cardUser : memoUser(entry.memo)),
      }
      const saved = await updateEntry(entry.id, payload)
      setRegistered((rows) => rows.map((r) => (r.id === entry.id ? { ...r, ...saved } : r)))
      cancelRow(entry.id)
      toast.success('저장되었습니다.')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSavingId(null)
    }
  }

  const headers = useMemo(
    () => (hasHeader ? rawRows[headerRow] || [] : []),
    [hasHeader, headerRow, rawRows],
  )
  const dataRows = useMemo(
    () => (hasHeader ? rawRows.slice(headerRow + 1) : rawRows),
    [hasHeader, headerRow, rawRows],
  )
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
      const detected = detectCompany(rows)
      const preset = COMPANY_PRESETS[detected]
      setFileName(file.name)
      setRawRows(rows)
      setCompany(detected)
      setCardLabel(preset.cardLabel)
      if (detected === 'woori') {
        const hr = findHeaderRow(rows)
        setHeaderRow(hr)
        setMapping({ ...preset.mapping })
      } else if (preset.mapping) {
        setHeaderRow(0)
        setMapping({ ...preset.mapping })
      } else {
        setHeaderRow(0)
        setMapping(autoMap(rows[0] || []))
      }
      setHasHeader(true)
      setPreview([])
      setSkippedTitles(0)
    } catch (err) {
      toast.error(err.message || '파일을 읽지 못했습니다.')
    } finally {
      setParsing(false)
    }
  }

  const applyCompany = (key) => {
    setCompany(key)
    const preset = COMPANY_PRESETS[key]
    if (preset.mapping) {
      if (key === 'woori') setHeaderRow(findHeaderRow(rawRows))
      else setHeaderRow(0)
      setMapping({ ...preset.mapping })
      setCardLabel(preset.cardLabel)
    } else {
      setHeaderRow(0)
      setMapping(autoMap(rawRows[0] || []))
      setCardLabel('')
    }
  }

  // 미리보기 생성 + 중복 검사 + 지난 분류 기억
  useEffect(() => {
    if (!dataRows.length || mapping.date < 0 || mapping.merchant < 0 || mapping.amount < 0) {
      setPreview([])
      return
    }
    let cancelled = false
    setDupChecking(true)
    ;(async () => {
      // 제목·반복 헤더 행은 조용히 제외 (우리은행처럼 중간에 제목이 반복되는 양식)
      const bodyRows = []
      let skipped = 0
      for (const r of dataRows) {
        if (isTitleRow(r) && !normDate(r[mapping.date])) {
          skipped += 1
          continue
        }
        bodyRows.push(r)
      }
      setSkippedTitles(skipped)
      const base = bodyRows.map((r, i) => {
        const payable = mapping.payable >= 0 ? parseAmount(r[mapping.payable]) : 0
        const total = payable > 0 ? payable : parseAmount(r[mapping.amount])
        const date = normDate(r[mapping.date])
        const merchant = cellText(r[mapping.merchant])
        const memo = mapping.memo >= 0 ? cellText(r[mapping.memo]) : ''
        const fxCurrency = mapping.currency >= 0 ? cellText(r[mapping.currency]).toUpperCase() : ''
        const fxAmount = mapping.foreign >= 0 ? Number(String(r[mapping.foreign] ?? '').replace(/[^0-9.-]/g, '')) || 0 : 0
        const fxFee = mapping.fee >= 0 ? parseAmount(r[mapping.fee]) : 0
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
          projectId: '',
          cardUser: '',
          fxCurrency,
          fxAmount,
          fxFee,
          autoFilled: false,
          excluded: invalid,
          invalid,
          dup: false,
        }
      })
      const dates = base.map((r) => r.date).filter(Boolean).sort()
      let dupSet = new Set()
      let merchantMap = new Map()
      if (dates.length) {
        try {
          const [existing, history] = await Promise.all([
            listEntries({ from: dates[0], to: dates[dates.length - 1], maxRows: 20000 }),
            listEntries({
              from: toISODate(new Date(new Date().setMonth(new Date().getMonth() - 6))),
              to: toISODate(new Date()),
              maxRows: 5000,
            }).catch(() => []),
          ])
          dupSet = new Set(
            existing.map((x) => `${x.entry_date}|${(x.counterparty || '').trim()}|${Number(x.total_amount || 0)}`),
          )
          // 최근 6개월: 같은 거래처의 마지막 분류를 기억 (최신순이므로 먼저 나온 것이 우선)
          for (const x of history || []) {
            const name = (x.counterparty || '').trim()
            if (name && !merchantMap.has(name) && (x.entry_type === 'purchase' || x.entry_type === 'opex')) {
              merchantMap.set(name, { type: x.entry_type, category: x.category || '' })
            }
          }
        } catch {
          /* 조회 실패해도 등록은 진행 */
        }
      }
      if (cancelled) return
      setPreview(
        base.map((r) => {
          const dup = !r.invalid && dupSet.has(`${r.date}|${r.merchant}|${r.total}`)
          const remembered = !r.invalid ? merchantMap.get(r.merchant) : null
          return {
            ...r,
            dup,
            excluded: r.excluded || dup,
            ...(remembered ? { type: remembered.type, category: remembered.category, autoFilled: true } : null),
          }
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
        if (bulkProject) next.projectId = bulkProject
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
      const rows = active.map((r) => {
        const fxNote = r.fxAmount > 0 ? ` (${fmtFx(r.fxCurrency, r.fxAmount)})` : ''
        const feeNote = r.fxFee > 0 ? ` · 해외수수료 ${formatKRW(r.fxFee)}원` : ''
        const cardNote = cardLabel ? ` · ${cardLabel}` : ''
        const userNote = r.cardUser.trim() ? ` · 이용자 ${r.cardUser.trim()}` : ''
        return {
          entry_type: r.type,
          source: 'card',
          entry_date: r.date,
          counterparty: r.merchant,
          category: r.category || '',
          description: `${r.memo || r.merchant}${fxNote}`,
          supply_amount: r.supply,
          vat_amount: r.vat,
          payment_method: '카드',
          memo: `법인카드 일괄등록${fileName ? ` (${fileName})` : ''}${feeNote}${cardNote}${userNote}`,
          project_id: r.projectId || null,
          fx_currency: r.fxCurrency || '',
          fx_amount: r.fxAmount || 0,
          fx_fee: r.fxFee || 0,
          created_by: user?.id,
        }
      })
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
      const [cardRows, projectRows, profileRows] = await Promise.all([
        listEntries({ from: period.range.from, to: period.range.to, source: 'card' }),
        listProjects().catch(() => []),
        listProfiles().catch(() => []),
      ])
      setRegistered(cardRows)
      setProjects(projectRows || [])
      setRegProjects(projectRows || [])
      setRegProfiles(profileRows || [])
      const files = await listAttachments(cardRows.map((r) => r.id)).catch(() => [])
      const map = {}
      for (const file of files || []) {
        if (!map[file.entry_id]) map[file.entry_id] = []
        map[file.entry_id].push(file)
      }
      setRegAttachments(map)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoadingList(false)
    }
  }, [period.range.from, period.range.to, toast])

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deleteEntry(removing.id)
      toast.success('삭제되었습니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

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
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="카드 선택">
                <select className="input" value={company} onChange={(e) => applyCompany(e.target.value)}>
                  {Object.entries(COMPANY_PRESETS).map(([key, p]) => (
                    <option key={key} value={key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="self-end pb-2 text-xs text-ink-500">
                이용자는 아래 목록에서 행별로 입력합니다. 메모에 함께 남습니다.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {mapSelect('date', '이용일자 열 (필수)')}
              {mapSelect('merchant', '가맹점 열 (필수)')}
              {mapSelect('amount', '이용금액 열 (필수)')}
              {mapSelect('memo', '적요·메모 열 (선택)')}
              {mapSelect('payable', '납부하실금액 열 (선택)')}
              {mapSelect('currency', '통화 열 (선택)')}
              {mapSelect('foreign', '현지금액 열 (선택)')}
              {mapSelect('fee', '수수료 열 (선택)')}
            </div>
            <p className="mt-2 text-xs text-ink-500">
              해외 이용분은 납부하실금액(원화)이 있으면 그 금액으로, 없으면 이용금액으로 등록됩니다.
            </p>
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
              <select
                className="input w-auto"
                value={bulkProject}
                onChange={(e) => setBulkProject(e.target.value)}
              >
                <option value="">프로젝트 유지</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-ghost" onClick={applyBulk}>
                일괄 적용
              </button>
              <span className="ml-auto text-xs font-medium text-ink-500">
                등록 {active.length}건 · 합계 {formatKRW(activeTotal)}원
                {dupCount ? ` · 중복 ${dupCount}건 제외` : ''}
                {skippedTitles ? ` · 제목행 ${skippedTitles}건 제외` : ''}
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
            <table className="w-full min-w-[1060px] border-collapse text-xs">
              <thead className="sticky top-0 bg-ink-50">
                <tr>
                  <th className="th w-10">등록</th>
                  <th className="th">이용일자</th>
                  <th className="th">가맹점</th>
                  <th className="th">외화</th>
                  <th className="th">프로젝트</th>
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
                      {r.autoFilled ? (
                        <span className="chip mt-1 bg-brand-50 text-brand-700">지난 분류 적용</span>
                      ) : null}
                      {r.dup ? (
                        <span className="chip mt-1 bg-amber-50 text-amber-700">중복 의심</span>
                      ) : null}
                      {r.invalid ? <span className="chip mt-1 bg-rose-50 text-loss">확인 필요</span> : null}
                      {r.total < 0 ? <span className="chip mt-1 bg-ink-100 text-ink-500">취소·환불</span> : null}
                    </td>
                    <td className="td whitespace-nowrap text-xs text-ink-600">
                      {r.fxAmount > 0 ? fmtFx(r.fxCurrency, r.fxAmount) : <span className="text-ink-300">—</span>}
                    </td>
                    <td className="td">
                      <select
                        className="input w-auto py-1 text-xs"
                        value={r.projectId}
                        onChange={(e) => setRow(r.key, { projectId: e.target.value })}
                      >
                        <option value="">미지정</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="td">
                      <input
                        className="input w-20 py-1 text-xs"
                        value={r.cardUser}
                        onChange={(e) => setRow(r.key, { cardUser: e.target.value })}
                        placeholder="ALL"
                      />
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
          {(() => {
            const excluded = preview.filter((r) => r.excluded)
            if (!excluded.length) return null
            const sum = excluded.reduce((a, r) => a + (r.total || 0), 0)
            return (
              <div className="border-t border-ink-100 px-4 py-3">
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-ink-600 hover:text-ink-900">
                    제외된 {excluded.length}건 보기 (합계 {formatKRW(sum)}원)
                  </summary>
                  <ul className="mt-2 flex max-h-56 flex-col gap-1.5 overflow-auto">
                    {excluded.map((r) => (
                      <li
                        key={r.key}
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-ink-50 px-3 py-2 text-xs"
                      >
                        <span className="font-semibold text-ink-800">
                          {r.date || '(날짜 없음)'} · {r.merchant || '(가맹점 없음)'}
                        </span>
                        <span className="font-num tabular-nums text-ink-600">{formatKRW(r.total)}원</span>
                        {r.dup ? (
                          <span className="chip bg-amber-50 text-amber-700">중복 의심 — 장부에 이미 있음</span>
                        ) : r.invalid ? (
                          <span className="chip bg-rose-50 text-loss">날짜·가맹점·금액 확인 필요</span>
                        ) : (
                          <span className="chip bg-ink-100 text-ink-500">직접 제외 — 체크하면 등록됨</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )
          })()}
        </div>
      ) : rawRows.length ? (
        <InlineAlert tone="info">이용일자·가맹점·이용금액 열을 지정하면 미리보기가 나타납니다.</InlineAlert>
      ) : null}

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
          <div>
            <h2 className="text-sm font-bold text-ink-900">등록된 카드 내역</h2>
            <p className="mt-0.5 text-xs text-ink-500">{period.range.label} · 바로 수정할 수 있습니다</p>
          </div>
          <PeriodPicker period={period} />
        </header>
        {loadingList ? (
          <LoadingBlock />
        ) : registered.length ? (
          <>
            <div className="grid grid-cols-2 gap-3 border-b border-ink-200 px-4 py-3.5 lg:grid-cols-4">
              <StatCard label="등록 건수" value={String(registered.length)} unit="건" tone="neutral" icon="card" />
              <StatCard
                label="합계"
                value={registered.reduce((a, e) => a + Number(e.total_amount || 0), 0)}
                tone="neutral"
                icon="coins"
              />
              {(() => {
                const map = new Map()
                for (const e of registered) {
                  const m = String(e.memo || '').match(/법카\s*([\d-]+)/)
                  const label = m ? `법카 ${m[1]}` : '기타'
                  if (!map.has(label)) map.set(label, { label, count: 0, total: 0 })
                  const row = map.get(label)
                  row.count += 1
                  row.total += Number(e.total_amount || 0)
                }
                return [...map.values()]
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 2)
                  .map((c) => (
                    <StatCard
                      key={c.label}
                      label={c.label}
                      value={c.total}
                      tone="neutral"
                      icon="receipt"
                      hint={`${c.count}건`}
                    />
                  ))
              })()}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-xs">
                <thead className="bg-ink-50/70">
                  <tr>
                    <th className="th">이용일자</th>
                    <th className="th">가맹점</th>
                    <th className="th">프로젝트</th>
                    <th className="th">유형</th>
                    <th className="th">항목</th>
                    <th className="th">이용자</th>
                    <th className="th text-right">공급가액</th>
                    <th className="th text-right">부가세</th>
                    <th className="th text-right">합계</th>
                    <th className="th text-right">서류</th>
                    <th className="th text-right">저장</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {registered.map((entry) => {
                    const edit = rowEdits[entry.id] || {}
                    const work = { ...entry, ...edit }
                    const dirty = Object.keys(edit).length > 0
                    const saving = savingId === entry.id
                    const cardUser =
                      edit.cardUser !== undefined ? edit.cardUser : memoUser(entry.memo)
                    return (
                      <tr key={entry.id} className={dirty ? 'bg-brand-50/40' : undefined}>
                        <td className="td">
                          <input
                            type="date"
                            className="input w-auto py-1 text-xs"
                            value={work.entry_date || ''}
                            onChange={(e) => setCell(entry.id, { entry_date: e.target.value })}
                          />
                        </td>
                        <td className="td min-w-[140px]">
                          <input
                            className="input py-1 text-xs"
                            value={work.counterparty || ''}
                            onChange={(e) => setCell(entry.id, { counterparty: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <select
                            className="input w-auto py-1 text-xs"
                            value={work.project_id || ''}
                            onChange={(e) => setCell(entry.id, { project_id: e.target.value })}
                          >
                            <option value="">미지정</option>
                            {regProjects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="td">
                          <select
                            className="input w-auto py-1 text-xs"
                            value={work.entry_type}
                            onChange={(e) => setCell(entry.id, { entry_type: e.target.value, category: '' })}
                          >
                            <option value="purchase">매입</option>
                            <option value="opex">운영비</option>
                          </select>
                        </td>
                        <td className="td">
                          <select
                            className="input w-auto py-1 text-xs"
                            value={work.category || ''}
                            onChange={(e) => setCell(entry.id, { category: e.target.value })}
                          >
                            <option value="">미분류</option>
                            {(CATEGORIES[work.entry_type] || []).map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="td">
                          <input
                            className="input w-20 py-1 text-xs"
                            value={cardUser}
                            onChange={(e) => setCell(entry.id, { cardUser: e.target.value })}
                            placeholder="ALL"
                          />
                        </td>
                        <td className="td num">
                          <input
                            type="number"
                            className="input w-24 py-1 text-right text-xs"
                            value={work.supply_amount ?? 0}
                            onChange={(e) => setCell(entry.id, { supply_amount: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="td num">
                          <input
                            type="number"
                            className="input w-24 py-1 text-right text-xs"
                            value={work.vat_amount ?? 0}
                            onChange={(e) => setCell(entry.id, { vat_amount: Number(e.target.value) || 0 })}
                          />
                        </td>
                        <td className="td num font-semibold">
                          {formatKRW(Number(work.supply_amount || 0) + Number(work.vat_amount || 0))}
                        </td>
                        <td className="td num">
                          <AttachmentCell
                            attachments={regAttachments[entry.id] || []}
                            onOpen={setViewerFiles}
                          />
                        </td>
                        <td className="td num whitespace-nowrap">
                          {dirty ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveRow(entry)}
                                disabled={saving}
                                className="mr-2 text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                              >
                                {saving ? '저장 중' : '저장'}
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelRow(entry.id)}
                                disabled={saving}
                                className="text-xs font-semibold text-ink-400 hover:underline disabled:opacity-50"
                              >
                                취소
                              </button>
                            </>
                          ) : isAdmin ? (
                            <button
                              type="button"
                              onClick={() => setRemoving(entry)}
                              className="text-xs font-semibold text-loss hover:underline"
                            >
                              삭제
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState
            icon="card"
            title="등록된 카드 내역이 없습니다"
            description="위에서 이용내역 파일을 올려 등록해 보세요."
          />
        )}
      </section>

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="카드 내역을 삭제하시겠습니까?"
        message={
          removing
            ? `${removing.entry_date} · ${removing.description || removing.counterparty || '내용 없음'} (${formatKRW(
                removing.total_amount,
              )}원)\n삭제하면 되돌릴 수 없습니다.`
            : ''
        }
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />

      <AttachmentModal
        open={Boolean(viewerFiles)}
        onClose={() => setViewerFiles(null)}
        attachments={viewerFiles || []}
      />

      <p className="text-center text-xs leading-relaxed text-ink-400">
        {ENTRY_META.purchase.label}·{ENTRY_META.opex.label}로 나뉘어 각 장부에 저장됩니다.
        할부 건은 전체 금액으로 한 번에 등록되니 나눠야 하면 행을 수정해 주세요.
      </p>
    </div>
  )
}
