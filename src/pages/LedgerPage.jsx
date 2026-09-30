import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import EntryFormModal from '../components/EntryFormModal'
import EntryTable from '../components/EntryTable'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import { AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, LoadingBlock, Modal, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { isStaffVisible, staffIdsFromProfiles } from '../lib/permissions'
import { CATEGORIES, ENTRY_META } from '../lib/constants'
import { ISSUE_META } from '../lib/validate'
import { downloadTextFile, parseAmount, parseCSV, toCSV } from '../lib/csv'
import { formatKRW } from '../lib/format'
import { DataAuditPanel } from './Dashboard'
import {
  createEntries,
  deleteEntry,
  listAttachments,
  listEntries,
  listPartners,
  listProfiles,
  listProjects,
  updateEntry,
} from '../lib/api'

const IMPORT_COLUMNS = ['일자', '거래처', '항목', '적요', '공급가액', '부가세', '결제수단', '비고', '프로젝트']

export default function LedgerPage({ type, source = 'manual', title, description }) {
  const meta = ENTRY_META[type]
  const { profile, isAdmin, user } = useAuth()
  const toast = useToast()
  const period = usePeriod('quarter')
  const [searchParams, setSearchParams] = useSearchParams()

  const [entries, setEntries] = useState([])
  const [projects, setProjects] = useState([])
  const [profiles, setProfiles] = useState([])
  const [partnerNames, setPartnerNames] = useState([])
  const [attachmentsByEntry, setAttachmentsByEntry] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [highlightIds, setHighlightIds] = useState([])
  const [highlightIssue, setHighlightIssue] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [personFilter, setPersonFilter] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [removingMany, setRemovingMany] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewerFiles, setViewerFiles] = useState(null)
  const [importOpen, setImportOpen] = useState(false)

  const isReport = source === 'expense_report'
  /* 이 메뉴의 점검 지적만 보여줍니다 (매출→sales, 매입→purchases, 운영비→expenses, 지출결의→expense-reports) */
  const menuSlug = source === 'expense_report' ? 'expense-reports' : type === 'sale' ? 'sales' : type === 'purchase' ? 'purchases' : 'expenses'

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (searchParams.get('new') !== null) setFormOpen(true)
    const q = searchParams.get('search')
    if (q) setSearch(q)
    // 외부 딥링크: ?project=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
    const qp = searchParams.get('project')
    if (qp) setProjectFilter(qp)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (from && to) {
      period.setPreset('custom')
      period.setCustom({ from, to })
    }
    // 대시보드 검색에서 넘어올 때: 기간 전체로 봅니다 (?period=all)
    if (searchParams.get('period') === 'all') {
      period.setPreset('custom')
      period.setCustom({ from: '', to: '' })
    }
    // 데이터 점검에서 넘어올 때: 의심 항목을 색으로 표시 (?highlight=id1,id2&issue=duplicate)
    const hl = (searchParams.get('highlight') || '').split(',').map((s) => s.trim()).filter(Boolean)
    setHighlightIds(hl)
    setHighlightIssue(searchParams.get('issue') || '')
  }, [searchParams])

  useEffect(() => {
    listPartners()
      .then((rows) => setPartnerNames((rows || []).map((r) => r.name).filter(Boolean)))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, projectRows, profileRows] = await Promise.all([
        listEntries({
          from: period.range.from,
          to: period.range.to,
          types: [type],
          // 매출·매입·운영비 장부는 카드 일괄등록분(source='card')까지 함께 보여줍니다.
          // 지출결의(source='expense_report')는 그대로 분리 표시합니다.
          ...(source !== 'manual' ? { source } : {}),
          projectId: projectFilter || undefined,
          search: debounced,
        }),
        listProjects(),
        listProfiles(),
      ])
      setEntries(rows)
      setProjects(projectRows)
      setProfiles(profileRows)

      const files = await listAttachments(rows.map((r) => r.id))
      const map = {}
      for (const file of files) {
        if (!map[file.entry_id]) map[file.entry_id] = []
        map[file.entry_id].push(file)
      }
      setAttachmentsByEntry(map)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [type, source, projectFilter, debounced, period.range.from, period.range.to, toast])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, source, projectFilter, debounced, period.range.from, period.range.to, reloadKey])

  const projectName = (id) => projects.find((p) => p.id === id)?.name || ''
  const personName = (id) => profiles.find((p) => p.id === id)?.full_name || ''
  /** 직원 키: 결의자 id → 퇴사자 통합 → 미지정. 날짜가 아니라 사람 기준 */
  const exCodeOf = (e) => {
    const m = String(e.memo || '').match(/([A-Z]+)\s*지결/)
    return m ? m[1] : ''
  }
  const ownerKey = (e) => e.requester_id || (exCodeOf(e) ? 'ex' : '__none')
  const ownerNameByKey = (key) => {
    if (key === '__none') return '미지정'
    if (key === 'ex' || key.startsWith('ex:')) return '기타'
    return personName(key) || '미지정'
  }
  const ownerName = (e) => {
    if (e.requester_id) return ownerNameByKey(e.requester_id)
    const code = exCodeOf(e)
    if (code) return '기타'
    return '미지정'
  }
  /** 직원 화면: 사원 작성분만 공유합니다 (관리자 작성분 제외) */
  const staffIds = useMemo(() => staffIdsFromProfiles(profiles), [profiles])
  const effectiveFilter = personFilter
  /** 퇴사자분은 기타에 합산됩니다 */
  const base = useMemo(
    () => (isAdmin ? entries : entries.filter((e) => isStaffVisible(e, staffIds))),
    [isAdmin, entries, staffIds],
  )

  /** 지출결의: 직원 필터 + 직원별 소계 (날짜가 아니라 사람 기준으로 봅니다) */
  const [oldestFirst, setOldestFirst] = useState(false)
  const shown = useMemo(() => {
    const rows = !isReport || !effectiveFilter ? [...base] : base.filter((e) => ownerKey(e) === effectiveFilter)
    rows.sort(
      (a, b) =>
        oldestFirst
          ? String(a.entry_date).localeCompare(String(b.entry_date)) ||
            String(a.created_at || '').localeCompare(String(b.created_at || ''))
          : String(b.entry_date).localeCompare(String(a.entry_date)) ||
            String(b.created_at || '').localeCompare(String(a.created_at || '')),
    )
    return rows
  }, [base, isReport, effectiveFilter, oldestFirst])

  const byPerson = useMemo(() => {
    if (!isReport) return []
    const map = new Map()
    for (const e of base) {
      const key = ownerKey(e)
      if (!map.has(key)) {
        map.set(key, { key, name: ownerNameByKey(key), n: 0, supply: 0, vat: 0, total: 0 })
      }
      const g = map.get(key)
      g.n += 1
      g.supply += Number(e.supply_amount || 0)
      g.vat += Number(e.vat_amount || 0)
      g.total += Number(e.total_amount || 0)
    }
    // 고정 슬롯: Z·B·G·S·N·H·J·M → 기타 → 미지정 (기간이 바뀌어도 순서 고정, 합계만 갱신)
    const ORDER = ['이향란', '이보람', '권혜민', '박현정', '김상희', '김혜린', '박은영', '이정현']
    const ordered = []
    for (const nm of ORDER) {
      const prof = profiles.find((p) => p.full_name === nm)
      const key = prof ? prof.id : `name:${nm}`
      const g = map.get(key) || { key, name: nm, n: 0, supply: 0, vat: 0, total: 0 }
      ordered.push(g)
    }
    for (const key of ['ex']) {
      const g = map.get(key) || {
        key,
        name: ownerNameByKey(key),
        n: 0,
        supply: 0,
        vat: 0,
        total: 0,
      }
      ordered.push(g)
    }
    return ordered
  }, [base, isReport, profiles])

  const totals = useMemo(
    () =>
      shown.reduce(
        (acc, e) => {
          acc.supply += Number(e.supply_amount || 0)
          acc.vat += Number(e.vat_amount || 0)
          acc.total += Number(e.total_amount || 0)
          return acc
        },
        { supply: 0, vat: 0, total: 0 },
      ),
    [shown],
  )

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deleteEntry(removing.id)
      toast.success('삭제되었습니다.')
      clearHighlightFor(removing.id)
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  /* 운영비 목록 직접 수정 (법인카드식 단계 저장). 일괄편집은 관리자만 */
  const bulkEdit = isAdmin
  /* 데이터 점검 표시 자동해제: 고친 행은 의심 목록에서 뺍니다 */
  const clearHighlightFor = (id) => {
    if (!id) return
    setHighlightIds((prev) => {
      const next = prev.filter((x) => String(x) !== String(id))
      if (next.length !== prev.length) {
        const params = new URLSearchParams(searchParams)
        if (next.length) {
          params.set('highlight', next.join(','))
        } else {
          params.delete('highlight')
          params.delete('issue')
          setHighlightIssue('')
        }
        setSearchParams(params, { replace: true })
      }
      return next
    })
  }
  /* 본인 행(등록자·지출자)만 수정·삭제 가능. 관리자는 전부 */
  const ownRow = (e) =>
    isAdmin || e?.created_by === user?.id || e?.requester_id === user?.id
  const handleSaveRow = async (entry, payload) => {
    const saved = await updateEntry(entry.id, payload)
    setEntries((rows) => rows.map((r) => (r.id === entry.id ? { ...r, ...saved } : r)))
    clearHighlightFor(entry.id)
    return saved
  }
  const handleDeleteMany = async () => {
    if (!removingMany?.length) return
    setBusy(true)
    try {
      let ok = 0
      for (const id of removingMany) {
        // eslint-disable-next-line no-await-in-loop
        try {
          await deleteEntry(id)
          ok += 1
        } catch {
          /* 개별 실패는 합계에 반영 */
        }
      }
      toast.success(`${removingMany.length}건 중 ${ok}건을 삭제했습니다.`)
      for (const id of removingMany) clearHighlightFor(id)
      setRemovingMany(null)
      setReloadKey((k) => k + 1)
    } finally {
      setBusy(false)
    }
  }

  const exportCSV = () => {
    if (!shown.length) {
      toast.info('내보낼 내역이 없습니다.')
      return
    }
    const headers = [
      '일자',
      '유형',
      '결의번호',
      '프로젝트',
      '거래처',
      '항목',
      '적요',
      '공급가액',
      '부가세',
      '합계',
      '결제수단',
      '작성자',
      '비고',
    ]
    const rows = shown.map((e) => [
      e.entry_date,
      ENTRY_META[e.entry_type]?.label || e.entry_type,
      e.doc_no,
      projectName(e.project_id),
      e.counterparty,
      e.category,
      e.description,
      Number(e.supply_amount || 0),
      Number(e.vat_amount || 0),
      Number(e.total_amount || 0),
      e.payment_method,
      isReport ? ownerName(e) : personName(e.requester_id || e.created_by),
      e.memo,
    ])
    const label = isReport ? '지출결의' : title
    downloadTextFile(`${label}_${period.range.from || 'all'}_${period.range.to || 'all'}.csv`, toCSV(headers, rows))
  }

  const downloadTemplate = () => {
    downloadTextFile(
      '장부_업로드_양식.csv',
      toCSV(IMPORT_COLUMNS, [['2026-09-21', '예시 거래처', '기타운영비', '예시 적요', 100000, 10000, '계좌이체', '', '']]),
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} description={description}>
        <button type="button" className="btn-ghost" onClick={exportCSV}>
          <Icon name="download" size={16} />
          CSV 내보내기
        </button>
        {isAdmin ? (
          <button type="button" className="btn-ghost" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={16} />
            CSV 일괄등록
          </button>
        ) : null}
        <button type="button" className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true) }}>
          <Icon name="plus" size={16} />
          {isReport ? '지출결의 등록' : `${meta.label} 등록`}
        </button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="공급가액 합계" value={totals.supply} tone={meta.key} icon={meta.icon} />
        <StatCard label="부가세 합계" value={totals.vat} tone="neutral" icon="receipt" />
        <StatCard label="합계 금액" value={totals.total} tone="neutral" icon="coins" />
        <StatCard
          label="건수"
          value={String(shown.length)}
          unit="건"
          tone="neutral"
          icon="file"
          hint={period.range.label}
        />
      </div>

      {isReport && byPerson.length > 0 ? (
        <div className="card px-4 py-3.5">
          <p className="mb-2 text-xs font-semibold text-ink-500">직원별 소계 (클릭하면 해당 직원만 표시)</p>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
            {byPerson.map((g) => {
              const on = personFilter === g.key
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setPersonFilter((cur) => (cur === g.key ? '' : g.key))}
                  className={`rounded-xl border p-3 text-left transition ${
                    on
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-ink-200 bg-white hover:border-brand-300'
                  }`}
                >
                  <p className={`text-sm font-bold ${on ? 'text-brand-700' : 'text-ink-900'}`}>{g.name}</p>
                  <p className="mt-0.5 font-num text-base font-extrabold tabular-nums text-ink-900">
                    {formatKRW(g.total)}원
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500">{g.n}건</p>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {isAdmin ? <DataAuditPanel menuSlug={menuSlug} /> : null}

      <div className="card overflow-hidden">
        {highlightIds.length ? (
          <HighlightBanner
            count={highlightIds.length}
            issue={highlightIssue}
            onClear={() => {
              setHighlightIds([])
              setHighlightIssue('')
              const next = new URLSearchParams(searchParams)
              next.delete('highlight')
              next.delete('issue')
              setSearchParams(next, { replace: true })
            }}
          />
        ) : null}
        <div className="flex flex-col gap-3 border-b border-ink-200 px-4 py-3.5">
          <PeriodPicker period={period} />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
              />
              <input
                className="input pl-9"
                placeholder="거래처, 적요, 항목, 결의번호 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="input sm:w-56"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="">전체 프로젝트</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {isReport ? (
              <select
                className="input sm:w-44"
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
              >
                <option value="">전체 직원</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
                <option value="ex">기타</option>
                <option value="__none">미지정</option>
              </select>
            ) : null}

            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={() => setOldestFirst((v) => !v)}
              title="일자 정렬 전환"
            >
              <Icon name={oldestFirst ? 'arrow-up' : 'arrow-down'} size={16} />
              <span className="hidden sm:inline">일자 {oldestFirst ? '오래된순' : '최신순'}</span>
            </button>
            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={() => setReloadKey((k) => k + 1)}
              title="새로고침"
            >
              <Icon name="refresh" size={16} />
              <span className="hidden sm:inline">새로고침</span>
            </button>
          </div>
        </div>

        {loading ? (
          <LoadingBlock />
        ) : (
          <EntryTable
            entries={shown}
            projects={projects}
            profiles={profiles}
            attachmentsByEntry={attachmentsByEntry}
            highlightIds={highlightIds}
            highlightIssue={highlightIssue}
            canEdit
            onEdit={(entry) => {
              setEditing({
                ...entry,
                attachments: attachmentsByEntry[entry.id] || [],
              })
              setFormOpen(true)
            }}
            onDelete={(entry) => setRemoving(entry)}
            onOpenAttachments={setViewerFiles}
            bulkEdit={bulkEdit}
            categories={CATEGORIES[type] || []}
            onSaveRow={handleSaveRow}
            onBulkDelete={isAdmin ? setRemovingMany : undefined}
            canChangeAuthor={isAdmin}
            canEditEntry={ownRow}
            canDeleteEntry={ownRow}
          />
        )}
      </div>

      <EntryFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSaved={() => {
          if (editing?.id) clearHighlightFor(editing.id)
          setReloadKey((k) => k + 1)
        }}
        entryType={type}
        source={source}
        initial={editing}
        projects={projects}
        profiles={profiles}
        partnerNames={partnerNames}
        isAdmin={isAdmin}
        userId={user?.id}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="내역을 삭제하시겠습니까?"
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

      <ConfirmDialog
        open={Boolean(removingMany)}
        busy={busy}
        title="선택한 내역을 삭제하시겠습니까?"
        message={removingMany ? `${removingMany.length}건, 삭제하면 되돌릴 수 없습니다.` : ''}
        onClose={() => setRemovingMany(null)}
        onConfirm={handleDeleteMany}
      />

      <AttachmentModal
        open={Boolean(viewerFiles)}
        onClose={() => setViewerFiles(null)}
        attachments={viewerFiles || []}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false)
          setReloadKey((k) => k + 1)
        }}
        type={type}
        source={source}
        projects={projects}
        userId={user?.id}
        onDownloadTemplate={downloadTemplate}
      />

      {!loading && !shown.length && !search && !projectFilter && !personFilter ? (
        <p className="text-center text-xs text-ink-400">
          {isReport
            ? '직원이 올린 지출결의가 이곳에 쌓입니다.'
            : '기간을 넓히거나 새 내역을 등록해 보세요.'}
        </p>
      ) : null}
    </div>
  )
}

/* --------------------------- 데이터 점검 하이라이트 배너 --------------------------- */

function HighlightBanner({ count, issue, onClear }) {
  const label = ISSUE_META[issue]?.label || '점검'
  const hint = ISSUE_META[issue]?.hint || '지적된 내역입니다'
  const strong = issue === 'duplicate' || issue === 'broken'
  return (
    <div
      className={`flex items-center gap-2 border-b px-4 py-2.5 text-xs ${
        strong ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      <span className="min-w-0 flex-1">
        <strong className="font-bold">
          데이터 점검({label})에서 이동
        </strong>{' '}
        · {hint} · {count}건을 {strong ? '빨간색' : '노란색'}으로 표시합니다.
      </span>
      <button type="button" onClick={onClear} className="shrink-0 font-bold hover:underline">
        표시 해제
      </button>
    </div>
  )
}

/* --------------------------- CSV 일괄 등록 --------------------------- */

function ImportModal({ open, onClose, onDone, type, source, projects, userId, onDownloadTemplate }) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setRows([])
      setError('')
    }
  }, [open])

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      if (parsed.length < 2) throw new Error('데이터 행이 없습니다.')

      const header = parsed[0].map((h) => String(h).trim())
      const indexOf = (name) => header.indexOf(name)
      const iDate = indexOf('일자')
      const iSupply = indexOf('공급가액')
      if (iDate < 0 || iSupply < 0) throw new Error('"일자" 와 "공급가액" 열이 필요합니다.')

      const projectByName = new Map(projects.map((p) => [p.name.trim(), p.id]))
      const out = []
      for (const raw of parsed.slice(1)) {
        const date = String(raw[iDate] || '').trim().replace(/[./]/g, '-')
        if (!date) continue
        const projectLabel = indexOf('프로젝트') >= 0 ? String(raw[indexOf('프로젝트')] || '').trim() : ''
        out.push({
          entry_type: type,
          source,
          entry_date: date,
          counterparty: indexOf('거래처') >= 0 ? String(raw[indexOf('거래처')] || '').trim() : '',
          category: indexOf('항목') >= 0 ? String(raw[indexOf('항목')] || '').trim() : '',
          description: indexOf('적요') >= 0 ? String(raw[indexOf('적요')] || '').trim() : '',
          supply_amount: parseAmount(raw[iSupply]),
          vat_amount: indexOf('부가세') >= 0 ? parseAmount(raw[indexOf('부가세')]) : 0,
          payment_method: indexOf('결제수단') >= 0 ? String(raw[indexOf('결제수단')] || '').trim() : '',
          memo: indexOf('비고') >= 0 ? String(raw[indexOf('비고')] || '').trim() : '',
          project_id: projectByName.get(projectLabel) || null,
          created_by: userId,
          requester_id: source === 'expense_report' ? userId : null,
        })
      }

      if (!out.length) throw new Error('등록할 행을 찾지 못했습니다.')
      setRows(out)
    } catch (err) {
      setRows([])
      setError(err.message)
    }
  }

  const submit = async () => {
    setSaving(true)
    try {
      await createEntries(rows)
      toast.success(`${rows.length}건이 등록되었습니다.`)
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="CSV 일괄등록"
      subtitle="엑셀에서 정리한 내역을 한 번에 올릴 수 있습니다."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving || !rows.length}>
            {saving ? '등록 중…' : `${rows.length}건 등록`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-ghost cursor-pointer">
            <Icon name="upload" size={16} />
            CSV 파일 선택
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </label>
          <button type="button" className="btn-ghost" onClick={onDownloadTemplate}>
            <Icon name="download" size={16} />
            양식 다운로드
          </button>
        </div>

        <div className="rounded-lg border border-ink-200 bg-ink-50/60 p-3.5 text-xs leading-relaxed text-ink-600">
          <p className="font-semibold text-ink-700">필수 열</p>
          <p>일자(YYYY-MM-DD), 공급가액</p>
          <p className="mt-2 font-semibold text-ink-700">선택 열</p>
          <p>거래처, 항목, 적요, 부가세, 결제수단, 비고, 프로젝트(이름이 정확히 일치해야 연결됩니다)</p>
        </div>

        {error ? <p className="text-sm font-medium text-loss">{error}</p> : null}

        {rows.length ? (
          <div className="overflow-hidden rounded-lg border border-ink-200">
            <p className="border-b border-ink-200 bg-ink-50 px-3.5 py-2 text-xs font-bold text-ink-700">
              미리보기 · 총 {rows.length}건
            </p>
            <div className="max-h-64 overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-xs">
                <thead className="bg-white">
                  <tr>
                    <th className="th">일자</th>
                    <th className="th">거래처</th>
                    <th className="th">항목</th>
                    <th className="th">적요</th>
                    <th className="th text-right">공급가액</th>
                    <th className="th text-right">부가세</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.slice(0, 20).map((row, index) => (
                    <tr key={index}>
                      <td className="td py-2 text-xs">{row.entry_date}</td>
                      <td className="td py-2 text-xs">{row.counterparty}</td>
                      <td className="td py-2 text-xs">{row.category}</td>
                      <td className="td py-2 text-xs">{row.description}</td>
                      <td className="td num py-2 text-xs">{formatKRW(row.supply_amount)}</td>
                      <td className="td num py-2 text-xs">{formatKRW(row.vat_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 20 ? (
                <p className="border-t border-ink-100 px-3.5 py-2 text-xs text-ink-500">
                  외 {rows.length - 20}건
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState
            icon="upload"
            title="파일을 선택해 주세요"
            description="양식을 내려받아 작성한 뒤 그대로 올리면 됩니다."
          />
        )}
      </div>
    </Modal>
  )
}
