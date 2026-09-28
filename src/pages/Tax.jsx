import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { InlineAlert, LoadingBlock, PageHeader } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { useStaffPermissions } from '../lib/permissions'
import { listAttachments, listEntries, uploadAttachment } from '../lib/api'
import { downloadTextFile, toCSV } from '../lib/csv'
import { formatKRW, todayISO } from '../lib/format'
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
} from '../lib/tax'

const FILTER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'vat', label: '부가세' },
  { key: 'withholding', label: '원천세' },
  { key: 'insurance', label: '4대보험' },
  { key: 'corp', label: '법인세·지방세' },
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
}) {
  const type = TAX_TYPES[deadline.type]
  const done = isDone(state, deadline.id)
  const prior = isPrior(deadline.due)

  /* 원천세는 납부확인만: 펼침·체크리스트 없이 한 줄로 */
  if (deadline.type === 'withholding') {
    return (
      <div className={`card flex items-center gap-3 px-4 py-2.5 ${done || prior ? 'opacity-75' : ''}`}>
        <span className="w-20 shrink-0 text-xs font-semibold text-ink-500">{deadline.period}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-800">납부기한 {deadline.due}</span>
        {statusChip(deadline, state, today)}
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
  const [state, setState] = useState(() => loadTaxState())
  const [openId, setOpenId] = useState(null)
  const [taxFilter, setTaxFilter] = useState('all')
  const [attachmentsByEntry, setAttachmentsByEntry] = useState({})
  const [uploading, setUploading] = useState(false)
  const [viewerFiles, setViewerFiles] = useState(null)
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
    ])
      .then(([prev, cur]) => {
        if (!mounted) return
        const all = [...(prev || []), ...(cur || [])]
        setEntries(all)
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
  }, [year, toast])

  const deadlines = useMemo(() => buildTaxCalendar(year), [year])
  const upcoming = useMemo(() => getUpcoming(deadlines, today, state), [deadlines, today, state])
  const vatRows = useMemo(() => vatEstimateByFiling(entries, year), [entries, year])
  const scheduleList = useMemo(() => deadlines.filter((d) => matchTaxFilter(d, taxFilter)), [deadlines, taxFilter])

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
          {/* 1. 임박한 신고 */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-bold text-ink-900">
              챙겨야 할 신고
              <span className="ml-1.5 font-medium text-ink-500">
                {upcoming.length ? `${upcoming.length}건` : '없음'}
              </span>
            </h2>
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
                  {...insuranceProps(d)}
                />
              ))
            )}
          </section>

          {/* 2. 부가세 예상 */}
          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">부가세 납부 예상 ({year}년)</h2>
              <p className="text-xs text-ink-500">매출세액 − 매입세액 · 장부 입력 기준</p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse">
                <thead className="bg-ink-50/70">
                  <tr>
                    <th className="th">신고 구분</th>
                    <th className="th text-right">매출세액</th>
                    <th className="th text-right">매입세액</th>
                    <th className="th text-right">납부(환급) 예상</th>
                    <th className="th text-right">납부기한</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {vatRows.map((r) => (
                    <tr key={r.key}>
                      <td className="td font-semibold">{r.label}</td>
                      <td className="td num">{formatKRW(r.saleVat)}원</td>
                      <td className="td num">{formatKRW(r.buyVat)}원</td>
                      <td className={`td num font-bold ${r.net < 0 ? 'text-emerald-700' : 'text-loss'}`}>
                        {r.net < 0 ? `환급 ${formatKRW(Math.abs(r.net))}원` : `${formatKRW(r.net)}원`}
                      </td>
                      <td className="td num text-ink-500">{r.due}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-ink-100 px-4 py-3 text-[11px] leading-relaxed text-ink-400">
              장부에 빠진 매입이 있으면 실제보다 많게 나옵니다. 확정신고분은 예정신고 납부세액 차감 전
              금액입니다. 간이과세·면세·공제 한도·가산세는 반영되지 않으니 신고 전 금진에 장부 CSV를 보내
              대조하세요.
            </p>
          </section>

          {/* 3. 연간 일정 */}
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
              <p className="text-xs text-ink-500">원천세(매월 10일)는 납부확인 체크만으로 충분합니다.</p>
            )}
            {scheduleList.length ? (
              scheduleList.map((d) => (
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
                  {...insuranceProps(d)}
                />
              ))
            ) : (
              <p className="card px-4 py-6 text-center text-xs text-ink-400">해당 종류의 일정이 없습니다.</p>
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
