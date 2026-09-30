import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { ConfirmDialog, EmptyState, InlineAlert, Modal } from './ui'
import { useToast } from './Toast'
import { addChecklistItem, deleteChecklistItem, updateChecklistItem } from '../lib/api'
import {
  SCHEDULE_DONE_LIST,
  SCHEDULE_LIST,
  buildSchedule,
  dday,
  ddayLabel,
  doneKeysFrom,
  doneMarkerText,
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
  markers = [],
  dateSupported = false,
  userId = null,
  onChanged,
  home = null,
  isAdmin = false,
  overrides = {},
  profiles = [],
  projects = [],
  syncBundle = null,
  onLocate = null,
}) {
  const toast = useToast()
  const today = todayISO()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)))
  const [selected, setSelected] = useState(today)
  const [quickText, setQuickText] = useState('')
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
    setQuickText('')
    const t = todayISO()
    setSelected(t)
    setYear(Number(t.slice(0, 4)))
    setMonth(Number(t.slice(5, 7)))
  }, [open ])

  const grid = useMemo(() => monthGrid(year, month), [year, month])
  const doneKeys = useMemo(() => doneKeysFrom(markers), [markers])
  const monthItems = useMemo(
    () =>
      buildSchedule({ loans, manuals, fromISO: grid[0], toISO: grid[grid.length - 1], overrides, doneKeys, profiles, projects }),
    [loans, manuals, grid, overrides, doneKeys, profiles, projects],
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
    return buildSchedule({ loans, manuals, fromISO: '2000-01-01', toISO: iso, overrides, doneKeys, profiles, projects }).filter(
      (it) => it.date && it.date >= base && !it.done,
    )
  }, [loans, manuals, overrides, doneKeys, profiles, projects])

  const selectedItems = useMemo(() => {
    const list = (byDate.get(selected) || []).slice()
    // 날짜 없는 수동 항목은 선택일에 상관없이 아래 별도로 보여줍니다
    return list
  }, [byDate, selected])

  const dateless = useMemo(() => manuals.filter((r) => !r.done && !r.due_date), [manuals])

  const reload = async () => {
    await onChanged?.()
  }

  /* 날짜 패널에서 바로 추가 (선택된 날짜로 들어갑니다) */
  const handleQuickAdd = async (e) => {
    e.preventDefault()
    const v = quickText.trim()
    if (!v || !selected) return
    setBusy(true)
    setError('')
    try {
      const extra = dateSupported ? { due_date: selected } : {}
      await addChecklistItem(SCHEDULE_LIST, v, userId, extra)
      setQuickText('')
      toast.success(`${formatDateHuman(selected)}에 등록되었습니다.`)
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

  /* 자동 항목 완료 체크 (지나간 일정이 "안 한 것처럼" 보이지 않게) */
  const toggleAuto = async (item) => {
    setBusy(true)
    try {
      if (item.done) {
        const marker = (markers || []).find((r) => String(r.text) === doneMarkerText(item.key))
        if (marker) await deleteChecklistItem(marker.id)
      } else {
        await addChecklistItem(SCHEDULE_DONE_LIST, doneMarkerText(item.key), userId)
      }
      await reload()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pickDate = (d) => {
    setSelected(d)
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
                  onClick={() => pickDate(d)}
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
                    {it.kind === 'auto' ? (
                      <button
                        type="button"
                        onClick={() => toggleAuto(it)}
                        aria-label={it.done ? '미완료로' : '완료로'}
                        title={it.done ? '클릭하면 미완료로 되돌립니다' : '클릭하면 완료로 표시됩니다'}
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          it.done ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 bg-white'
                        }`}
                      >
                        {it.done ? <Icon name="check" size={11} strokeWidth={2.6} /> : null}
                      </button>
                    ) : null}
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                        it.done ? 'bg-emerald-100 text-emerald-700' : chipTone(dday(it.date))
                      }`}
                    >
                      {it.done ? '완료' : ddayLabel(it.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`font-semibold ${it.done ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                        {it.title}
                      </span>
                      {it.detail ? <span className="block text-[11px] text-ink-500">{it.detail}</span> : null}
                      <span className="block text-[10px] text-ink-400">{it.source}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-1 text-xs text-ink-400">잡힌 일정이 없습니다.</p>
            )}
            <form onSubmit={handleQuickAdd} className="mt-2 flex items-center gap-1.5 border-t border-ink-100 pt-2">
              <input
                className="input min-w-0 flex-1 !py-1.5 text-xs"
                placeholder={`${formatDateHuman(selected)}에 일정 추가`}
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
              />
              <button type="submit" className="btn-ghost shrink-0 !px-2.5 !py-1.5 text-xs" disabled={!quickText.trim() || busy}>
                추가
              </button>
            </form>
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
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold text-ink-900">다가오는 일정 (30일)</p>
              <Link to="/tax" onClick={onClose} className="text-[11px] font-semibold text-brand-700 hover:underline">
                세금 신고 준비물은 세금관리 →
              </Link>
            </div>
            {upcoming.length ? (
              <ul className="flex max-h-56 flex-col divide-y divide-ink-100 overflow-y-auto">
                {upcoming.slice(0, 12).map((it) => (
                  <li key={it.key}>
                    <button
                      type="button"
                      onClick={() => it.date && pickDate(it.date)}
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

          {home ? <HomeChecklist home={home} isAdmin={isAdmin} userId={userId} onLocate={onLocate} /> : null}

          {syncBundle ? <SyncChecklist bundle={syncBundle} /> : null}

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

/* 확인 필요 목록 (대시보드에서 여기로 이동). 같은 DB를 공유합니다. */
function HomeChecklist({ home, isAdmin, userId, onLocate = null }) {
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [busy, setBusy] = useState(false)
  const items = home.items || []
  const openItems = items.filter((x) => !x.done)
  const doneItems = items.filter((x) => x.done)

  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const submitAdd = (e) => {
    e.preventDefault()
    const v = draft.trim()
    if (!v) return
    run(async () => {
      await home.add(v)
      setDraft('')
    })
  }

  const submitEdit = (e) => {
    e.preventDefault()
    const v = editText.trim()
    if (!editingId || !v) return
    const id = editingId
    run(async () => {
      await home.rename(id, v)
      setEditingId(null)
    })
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-3">
      <p className="mb-1.5 text-xs font-bold text-ink-900">
        확인 필요 목록
        <span className="ml-1.5 font-medium text-ink-500">{openItems.length}건</span>
      </p>
      {openItems.length ? (
        <ul className="flex flex-col divide-y divide-ink-100">
          {openItems.map((item) => (
            <li key={item.id} className="flex items-start gap-1.5 py-1.5">
              {editingId === item.id ? (
                <form onSubmit={submitEdit} className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input
                    autoFocus
                    className="input min-w-0 flex-1 !py-1.5 text-xs"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <button type="submit" className="shrink-0 text-xs font-bold text-brand-700 hover:underline" disabled={busy}>
                    저장
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="shrink-0 text-xs text-ink-400 hover:underline">
                    취소
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => run(() => home.toggle(item.id))}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-ink-300 bg-white text-transparent">
                    <Icon name="check" size={11} strokeWidth={2.6} />
                  </span>
                  <span className="text-xs text-ink-800">{item.text}</span>
                </button>
              )}
              {onLocate ? (
                <button
                  type="button"
                  onClick={() => onLocate(item.text)}
                  title="관련 내역 검색으로 이동"
                  className="shrink-0 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold text-brand-700 transition hover:bg-brand-100"
                >
                  관련내역
                </button>
              ) : null}
              {isAdmin && editingId !== item.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(item.id)
                      setEditText(item.text)
                    }}
                    className="shrink-0 rounded-md p-1 text-ink-300 transition hover:bg-brand-50 hover:text-brand-700"
                    aria-label="수정"
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => home.remove(item.id))}
                    className="shrink-0 rounded-md p-1 text-ink-300 transition hover:bg-rose-50 hover:text-loss"
                    aria-label="삭제"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-1 text-xs text-ink-400">다 확인했습니다.</p>
      )}
      {doneItems.length ? (
        <>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-ink-400 hover:text-ink-600"
            aria-expanded={showDone}
          >
            <Icon name={showDone ? 'chevron-down' : 'chevron-right'} size={13} />
            완료됨 {doneItems.length}건
          </button>
          {showDone ? (
            <ul className="mt-1 flex flex-col divide-y divide-ink-100 border-t border-ink-100">
              {doneItems.map((item) => (
                <li key={item.id} className="flex items-start gap-1.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => run(() => home.toggle(item.id))}
                    title="클릭하면 미완료로 되돌립니다"
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-emerald-600 text-white">
                      <Icon name="check" size={11} strokeWidth={2.6} />
                    </span>
                    <span className="text-xs text-ink-400 line-through">{item.text}</span>
                  </button>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => run(() => home.remove(item.id))}
                      className="shrink-0 rounded-md p-1 text-ink-300 transition hover:bg-rose-50 hover:text-loss"
                      aria-label="삭제"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {isAdmin ? (
        <form onSubmit={submitAdd} className="mt-1.5 flex items-center gap-1.5 border-t border-ink-100 pt-2">
          <input
            className="input min-w-0 flex-1 !py-1.5 text-xs"
            placeholder="확인할 일 추가"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn-ghost shrink-0 !px-2.5 !py-1.5 text-xs" disabled={!draft.trim() || busy}>
            추가
          </button>
        </form>
      ) : null}
    </div>
  )
}

/* 업데이트 체크리스트 (대시보드에서 여기로 이동) */
function SyncChecklist({ bundle }) {
  const [open, setOpen] = useState(false)
  const { sync, editing, setEditing, saveEditing, newSync, setNewSync, addSyncItem } = bundle
  const items = sync.items || []
  const left = items.filter((x) => !x.done).length
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/50 px-3.5 py-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left" aria-expanded={open}>
        <p className="min-w-0 flex-1 text-xs font-bold text-ink-900">
          업데이트 체크리스트
          <span className="ml-1.5 font-medium text-ink-500">{left}건 남음</span>
        </p>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="shrink-0 text-ink-400" />
      </button>
      {open ? (
        <>
          <ul className="mt-1.5 flex flex-col divide-y divide-ink-100 border-t border-ink-100">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-1.5 py-1.5">
                {editing?.list === 'sync' && editing?.id === item.id ? (
                  <form onSubmit={saveEditing} className="flex min-w-0 flex-1 items-center gap-1.5">
                    <input
                      autoFocus
                      className="input min-w-0 flex-1 !py-1.5 text-xs"
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    />
                    <button type="submit" className="shrink-0 text-xs font-bold text-brand-700 hover:underline">
                      저장
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="shrink-0 text-xs text-ink-400 hover:underline">
                      취소
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => sync.toggle(item.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        item.done ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 bg-white text-transparent'
                      }`}
                    >
                      <Icon name="check" size={11} strokeWidth={2.6} />
                    </span>
                    <span className={`text-xs ${item.done ? 'text-ink-400 line-through' : 'text-ink-800'}`}>
                      {item.text}
                    </span>
                  </button>
                )}
                {!(editing?.list === 'sync' && editing?.id === item.id) ? (
                  <button
                    type="button"
                    onClick={() => setEditing({ list: 'sync', id: item.id, text: item.text })}
                    className="shrink-0 rounded-md p-1 text-ink-300 transition hover:bg-brand-50 hover:text-brand-700"
                    aria-label="수정"
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => sync.remove(item.id)}
                  className="shrink-0 rounded-md p-1 text-ink-300 transition hover:bg-rose-50 hover:text-loss"
                  aria-label="삭제"
                >
                  <Icon name="trash" size={13} />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addSyncItem} className="mt-1.5 flex items-center gap-1.5 border-t border-ink-100 pt-2">
            <input
              className="input min-w-0 flex-1 !py-1.5 text-xs"
              placeholder="업데이트할 일 추가"
              value={newSync}
              onChange={(e) => setNewSync(e.target.value)}
            />
            <button type="submit" className="btn-ghost shrink-0 !px-2.5 !py-1.5 text-xs" disabled={!newSync.trim()}>
              추가
            </button>
          </form>
        </>
      ) : null}
    </div>
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
