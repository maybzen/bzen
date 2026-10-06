import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { formatKRW } from '../lib/format'
import { listEntries, listProfiles, updateProfile } from '../lib/api'

/**
 * 구성원 (인사관리 · 대표 전용).
 * 인적사항(부서·연락처·입사일·재직)을 한 화면에서 관리합니다.
 * 이름·계정은 계정관리에서 다룹니다.
 */

/* 근속: N년 N개월 (입사일 기준) */
function tenure(hireDate) {
  if (!hireDate) return '—'
  const from = new Date(`${hireDate}T00:00:00`)
  const now = new Date()
  if (Number.isNaN(from.getTime()) || from > now) return '—'
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth())
  if (now.getDate() < from.getDate()) months -= 1
  if (months < 0) return '—'
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y <= 0) return `${m}개월`
  return m ? `${y}년 ${m}개월` : `${y}년`
}

/* 생일: 만나이 · D-day */
function birthday(birthDate) {
  if (!birthDate) return ''
  const b = new Date(`${birthDate}T00:00:00`)
  if (Number.isNaN(b.getTime())) return ''
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age -= 1
  const thisYear = new Date(now.getFullYear(), b.getMonth(), b.getDate())
  const next = thisYear >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
    ? thisYear
    : new Date(now.getFullYear() + 1, b.getMonth(), b.getDate())
  const dday = Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000)
  return `만 ${age}세 · D-${dday}`
}
export default function Members() {
  const { user } = useAuth()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState([])
  const [payByName, setPayByName] = useState({})
  const [rowEdits, setRowEdits] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [bulkSaving, setBulkSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      listProfiles(),
      listEntries({ types: ['opex'], maxRows: 20000 }).catch(() => []),
    ])
      .then(([profRows, entryRows]) => {
        if (!alive) return
        setProfiles(profRows || [])
        const map = {}
        for (const e of entryRows || []) {
          if (e.category !== '인건비') continue
          const n = String(e.counterparty || '').trim()
          if (!n) continue
          map[n] = (map[n] || 0) + Number(e.total_amount || 0)
        }
        setPayByName(map)
      })
      .catch((e) => toast.error(e.message))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [toast])

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

  const saveRow = async (p, silent = false) => {
    const patch = rowEdits[p.id]
    if (!patch) return true
    setSavingId(p.id)
    try {
      const saved = await updateProfile(p.id, {
        department: String(patch.department ?? p.department ?? '').trim(),
        phone: String(patch.phone ?? p.phone ?? '').trim(),
        hire_date: patch.hire_date ?? p.hire_date ?? null,
        birth_date: patch.birth_date ?? p.birth_date ?? null,
        // 챙기는 생일 컬럼이 있을 때만 보냅니다 (마이그레이션 전 400 방지)
        ...(celebrateSupported ? { birth_celebrate: patch.birth_celebrate ?? p.birth_celebrate ?? null } : {}),
        active: patch.active ?? p.active ?? true,
      })
      setProfiles((rows) => rows.map((r) => (r.id === p.id ? { ...r, ...saved } : r)))
      cancelRow(p.id)
      if (!silent) toast.success(`${p.full_name} 저장되었습니다.`)
      return true
    } catch (e) {
      if (!silent) toast.error(e.message)
      return false
    } finally {
      setSavingId(null)
    }
  }

  const saveAllDirty = async () => {
    const targets = profiles.filter((p) => rowEdits[p.id])
    if (!targets.length) return
    setBulkSaving(true)
    try {
      let ok = 0
      for (const p of targets) {
        // eslint-disable-next-line no-await-in-loop
        if (await saveRow(p, true)) ok += 1
      }
      if (ok === targets.length) toast.success(`${ok}건이 모두 저장되었습니다.`)
      else toast.error(`${targets.length}건 중 ${ok}건 저장했습니다.`)
    } finally {
      setBulkSaving(false)
    }
  }

  const dirtyCount = Object.keys(rowEdits).length
  const activeList = useMemo(() => profiles.filter((p) => p.active !== false), [profiles])
  /* 챙기는 생일 컬럼(migration_profiles_celebrate.sql) 적용 전에는 숨깁니다 */
  const celebrateSupported = useMemo(() => profiles.some((p) => p && 'birth_celebrate' in p), [profiles])

  const totalPay = useMemo(() => Object.values(payByName).reduce((a, v) => a + v, 0), [payByName])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="구성원"
        description="인사관리 · 부서·연락처·입사일·생일·재직을 관리합니다. 이름·계정은 계정관리에서 바꿉니다. 외부인력은 여기서 추가하세요."
      >
        <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
          <Icon name="plus" size={16} />
          구성원 추가
        </button>
      </PageHeader>

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="재직" value={String(activeList.length)} unit="명" tone="neutral" icon="users" />
            <StatCard label="인건비 누적" value={totalPay} tone="opex" icon="coins" hint="장부 인건비 합계" />
          </div>

          {dirtyCount ? (
            <div className="card flex flex-wrap items-center gap-2 border-brand-200 bg-brand-50/50 px-4 py-2.5 text-xs">
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

          {profiles.length ? (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] border-collapse text-xs">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">이름</th>
                      <th className="th">부서</th>
                      <th className="th">연락처</th>
                      <th className="th">입사일</th>
                      <th className="th">근속</th>
                      <th className="th">생일</th>
                      <th className="th text-right">인건비 누적</th>
                      <th className="th">상태</th>
                      <th className="th text-right">저장</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {profiles.map((p) => {
                      const edit = rowEdits[p.id] || {}
                      const work = { ...p, ...edit }
                      const dirty = Object.keys(edit).length > 0
                      const saving = savingId === p.id
                      return (
                        <tr key={p.id} className={dirty ? 'bg-brand-50/40' : undefined}>
                          <td className="td font-bold text-ink-900">{p.full_name || <span className="text-ink-300">—</span>}</td>
                          <td className="td">
                            <input
                              className="input w-32 py-1 text-xs"
                              value={work.department || ''}
                              onChange={(e) => setCell(p.id, { department: e.target.value })}
                              placeholder="부서"
                            />
                          </td>
                          <td className="td">
                            <input
                              className="input w-32 py-1 text-xs"
                              value={work.phone || ''}
                              onChange={(e) => setCell(p.id, { phone: e.target.value })}
                              placeholder="010-0000-0000"
                            />
                          </td>
                          <td className="td">
                            <input
                              type="date"
                              className="input w-auto py-1 text-xs"
                              value={work.hire_date || ''}
                              onChange={(e) => setCell(p.id, { hire_date: e.target.value || null })}
                            />
                          </td>
                          <td className="td whitespace-nowrap text-ink-600">{tenure(work.hire_date)}</td>
                          <td className="td whitespace-nowrap">
                            <input
                              type="date"
                              className="input w-auto py-1 text-xs"
                              value={work.birth_date || ''}
                              onChange={(e) => setCell(p.id, { birth_date: e.target.value || null })}
                            />
                            <span className="mt-0.5 block text-[11px] text-ink-500">{birthday(work.birth_date)}</span>
                            {celebrateSupported ? (
                              <>
                                <input
                                  type="date"
                                  className="input mt-1 w-auto py-1 text-xs"
                                  value={work.birth_celebrate || ''}
                                  onChange={(e) => setCell(p.id, { birth_celebrate: e.target.value || null })}
                                  title="실제로 챙기는 날 (비우면 실생일)"
                                />
                                <span className="mt-0.5 block text-[11px] text-ink-500">
                                  {work.birth_celebrate ? `챙기는 날 ${String(work.birth_celebrate).slice(5)}` : '챙기는 날: 실생일과 같음'}
                                </span>
                              </>
                            ) : null}
                          </td>
                          <td className="td num">{formatKRW(payByName[String(p.full_name || '').trim()] || 0)}</td>
                          <td className="td">
                            <button
                              type="button"
                              onClick={() => setCell(p.id, { active: !(work.active !== false) })}
                              className={`chip ${work.active !== false ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}`}
                              title="클릭하면 재직·퇴사 전환"
                            >
                              {work.active !== false ? '재직' : '퇴사'}
                            </button>
                          </td>
                          <td className="td num whitespace-nowrap">
                            {dirty ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => saveRow(p)}
                                  disabled={saving}
                                  className="mr-2 text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                                >
                                  {saving ? '저장 중' : '저장'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelRow(p.id)}
                                  disabled={saving}
                                  className="text-xs font-semibold text-ink-400 hover:underline disabled:opacity-50"
                                >
                                  취소
                                </button>
                              </>
                            ) : (
                              <span className="text-xs text-ink-300">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-ink-100 px-4 py-3 text-xs leading-relaxed text-ink-500">
                <Icon name="info" size={13} className="mr-1 inline text-ink-400" />
                휴무대장 입사일과 함께 씁니다. 퇴사로 바꾸면 목록·집계에서 빠집니다.
              </p>
            </div>
          ) : (
            <EmptyState icon="users" title="구성원이 없습니다" description="계정관리에서 직원을 등록하세요." />
          )}
        </>
      )}
    </div>
  )
}
