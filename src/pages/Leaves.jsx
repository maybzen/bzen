import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABEL } from '../lib/constants'
import { todayKST } from '../lib/format'
import {
  createLeaveEntry,
  deleteLeaveEntry,
  listLeaveEntries,
  listProfiles,
  updateLeaveEntry,
} from '../lib/api'

const LEAVE_TYPES = ['연차', '월차', '대휴', '동계휴가', '보건휴가', '경조사']
const SHEET_ORDER = ['이보람', '권혜민', '박현정', '김상희', '김혜린', '박은영', '이정현']
/* 새해 자동 부여 기준 (연차 있는 분) */
const GRANT_DEFAULTS = {
  이보람: { 연차: '16' },
  권혜민: { 연차: '16' },
  박현정: { 연차: '15' },
  김상희: { 연차: '15' },
}

function fmtDays(v) {
  const n = Number(v || 0)
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

function statusChip(status) {
  if (status === '승인') return <span className="chip bg-emerald-50 text-emerald-700">승인</span>
  if (status === '반려') return <span className="chip bg-ink-100 text-ink-400">반려</span>
  return <span className="chip bg-amber-50 text-amber-700">승인대기</span>
}

function directionChip(direction) {
  if (direction === '발생') return <span className="chip bg-emerald-50 text-emerald-700">발생</span>
  if (direction === '취소') return <span className="chip bg-rose-50 text-loss">취소</span>
  return <span className="chip bg-ink-100 text-ink-600">사용</span>
}

/* 사용기간 표시 (종료일이 다르면 범위) */
function periodLabel(e) {
  const s = e.entry_date || ''
  const t = e.end_date || ''
  if (t && t !== s) return `${s}~${t}`
  return s
}

/* 새해 자동 부여: 연차 15일~ (기준표 우선)·동계 10일·전원 보건 12일.
   재직자만, 올해 입사자는 연차 비례(월 1일·최대 11일). 동시 부여 방지를 위해 연 1회만. */
async function autoGrantYear(all, profileRows, userId, grantedRef) {
  const y = Number(todayKST().slice(0, 4))
  if (grantedRef.current[y]) return 0
  grantedRef.current[y] = true
  const marker = `${y}-01-01`
  const has = (all || []).some((e) => e.entry_date === marker && /부여/.test(e.memo || ''))
  if (has) return 0
  const byName = new Map((profileRows || []).map((p) => [String(p.full_name || '').trim(), p]))
  const names = [
    ...new Set([
      ...SHEET_ORDER.filter((n) => {
        const p = byName.get(n)
        return !p || p.active !== false
      }),
      ...(profileRows || [])
        .filter((p) => p.active !== false && String(p.full_name || '').trim())
        .map((p) => String(p.full_name).trim()),
    ]),
  ]
  const payloads = []
  for (const person of names) {
    const prof = byName.get(person)
    let annual = Number(GRANT_DEFAULTS[person]?.연차 || 15)
    // 올해 입사자: 입사 익월부터 월 1일씩 (최대 11일)
    const hireY = Number(String(prof?.hire_date || '').slice(0, 4))
    const hireM = Number(String(prof?.hire_date || '').slice(5, 7))
    if (hireY === y && hireM >= 1 && hireM <= 12) {
      annual = Math.min(11, Math.max(0, 12 - hireM))
    }
    payloads.push({ entry_date: marker, person, leave_type: '연차', direction: '발생', days: annual, memo: `${y}년 자동부여`, status: '승인' })
    payloads.push({ entry_date: marker, person, leave_type: '동계휴가', direction: '발생', days: 10, memo: `${y}년 자동부여`, status: '승인' })
    payloads.push({ entry_date: marker, person, leave_type: '보건휴가', direction: '발생', days: 12, memo: `${y}년 자동부여`, status: '승인' })
  }
  for (const p of payloads) await createLeaveEntry(p, userId)
  return payloads.length
}

/* 대표 결재 토글 (대기·승인·반려) */
function StatusToggle({ status, busy, onChange }) {
  const opts = [
    { key: '요청', label: '대기', on: 'bg-amber-500 text-white shadow-sm' },
    { key: '승인', label: '승인', on: 'bg-emerald-600 text-white shadow-sm' },
    { key: '반려', label: '반려', on: 'bg-rose-500 text-white shadow-sm' },
  ]
  return (
    <div className="inline-flex gap-1 rounded-lg bg-ink-100 p-1">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={busy}
          onClick={() => {
            if (status !== o.key) onChange(o.key)
          }}
          className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
            status === o.key ? o.on : 'text-ink-400 hover:text-ink-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
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
  const [presetPerson, setPresetPerson] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [detailPerson, setDetailPerson] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const grantedRef = useRef({})

  /* 직원은 처음에 본인만 봅니다 (잔여 확인용. 필터에서 바꿀 수 있음) */
  const ownName = useMemo(
    () => (profiles || []).find((p) => p.id === user?.id)?.full_name || '',
    [profiles, user?.id],
  )
  useEffect(() => {
    if (!isAdmin && ownName && !personFilter) setPersonFilter(ownName)
  }, [isAdmin, ownName, personFilter])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all([listLeaveEntries(), listProfiles()])
      .then(([leaveRows, profileRows]) => {
        if (!mounted) return
        const all = leaveRows || []
        setRows(all)
        setProfiles(profileRows || [])
        /* 새해 자동 부여: 해당 연도 부여 기록이 없으면 관리자가 처음 열 때 1회 등록 */
        if (isAdmin) {
          autoGrantYear(all, profileRows || [], user?.id, grantedRef)
            .then((added) => {
              if (!mounted || !added) return
              toast.success(`${added}건을 새해 부여했습니다.`)
              return listLeaveEntries().then((r) => {
                if (mounted) setRows(r || [])
              })
            })
            .catch(() => {})
        }
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
  }, [reloadKey, isAdmin, user?.id])

  /* 총괄: 승인분만 집계 + 승인대기 건수 */
  const summary = useMemo(() => {
    const map = new Map()
    for (const e of rows || []) {
      if (e.status === '반려') continue
      const p = (e.person || '').trim() || '(미지정)'
      if (!map.has(p)) map.set(p, { person: p, types: {}, accrued: 0, used: 0, pending: 0 })
      const r = map.get(p)
      if (e.status !== '승인') {
        r.pending += 1
        continue
      }
      const t = e.leave_type || '미분류'
      if (!r.types[t]) r.types[t] = { accrued: 0, used: 0 }
      const d = Number(e.days || 0)
      // 취소는 없던 일로: 발생에서 차감합니다 (사용에 더하면 잔여가 깎여요)
      if (e.direction === '발생') {
        r.types[t].accrued += d
        r.accrued += d
      } else if (e.direction === '취소') {
        r.types[t].accrued -= d
        r.accrued -= d
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
    const acc = { accrued: 0, used: 0, annual: 0, pending: 0 }
    for (const r of summary) {
      acc.accrued += r.accrued
      acc.used += r.used
      acc.pending += r.pending
      for (const t of ['연차', '월차']) {
        acc.annual += (r.types[t]?.accrued || 0) - (r.types[t]?.used || 0)
      }
    }
    return acc
  }, [summary])

  const leaveRemain = useMemo(() => {
    let v = 0
    for (const r of summary) v += (r.types['대휴']?.accrued || 0) - (r.types['대휴']?.used || 0)
    return v
  }, [summary])

  const detailRows = useMemo(() => {
    let list = rows || []
    if (personFilter) list = list.filter((e) => e.person === personFilter)
    if (dateFrom) list = list.filter((e) => (e.end_date || e.entry_date || '') >= dateFrom)
    if (dateTo) list = list.filter((e) => (e.entry_date || '') <= dateTo)
    /* 최근에 작성·수정한 순 (승인대기가 바로 보이도록) */
    return list.slice().sort((a, b) => {
      const ca = String(a.created_at || '')
      const cb = String(b.created_at || '')
      if (ca !== cb) return cb < ca ? -1 : 1
      return (a.entry_date || '') < (b.entry_date || '') ? 1 : -1
    })
  }, [rows, personFilter, dateFrom, dateTo])

  const personOptions = useMemo(() => {
    const names = new Set([...SHEET_ORDER, ...profiles.map((p) => p.full_name).filter(Boolean)])
    return [...names]
  }, [profiles])

  const decide = async (entry, next) => {
    if (entry.status === next) return
    setBusy(true)
    try {
      await updateLeaveEntry(entry.id, {
        status: next,
        decided_by: next === '요청' ? null : user?.id,
        decided_at: next === '요청' ? null : new Date().toISOString(),
      })
      toast.success(next === '승인' ? '승인했습니다.' : next === '반려' ? '반려했습니다.' : '대기로 되돌렸습니다.')
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

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
      <PageHeader title="휴무대장" description="연차·월차·대휴·동계휴가·보건휴가 발생과 사용을 기록합니다.">
        <select className="input sm:w-44" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
          <option value="">전체 직원</option>
          {summary.map((r) => (
            <option key={r.person} value={r.person}>
              {r.person}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary" onClick={() => { setPresetPerson(''); setFormOpen(true) }}>
          <Icon name="plus" size={16} />
          휴무 등록
        </button>
      </PageHeader>

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="전체 잔여" value={fmtDays(totals.accrued - totals.used)} unit="일" tone="brand" icon="file" />
            <StatCard label="연차·월차 잔여" value={fmtDays(totals.annual)} unit="일" tone="neutral" icon="calendar" />
            <StatCard label="대휴 잔여" value={fmtDays(leaveRemain)} unit="일" tone="neutral" icon="coins" />
            <StatCard label="승인 대기" value={String(totals.pending)} unit="건" tone="neutral" icon="alert" />
          </div>

          {/* 총괄표 (이름 카드) */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-bold text-ink-900">
              휴무 현황 총괄표
              <span className="ml-1.5 font-medium text-ink-500">이름을 누르면 세부내역·결재현황을 볼 수 있습니다</span>
            </h2>
            {summary.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {summary.map((r) => {
                  const types = LEAVE_TYPES.filter((t) => r.types[t])
                  return (
                    <button
                      key={r.person}
                      type="button"
                      onClick={() => setDetailPerson(r.person)}
                      className="card overflow-hidden p-0 text-left transition hover:shadow-pop"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
                        <span className="text-sm font-extrabold text-ink-900">{r.person}</span>
                        <span className="flex items-center gap-1.5">
                          {r.pending ? (
                            <span className="chip bg-amber-50 text-amber-700">대기 {r.pending}</span>
                          ) : null}
                          <span className="font-num text-sm font-extrabold tabular-nums text-brand-700">
                            잔여 {fmtDays(r.accrued - r.used)}
                          </span>
                        </span>
                      </div>
                      <dl className="px-4 py-2">
                        {types.map((t) => {
                          const v = (r.types[t]?.accrued || 0) - (r.types[t]?.used || 0)
                          return (
                            <div key={t} className="flex items-baseline justify-between gap-2 py-1">
                              <dt className="text-xs text-ink-500">{t}</dt>
                              <dd className="font-num text-xs tabular-nums text-ink-500">
                                {fmtDays(r.types[t]?.accrued || 0)} − {fmtDays(r.types[t]?.used || 0)} ={' '}
                                <span className="text-sm font-bold text-ink-900">{fmtDays(v)}</span>
                              </dd>
                            </div>
                          )
                        })}
                        {!types.length ? (
                          <p className="py-3 text-center text-xs text-ink-400">내역이 없습니다.</p>
                        ) : null}
                      </dl>
                    </button>
                  )
                })}
              </div>
            ) : (
              <EmptyState icon="file" title="등록된 내역이 없습니다" description="휴무 등록으로 발생·사용을 기록하세요." />
            )}
          </section>

          {/* 상세 내역 */}
          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                발생·사용 내역
                <span className="ml-2 font-num text-xs font-semibold tabular-nums text-ink-400">
                  {detailRows.length}건
                </span>
              </h2>
              <div className="flex items-center gap-1.5 text-xs text-ink-500">
                <input
                  type="date"
                  className="input w-36 px-2 py-1.5 text-xs"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  title="시작일"
                />
                <span>~</span>
                <input
                  type="date"
                  className="input w-36 px-2 py-1.5 text-xs"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  title="종료일"
                />
                {dateFrom || dateTo ? (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold text-ink-400 hover:text-ink-700 hover:underline"
                    onClick={() => {
                      setDateFrom('')
                      setDateTo('')
                    }}
                  >
                    지우기
                  </button>
                ) : null}
              </div>
            </header>
            {detailRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">사용기간</th>
                      <th className="th">직원</th>
                      <th className="th">구분</th>
                      <th className="th">발생/사용/취소</th>
                      <th className="th text-right">일수</th>
                      <th className="th">사유</th>
                      <th className="th">결재</th>
                      {isAdmin ? <th className="th w-14">삭제</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {detailRows.slice(0, 200).map((e) => (
                      <tr key={e.id} className="transition hover:bg-ink-50/60">
                        <td className="td whitespace-nowrap">{periodLabel(e)}</td>
                        <td className="td font-medium">{e.person}</td>
                        <td className="td">{e.leave_type}</td>
                        <td className="td">{directionChip(e.direction)}</td>
                        <td className="td num font-semibold">{fmtDays(e.days)}</td>
                        <td className="td max-w-[220px] truncate text-ink-500">{e.memo}</td>
                        <td className="td">
                          {isAdmin ? (
                            <StatusToggle status={e.status} busy={busy} onChange={(next) => decide(e, next)} />
                          ) : (
                            statusChip(e.status)
                          )}
                        </td>
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
        isAdmin={isAdmin}
        defaultPerson={presetPerson || personFilter}
        rows={rows}
      />

      <PersonModal
        person={detailPerson}
        onClose={() => setDetailPerson(null)}
        onRegister={(p) => {
          setDetailPerson(null)
          setPresetPerson(p)
          setFormOpen(true)
        }}
        rows={rows}
        profiles={profiles}
        isAdmin={isAdmin}
        busy={busy}
        onDecide={decide}
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

/* ------------------------- 직원별 상세 ------------------------- */

function PersonModal({ person, onClose, onRegister, rows, profiles, isAdmin, busy, onDecide }) {
  const profile = useMemo(
    () => (profiles || []).find((p) => p.full_name === person),
    [profiles, person],
  )

  /* 세부내역: 오래된 순으로 잔여 누적 후 최신 순으로 표시 */
  const detail = useMemo(() => {
    if (!person) return []
    const list = (rows || [])
      .filter((e) => e.person === person && e.status !== '반려')
      .slice()
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0))
    const run = {}
    const withBalance = list.map((e) => {
      const t = e.leave_type || '미분류'
      run[t] = (run[t] || 0) + (e.direction === '발생' ? Number(e.days || 0) : -Number(e.days || 0))
      return { ...e, balance: run[t] }
    })
    return withBalance.reverse()
  }, [rows, person])

  const total = useMemo(() => {
    const map = {}
    for (const e of detail) {
      if (e.status !== '승인') continue
      const t = e.leave_type || '미분류'
      if (!map[t]) map[t] = { accrued: 0, used: 0 }
      if (e.direction === '발생') map[t].accrued += Number(e.days || 0)
      else if (e.direction === '취소') map[t].accrued -= Number(e.days || 0)
      else map[t].used += Number(e.days || 0)
    }
    return map
  }, [detail])

  const pending = useMemo(() => detail.filter((e) => e.status !== '승인').length, [detail])

  return (
    <Modal
      open={Boolean(person)}
      onClose={onClose}
      title={person ? `${person} 휴무 현황` : ''}
      subtitle="인사정보 · 총괄 · 세부내역 · 결재현황"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn-primary" onClick={() => onRegister?.(person)}>
            <Icon name="plus" size={15} />
            휴무 등록
          </button>
        </>
      }
    >
      {!person ? null : (
        <div className="flex flex-col gap-5">
          {/* 인사정보: 직원에게는 본인 외 연락처·생년월일·입사일 숨김 */}
          <section>
            <h3 className="mb-2 text-xs font-bold text-ink-500">인사정보</h3>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <InfoBox label="이름" value={person} />
              <InfoBox label="부서" value={profile?.department || '—'} />
              <InfoBox label="연락처" value={isAdmin ? profile?.phone || '—' : '—'} />
              <InfoBox label="권한" value={ROLE_LABEL[profile?.role] || '—'} />
              <InfoBox label="생년월일" value={isAdmin ? profile?.birth_date || '—' : '—'} />
              <InfoBox label="입사일" value={isAdmin ? profile?.hire_date || '—' : '—'} />
            </dl>
          </section>

          {/* 총괄 */}
          <section>
            <h3 className="mb-2 text-xs font-bold text-ink-500">
              총괄{pending ? <span className="chip ml-1.5 bg-amber-50 text-amber-700">승인대기 {pending}건</span> : null}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-ink-200">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead className="bg-ink-50/70">
                  <tr>
                    <th className="th">구분</th>
                    <th className="th text-right">발생일수</th>
                    <th className="th text-right">사용일수</th>
                    <th className="th text-right">잔여일수</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {LEAVE_TYPES.filter((t) => total[t]).map((t) => (
                    <tr key={t}>
                      <td className="td font-medium">{t}</td>
                      <td className="td num">{fmtDays(total[t].accrued)}</td>
                      <td className="td num">{fmtDays(total[t].used)}</td>
                      <td className="td num font-bold">{fmtDays(total[t].accrued - total[t].used)}</td>
                    </tr>
                  ))}
                  {!Object.keys(total).length ? (
                    <tr>
                      <td colSpan={4} className="empty">
                        승인된 내역이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {/* 세부내역 */}
          <section>
            <h3 className="mb-2 text-xs font-bold text-ink-500">세부내역</h3>
            {detail.length ? (
              <div className="max-h-80 overflow-auto rounded-lg border border-ink-200">
                <table className="w-full min-w-[620px] border-collapse text-xs">
                  <thead className="sticky top-0 bg-white shadow-sm">
                    <tr>
                      <th className="th">사용기간</th>
                      <th className="th">구분</th>
                      <th className="th text-right">발생</th>
                      <th className="th text-right">사용</th>
                      <th className="th text-right">잔여</th>
                      <th className="th">세부내역</th>
                      <th className="th">결재</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {detail.map((e) => (
                      <tr key={e.id}>
                        <td className="td whitespace-nowrap">{periodLabel(e)}</td>
                        <td className="td">{e.leave_type}</td>
                        <td className="td num">{e.direction === '발생' ? fmtDays(e.days) : '—'}</td>
                        <td className="td num">{e.direction === '사용' ? fmtDays(e.days) : '—'}</td>
                        <td className="td num font-bold">{fmtDays(e.balance)}</td>
                        <td className="td max-w-[180px] truncate text-ink-500">{e.memo}</td>
                        <td className="td">
                          {isAdmin ? (
                            <StatusToggle status={e.status} busy={busy} onChange={(next) => onDecide(e, next)} />
                          ) : (
                            statusChip(e.status)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-ink-200 px-4 py-6 text-center text-xs text-ink-400">
                내역이 없습니다.
              </p>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

function InfoBox({ label, value }) {
  return (
    <div className="rounded-lg border border-ink-200 px-3 py-2">
      <p className="text-[11px] font-semibold text-ink-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-ink-900">{value}</p>
    </div>
  )
}

/* --------------------------- 휴무 등록 --------------------------- */

function LeaveFormModal({ open, onClose, onSaved, personOptions, userId, isAdmin, defaultPerson, rows }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    entry_date: todayKST(),
    end_date: todayKST(),
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
        entry_date: todayKST(),
        end_date: todayKST(),
        person: defaultPerson || f.person || '',
        weekendHours: '',
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  /* 선택한 직원·구분의 현재 잔여(승인 기준) + 등록 후 예상 잔여 */
  const currentRemain = useMemo(() => {
    let a = 0
    let u = 0
    for (const e of rows || []) {
      if (e.person !== form.person || e.leave_type !== form.leave_type || e.status !== '승인') continue
      if (e.direction === '발생') a += Number(e.days || 0)
      else u += Number(e.days || 0)
    }
    return a - u
  }, [rows, form.person, form.leave_type])
  const projected = currentRemain + (form.direction === '발생' ? Number(form.days || 0) : -Number(form.days || 0))

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
          end_date: form.end_date && form.end_date !== form.entry_date ? form.end_date : null,
          person: form.person,
          leave_type: form.leave_type,
          direction: form.direction,
          days,
          memo: form.memo.trim(),
          status: isAdmin ? '승인' : '요청',
        },
        userId,
      )
      toast.success(isAdmin ? '등록되었습니다.' : '승인 요청되었습니다. 대표 승인 후 반영됩니다.')
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
      subtitle={isAdmin ? '발생과 사용을 기록하면 잔여가 자동 계산됩니다.' : '등록하면 대표 승인 후 잔여에 반영됩니다.'}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? '등록 중…' : isAdmin ? '등록' : '승인 요청'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="시작일" required>
            <input type="date" className="input" value={form.entry_date} onChange={(e) => set('entry_date', e.target.value)} />
          </Field>
          <Field label="종료일" hint="당일이면 시작일과 같게">
            <input type="date" className="input" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
        </div>
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
          <Field label="발생/사용/취소" required hint="취소=소멸·정산">
            <select className="input" value={form.direction} onChange={(e) => set('direction', e.target.value)}>
              <option value="사용">사용</option>
              <option value="발생">발생</option>
              <option value="취소">취소</option>
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

        {form.person && form.leave_type ? (
          <div className="rounded-lg border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-xs">
            <span className="font-semibold text-ink-700">
              {form.person} · {form.leave_type}
            </span>
            <span className="text-ink-600">
              {' '}
              현재 잔여 <strong className="font-num tabular-nums">{fmtDays(currentRemain)}일</strong>
              {' → '}등록 후 <strong className="font-num tabular-nums">{fmtDays(projected)}일</strong> 예상
            </span>
            <span className="block text-[11px] text-ink-400">승인된 내역 기준입니다.</span>
          </div>
        ) : null}

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


