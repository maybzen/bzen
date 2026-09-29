import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { ConfirmDialog, EmptyState, Field, InlineAlert, Modal, Spinner } from './ui'
import { useToast } from './Toast'
import { addChecklistItem, deleteChecklistItem, updateChecklistItem } from '../lib/api'
import {
  SCHEDULE_LIST,
  buildSchedule,
  dday,
  ddayLabel,
  monthGrid,
  monthTitle,
} from '../lib/schedule'
import { formatDateHuman, todayISO } from '../lib/format'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']

function shiftMonth(year, month1, delta) {
  const d = new Date(year, month1 - 1 + delta, 1)
  return [d.getFullYear(), d.getMonth() + 1]
}

export default function ScheduleModal({
  open,
  onClose,
  loans = [],
  manuals = [],
  dateSupported = false,
  userId = null,
  onChanged,
}) {
  const toast = useToast()
  const today = todayISO()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)))
  const [selected, setSelected] = useState(today)
  const [text, setText] = useState('')
  const [date, setDate] = useState(today)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [editDate, setEditDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState(null)

  useEffect(() => {
    if (!open) return
    setError('')
    setEditingId(null)
    setConfirmId(null)
    const t = todayISO()
    setSelected(t)
    setDate(t)
    setYear(Number(t.slice(0, 4)))
    setMonth(Number(t.slice(5, 7)))
  }, [open ])

  const grid = useMemo(() => monthGrid(year, month), [year, month])
  const monthItems = useMemo(
    () =>
      buildSchedule({ loans, manuals, fromISO: grid[0], toISO: grid[grid.length - 1] }),
    [loans, manuals, grid],
  )
  const byDate = useMemo(() => {
    const m = new Map()
    for (const it of monthItems) {
      if (!it.date) continue
      if (!m.has(it.date)) m.set(it.date, [])
      m.get(it.date).push(it)
    }
    return m
  }, [monthItems])

  const upcoming = useMemo(() => {
    const base = todayISO()
    const end = new Date()
    end.setDate(end.getDate() + 30)
    const iso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    return buildSchedule({ loans, manuals, fromISO: '2000-01-01', toISO: iso }).filter(
      (it) => it.date && it.date >= base,
    )
  }, [loans, manuals])

  const selectedItems = useMemo(() => {
    const list = (byDate.get(selected) || []).slice()
    // 날짜 없는 수동 항목은 선택일에 상관없이 아래 별도로 보여줍니다
    return list
  }, [byDate, selected])

  const dateless = useMemo(() => manuals.filter((r) => !r.done && !r.due_date), [manuals])

  const reload = async () => {
    await onChanged?.()
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    setBusy(true)
    setError('')
    try {
      const extra = dateSupported && date ? { due_date: date } : {}
      await addChecklistItem(SCHEDULE_LIST, v, userId, extra)
      setText('')
      toast.success('일정이 등록되었습니다.')
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleDone = async (row) => {
    try {
      await updateChecklistItem(row.id, { done: !row.done })
      await reload()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const startEdit = (row) => {
    setEditingId(row.id)
    setEditText(row.text)
    setEditDate(row.due_date || '')
  }

  const saveEdit = async () => {
    if (!editingId) return
    const v = editText.trim()
    if (!v) return
    setBusy(true)
    try {
      const patch = { text: v }
      if (dateSupported) patch.due_date = editDate || null
      await updateChecklistItem(editingId, patch)
      setEditingId(null)
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!confirmId) return
    setBusy(true)
    try {
      await deleteChecklistItem(confirmId)
      setConfirmId(null)
      toast.success('삭제되었습니다.')
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const go = (delta) => {
    const [y, m] = shiftMonth(year, month, delta)
    setYear(y)
    setMonth(m)
  }

  const chipTone = (d) => {
    if (d === null) return 'bg-ink-100 text-ink-500'
    if (d < 0) return 'bg-rose-100 text-rose-700'
    if (d === 0) return 'bg-rose-500 text-white'
    if (d <= 3) return 'bg-amber-100 text-amber-800'
    return 'bg-ink-100 text-ink-600'
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="일정"
        subtitle="자동이체·세금 납부일은 자동 계산, 나머지는 직접 등록합니다."
        size="lg"
      >
        <div className="flex flex-col gap-4">
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          {!dateSupported ? (
            <InlineAlert tone="info">
              날짜 지정은 SQL 1회 실행 후 켜집니다
              (supabase/migration_schedules.sql). 지금은 날짜 없이 등록됩니다.
            </InlineAlert>
          ) : null}

          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => go(-1)}>
              <Icon name="chevron-left" size={14} /> 이전 달
            </button>
            <p className="text-sm font-bold text-ink-900">{monthTitle(year, month)}</p>
            <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => go(1)}>
              다음 달 <Icon name="chevron-right" size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEK.map((w, i) => (
              <p key={w} className={`pb-1 text-[11px] font-bold ${i === 0 ? 'text-loss' : 'text-ink-400'}`}>
                {w}
              </p>
            ))}
            {grid.map((d) => {
              const inMonth = d.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`
              const items = byDate.get(d) || []
              const isToday = d === todayISO()
              const isSel = d === selected
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelected(d)}
                  className={`flex min-h-[44px] flex-col items-center gap-0.5 rounded-lg border px-1 py-1 text-[11px] transition ${
                    isSel
                      ? 'border-brand-500 bg-brand-50 font-bold text-brand-800'
                      : inMonth
                        ? 'border-transparent hover:border-ink-200 hover:bg-ink-50'
                        : 'border-transparent text-ink-300'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full tabular-nums ${
                      isToday ? 'bg-loss font-bold text-white' : ''
                    }`}
                  >
                    {Number(d.slice(8, 10))}
                  </span>
                  <span className="flex h-1.5 items-center gap-0.5">
                    {items.slice(0, 3).map((it) => (
                      <span
                        key={it.key}
                        title={it.title}
                        className={`h-1.5 w-1.5 rounded-full ${
                          it.kind === 'auto' ? 'bg-brand-500' : it.done ? 'bg-ink-200' : 'bg-amber-500'
                        }`}
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="rounded-xl border border-ink-200 bg-white px-3.5 py-3">
            <p className="mb-2 text-xs font-bold text-ink-900">
              {formatDateHuman(selected)}
              <span className="ml-1.5 font-medium text-ink-400">{selectedItems.length}건</span>
            </p>
            {selectedItems.length ? (
              <ul className="flex flex-col divide-y divide-ink-100">
                {selectedItems.map((it) => (
                  <li key={it.key} className="flex items-start gap-2 py-1.5 text-xs">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${chipTone(dday(it.date))}`}
                    >
                      {ddayLabel(it.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-ink-900">{it.title}</span>
                      {it.detail ? <span className="block text-[11px] text-ink-500">{it.detail}</span> : null}
                      <span className="block text-[10px] text-ink-400">{it.source}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-1 text-xs text-ink-400">잡힌 일정이 없습니다.</p>
            )}
          </div>

          {dateless.length ? (
            <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/60 px-3.5 py-3">
              <p className="mb-1.5 text-xs font-bold text-ink-700">날짜 없음 ({dateless.length}건)</p>
              <ul className="flex flex-col gap-1">
                {dateless.map((r) => (
                  <ManualRow
                    key={r.id}
                    row={r}
                    editing={editingId === r.id}
                    editText={editText}
                    editDate={editDate}
                    dateSupported={dateSupported}
                    busy={busy}
                    onEditText={setEditText}
                    onEditDate={setEditDate}
                    onStartEdit={() => startEdit(r)}
                    onSaveEdit={saveEdit}
                    onCancelEdit={() => setEditingId(null)}
                    onToggle={() => toggleDone(r)}
                    onDelete={() => setConfirmId(r.id)}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-xl border border-ink-200 bg-white px-3.5 py-3">
            <p className="mb-2 text-xs font-bold text-ink-900">다가오는 일정 (30일)</p>
            {upcoming.length ? (
              <ul className="flex max-h-56 flex-col divide-y divide-ink-100 overflow-y-auto">
                {upcoming.slice(0, 12).map((it) => (
                  <li key={it.key}>
                    <button
                      type="button"
                      onClick={() => it.date && setSelected(it.date)}
                      className="flex w-full items-start gap-2 py-1.5 text-left text-xs transition hover:bg-ink-50"
                    >
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${chipTone(dday(it.date))}`}
                      >
                        {ddayLabel(it.date)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-ink-900">{it.title}</span>
                        <span className="ml-1.5 text-[11px] tabular-nums text-ink-400">
                          {it.date ? formatDateHuman(it.date) : ''}
                        </span>
                        {it.detail ? <span className="block text-[11px] text-ink-500">{it.detail}</span> : null}
                      </span>
                      <span className="mt-0.5 shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">
                        {it.source}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="calendar" title="다가오는 일정이 없습니다" description="직접 등록해 보세요." />
            )}
          </div>

          <form onSubmit={handleAdd} className="flex flex-col gap-2 rounded-xl border border-ink-200 bg-ink-50/60 p-3.5">
            <p className="text-xs font-bold text-ink-900">직접 등록</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {dateSupported ? (
                <input
                  type="date"
                  className="input shrink-0 sm:w-40"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              ) : null}
              <input
                className="input min-w-0 flex-1"
                placeholder="예: 4대보험 고지서 확인"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" className="btn-primary shrink-0" disabled={busy || !text.trim()}>
                {busy ? <Spinner size={14} /> : <Icon name="plus" size={14} />}
                추가
              </button>
            </div>
          </form>

          {manuals.filter((r) => !r.done && r.due_date).length ? (
            <div className="rounded-xl border border-ink-200 bg-white px-3.5 py-3">
              <p className="mb-1.5 text-xs font-bold text-ink-700">직접 등록한 일정</p>
              <ul className="flex flex-col gap-1">
                {manuals
                  .filter((r) => !r.done && r.due_date)
                  .slice()
                  .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
                  .map((r) => (
                    <ManualRow
                      key={r.id}
                      row={r}
                      editing={editingId === r.id}
                      editText={editText}
                      editDate={editDate}
                      dateSupported={dateSupported}
                      busy={busy}
                      onEditText={setEditText}
                      onEditDate={setEditDate}
                      onStartEdit={() => startEdit(r)}
                      onSaveEdit={saveEdit}
                      onCancelEdit={() => setEditingId(null)}
                      onToggle={() => toggleDone(r)}
                      onDelete={() => setConfirmId(r.id)}
                    />
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmId}
        title="일정을 삭제하시겠습니까?"
        message="직접 등록한 일정이 삭제됩니다. 자동 계산 항목은 삭제할 수 없습니다."
        onClose={() => setConfirmId(null)}
        onConfirm={confirmDelete}
        busy={busy}
      />
    </>
  )
}

function ManualRow({
  row,
  editing,
  editText,
  editDate,
  dateSupported,
  busy,
  onEditText,
  onEditDate,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onToggle,
  onDelete,
}) {
  if (editing) {
    return (
      <li className="flex flex-col gap-1.5 rounded-lg bg-white px-2.5 py-2">
        <input className="input !py-1.5 text-xs" value={editText} onChange={(e) => onEditText(e.target.value)} />
        <div className="flex items-center gap-1.5">
          {dateSupported ? (
            <input
              type="date"
              className="input !w-36 !py-1.5 text-xs"
              value={editDate}
              onChange={(e) => onEditDate(e.target.value)}
            />
          ) : null}
          <span className="flex-1" />
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={onCancelEdit}>
            취소
          </button>
          <button type="button" className="btn-primary !px-2 !py-1 text-xs" onClick={onSaveEdit} disabled={busy}>
            저장
          </button>
        </div>
      </li>
    )
  }
  return (
    <li className="flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs">
      <button
        type="button"
        onClick={onToggle}
        aria-label={row.done ? '미완료로' : '완료로'}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          row.done ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 bg-white'
        }`}
      >
        {row.done ? <Icon name="check" size={12} /> : null}
      </button>
      <span className="min-w-0 flex-1">
        <span className={`font-semibold ${row.done ? 'text-ink-400 line-through' : 'text-ink-800'}`}>
          {row.text}
        </span>
        {row.due_date ? (
          <span className="ml-1.5 text-[11px] tabular-nums text-ink-400">{formatDateHuman(row.due_date)}</span>
        ) : null}
      </span>
      <button type="button" className="shrink-0 p-1 text-ink-400 hover:text-ink-700" onClick={onStartEdit} aria-label="수정">
        <Icon name="pencil" size={13} />
      </button>
      <button type="button" className="shrink-0 p-1 text-ink-400 hover:text-loss" onClick={onDelete} aria-label="삭제">
        <Icon name="trash" size={13} />
      </button>
    </li>
  )
}
