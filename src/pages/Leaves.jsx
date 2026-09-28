import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { todayISO } from '../lib/format'
import { createLeaveEntry, deleteLeaveEntry, listLeaveEntries, listProfiles } from '../lib/api'

const LEAVE_TYPES = ['연차', '대휴', '동계휴가', '보건휴가', '경조사']
const SHEET_ORDER = ['이보람', '권혜민', '박현정', '김상희', '김혜린', '박은영', '이정현']

function remain(r, type) {
  const t = r.types[type]
  if (!t) return 0
  return t.accrued - t.used
}

export default function Leaves() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState([])
  const [personFilter, setPersonFilter] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [grantOpen, setGrantOpen] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all([listLeaveEntries(), listProfiles()])
      .then(([leaveRows, profileRows]) => {
        if (!mounted) return
        setRows(leaveRows || [])
        setProfiles(profileRows || [])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const summary = useMemo(() => {
    const map = new Map()
    for (const e of rows || []) {
      const p = (e.person || '').trim() || '(미지정)'
      if (!map.has(p)) map.set(p, { person: p, types: {}, accrued: 0, used: 0 })
      const r = map.get(p)
      const t = e.leave_type || '미분류'
      if (!r.types[t]) r.types[t] = { accrued: 0, used: 0 }
      const d = Number(e.days || 0)
      if (e.direction === '발생') {
        r.types[t].accrued += d
        r.accrued += d
      } else {
        r.types[t].used += d
        r.used += d
      }
    }
    return [...map.values()].sort((a, b) => {
      const ai = SHEET_ORDER.indexOf(a.person)
      const bi = SHEET_ORDER.indexOf(b.person)
      if (ai < 0 && bi < 0) return a.person.localeCompare(b.person, 'ko')
      if (ai < 0) return 1
      if (bi < 0) return -1
      return ai - bi
    })
  }, [rows])

  const totals = useMemo(() => {
    const acc = { accrued: 0, used: 0, types: {} }
    for (const r of summary) {
      acc.accrued += r.accrued
      acc.used += r.used
      for (const t of LEAVE_TYPES) {
        if (!acc.types[t]) acc.types[t] = { accrued: 0, used: 0 }
        acc.types[t].accrued += r.types[t]?.accrued || 0
        acc.types[t].used += r.types[t]?.used || 0
      }
    }
    return acc
  }, [summary])

  const detailRows = useMemo(() => {
    const list = personFilter ? rows.filter((e) => e.person === personFilter) : rows
    return (list || []).slice().sort((a, b) => {
      if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? 1 : -1
      return String(b.created_at || '') < String(a.created_at || '') ? -1 : 1
    })
  }, [rows, personFilter])

  const personOptions = useMemo(() => {
    const names = new Set([...SHEET_ORDER, ...profiles.map((p) => p.full_name).filter(Boolean)])
    return [...names]
  }, [profiles])

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deleteLeaveEntry(removing.id)
      toast.success('삭제되었습니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="휴무대장" description="연차·대휴·동계휴가·보건휴가 발생과 사용을 기록합니다.">
        <select className="input sm:w-44" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
          <option value="">전체 직원</option>
          {summary.map((r) => (
            <option key={r.person} value={r.person}>
              {r.person}
            </option>
          ))}
        </select>
        {isAdmin ? (
          <button type="button" className="btn-ghost" onClick={() => setGrantOpen(true)}>
            <Icon name="calendar" size={16} />
            새해 일괄 부여
          </button>
        ) : null}
        <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
          <Icon name="plus" size={16} />
          휴무 등록
        </button>
      </PageHeader>

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="전체 잔여" value={fmtDays(totals.accrued - totals.used)} tone="brand" icon="file" />
            <StatCard
              label="연차 잔여"
              value={fmtDays((totals.types['연차']?.accrued || 0) - (totals.types['연차']?.used || 0))}
              tone="neutral"
              icon="calendar"
            />
            <StatCard
              label="대휴 잔여"
              value={fmtDays((totals.types['대휴']?.accrued || 0) - (totals.types['대휴']?.used || 0))}
              tone="neutral"
              icon="coins"
            />
            <StatCard label="등록 건수" value={String(rows.length)} unit="건" tone="neutral" icon="receipt" />
          </div>

          {/* 총괄표 */}
          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">휴무 현황 총괄표</h2>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead className="bg-ink-50/70">
                  <tr>
                    <th className="th">직원</th>
                    {LEAVE_TYPES.map((t) => (
                      <th key={t} className="th text-right">
                        {t} 잔여
                      </th>
                    ))}
                    <th className="th text-right">합계 잔여</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {summary.map((r) => (
                    <tr key={r.person} className="transition hover:bg-ink-50/60">
                      <td className="td font-semibold">{r.person}</td>
                      {LEAVE_TYPES.map((t) => {
                        const v = remain(r, t)
                        return (
                          <td key={t} className="td num">
                            <span className="font-bold">{fmtDays(v)}</span>
                            <span className="block text-[11px] font-normal text-ink-400">
                              발생 {fmtDays(r.types[t]?.accrued || 0)} · 사용 {fmtDays(r.types[t]?.used || 0)}
                            </span>
                          </td>
                        )
                      })}
                      <td className="td num font-extrabold">{fmtDays(r.accrued - r.used)}</td>
                    </tr>
                  ))}
                  {!summary.length ? (
                    <tr>
                      <td colSpan={LEAVE_TYPES.length + 2} className="empty">
                        등록된 내역이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {/* 상세 내역 */}
          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                발생·사용 내역
                <span className="ml-2 font-num text-xs font-semibold tabular-nums text-ink-400">
                  {detailRows.length}건
                </span>
              </h2>
            </header>
            {detailRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">일자</th>
                      <th className="th">직원</th>
                      <th className="th">구분</th>
                      <th className="th">발생/사용</th>
                      <th className="th text-right">일수</th>
                      <th className="th">사유</th>
                      {isAdmin ? <th className="th w-16" /> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {detailRows.slice(0, 200).map((e) => (
                      <tr key={e.id} className="transition hover:bg-ink-50/60">
                        <td className="td whitespace-nowrap">{e.entry_date}</td>
                        <td className="td font-medium">{e.person}</td>
                        <td className="td">{e.leave_type}</td>
                        <td className="td">
                          <span
                            className={`chip ${e.direction === '발생' ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-600'}`}
                          >
                            {e.direction}
                          </span>
                        </td>
                        <td className="td num font-semibold">{fmtDays(e.days)}</td>
                        <td className="td max-w-[260px] truncate text-ink-500">{e.memo}</td>
                        {isAdmin ? (
                          <td className="td">
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-ink-400 transition hover:bg-rose-50 hover:text-loss"
                              onClick={() => setRemoving(e)}
                              title="삭제"
                            >
                              <Icon name="trash" size={15} />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detailRows.length > 200 ? (
                  <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-500">
                    최근 200건만 표시됩니다.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState icon="file" title="내역이 없습니다" description="휴무 등록으로 발생·사용을 기록하세요." />
            )}
          </section>
        </>
      )}

      <LeaveFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          setReloadKey((k) => k + 1)
        }}
        personOptions={personOptions}
        userId={user?.id}
        defaultPerson={personFilter}
      />

      <GrantModal
        open={grantOpen}
        onClose={() => setGrantOpen(false)}
        onSaved={() => {
          setGrantOpen(false)
          setReloadKey((k) => k + 1)
        }}
        personOptions={personOptions}
        userId={user?.id}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="내역을 삭제하시겠습니까?"
        message={removing ? `${removing.entry_date} · ${removing.person} · ${removing.leave_type} ${removing.direction} ${fmtDays(removing.days)}일` : ''}
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function fmtDays(v) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

/* --------------------------- 휴무 등록 --------------------------- */

function LeaveFormModal({ open, onClose, onSaved, personOptions, userId, defaultPerson }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    entry_date: todayISO(),
    person: '',
    leave_type: '연차',
    direction: '사용',
    days: '1',
    memo: '',
    weekendHours: '',
  })

  useEffect(() => {
    if (open) {
      setForm((f) => ({
        ...f,
        entry_date: todayISO(),
        person: defaultPerson || f.person || '',
        weekendHours: '',
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  /* 주말출근 → 대휴 자동 계산 (4시간 이상 1일, 미만 0.5일) */
  const applyWeekend = () => {
    const h = Number(form.weekendHours)
    if (!h || h <= 0) {
      toast.error('주말 근무 시간을 입력해 주세요.')
      return
    }
    setForm((f) => ({
      ...f,
      leave_type: '대휴',
      direction: '발생',
      days: String(h >= 4 ? 1 : 0.5),
      memo: `주말출근 ${h}시간`,
    }))
    toast.success(h >= 4 ? '대휴 1일이 계산되었습니다.' : '대휴 0.5일이 계산되었습니다.')
  }

  const submit = async () => {
    if (!form.person) {
      toast.error('직원을 선택해 주세요.')
      return
    }
    const days = Number(form.days)
    if (!days || days <= 0) {
      toast.error('일수를 입력해 주세요. (0.5일 단위)')
      return
    }
    setSaving(true)
    try {
      await createLeaveEntry(
        {
          entry_date: form.entry_date,
          person: form.person,
          leave_type: form.leave_type,
          direction: form.direction,
          days,
          memo: form.memo.trim(),
        },
        userId,
      )
      toast.success('등록되었습니다.')
      onSaved()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="휴무 등록"
      subtitle="발생과 사용을 기록하면 잔여가 자동 계산됩니다."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? '등록 중…' : '등록'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="일자" required>
            <input type="date" className="input" value={form.entry_date} onChange={(e) => set('entry_date', e.target.value)} />
          </Field>
          <Field label="직원" required>
            <select className="input" value={form.person} onChange={(e) => set('person', e.target.value)}>
              <option value="">선택</option>
              {personOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="구분" required>
            <select className="input" value={form.leave_type} onChange={(e) => set('leave_type', e.target.value)}>
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="발생/사용" required>
            <select className="input" value={form.direction} onChange={(e) => set('direction', e.target.value)}>
              <option value="사용">사용</option>
              <option value="발생">발생</option>
            </select>
          </Field>
          <Field label="일수" required hint="0.5 단위">
            <input
              type="number"
              min="0.5"
              step="0.5"
              className="input"
              value={form.days}
              onChange={(e) => set('days', e.target.value)}
            />
          </Field>
        </div>
        <Field label="사유">
          <input
            className="input"
            placeholder="예: 하계휴가, 주말출근 5시간"
            value={form.memo}
            onChange={(e) => set('memo', e.target.value)}
          />
        </Field>

        <div className="rounded-lg border border-ink-200 bg-ink-50/60 p-3.5">
          <p className="text-xs font-bold text-ink-700">주말출근 대휴 계산</p>
          <p className="mt-0.5 text-[11px] text-ink-500">4시간 이상 1일 · 4시간 미만 0.5일</p>
          <div className="mt-2 flex gap-2">
            <input
              type="number"
              min="0"
              step="0.5"
              className="input"
              placeholder="근무 시간 (예: 5)"
              value={form.weekendHours}
              onChange={(e) => set('weekendHours', e.target.value)}
            />
            <button type="button" className="btn-ghost shrink-0" onClick={applyWeekend}>
              계산해서 입력
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------- 새해 일괄 부여 ------------------------- */

function GrantModal({ open, onClose, onSaved, personOptions, userId }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [grantYear, setGrantYear] = useState(String(Number(todayISO().slice(0, 4)) + 1))
  const [rows, setRows] = useState({})

  useEffect(() => {
    if (open) {
      const init = {}
      for (const n of personOptions) init[n] = { 연차: '', 대휴: '', 동계휴가: '', 보건휴가: '12' }
      setRows(init)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const setCell = (person, type, value) =>
    setRows((prev) => ({ ...prev, [person]: { ...prev[person], [type]: value } }))

  const submit = async () => {
    const y = Number(grantYear)
    if (!y || y < 2000 || y > 2100) {
      toast.error('연도를 확인해 주세요.')
      return
    }
    const payloads = []
    for (const person of personOptions) {
      for (const type of ['연차', '대휴', '동계휴가', '보건휴가']) {
        const days = Number(rows[person]?.[type] || 0)
        if (days > 0) {
          payloads.push({
            entry_date: `${y}-01-01`,
            person,
            leave_type: type,
            direction: '발생',
            days,
            memo: `${y}년 부여`,
          })
        }
      }
    }
    if (!payloads.length) {
      toast.error('부여할 일수를 입력해 주세요.')
      return
    }
    setSaving(true)
    try {
      for (const p of payloads) await createLeaveEntry(p, userId)
      toast.success(`${payloads.length}건을 부여했습니다.`)
      onSaved()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="새해 일괄 부여"
      subtitle="연차가 있는 분 기준으로 보건휴가 12일 등을 한 번에 부여합니다."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? '부여 중…' : '일괄 부여'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="부여 연도" required>
          <input
            className="input sm:w-40"
            value={grantYear}
            onChange={(e) => setGrantYear(e.target.value)}
            placeholder="2027"
          />
        </Field>
        <div className="overflow-x-auto rounded-lg border border-ink-200">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="bg-ink-50/70">
              <tr>
                <th className="th">직원</th>
                {['연차', '대휴', '동계휴가', '보건휴가'].map((t) => (
                  <th key={t} className="th text-right">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {personOptions.map((n) => (
                <tr key={n}>
                  <td className="td font-medium">{n}</td>
                  {['연차', '대휴', '동계휴가', '보건휴가'].map((t) => (
                    <td key={t} className="td">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        className="input px-2 py-1.5 text-right"
                        value={rows[n]?.[t] ?? ''}
                        onChange={(e) => setCell(n, t, e.target.value)}
                        placeholder="0"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-500">0보다 큰 칸만 {grantYear}년 1월 1일 발생으로 등록됩니다.</p>
      </div>
    </Modal>
  )
}
