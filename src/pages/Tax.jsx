import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { AmountInput, Field, InlineAlert, LoadingBlock, Modal, PageHeader } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { useStaffPermissions } from '../lib/permissions'
import { listAttachments, listEntries, uploadAttachment } from '../lib/api'
import { downloadTextFile, toCSV } from '../lib/csv'
import { formatKRW, todayISO } from '../lib/format'
import {
  TAX_PAYMENT_TYPES,
  deadlinePaymentKey,
  listTaxPayments,
  newPaymentKey,
  paymentDiff,
  paymentMap,
  removeTaxPayment,
  saveTaxPayment,
  taxPaymentType,
  vatPaymentKey,
} from '../lib/taxPayments'
import {
  TAX_DOCS,
  TAX_TYPES,
  buildTaxCalendar,
  checkProgress,
  dDayLabel,
  dayDiff,
  getUpcoming,
  isDone,
  isPrior,
  loadTaxState,
  saveTaxState,
  setTaxDone,
  toggleTaxCheck,
  vatEstimateByFiling,
  withholdingPaidByMonth,
} from '../lib/tax'

const FILTER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'vat', label: '부가세' },
  { key: 'withholding', label: '원천세+지방(매월)' },
  { key: 'insurance', label: '4대보험' },
  { key: 'corp', label: '법인세+지방(연1회)' },
]

function matchTaxFilter(deadline, filter) {
  if (filter === 'all') return true
  if (filter === 'corp') return deadline.type === 'corporate' || deadline.type === 'local'
  return deadline.type === filter
}

function statusChip(deadline, state, today) {  if (isPrior(deadline.due)) {
    return <span className="chip bg-ink-100 text-ink-400">이전 담당</span>
  }
  if (isDone(state, deadline.id)) {
    return <span className="chip bg-emerald-50 text-emerald-700">완료</span>
  }
  const n = dayDiff(today, deadline.due)
  if (n < 0) return <span className="chip bg-rose-50 text-loss">기한 지남</span>
  if (n === 0) return <span className="chip bg-rose-50 text-loss">D-day</span>
  if (n <= 14) return <span className="chip bg-amber-50 text-amber-700">{dDayLabel(deadline.due, today)}</span>
  return <span className="chip bg-ink-100 text-ink-600">{dDayLabel(deadline.due, today)}</span>
}

function DeadlineCard({
  deadline,
  state,
  today,
  open,
  onToggleOpen,
  onToggleCheck,
  onToggleDone,
  onExport,
  insuranceEntry,
  insuranceFiles,
  uploading,
  onUploadInsurance,
  onOpenInsuranceFiles,
  paid,
  onRegisterPay,
  onShowPay,
}) {
  const type = TAX_TYPES[deadline.type]
  const done = isDone(state, deadline.id)
  const prior = isPrior(deadline.due)

  /* 원천세는 세금관리에서 입력한 납부 기록을 우선 표시하고, 없으면 예전 장부 기록을 보여줍니다.
     매달 같이 나오는 국세(소득세)+지방세(특별징수분) 쌍으로 보여줍니다 */
  if (deadline.type === 'withholding') {
    return (
      <div className={`card flex items-center gap-3 px-4 py-2.5 ${done || prior ? 'opacity-75' : ''}`}>
        <span className="w-20 shrink-0 text-xs font-semibold text-ink-500">{deadline.period}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-800">
          납부기한 {deadline.due}
          {paid && paid.total ? (
            <button
              type="button"
              onClick={() => (paid.record ? onRegisterPay(deadline) : onShowPay(deadline))}
              className="ml-1.5 font-num font-bold tabular-nums text-brand-700 hover:underline"
              title={paid.record ? '입력한 납부 기록 수정' : '클릭하면 장부 내역 확인'}
            >
              {formatKRW(paid.total)}원
            </button>
          ) : (
            <span className="ml-1.5 font-num font-bold tabular-nums text-ink-300">미등록</span>
          )}
          {paid?.record ? (
            <span className="ml-1 text-[11px] text-ink-400">납부 기록</span>
          ) : paid && paid.total ? (
            <span className="ml-1 text-[11px] text-ink-400">
              국세 {formatKRW(paid.national)}·지방 {formatKRW(paid.local)}
              {paid.count > 2 ? ` · ${paid.count}건` : ''}
            </span>
          ) : null}
        </span>
        {statusChip(deadline, state, today)}
        <button
          type="button"
          onClick={() => onRegisterPay(deadline)}
          className="shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-brand-50 hover:text-brand-700"
          title="납부 기록 입력"
        >
          <Icon name="plus" size={16} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => onToggleDone(deadline.id, !done)}
          className="shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-emerald-50 hover:text-emerald-700"
          title={done ? '완료 취소' : '납부확인'}
        >
          <Icon name="check" size={16} strokeWidth={2.4} className={done ? 'text-emerald-600' : ''} />
        </button>
      </div>
    )
  }

  const docs = TAX_DOCS[deadline.type] || []
  const progress = checkProgress(state, deadline)
  const checks = state?.[deadline.id]?.checks || {}

  return (
    <div className={`card overflow-hidden ${done || prior ? 'opacity-75' : ''}`}>
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-ink-50/50"
      >
        <span className={`chip shrink-0 ${type.chip}`}>{type.label}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink-900">
            {deadline.title}
            <span className="ml-1.5 font-medium text-ink-500">{deadline.period}</span>
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">납부기한 {deadline.due}</span>
        </span>
        {progress ? (
          <span className="hidden shrink-0 text-[11px] font-semibold text-ink-500 sm:block">
            준비 {progress.done}/{progress.total}
          </span>
        ) : null}
        {statusChip(deadline, state, today)}
        <Icon name="chevron-down" size={15} className={`shrink-0 text-ink-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="border-t border-ink-100 px-4 py-4">
          {progress ? (
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          ) : null}
          <ul className="flex flex-col gap-1">
            {docs.map((doc, i) => (
              <li key={doc}>
                <button
                  type="button"
                  onClick={() => onToggleCheck(deadline.id, i)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-ink-50"
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                      checks[i] ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 bg-white text-transparent'
                    }`}
                  >
                    <Icon name="check" size={13} strokeWidth={2.6} />
                  </span>
                  <span className={checks[i] ? 'text-ink-400 line-through' : 'text-ink-800'}>{doc}</span>
                </button>
              </li>
            ))}
          </ul>
          {deadline.type === 'insurance' ? (
            <div className="mt-3 rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2.5">
              {insuranceEntry ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-ink-600">
                    고지서 PDF {insuranceFiles?.length ? `${insuranceFiles.length}건` : '없음'}
                  </span>
                  {insuranceFiles?.length ? (
                    <button
                      type="button"
                      className="btn-ghost px-2.5 py-1.5 text-xs"
                      onClick={() => onOpenInsuranceFiles(insuranceFiles)}
                    >
                      보기
                    </button>
                  ) : null}
                  <label className={`btn-ghost cursor-pointer px-2.5 py-1.5 text-xs ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
                    <Icon name="upload" size={14} />
                    {uploading ? '올리는 중…' : '파일 등록'}
                    <input
                      type="file"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (f) onUploadInsurance(insuranceEntry.id, f)
                      }}
                    />
                  </label>
                </div>
              ) : (
                <p className="text-xs text-ink-500">장부에 이 달 회사부담분이 없습니다.</p>
              )}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onToggleDone(deadline.id, !done)}
              className={done ? 'btn-ghost' : 'btn-primary'}
            >
              <Icon name="check" size={15} />
              {done ? '완료 취소' : '신고 완료로 표시'}
            </button>
            {deadline.dataFrom ? (
              <button type="button" onClick={() => onExport(deadline)} className="btn-ghost">
                <Icon name="download" size={15} />
                금진 전달용 CSV
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function Tax() {
  const { profile, user } = useAuth()
  const toast = useToast()
  const thisYear = Number(todayISO().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [payments, setPayments] = useState([])
  const [state, setState] = useState(() => loadTaxState())
  const [openId, setOpenId] = useState(null)
  const [taxFilter, setTaxFilter] = useState('all')
  const [attachmentsByEntry, setAttachmentsByEntry] = useState({})
  const [uploading, setUploading] = useState(false)
  const [viewerFiles, setViewerFiles] = useState(null)
  const [payForm, setPayForm] = useState(null)
  const [paySaving, setPaySaving] = useState(false)
  const [payError, setPayError] = useState('')
  const [payDetailYm, setPayDetailYm] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const today = todayISO()

  useEffect(() => {
    saveTaxState(state)
  }, [state])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all([
      listEntries({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }),
      listEntries({ from: `${year}-01-01`, to: `${year}-12-31` }),
      listTaxPayments().catch(() => []),
    ])
      .then(([prev, cur, paymentRows]) => {
        if (!mounted) return
        const all = [...(prev || []), ...(cur || [])]
        setEntries(all)
        setPayments(paymentRows || [])
        const insIds = all.filter((e) => e.counterparty === '국민건강보험공단').map((e) => e.id)
        listAttachments(insIds)
          .then((files) => {
            if (!mounted) return
            const map = {}
            for (const f of files || []) {
              if (!map[f.entry_id]) map[f.entry_id] = []
              map[f.entry_id].push(f)
            }
            setAttachmentsByEntry(map)
          })
          .catch(() => {})
      })
      .catch((e) => {
        if (mounted) toast.error(e.message)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [year, reloadKey, toast])

  const deadlines = useMemo(() => buildTaxCalendar(year), [year])
  const upcoming = useMemo(() => getUpcoming(deadlines, today, state), [deadlines, today, state])
  const vatRows = useMemo(() => vatEstimateByFiling(entries, year), [entries, year])
  /* 원천세 납부월별 장부 합계 (납부기한 달 키) */
  const paidMap = useMemo(() => withholdingPaidByMonth(entries), [entries])
  const payByKey = useMemo(() => paymentMap(payments), [payments])

  /* 세금관리 탭에 직접 입력한 납부 기록을 우선하고,
     예전에 장부(세금과공과)에 넣은 원천세는 기록이 없을 때만 보여줍니다. */
  const paidOf = (deadline) => {
    const rec = payByKey.get(deadlinePaymentKey(deadline.id))
    if (rec) return { total: Number(rec.paid || 0), national: 0, local: 0, count: 1, record: rec }
    return paidMap.get(String(deadline.due || '').slice(0, 7)) || null
  }

  /* 부가세 예상 4줄 + 저장된 실납부 기록 */
  const vatAutoRows = useMemo(
    () =>
      vatRows.map((row) => ({
        key: vatPaymentKey(year, row.key),
        row,
        rec: payByKey.get(vatPaymentKey(year, row.key)) || null,
      })),
    [vatRows, payByKey, year],
  )

  /* 부가세 4줄에 자동으로 붙는 기록을 뺀 나머지(원천세·법인세·4대보험·기타) */
  const otherPayments = useMemo(() => {
    const autoKeys = new Set(vatRows.map((row) => vatPaymentKey(year, row.key)))
    return payments
      .filter((p) => !autoKeys.has(p.key))
      .filter((p) => {
        const y = String(p.due || p.paidOn || '').slice(0, 4)
        return !y || y === String(year)
      })
      .sort((a, b) => {
        const ad = String(a.due || a.paidOn || '')
        const bd = String(b.due || b.paidOn || '')
        return ad.localeCompare(bd)
      })
  }, [payments, vatRows, year])

  const paySummary = useMemo(() => {
    let expected = 0
    let paid = 0
    for (const { row, rec } of vatAutoRows) {
      expected += Number(row.net || 0)
      if (rec) paid += Number(rec.paid || 0)
    }
    for (const p of otherPayments) {
      expected += Number(p.expected || 0)
      paid += Number(p.paid || 0)
    }
    return { expected, paid, diff: paid - expected }
  }, [vatAutoRows, otherPayments])

  const scheduleList = useMemo(() => deadlines.filter((d) => matchTaxFilter(d, taxFilter)), [deadlines, taxFilter])
  const currentSchedule = useMemo(() => scheduleList.filter((d) => d.due >= today), [scheduleList, today])
  const pastSchedule = useMemo(() => scheduleList.filter((d) => d.due < today), [scheduleList, today])

  /* 4대보험 회사부담분 장부(월별) — 고지서 PDF 첨부 대상 */
  const insuranceByMonth = useMemo(() => {
    const map = new Map()
    for (const e of entries || []) {
      if (e.counterparty !== '국민건강보험공단') continue
      const key = String(e.entry_date || '').slice(0, 7)
      if (key && !map.has(key)) map.set(key, e)
    }
    return map
  }, [entries])

  const insuranceProps = (deadline) => {
    if (deadline.type !== 'insurance') return {}
    const entry = insuranceByMonth.get(String(deadline.due).slice(0, 7))
    return {
      insuranceEntry: entry,
      insuranceFiles: entry ? attachmentsByEntry[entry.id] || [] : [],
      uploading,
      onUploadInsurance: uploadInsurance,
      onOpenInsuranceFiles: setViewerFiles,
    }
  }

  const uploadInsurance = async (entryId, file) => {
    if (!user?.id) {
      toast.error('로그인이 필요합니다.')
      return
    }
    setUploading(true)
    try {
      const row = await uploadAttachment(entryId, file, user.id)
      setAttachmentsByEntry((prev) => ({ ...prev, [entryId]: [...(prev[entryId] || []), row] }))
      toast.success('고지서를 등록했습니다.')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setUploading(false)
    }
  }

  const toggleCheck = (id, i) => setState((s) => toggleTaxCheck(s, id, i))
  const toggleDone = (id, done) => {
    setState((s) => setTaxDone(s, id, done))
    if (done) toast.success('완료로 표시했습니다.')
  }

  /* ------------------------- 세금 납부 기록 입력 ------------------------- */

  const openPayForVat = (row, rec) => {
    setPayError('')
    if (rec) {
      setPayForm({ ...rec })
      return
    }
    const label = String(row.label || '')
    const period = (label.match(/\(([^)]+)\)/) || [])[1] || label
    setPayForm({
      key: vatPaymentKey(year, row.key),
      type: 'vat',
      title: `부가세 ${label.split(' (')[0]}`.trim(),
      period,
      due: row.due,
      expected: Number(row.net || 0),
      paid: '',
      paidOn: '',
      memo: '',
    })
  }

  const openPayForDeadline = (deadline) => {
    setPayError('')
    const rec = payByKey.get(deadlinePaymentKey(deadline.id))
    if (rec) {
      setPayForm({ ...rec })
      return
    }
    const ledger = paidMap.get(String(deadline.due || '').slice(0, 7))
    setPayForm({
      key: deadlinePaymentKey(deadline.id),
      type: deadline.type,
      title: deadline.title,
      period: deadline.period || '',
      due: deadline.due || '',
      expected: '',
      paid: ledger?.total ? String(ledger.total) : '',
      paidOn: ledger?.total ? today : '',
      memo: '',
    })
  }

  const openPayNew = (type = 'other') => {
    const t = taxPaymentType(type)
    setPayError('')
    setPayForm({
      key: newPaymentKey(),
      type,
      title: t.title,
      period: '',
      due: '',
      expected: '',
      paid: '',
      paidOn: today,
      memo: '',
    })
  }

  const submitPay = async (e) => {
    e.preventDefault()
    if (!payForm) return
    const title = String(payForm.title || '').trim()
    if (!title) {
      setPayError('항목명을 입력해 주세요.')
      return
    }
    const toNum = (v) => Number(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0
    const paidNum = toNum(payForm.paid)
    setPaySaving(true)
    setPayError('')
    try {
      const saved = await saveTaxPayment(
        {
          ...payForm,
          title,
          expected: toNum(payForm.expected),
          paid: paidNum,
          paidOn: payForm.paidOn || (paidNum ? today : ''),
        },
        user?.id,
      )
      setPayments((prev) => [...prev.filter((p) => p.id !== saved.id && p.key !== saved.key), saved])
      setPayForm(null)
      toast.success('납부 기록을 저장했습니다.')
    } catch (err) {
      setPayError(err.message)
    } finally {
      setPaySaving(false)
    }
  }

  const handleDeletePay = async () => {
    if (!payForm?.id) return
    if (!window.confirm('이 납부 기록을 삭제할까요?')) return
    setPaySaving(true)
    setPayError('')
    try {
      await removeTaxPayment(payForm.id)
      setPayments((prev) => prev.filter((p) => p.id !== payForm.id))
      setPayForm(null)
      toast.success('납부 기록을 삭제했습니다.')
    } catch (err) {
      setPayError(err.message)
    } finally {
      setPaySaving(false)
    }
  }

  /** 세무법인 전달용: 과세기간 장부 CSV */
  const exportFiling = (deadline) => {
    const rows = (entries || [])
      .filter((e) => {
        const d = String(e.entry_date || '')
        return d >= deadline.dataFrom && d <= deadline.dataTo
      })
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1))
    if (!rows.length) {
      toast.error('해당 기간에 장부 내역이 없습니다.')
      return
    }
    const headers = ['일자', '유형', '거래처', '항목', '적요', '공급가액', '부가세', '합계', '결제수단', '비고']
    const typeLabel = { sale: '매출', purchase: '매입', opex: '운영비' }
    const body = rows.map((e) => [
      e.entry_date,
      typeLabel[e.entry_type] || e.entry_type,
      e.counterparty,
      e.category,
      e.description,
      Number(e.supply_amount || 0),
      Number(e.vat_amount || 0),
      Number(e.total_amount || 0),
      e.payment_method,
      e.memo,
    ])
    downloadTextFile(
      `금진전달_${deadline.title}_${deadline.dataFrom}_${deadline.dataTo}.csv`,
      toCSV(headers, body),
    )
    toast.success(`${rows.length}건을 내려받았습니다.`)
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="세금관리"
        description="신고 일정·준비물·부가세 예상을 한 곳에서 챙깁니다. 최종 신고 전에는 세무법인 금진과 확인하세요."
      >
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                y === year ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {y}년
            </button>
          ))}
        </div>
      </PageHeader>

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {/* 2. 부가세 예상 */}
          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">부가세 납부 예상 ({year}년)</h2>
              <p className="text-xs text-ink-500">매출세액 − 매입세액 · 장부 입력 기준</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead className="bg-ink-50/70">
                  <tr>
                    <th className="th">신고 구분</th>
                    <th className="th text-right">매출세액</th>
                    <th className="th text-right">매입세액</th>
                    <th className="th text-right">납부(환급) 예상</th>
                    <th className="th text-right">실납부</th>
                    <th className="th text-right">차액</th>
                    <th className="th text-right">납부기한</th>
                    <th className="th text-center">납부일</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {vatAutoRows.map(({ row: r, rec }) => {
                    const diff = paymentDiff(rec)
                    return (
                      <tr key={r.key}>
                        <td className="td font-semibold">{r.label}</td>
                        <td className="td num">{formatKRW(r.saleVat)}원</td>
                        <td className="td num">{formatKRW(r.buyVat)}원</td>
                        <td className={`td num font-bold ${r.net < 0 ? 'text-emerald-700' : 'text-loss'}`}>
                          {r.net < 0 ? `환급 ${formatKRW(Math.abs(r.net))}원` : `${formatKRW(r.net)}원`}
                        </td>
                        <td className="td num font-bold">
                          {rec && Number(rec.paid) !== 0 ? (
                            `${formatKRW(rec.paid)}원`
                          ) : (
                            <span className="font-medium text-ink-300">미입력</span>
                          )}
                        </td>
                        <td
                          className={`td num font-bold ${
                            diff === null
                              ? 'text-ink-300'
                              : diff === 0
                                ? 'text-emerald-700'
                                : diff > 0
                                  ? 'text-amber-700'
                                  : 'text-loss'
                          }`}
                        >
                          {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatKRW(diff)}원`}
                        </td>
                        <td className="td num text-ink-500">{r.due}</td>
                        <td className="td text-center text-xs text-ink-500">{rec?.paidOn || '—'}</td>
                        <td className="td text-right">
                          <button
                            type="button"
                            className="btn-ghost whitespace-nowrap px-2 py-1 text-xs"
                            onClick={() => openPayForVat(r, rec)}
                          >
                            {rec ? '수정' : '실납부 입력'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-ink-100 px-4 py-3 text-[11px] leading-relaxed text-ink-400">
              장부에 빠진 매입이 있으면 실제보다 많게 나옵니다. 확정신고분은 예정신고 납부세액 차감 전
              금액입니다. 간이과세·면세·공제 한도·가산세는 반영되지 않으니 신고 전 금진에 장부 CSV를 보내
              대조하세요. <span className="font-semibold text-ink-500">실납부를 입력하면 예상과의 차액을 자동 계산합니다.</span>
            </p>
          </section>

          {/* 3. 세금·법정부담금 납부 기록 (직원 화면 비공개 · 운영비 장부와 분리) */}
          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-ink-900">세금·법정부담금 납부 기록 ({year}년)</h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  부가세·원천세·법인세·지방소득세·4대보험을 예상과 실제 납부액으로 비교합니다.
                </p>
              </div>
              <button type="button" className="btn-primary whitespace-nowrap" onClick={() => openPayNew()}>
                <Icon name="plus" size={15} />
                납부 기록 추가
              </button>
            </header>

            <div className="flex flex-wrap gap-1.5 border-b border-ink-100 px-4 py-3">
              {TAX_PAYMENT_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => openPayNew(t.key)}
                  className={`chip ${t.chip} transition hover:brightness-95`}
                  title={`${t.label} 납부 기록 추가`}
                >
                  + {t.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 border-b border-ink-100 px-4 py-3 text-right">
              <div>
                <p className="text-[11px] text-ink-400">예상 합계 (부가세 포함)</p>
                <p className="font-num text-sm font-extrabold tabular-nums text-ink-900">
                  {formatKRW(paySummary.expected)}원
                </p>
              </div>
              <div>
                <p className="text-[11px] text-ink-400">실납부 합계</p>
                <p className="font-num text-sm font-extrabold tabular-nums text-brand-700">
                  {formatKRW(paySummary.paid)}원
                </p>
              </div>
              <div>
                <p className="text-[11px] text-ink-400">차액</p>
                <p
                  className={`font-num text-sm font-extrabold tabular-nums ${
                    paySummary.diff === 0
                      ? 'text-emerald-700'
                      : paySummary.diff > 0
                        ? 'text-amber-700'
                        : 'text-loss'
                  }`}
                >
                  {paySummary.diff > 0 ? '+' : ''}
                  {formatKRW(paySummary.diff)}원
                </p>
              </div>
            </div>

            {otherPayments.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">구분</th>
                      <th className="th text-left">항목</th>
                      <th className="th text-left">대상 기간</th>
                      <th className="th text-right">납부기한</th>
                      <th className="th text-right">예상금액</th>
                      <th className="th text-right">실납부금</th>
                      <th className="th text-right">차액</th>
                      <th className="th text-center">납부일</th>
                      <th className="th text-left">메모</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {otherPayments.map((p) => {
                      const t = taxPaymentType(p.type)
                      const diff = paymentDiff(p)
                      return (
                        <tr key={p.id}>
                          <td className="td">
                            <span className={`chip ${t.chip}`}>{t.label}</span>
                          </td>
                          <td className="td font-semibold">{p.title}</td>
                          <td className="td text-ink-500">{p.period || '—'}</td>
                          <td className="td num text-ink-500">{p.due || '—'}</td>
                          <td className="td num">
                            {Number(p.expected) < 0
                              ? `환급 ${formatKRW(Math.abs(p.expected))}원`
                              : `${formatKRW(p.expected)}원`}
                          </td>
                          <td className="td num font-bold">
                            {Number(p.paid) !== 0 ? (
                              `${formatKRW(p.paid)}원`
                            ) : (
                              <span className="font-medium text-ink-300">미입력</span>
                            )}
                          </td>
                          <td
                            className={`td num font-bold ${
                              diff === null
                                ? 'text-ink-300'
                                : diff === 0
                                  ? 'text-emerald-700'
                                  : diff > 0
                                    ? 'text-amber-700'
                                    : 'text-loss'
                            }`}
                          >
                            {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatKRW(diff)}원`}
                          </td>
                          <td className="td text-center text-xs text-ink-500">{p.paidOn || '—'}</td>
                          <td className="td max-w-[160px] truncate text-xs text-ink-500" title={p.memo}>
                            {p.memo || '—'}
                          </td>
                          <td className="td text-right">
                            <button
                              type="button"
                              className="btn-ghost whitespace-nowrap px-2 py-1 text-xs"
                              onClick={() => {
                                setPayError('')
                                setPayForm({ ...p })
                              }}
                            >
                              수정
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-6 text-center text-xs text-ink-400">
                원천세·4대보험·법인세 등 추가 기록이 없습니다. 위 버튼으로 추가하세요.
              </p>
            )}
            <p className="border-t border-ink-100 px-4 py-3 text-[11px] leading-relaxed text-ink-400">
              4대보험은 세금은 아니지만 법정 부담금이라 함께 관리합니다. 여기 입력한 금액은 운영비 장부에
              남기지 않으므로 직원 화면·프로젝트 손익에는 잡히지 않습니다.
            </p>
          </section>

          {/* 1. 연간 전체 일정 */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink-900">{year}년 전체 일정</h2>
              <div className="inline-flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
                {FILTER_TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTaxFilter(t.key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      t.key === taxFilter ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {(taxFilter === 'all' || taxFilter === 'withholding') && (
              <p className="text-xs text-ink-500">원천세(매월 10일)는 + 버튼으로 실납부금을 기록하면 금액이 표시됩니다. 매달 같이 나오는 국세(소득세)+지방세(특별징수분) 합산입니다.</p>
            )}
            {taxFilter === 'corp' && (
              <p className="text-xs text-ink-500">법인세 확정(3/31)과 지방소득세(4/30)는 연 1회 세트입니다. 매달 나가는 지방세(특별징수분)는 원천세 행에 포함됩니다.</p>
            )}
            {currentSchedule.map((d) => (
              <DeadlineCard
                key={d.id}
                deadline={d}
                state={state}
                today={today}
                open={openId === d.id}
                onToggleOpen={() => setOpenId((v) => (v === d.id ? null : d.id))}
                onToggleCheck={toggleCheck}
                onToggleDone={toggleDone}
                onExport={exportFiling}
                paid={paidOf(d)}
                onRegisterPay={openPayForDeadline}
                onShowPay={(dl) => setPayDetailYm(String(dl.due || '').slice(0, 7))}
                {...insuranceProps(d)}
              />
            ))}
            {!scheduleList.length ? (
              <p className="card px-4 py-6 text-center text-xs text-ink-400">해당 종류의 일정이 없습니다.</p>
            ) : null}
            {pastSchedule.length ? (
              <details className="card overflow-hidden">
                <summary className="cursor-pointer list-none px-4 py-3.5 transition hover:bg-ink-50/60">
                  <span className="flex items-center gap-2 text-sm font-bold text-ink-900">
                    <Icon name="chevron-right" size={15} className="text-ink-400" />
                    지난 일정 {pastSchedule.length}건
                    <span className="font-medium text-ink-400">펼쳐서 한 번에 보기</span>
                  </span>
                </summary>
                <div className="flex flex-col gap-3 border-t border-ink-100 px-4 py-4">
                  {pastSchedule.map((d) => (
                    <DeadlineCard
                      key={d.id}
                      deadline={d}
                      state={state}
                      today={today}
                      open={openId === d.id}
                      onToggleOpen={() => setOpenId((v) => (v === d.id ? null : d.id))}
                      onToggleCheck={toggleCheck}
                      onToggleDone={toggleDone}
                      onExport={exportFiling}
                      paid={paidOf(d)}
                      onRegisterPay={openPayForDeadline}
                      onShowPay={(dl) => setPayDetailYm(String(dl.due || '').slice(0, 7))}
                      {...insuranceProps(d)}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          {/* 3. 챙겨야 할 신고 (4대보험 자동이체 제외) */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-bold text-ink-900">
              챙겨야 할 신고
              <span className="ml-1.5 font-medium text-ink-500">
                {upcoming.length ? `${upcoming.length}건` : '없음'}
              </span>
            </h2>
            <p className="text-xs text-ink-500">4대보험(급여일 자동이체)은 제외됩니다.</p>
            {!upcoming.length ? (
              <InlineAlert tone="success">
                <strong>다 챙겼습니다.</strong> 앞으로 60일 안에 마감되는 신고가 없습니다.
              </InlineAlert>
            ) : (
              upcoming.map((d) => (
                <DeadlineCard
                  key={d.id}
                  deadline={d}
                  state={state}
                  today={today}
                  open={openId === d.id}
                  onToggleOpen={() => setOpenId((v) => (v === d.id ? null : d.id))}
                  onToggleCheck={toggleCheck}
                  onToggleDone={toggleDone}
                  onExport={exportFiling}
                  paid={paidOf(d)}
                  onRegisterPay={openPayForDeadline}
                  onShowPay={(dl) => setPayDetailYm(String(dl.due || '').slice(0, 7))}
                  {...insuranceProps(d)}
                />
              ))
            )}
          </section>

          <p className="pb-2 text-center text-xs text-ink-400">
            {profile?.full_name ? `${profile.full_name} · ` : ''}
            일반과세·12월 결산법인 기준이며 법 개정·휴일 연기에 따라 달라질 수 있습니다.
          </p>
        </>
      )}

      <AttachmentModal
        open={Boolean(viewerFiles)}
        onClose={() => setViewerFiles(null)}
        attachments={viewerFiles || []}
        title="고지서 PDF"
      />

      {/* 세금·법정부담금 납부 기록 입력.
          예상금액과 실납부금을 함께 적으면 차액을 자동 계산합니다.
          (운영비 장부에는 남기지 않아 직원 화면·프로젝트 손익에 잡히지 않습니다) */}
      <Modal
        open={Boolean(payForm)}
        onClose={() => {
          if (paySaving) return
          setPayForm(null)
          setPayError('')
        }}
        title={payForm?.id ? '납부 기록 수정' : '납부 기록 추가'}
        subtitle="예상금액과 실제 납부한 금액을 적으면 차액을 계산해 보여줍니다."
        footer={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setPayForm(null)
                setPayError('')
              }}
              disabled={paySaving}
            >
              취소
            </button>
            {payForm?.id ? (
              <button
                type="button"
                className="btn-ghost text-rose-600 hover:bg-rose-50"
                onClick={handleDeletePay}
                disabled={paySaving}
              >
                삭제
              </button>
            ) : null}
            <button type="submit" form="tax-payment-form" className="btn-primary" disabled={paySaving}>
              {paySaving ? '저장 중…' : '저장'}
            </button>
          </>
        }
      >
        {payForm ? (
          <form id="tax-payment-form" onSubmit={submitPay} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {payError ? (
              <div className="sm:col-span-2">
                <InlineAlert tone="error">{payError}</InlineAlert>
              </div>
            ) : null}
            <Field label="구분">
              <select
                className="input"
                value={payForm.type}
                onChange={(e) => {
                  const type = e.target.value
                  setPayForm((f) => ({
                    ...f,
                    type,
                    title: f.title && f.title !== taxPaymentType(f.type).title ? f.title : taxPaymentType(type).title,
                  }))
                }}
              >
                {TAX_PAYMENT_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="항목명" required>
              <input
                className="input"
                value={payForm.title}
                onChange={(e) => setPayForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="예: 부가세 1기 예정"
                required
              />
            </Field>
            <Field label="대상 기간">
              <input
                className="input"
                value={payForm.period}
                onChange={(e) => setPayForm((f) => ({ ...f, period: e.target.value }))}
                placeholder="예: 1~3월분"
              />
            </Field>
            <Field label="납부기한">
              <input
                type="date"
                className="input"
                value={payForm.due || ''}
                onChange={(e) => setPayForm((f) => ({ ...f, due: e.target.value }))}
              />
            </Field>
            <Field label="예상금액" hint="부가세는 예상금액이 자동으로 채워집니다. 환급이면 음수로 적어주세요.">
              <AmountInput
                className="input text-right font-num tabular-nums"
                value={payForm.expected}
                onChange={(e) => setPayForm((f) => ({ ...f, expected: e.target.value }))}
                placeholder="0"
              />
            </Field>
            <Field label="실납부금" hint="통장에서 실제로 빠져나간 금액">
              <AmountInput
                className="input text-right font-num tabular-nums"
                value={payForm.paid}
                onChange={(e) => setPayForm((f) => ({ ...f, paid: e.target.value }))}
                placeholder="0"
              />
            </Field>
            <Field label="납부일">
              <input
                type="date"
                className="input"
                value={payForm.paidOn || ''}
                onChange={(e) => setPayForm((f) => ({ ...f, paidOn: e.target.value }))}
              />
            </Field>
            <Field label="메모" className="sm:col-span-2">
              <input
                className="input"
                value={payForm.memo}
                onChange={(e) => setPayForm((f) => ({ ...f, memo: e.target.value }))}
                placeholder="예: 홈택스 납부, 분납 1차"
              />
            </Field>
            <div className="sm:col-span-2 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
              차액 = 실납부금 − 예상금액 · 예상이 환급(음수)이면 차액은 표시하지 않습니다.
            </div>
          </form>
        ) : null}
      </Modal>

      {/* 원천세 납부 내역: 합계를 누르면 어떤 장부 행인지 확인 */}
      <Modal
        open={Boolean(payDetailYm)}
        onClose={() => setPayDetailYm('')}
        title={payDetailYm ? `${payDetailYm} 원천세 납부 내역` : '원천세 납부 내역'}
        subtitle={
          payDetailYm && paidMap.get(payDetailYm)
            ? `합계 ${formatKRW(paidMap.get(payDetailYm).total)}원 · 국세 ${formatKRW(paidMap.get(payDetailYm).national)}원 · 지방 ${formatKRW(paidMap.get(payDetailYm).local)}원`
            : ''
        }
        size="lg"
        footer={
          <button type="button" className="btn-ghost" onClick={() => setPayDetailYm('')}>
            닫기
          </button>
        }
      >
        {(paidMap.get(payDetailYm)?.rows || []).length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-xs">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">일자</th>
                  <th className="th">거래처</th>
                  <th className="th">적요</th>
                  <th className="th">메모</th>
                  <th className="th text-right">금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {(paidMap.get(payDetailYm)?.rows || []).map((e) => (
                  <tr key={e.id}>
                    <td className="td whitespace-nowrap">{e.entry_date}</td>
                    <td className="td">{e.counterparty || '—'}</td>
                    <td className="td">{e.description || '—'}</td>
                    <td className="td text-ink-500">{e.memo || '—'}</td>
                    <td className="td num font-bold">{formatKRW(e.total_amount)}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-ink-500">내역이 없습니다.</p>
        )}
      </Modal>
    </div>
  )
}

/** 대시보드 상단 임박 신고 알림 배너 (권한 없으면 숨김) */
export function TaxAlertBanner() {
  const { profile, isAdmin } = useAuth()
  const { perms, loading: permsLoading } = useStaffPermissions(profile)
  const [state] = useState(() => loadTaxState())
  const today = todayISO()
  const year = Number(today.slice(0, 4))
  const urgent = useMemo(() => {
    const all = [...buildTaxCalendar(year), ...buildTaxCalendar(year + 1)]
    return getUpcoming(all, today, state)
      .sort((a, b) => (a.due < b.due ? -1 : 1))
      .slice(0, 1)[0]
  }, [year, today, state])

  if (permsLoading) return null
  if (!isAdmin && !perms.includes('tax')) return null
  if (!urgent) return null
  const n = dayDiff(today, urgent.due)
  const overdue = n < 0
  return (
    <Link
      to="/tax"
      className={`flex items-center gap-3 rounded-xl2 border px-4 py-3 shadow-card transition hover:shadow-pop ${
        overdue ? 'border-rose-200 bg-rose-50' : n <= 14 ? 'border-amber-200 bg-amber-50' : 'border-ink-200/70 bg-white'
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          overdue || n <= 14 ? 'bg-white text-amber-600' : 'bg-amber-50 text-amber-600'
        }`}
      >
        <Icon name="calendar" size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink-900">
          {urgent.title} {dDayLabel(urgent.due, today)}
        </span>
        <span className="block truncate text-xs text-ink-500">
          {urgent.period} · 납부기한 {urgent.due} · 준비물을 확인하세요
        </span>
      </span>
      <span className="shrink-0 text-xs font-bold text-brand-700">세금관리 →</span>
    </Link>
  )
}
