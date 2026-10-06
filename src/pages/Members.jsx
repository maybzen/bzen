import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { EmptyState, Field, InlineAlert, LoadingBlock, Modal, PageHeader, Spinner, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { formatKRW } from '../lib/format'
import { EXTERNAL_PARTNER_DEFAULT, OFFICE_STAFF, cardCodeForName } from '../lib/constants'
import { createProfile, listEntries, listProfiles, updateProfile } from '../lib/api'

/**
 * 구성원 (인사관리 · 대표 전용).
 * 내부 직원 + 협력 인력(손선욱·허수정·장정아)을 함께 관리합니다.
 * 이름·부서·연락처·입사일·재직·구분(내부/외부)·카드코드를 이 화면에서 직접 추가·수정합니다.
 * 로그인 계정이 필요한 경우(출근·장부 작성용)는 계정관리에서 만듭니다.
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
function kindOfProfile(p) {
  if (!p) return 'internal'
  // 구성원에서 직접 고른 구분을 우선합니다 (구 명칭 external_office도 외부협력으로 봅니다)
  if (p.employment_type === 'external_partner' || p.employment_type === 'external_office') return 'external_partner'
  if (p.employment_type === 'external') return 'external'
  if (p.employment_type === 'internal') return 'internal'
  // 아직 구분을 안 고른 외부협력(허수정·장정아)은 외부협력이 기본
  if (EXTERNAL_PARTNER_DEFAULT.includes(String(p.full_name || '').trim())) return 'external_partner'
  return 'internal'
}

const KIND_META = {
  internal: { label: '내부', chip: 'bg-ink-100 text-ink-600', title: '내부 직원 (4대보험·명세서)' },
  external_partner: { label: '외부협력', chip: 'bg-sky-50 text-sky-700', title: '사무실 상주지만 세무상 외부 · 3.3% 원천징수' },
  external: { label: '단기외부', chip: 'bg-amber-50 text-amber-700', title: '행사 알바 등 단기 외부 · 3.3% 원천징수' },
}

function cardCodeOf(p) {
  const saved = String(p?.card_code || '').trim().toUpperCase()
  if (saved) return saved
  return cardCodeForName(p?.full_name) || ''
}

function isMissingColumnError(e) {
  return /column .* does not exist|42703|schema cache/i.test(String(e?.message || ''))
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

  const [addOpen, setAddOpen] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [addForm, setAddForm] = useState({
    full_name: '',
    employment_type: 'internal',
    card_code: '',
    department: '',
    phone: '',
    hire_date: '',
  })

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
    const base = {
      full_name: String(patch.full_name ?? p.full_name ?? '').trim(),
      department: String(patch.department ?? p.department ?? '').trim(),
      phone: String(patch.phone ?? p.phone ?? '').trim(),
      hire_date: patch.hire_date ?? p.hire_date ?? null,
      birth_date: patch.birth_date ?? p.birth_date ?? null,
      ...(celebrateSupported ? { birth_celebrate: patch.birth_celebrate ?? p.birth_celebrate ?? null } : {}),
      active: patch.active ?? p.active ?? true,
    }
    if (externalSupported) base.employment_type = patch.employment_type ?? p.employment_type ?? 'internal'
    if (cardCodeSupported) {
      base.card_code = String(patch.card_code ?? p.card_code ?? '').trim().toUpperCase()
    }
    if (!base.full_name) {
      if (!silent) toast.error('이름을 입력해 주세요.')
      setSavingId(null)
      return false
    }
    try {
      const saved = await updateProfile(p.id, base)
      setProfiles((rows) => rows.map((r) => (r.id === p.id ? { ...r, ...saved } : r)))
      cancelRow(p.id)
      if (!silent) toast.success(`${saved.full_name || p.full_name} 저장되었습니다.`)
      return true
    } catch (e) {
      // 마이그레이션 전 DB(컬럼 없음)에서도 저장은 되게 재시도
      if (isMissingColumnError(e)) {
        try {
          const fallback = { ...base }
          delete fallback.employment_type
          delete fallback.card_code
          const saved = await updateProfile(p.id, fallback)
          setProfiles((rows) => rows.map((r) => (r.id === p.id ? { ...r, ...saved } : r)))
          cancelRow(p.id)
          if (!silent) toast.success(`${saved.full_name || p.full_name} 저장되었습니다.`)
          return true
        } catch (e2) {
          if (!silent) toast.error(e2.message)
          return false
        } finally {
          setSavingId(null)
        }
      }
      if (!silent) toast.error(e.message)
      setSavingId(null)
      return false
    } finally {
      setSavingId((cur) => (cur === p.id ? null : cur))
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

  const openAdd = (preset = {}) => {
    setAddForm({
      full_name: preset.full_name || '',
      employment_type: preset.employment_type || 'internal',
      card_code: preset.card_code || cardCodeForName(preset.full_name) || '',
      department: preset.department || '',
      phone: preset.phone || '',
      hire_date: preset.hire_date || '',
    })
    setAddError('')
    setAddOpen(true)
  }

  const submitAdd = async (e) => {
    e.preventDefault()
    const name = String(addForm.full_name || '').trim()
    if (!name) return setAddError('이름을 입력해 주세요.')
    if (profiles.some((p) => String(p.full_name || '').trim() === name)) {
      return setAddError(`"${name}" 님은 이미 구성원에 있습니다. 목록에서 수정해 주세요.`)
    }
    setAddSaving(true)
    setAddError('')
    const row = {
      full_name: name,
      role: 'staff',
      department: String(addForm.department || '').trim(),
      phone: String(addForm.phone || '').trim(),
      hire_date: addForm.hire_date || null,
      active: true,
    }
    if (externalSupported) row.employment_type = addForm.employment_type || 'internal'
    if (cardCodeSupported) row.card_code = String(addForm.card_code || cardCodeForName(name) || '').trim().toUpperCase()
    try {
      const saved = await createProfile(row)
      setProfiles((rows) => [...rows, saved])
      setAddOpen(false)
      toast.success(`${saved.full_name} 님이 구성원에 등록되었습니다.`)
    } catch (err) {
      if (isMissingColumnError(err)) {
        try {
          const fallback = { ...row }
          delete fallback.employment_type
          delete fallback.card_code
          const saved = await createProfile(fallback)
          setProfiles((rows) => [...rows, saved])
          setAddOpen(false)
          toast.success(`${saved.full_name} 님이 등록되었습니다. (구분·카드코드는 SQL 실행 후 표시됩니다)`)
          return
        } catch (e2) {
          setAddError(`${e2.message} — Supabase SQL Editor에서 supabase/migration_profiles_external.sql 실행이 필요할 수 있습니다.`)
          return
        }
      }
      setAddError(err.message)
    } finally {
      setAddSaving(false)
    }
  }

  const dirtyCount = Object.keys(rowEdits).length
  const activeList = useMemo(() => profiles.filter((p) => p.active !== false), [profiles])
  const officeExternalList = useMemo(() => profiles.filter((p) => kindOfProfile(p) === 'external_partner'), [profiles])
  const tempExternalList = useMemo(() => profiles.filter((p) => kindOfProfile(p) === 'external'), [profiles])
  /* 챙기는 생일 컬럼(migration_profiles_celebrate.sql) 적용 전에는 숨깁니다 */
  const celebrateSupported = useMemo(() => profiles.some((p) => p && 'birth_celebrate' in p), [profiles])
  const externalSupported = useMemo(() => profiles.some((p) => p && 'employment_type' in p), [profiles])
  const cardCodeSupported = useMemo(() => profiles.some((p) => p && 'card_code' in p), [profiles])

  const totalPay = useMemo(() => Object.values(payByName).reduce((a, v) => a + v, 0), [payByName])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="구성원"
        description="인사관리 · 내부 직원과 협력 인력(손선욱·허수정·장정아)을 함께 관리합니다. 이름·구분·카드코드까지 이 화면에서 추가·수정합니다."
      >
        <button type="button" className="btn-primary" onClick={() => openAdd()}>
          <Icon name="plus" size={16} />
          구성원 추가
        </button>
      </PageHeader>
      {!loading && !externalSupported ? (
        <InlineAlert tone="info">
          인별 구분(내부/외부협력/단기외부·카드코드)을 저장하려면 Supabase SQL Editor에서{' '}
          <strong>supabase/migration_profiles_external.sql</strong>을 1회 실행하세요. 실행 전에도 허수정·장정아님은
          외부협력으로 표시됩니다.
        </InlineAlert>
      ) : null}

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="재직" value={String(activeList.length)} unit="명" tone="neutral" icon="users" />
            <StatCard
              label="외부협력"
              value={String(officeExternalList.filter((p) => p.active !== false).length)}
              unit="명"
              tone="neutral"
              icon="users"
              hint={`단기외부 ${tempExternalList.filter((p) => p.active !== false).length}명`}
            />
            <StatCard label="인건비 누적" value={totalPay} tone="opex" icon="coins" hint="장부 인건비 합계" />
          </div>

          {OFFICE_STAFF.filter(
            (s) => !profiles.some((p) => String(p.full_name || '').trim() === s.name),
          ).length ? (
            <div className="card flex flex-wrap items-center gap-2 border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs">
              <span className="font-semibold text-ink-800">아직 구성원에 없는 협력 인력</span>
              {OFFICE_STAFF.filter(
                (s) => !profiles.some((p) => String(p.full_name || '').trim() === s.name),
              ).map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => openAdd({ full_name: s.name, employment_type: s.kind || 'internal' })}
                  className="chip bg-white font-bold text-amber-700 hover:underline"
                >
                  + {s.name}
                </button>
              ))}
            </div>
          ) : null}

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
                <table className="w-full min-w-[1080px] border-collapse text-xs">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">이름</th>
                      <th className="th">구분</th>
                      <th className="th">카드코드</th>
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
                      const kind = kindOfProfile(work)
                      const kindMeta = KIND_META[kind] || KIND_META.internal
                      return (
                        <tr key={p.id} className={dirty ? 'bg-brand-50/40' : undefined}>
                          <td className="td">
                            <input
                              className="input w-28 py-1 text-xs font-bold"
                              value={work.full_name || ''}
                              onChange={(e) => setCell(p.id, { full_name: e.target.value })}
                              placeholder="이름"
                            />
                          </td>
                          <td className="td">
                            {externalSupported ? (
                              <select
                                className="input w-28 py-1 text-xs"
                                value={['internal', 'external_partner', 'external'].includes(work.employment_type) ? work.employment_type : kind}
                                onChange={(e) => setCell(p.id, { employment_type: e.target.value })}
                              >
                                <option value="internal">내부</option>
                                <option value="external_partner">외부협력·3.3%</option>
                                <option value="external">단기외부·3.3%</option>
                              </select>
                            ) : (
                              <span
                                className={`chip ${kindMeta.chip}`}
                                title={kindMeta.title}
                              >
                                {kindMeta.label}
                              </span>
                            )}
                          </td>
                          <td className="td">
                            {cardCodeSupported ? (
                              <input
                                className="input w-16 py-1 text-xs font-bold uppercase"
                                value={String(work.card_code ?? cardCodeOf(p) ?? '').toUpperCase()}
                                onChange={(e) => setCell(p.id, { card_code: e.target.value.toUpperCase() })}
                                placeholder="예: C"
                              />
                            ) : (
                              <span className="font-bold text-ink-700">{cardCodeOf(work) || '—'}</span>
                            )}
                          </td>
                          <td className="td">
                            <input
                              className="input w-28 py-1 text-xs"
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
                휴무대장 입사일과 함께 씁니다. 퇴사로 바꾸면 목록·집계에서 빠집니다. 외부협력·단기외부는 급여관리에서
                분리 표시되고(3.3%), 카드코드는 카드내역·운영비 작성 시 기타 직접입력과 같은 값으로 씁니다.
                {user ? '' : ''}
              </p>
            </div>
          ) : (
            <EmptyState icon="users" title="구성원이 없습니다" description="위 구성원 추가로 등록하세요." />
          )}
        </>
      )}

      <Modal
        open={addOpen}
        onClose={addSaving ? undefined : () => setAddOpen(false)}
        title="구성원 추가"
        subtitle="로그인 계정 없이 근무하는 분(외부협력·손선욱형)도 여기서 등록합니다. 로그인용 계정은 계정관리에서 만듭니다."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAddOpen(false)} disabled={addSaving}>
              취소
            </button>
            <button type="submit" form="member-add-form" className="btn-primary" disabled={addSaving}>
              {addSaving ? <Spinner size={15} /> : null}
              {addSaving ? '등록 중…' : '등록'}
            </button>
          </>
        }
      >
        <form id="member-add-form" onSubmit={submitAdd} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {addError ? (
            <div className="sm:col-span-2">
              <InlineAlert tone="error">{addError}</InlineAlert>
            </div>
          ) : null}
          <Field label="이름" required>
            <input
              className="input"
              value={addForm.full_name}
              onChange={(e) =>
                setAddForm((f) => ({
                  ...f,
                  full_name: e.target.value,
                  card_code: f.card_code || cardCodeForName(e.target.value),
                }))
              }
              placeholder="예: 허수정"
              required
            />
          </Field>
          <Field label="구분" hint="외부는 3.3% · 외부협력은 급여에서 따로 표시">
            <select
              className="input"
              value={addForm.employment_type}
              onChange={(e) => setAddForm((f) => ({ ...f, employment_type: e.target.value }))}
            >
              <option value="internal">내부 (4대보험·명세서)</option>
              <option value="external_partner">외부협력·3.3% (상주)</option>
              <option value="external">단기외부·3.3% (행사 알바)</option>
            </select>
          </Field>
          <Field label="카드코드" hint="영어 대문자 (카드 화면의 기타 직접입력과 같은 값)">
            <input
              className="input uppercase"
              value={addForm.card_code}
              onChange={(e) => setAddForm((f) => ({ ...f, card_code: e.target.value.toUpperCase() }))}
              placeholder="예: C"
            />
          </Field>
          <Field label="부서">
            <input
              className="input"
              value={addForm.department}
              onChange={(e) => setAddForm((f) => ({ ...f, department: e.target.value }))}
              placeholder="예: 경영지원"
            />
          </Field>
          <Field label="연락처">
            <input
              className="input"
              value={addForm.phone}
              onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="010-0000-0000"
            />
          </Field>
          <Field label="입사일">
            <input
              type="date"
              className="input"
              value={addForm.hire_date}
              onChange={(e) => setAddForm((f) => ({ ...f, hire_date: e.target.value }))}
            />
          </Field>
          {!externalSupported ? (
            <p className="text-xs leading-relaxed text-ink-500 sm:col-span-2">
              구분·카드코드 칸은 supabase/migration_profiles_external.sql 실행 뒤 DB에 저장됩니다. 실행 전에도 구분 변경·카드코드 입력은 화면에 바로 반영됩니다.
            </p>
          ) : null}
        </form>
      </Modal>
    </div>
  )
}
