import { useMemo, useState } from 'react'
import Icon from './Icon'
import { AttachmentCell } from './Attachments'
import { ENTRY_META } from '../lib/constants'
import { formatDateHuman, formatKRW } from '../lib/format'

function personName(profiles, id) {
  if (!id) return '—'
  const p = profiles.find((x) => x.id === id)
  return p?.full_name || p?.email || '—'
}

/** 작성자 표기: 결의자 → 등록자 → 카드 이용자 → 미지정 순 */
function ownerLabel(profiles, entry) {
  if (entry.requester_id) return personName(profiles, entry.requester_id)
  if (entry.created_by) return personName(profiles, entry.created_by)
  if (cardUser(entry)) return cardUser(entry)
  if (entry.source === 'expense_report') {
    const m = String(entry.memo || '').match(/([A-Z]+)\s*지결/)
    if (m) return '기타'
  }
  return '미지정'
}

/** 법인카드 이용자: 메모의 "· 이용자 XXX" 에서 추출 */
function cardUser(entry) {
  const m = String(entry.memo || '').match(/이용자\s+([^·]+)/)
  return m ? m[1].trim() : ''
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
}) {
  const [rowEdits, setRowEdits] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [selected, setSelected] = useState({})
  const [bulkProject, setBulkProject] = useState('')

  const editable = bulkEdit && canEdit && typeof onSaveRow === 'function'

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
      }
      cancelRow(entry.id)
      return true
    } catch {
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

  if (!entries.length) {
    return (
      <div className="empty">
        <p className="font-semibold text-ink-600">내역이 없습니다</p>
        <p className="mt-1 text-xs text-ink-400">조건을 바꾸거나 새 내역을 등록해 보세요.</p>
        {emptyAction ? <div className="mt-4">{emptyAction}</div> : null}
      </div>
    )
  }

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
              <th className="th text-right">부가세</th>
              <th className="th text-right">합계</th>
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
              return (
                <tr key={entry.id} className={dirty ? 'bg-brand-50/40 transition' : 'transition hover:bg-ink-50/60'}>
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
                      <input
                        type="number"
                        className="input w-24 py-1 text-right text-xs"
                        value={work.supply_amount ?? 0}
                        onChange={(e) => setCell(entry.id, { supply_amount: Number(e.target.value) || 0 })}
                      />
                    ) : (
                      formatKRW(entry.supply_amount)
                    )}
                  </td>
                  <td className="td num">
                    {editable ? (
                      <input
                        type="number"
                        className="input w-24 py-1 text-right text-xs"
                        value={work.vat_amount ?? 0}
                        onChange={(e) => setCell(entry.id, { vat_amount: Number(e.target.value) || 0 })}
                      />
                    ) : (
                      formatKRW(entry.vat_amount)
                    )}
                  </td>
                  <td className="td num font-bold text-ink-900">
                    {editable
                      ? formatKRW(Number(work.supply_amount || 0) + Number(work.vat_amount || 0))
                      : formatKRW(entry.total_amount)}
                  </td>
                  <td className="td">
                    <AttachmentCell attachments={files} onOpen={onOpenAttachments} />
                  </td>
                  <td className="td max-w-[130px] truncate text-xs text-ink-500">
                    {ownerLabel(profiles, entry)}
                    {cardUser(entry) && cardUser(entry) !== ownerLabel(profiles, entry) ? (
                      <span className="block truncate text-[11px] text-brand-700">이용자 {cardUser(entry)}</span>
                    ) : null}
                  </td>
                  <td className="td">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onEdit?.(entry)}
                          className="rounded-md px-1.5 py-1.5 text-xs font-semibold text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                          title="상세"
                        >
                          상세
                        </button>
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
                        ) : (
                          <button
                            type="button"
                            onClick={() => onEdit?.(entry)}
                            className="rounded-md p-1.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                            aria-label="수정"
                          >
                            <Icon name="pencil" size={15} />
                          </button>
                        )}
                        {onDelete ? (
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
              <td className="td num font-bold">{formatKRW(totals.vat)}</td>
              <td className="td num font-extrabold text-brand-700">{formatKRW(totals.total)}</td>
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
            return (
              <li key={entry.id} className={dirty ? 'bg-brand-50/40 px-4 py-3.5' : 'px-4 py-3.5'}>
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
                        {showType ? (
                          <span className={`chip ${meta?.chip || 'bg-ink-100 text-ink-600'}`}>{meta?.label}</span>
                        ) : null}
                        <span className="text-xs font-semibold text-ink-500">
                          {formatDateHuman(entry.entry_date)}
                        </span>
                        {entry.category ? (
                          <span className="chip bg-ink-100 text-ink-600">{entry.category}</span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 truncate text-sm font-bold text-ink-900">
                        {entry.description || entry.counterparty || '(내용 없음)'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {entry.counterparty || '—'}
                        {` · 작성자 ${ownerLabel(profiles, entry)}`}
                        {cardUser(entry) ? ` · 이용자 ${cardUser(entry)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-num text-sm font-extrabold tabular-nums text-ink-900">
                      {formatKRW(entry.total_amount)}
                    </p>
                    <p className="text-[11px] text-ink-400">공급 {formatKRW(entry.supply_amount)}</p>
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
                      <button type="button" onClick={() => onEdit?.(entry)} className="btn-ghost px-2.5 py-1.5 text-xs">
                        <Icon name="pencil" size={13} />
                        수정
                      </button>
                      {onDelete ? (
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
              <span className="font-num tabular-nums text-brand-700">{formatKRW(totals.total)}원</span>
            </div>
          </li>
        </ul>
      </div>
    </>
  )
}
