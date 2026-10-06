import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { AmountInput } from './ui'
import { AttachmentCell } from './Attachments'
import { ENTRY_META } from '../lib/constants'
import { formatDateHuman, formatKRW } from '../lib/format'
import { ISSUE_META } from '../lib/validate'
import { useToast } from './Toast'

function personName(profiles, id) {
  if (!id) return '—'
  const p = profiles.find((x) => x.id === id)
  return p?.full_name || p?.email || '—'
}

/**
 * 작성자 표기: 실제 쓴 사람 우선.
 * 결의자(지출자) → 메모의 이용자(E·SH 같은 퇴사자/외부인 포함) → 등록자(입력한 사람) → 미지정 순
 */
function memoUser(entry) {
  const m = String(entry.memo || '').match(/이용자\s+([^·]+)/)
  return m ? m[1].trim() : ''
}

function ownerLabel(profiles, entry) {
  if (entry.requester_id) return personName(profiles, entry.requester_id)
  if (memoUser(entry)) return memoUser(entry)
  if (entry.created_by) return personName(profiles, entry.created_by)
  return '미지정'
}

/** 법인카드 이용자: 메모의 "· 이용자 XXX" 에서 추출 */
function cardUser(entry) {
  return memoUser(entry)
}

export default function EntryTable({
  entries = [],
  projects = [],
  profiles = [],
  attachmentsByEntry = {},
  showType = false,
  canEdit = true,
  onEdit,
  onDelete,
  onOpenAttachments,
  emptyAction,
  /* 법인카드식 일괄편집 (운영비용) */
  bulkEdit = false,
  categories = [],
  onSaveRow = null,
  onBulkDelete = null,
  /* 등록자(작성자) 일괄 변경. 입사 전 자료 정정용이라 관리자 화면에서만 켭니다. */
  canChangeAuthor = false,
  /* 명세서 버튼 (급여관리). 주면 행마다 명세서 버튼이 생깁니다. */
  onSlip = null,
  /* 명세서가 저장된 행 id 목록. 버튼에 ✓가 붙습니다. */
  slipEntryIds = null,
  /* 명세서 버튼 라벨 (기본 '명세서') */
  slipLabel = '명세서',
  /* 행별 수정·삭제 가능 여부 (직원 본인 행만 허용할 때 사용) */
  canEditEntry = null,
  canDeleteEntry = null,
  /* 부가세 열 숨기기 (급여처럼 전부 0원일 때) */
  hideVat = false,
  /* 데이터 점검에서 넘어온 의심 항목 id 목록 → 색으로 표시 */
  highlightIds = [],
  highlightIssue = '',
  /* 이름별 추가 지급액 (급여 지출결의 등) → 실지급 열 표시 */
  extraPayMap = null,
  /* 출처 뱃지 (운영비 목록에서 지출결의분을 작게 구분) */
  showSource = false,
}) {
  const [rowEdits, setRowEdits] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [selected, setSelected] = useState({})
  const [bulkProject, setBulkProject] = useState('')
  const [bulkAuthor, setBulkAuthor] = useState('')
  const toast = useToast()

  const editable = bulkEdit && canEdit && typeof onSaveRow === 'function'

  /* 직원 id 집합: 지출결의 출처가 비어도 지출자가 직원이면 직원 입력분으로 봅니다 */
  const staffIdSet = useMemo(
    () => new Set((profiles || []).filter((p) => p && p.id && p.role !== 'admin').map((p) => p.id)),
    [profiles],
  )
  const isReportRow = (entry) => {
    if (!entry) return false
    if (entry.source === 'expense_report') return true
    return Boolean(entry.requester_id && staffIdSet.has(entry.requester_id))
  }

  const hlSet = useMemo(() => new Set((highlightIds || []).map(String)), [highlightIds])

  /* 사유별 색: 중복·깨짐은 빨강, 부가세·표기는 노랑, 누락은 파랑 */
  const hlLabel = ISSUE_META[highlightIssue]?.label || '점검'
  const hlRow = highlightIssue === 'duplicate' || highlightIssue === 'broken'
    ? 'bg-rose-50 transition hover:bg-rose-100/70'
    : highlightIssue === 'field'
      ? 'bg-sky-50 transition hover:bg-sky-100/70'
      : 'bg-amber-50 transition hover:bg-amber-100/70'
  const hlChip = highlightIssue === 'duplicate' || highlightIssue === 'broken'
    ? 'bg-rose-500 text-white'
    : highlightIssue === 'field'
      ? 'bg-sky-500 text-white'
      : 'bg-amber-400 text-white'

  /* 점검 항목으로 이동하면 첫 번째 의심 행으로 스크롤합니다 */
  useEffect(() => {
    if (!hlSet.size || !entries.length) return
    const first = entries.find((e) => hlSet.has(String(e.id)))
    if (!first) return
    const t = window.setTimeout(() => {
      document.getElementById(`entry-${first.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [hlSet, entries])

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

  const saveRow = async (entry, silent = false) => {
    const patch = rowEdits[entry.id]
    if (!patch) return true
    const work = { ...entry, ...patch }
    if (!work.entry_date || !String(work.counterparty || '').trim()) return false
    setSavingId(entry.id)
    try {
      const saved = await onSaveRow(entry, {
        entry_date: work.entry_date,
        counterparty: String(work.counterparty).trim(),
        description: String(work.description || '').trim(),
        project_id: work.project_id || null,
        category: work.category || '',
        supply_amount: Number(work.supply_amount) || 0,
        vat_amount: Number(work.vat_amount) || 0,
        ...(work.created_by !== undefined ? { created_by: work.created_by || null } : {}),
      })
      if (saved && saved.id) {
        entry.supply_amount = saved.supply_amount ?? work.supply_amount
        entry.vat_amount = saved.vat_amount ?? work.vat_amount
        entry.total_amount = saved.total_amount ?? Number(work.supply_amount || 0) + Number(work.vat_amount || 0)
        entry.entry_date = saved.entry_date ?? work.entry_date
        entry.counterparty = saved.counterparty ?? work.counterparty
        entry.description = saved.description ?? work.description
        entry.project_id = saved.project_id ?? work.project_id ?? null
        entry.category = saved.category ?? work.category ?? ''
        if (work.created_by !== undefined) entry.created_by = saved.created_by ?? work.created_by ?? null
      }
      cancelRow(entry.id)
      return true
    } catch (err) {
      if (!silent) toast.error(`저장하지 못했습니다: ${err?.message || '알 수 없는 오류'}`)
      return false
    } finally {
      setSavingId(null)
    }
  }

  const saveAllDirty = async () => {
    const targets = entries.filter((e) => rowEdits[e.id])
    if (!targets.length) return
    setBulkSaving(true)
    try {
      for (const entry of targets) {
        // eslint-disable-next-line no-await-in-loop
        await saveRow(entry, true)
      }
    } finally {
      setBulkSaving(false)
    }
  }

  const selectedIds = useMemo(() => entries.filter((e) => selected[e.id]).map((e) => e.id), [entries, selected])
  const selectedSum = useMemo(
    () => entries.filter((e) => selected[e.id]).reduce((a, e) => a + Number(e.total_amount || 0), 0),
    [entries, selected],
  )
  const dirtyCount = Object.keys(rowEdits).length

  const toggleSelectAll = (on) => {
    if (on) {
      const next = {}
      for (const e of entries) next[e.id] = true
      setSelected(next)
    } else {
      setSelected({})
    }
  }

  const applyBulkProject = () => {
    if (!bulkProject || !selectedIds.length) return
    setRowEdits((m) => {
      const next = { ...m }
      for (const id of selectedIds) next[id] = { ...(next[id] || {}), project_id: bulkProject }
      return next
    })
  }

  const applyBulkAuthor = () => {
    if (!selectedIds.length) return
    setRowEdits((m) => {
      const next = { ...m }
      for (const id of selectedIds) next[id] = { ...(next[id] || {}), created_by: bulkAuthor || null }
      return next
    })
  }

  const authorName = (id) => {
    if (!id) return '미지정'
    const p = profiles.find((x) => x.id === id)
    return p?.full_name || p?.email || '미지정'
  }

  if (!entries.length) {
    return (
      <div className="empty">
        <p className="font-semibold text-ink-600">내역이 없습니다</p>
        <p className="mt-1 text-xs text-ink-400">조건을 바꾸거나 새 내역을 등록해 보세요.</p>
        {emptyAction ? <div className="mt-4">{emptyAction}</div> : null}
      </div>
    )
  }

  const extraTotal = extraPayMap
    ? (() => {
        const seen = new Set()
        let s = 0
        for (const e of entries) {
          const n = String(e.counterparty || '').trim()
          if (n && !seen.has(n)) {
            seen.add(n)
            s += Number(extraPayMap[n] || 0)
          }
        }
        return s
      })()
    : 0
  const totals = entries.reduce(
    (acc, e) => {
      acc.supply += Number(e.supply_amount || 0)
      acc.vat += Number(e.vat_amount || 0)
      acc.total += Number(e.total_amount || 0)
      return acc
    },
    { supply: 0, vat: 0, total: 0 },
  )
  const leadCols = (showType ? 6 : 5) + (editable ? 1 : 0)

  const bulkBars = editable ? (
    <>
      {selectedIds.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-brand-50/50 px-4 py-2.5 text-xs">
          <span className="font-semibold text-ink-800">
            {selectedIds.length}건 선택됨 (합계 {formatKRW(selectedSum)}원)
          </span>
          <select
            className="input w-auto py-1 text-xs"
            value={bulkProject}
            onChange={(e) => setBulkProject(e.target.value)}
          >
            <option value="">프로젝트 선택</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyBulkProject}
            disabled={!bulkProject}
            className="font-bold text-brand-700 hover:underline disabled:opacity-50"
          >
            일괄 적용
          </button>
          {canChangeAuthor ? (
            <>
              <select
                className="input w-auto py-1 text-xs"
                value={bulkAuthor}
                onChange={(e) => setBulkAuthor(e.target.value)}
                title="선택한 행의 등록자를 바꿉니다"
              >
                <option value="">등록자 선택</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyBulkAuthor}
                className="font-bold text-brand-700 hover:underline"
              >
                등록자 적용
              </button>
            </>
          ) : null}
          {typeof onBulkDelete === 'function' ? (
            <button
              type="button"
              onClick={() => onBulkDelete(selectedIds)}
              className="font-bold text-loss hover:underline"
            >
              선택 삭제
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSelected({})}
            className="font-semibold text-ink-500 hover:underline"
          >
            선택 해제
          </button>
        </div>
      ) : null}
      {dirtyCount ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-brand-50/50 px-4 py-2.5 text-xs">
          <span className="font-semibold text-ink-800">수정 중 {dirtyCount}건</span>
          <button
            type="button"
            onClick={saveAllDirty}
            disabled={bulkSaving}
            className="font-bold text-brand-700 hover:underline disabled:opacity-50"
          >
            {bulkSaving ? '저장 중…' : '일괄 저장'}
          </button>
        </div>
      ) : null}
    </>
  ) : null

  return (
    <>
      {/* 데스크톱 표 */}
      <div className="hidden overflow-x-auto lg:block">
        {bulkBars}
        <table className="w-full min-w-[1080px] border-collapse">
          <thead className="border-b border-ink-200 bg-ink-50/70">
            <tr>
              {editable ? (
                <th className="th w-10 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={entries.length > 0 && selectedIds.length === entries.length}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    aria-label="전체 선택"
                  />
                </th>
              ) : null}
              <th className="th">일자</th>
              {showType ? <th className="th">유형</th> : null}
              <th className="th">프로젝트</th>
              <th className="th">거래처 / 사용처</th>
              <th className="th">항목</th>
              <th className="th">적요</th>
              <th className="th text-right">공급가액</th>
              {hideVat ? null : <th className="th text-right">부가세</th>}
              <th className="th text-right">합계</th>
              {extraPayMap ? <th className="th text-right">실지급</th> : null}
              <th className="th">증빙</th>
              <th className="th">작성자</th>
              <th className="th text-right">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {entries.map((entry) => {
              const project = projects.find((p) => p.id === entry.project_id)
              const meta = ENTRY_META[entry.entry_type]
              const files = attachmentsByEntry[entry.id] || []
              const edit = rowEdits[entry.id] || {}
              const work = { ...entry, ...edit }
              const dirty = Object.keys(edit).length > 0
              const saving = savingId === entry.id
              const hl = hlSet.has(String(entry.id))
              return (
                <tr
                  key={entry.id}
                  id={`entry-${entry.id}`}
                  className={
                    hl
                      ? `${hlRow} ring-1 ring-inset ${highlightIssue === 'duplicate' || highlightIssue === 'broken' ? 'ring-rose-300' : highlightIssue === 'field' ? 'ring-sky-300' : 'ring-amber-300'}`
                      : dirty
                        ? 'bg-brand-50/40 transition'
                        : 'transition hover:bg-ink-50/60'
                  }
                >
                  {editable ? (
                    <td className="td text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        checked={Boolean(selected[entry.id])}
                        onChange={(e) =>
                          setSelected((m) => ({ ...m, [entry.id]: e.target.checked || undefined }))
                        }
                        aria-label="선택"
                      />
                    </td>
                  ) : null}
                  <td className="td whitespace-nowrap font-medium">
                    {hl ? (
                      <span className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${hlChip}`}>
                        {hlLabel}
                      </span>
                    ) : null}
                    {editable ? (
                      <input
                        type="date"
                        className="input w-auto py-1 text-xs"
                        value={work.entry_date || ''}
                        onChange={(e) => setCell(entry.id, { entry_date: e.target.value })}
                      />
                    ) : (
                      formatDateHuman(entry.entry_date)
                    )}
                  </td>
                  {showType ? (
                    <td className="td">
                      <span className={`chip ${meta?.chip || 'bg-ink-100 text-ink-600'}`}>{meta?.label}</span>
                    </td>
                  ) : null}
                  <td className="td max-w-[190px] truncate">
                    {editable ? (
                      <select
                        className="input w-full py-1 text-xs"
                        value={work.project_id || ''}
                        onChange={(e) => setCell(entry.id, { project_id: e.target.value })}
                      >
                        <option value="">미지정</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : project ? (
                      <span className="text-ink-800">{project.name}</span>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                  <td className="td max-w-[190px] truncate">
                    {editable ? (
                      <input
                        className="input w-full py-1 text-xs"
                        value={work.counterparty || ''}
                        onChange={(e) => setCell(entry.id, { counterparty: e.target.value })}
                      />
                    ) : (
                      entry.counterparty || <span className="text-ink-300">—</span>
                    )}
                  </td>
                  <td className="td max-w-[130px] truncate">
                    {editable ? (
                      <select
                        className="input w-full py-1 text-xs"
                        value={work.category || ''}
                        onChange={(e) => setCell(entry.id, { category: e.target.value })}
                      >
                        <option value="">미분류</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : entry.category ? (
                      <span className="chip bg-ink-100 text-ink-600">{entry.category}</span>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                    {showSource && isReportRow(entry) ? (
                      <span className="ml-1 chip bg-violet-50 text-violet-700" title="지출결의·직원 입력분">지결</span>
                    ) : null}
                  </td>
                  <td className="td max-w-[150px] truncate">
                    {editable ? (
                      <input
                        className="input w-full py-1 text-xs"
                        value={work.description || ''}
                        onChange={(e) => setCell(entry.id, { description: e.target.value })}
                      />
                    ) : (
                      entry.description || <span className="text-ink-300">—</span>
                    )}
                  </td>
                  <td className="td num">
                    {editable ? (
                      <AmountInput
                        className="input w-24 py-1 text-right text-xs"
                        value={work.supply_amount ?? 0}
                        onChange={(e) => setCell(entry.id, { supply_amount: Number(e.target.value) || 0 })}
                      />
                    ) : (
                      formatKRW(entry.supply_amount)
                    )}
                  </td>
                  {hideVat ? null : (
                  <td className="td num">
                    {editable ? (
                      <AmountInput
                        className="input w-24 py-1 text-right text-xs"
                        value={work.vat_amount ?? 0}
                        onChange={(e) => setCell(entry.id, { vat_amount: Number(e.target.value) || 0 })}
                      />
                    ) : (
                      formatKRW(entry.vat_amount)
                    )}
                  </td>
                  )}
                  <td className="td num font-bold text-ink-900">
                    {editable
                      ? formatKRW(Number(work.supply_amount || 0) + Number(work.vat_amount || 0))
                      : formatKRW(entry.total_amount)}
                  </td>
                  {extraPayMap ? (
                    <td className="td num font-bold text-brand-700">
                      {formatKRW(Number(entry.total_amount || 0) + Number(extraPayMap[String(entry.counterparty || '').trim()] || 0))}
                    </td>
                  ) : null}
                  <td className="td">
                    <AttachmentCell attachments={files} onOpen={onOpenAttachments} />
                  </td>
                  <td className="td max-w-[130px] truncate text-xs text-ink-500">
                    {(() => {
                      const own = ownerLabel(profiles, work)
                      const use = cardUser(entry)
                      // 작성자가 있으면 작성자로, 없으면 이용자만. 등록자는 일괄 입력이라서 뺍니다.
                      if (own && own !== '미지정') {
                        return (
                          <>
                            작성자 {own}
                            {use && use !== own ? (
                              <span className="block truncate text-[11px] text-brand-700">이용자 {use}</span>
                            ) : null}
                          </>
                        )
                      }
                      return use ? <>이용자 {use}</> : '미지정'
                    })()}
                    {dirty && work.created_by !== undefined ? (
                      <span className="block truncate text-[11px] text-brand-700">→ {authorName(work.created_by)}</span>
                    ) : null}
                  </td>
                  <td className="td">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {onSlip ? (
                          <button
                            type="button"
                            onClick={() => onSlip?.(entry)}
                            className="rounded-md px-1.5 py-1.5 text-xs font-semibold text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                            title={slipEntryIds?.has?.(entry.id) ? '명세서 보기·수정' : '명세서 작성'}
                          >
                            {slipLabel}
                            {slipEntryIds?.has?.(entry.id) ? ' ✓' : ''}
                          </button>
                        ) : null}
                        {(!canEditEntry || canEditEntry(entry)) && onEdit && !(editable && dirty) ? (
                          <button
                            type="button"
                            onClick={() => onEdit?.(entry)}
                            className="rounded-md p-1.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                            aria-label="수정"
                            title="수정"
                          >
                            <Icon name="pencil" size={15} />
                          </button>
                        ) : null}
                        {editable && dirty ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveRow(entry)}
                              disabled={saving}
                              className="rounded-md px-1.5 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-50 disabled:opacity-50"
                            >
                              {saving ? '저장 중' : '저장'}
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelRow(entry.id)}
                              disabled={saving}
                              className="rounded-md px-1.5 py-1.5 text-xs font-semibold text-ink-400 transition hover:bg-ink-100 disabled:opacity-50"
                            >
                              취소
                            </button>
                          </>
                        ) : null}
                        {onDelete && (!canDeleteEntry || canDeleteEntry(entry)) ? (
                          <button
                            type="button"
                            onClick={() => onDelete?.(entry)}
                            className="rounded-md p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-loss"
                            aria-label="삭제"
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="block text-right text-xs text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-ink-200 bg-ink-50/80">
            <tr>
              <td className="td font-bold" colSpan={leadCols}>
                합계 ({entries.length}건)
              </td>
              <td className="td num font-bold">{formatKRW(totals.supply)}</td>
              {hideVat ? null : <td className="td num font-bold">{formatKRW(totals.vat)}</td>}
              <td className="td num font-extrabold text-ink-900">{formatKRW(totals.total)}</td>
              {extraPayMap ? (
                <td className="td num font-extrabold text-ink-900">{formatKRW(totals.total + extraTotal)}</td>
              ) : null}
              <td className="td" colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 모바일 카드 */}
      <div className="lg:hidden">
        {bulkBars}
        <ul className="flex flex-col divide-y divide-ink-100">
          {entries.map((entry) => {
            const project = projects.find((p) => p.id === entry.project_id)
            const meta = ENTRY_META[entry.entry_type]
            const files = attachmentsByEntry[entry.id] || []
            const edit = rowEdits[entry.id] || {}
            const work = { ...entry, ...edit }
            const dirty = Object.keys(edit).length > 0
            const saving = savingId === entry.id
            const hl = hlSet.has(String(entry.id))
            return (
              <li
                key={entry.id}
                id={`entry-${entry.id}`}
                className={
                  hl
                    ? `${hlRow} px-4 py-3.5`
                    : dirty
                      ? 'bg-brand-50/40 px-4 py-3.5'
                      : 'px-4 py-3.5'
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    {editable ? (
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
                        checked={Boolean(selected[entry.id])}
                        onChange={(e) =>
                          setSelected((m) => ({ ...m, [entry.id]: e.target.checked || undefined }))
                        }
                        aria-label="선택"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {hl ? (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${hlChip}`}>
                            {hlLabel}
                          </span>
                        ) : null}
                        {showType ? (
                          <span className={`chip ${meta?.chip || 'bg-ink-100 text-ink-600'}`}>{meta?.label}</span>
                        ) : null}
                        <span className="text-xs font-semibold text-ink-500">
                          {formatDateHuman(entry.entry_date)}
                        </span>
                        {entry.category ? (
                          <span className="chip bg-ink-100 text-ink-600">{entry.category}</span>
                        ) : null}
                        {showSource && isReportRow(entry) ? (
                          <span className="chip bg-violet-50 text-violet-700">지결</span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 truncate text-sm font-bold text-ink-900">
                        {entry.description || entry.counterparty || '(내용 없음)'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {entry.counterparty || '—'}
                        {(() => {
                          const own = ownerLabel(profiles, entry)
                          const use = cardUser(entry)
                          if (own && own !== '미지정') {
                            return ` · 작성자 ${own}${use && use !== own ? ` · 이용자 ${use}` : ''}`
                          }
                          return use ? ` · 이용자 ${use}` : ' · 미지정'
                        })()}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-num text-sm font-extrabold tabular-nums text-ink-900">
                      {formatKRW(entry.total_amount)}
                    </p>
                    <p className="text-[11px] text-ink-400">공급 {formatKRW(entry.supply_amount)}</p>
                    {extraPayMap && Number(extraPayMap[String(entry.counterparty || '').trim()] || 0) ? (
                      <p className="text-[11px] font-bold text-brand-700">
                        실지급 {formatKRW(Number(entry.total_amount || 0) + Number(extraPayMap[String(entry.counterparty || '').trim()] || 0))}
                      </p>
                    ) : null}
                  </div>
                </div>

                {editable ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    <select
                      className="input min-w-0 flex-1 py-1.5 text-xs"
                      value={work.project_id || ''}
                      onChange={(e) => setCell(entry.id, { project_id: e.target.value })}
                      aria-label="프로젝트"
                    >
                      <option value="">프로젝트 미지정</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {dirty ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveRow(entry)}
                          disabled={saving}
                          className="shrink-0 text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                        >
                          {saving ? '저장 중' : '저장'}
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelRow(entry.id)}
                          disabled={saving}
                          className="shrink-0 text-xs font-semibold text-ink-400 hover:underline disabled:opacity-50"
                        >
                          취소
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : (
                  project ? (
                    <p className="mt-1.5 truncate text-xs text-ink-500">{project.name}</p>
                  ) : null
                )}

                <div className="mt-2.5 flex items-center justify-between">
                  <AttachmentCell attachments={files} onOpen={onOpenAttachments} />
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      {onSlip ? (
                        <button
                          type="button"
                          onClick={() => onSlip?.(entry)}
                          className="btn-ghost px-2.5 py-1.5 text-xs"
                          title={slipEntryIds?.has?.(entry.id) ? '명세서 보기·수정' : '명세서 작성'}
                        >
                          {slipLabel}
                          {slipEntryIds?.has?.(entry.id) ? ' ✓' : ''}
                        </button>
                      ) : null}
                      {(!canEditEntry || canEditEntry(entry)) && onEdit ? (
                        <button type="button" onClick={() => onEdit?.(entry)} className="btn-ghost px-2.5 py-1.5 text-xs">
                          <Icon name="pencil" size={13} />
                          수정
                        </button>
                      ) : null}
                      {onDelete && (!canDeleteEntry || canDeleteEntry(entry)) ? (
                        <button
                          type="button"
                          onClick={() => onDelete?.(entry)}
                          className="btn-ghost px-2.5 py-1.5 text-xs text-loss"
                        >
                          <Icon name="trash" size={13} />
                          삭제
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
          <li className="bg-ink-50/80 px-4 py-3">
            <div className="flex items-center justify-between text-sm font-bold text-ink-900">
              <span>합계 ({entries.length}건)</span>
              <span className="font-num tabular-nums text-ink-900">{formatKRW(totals.total)}원</span>
            </div>
          </li>
        </ul>
      </div>
    </>
  )
}
