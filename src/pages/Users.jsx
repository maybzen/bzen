import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { ConfirmDialog, Field, InlineAlert, LoadingBlock, Modal, PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABEL } from '../lib/constants'
import { PERM_DEFS, PERM_LABEL } from '../lib/permissions'
import { formatDateHuman } from '../lib/format'
import { callAdminFn, getSettings, listProfiles, updateSettings } from '../lib/api'

const EMPTY = {
  full_name: '',
  email: '',
  password: '',
  role: 'staff',
  department: '',
  phone: '',
  menus: [],
}

export default function Users() {
  const { user, refreshProfile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState([])
  const [search, setSearch] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [overrides, setOverrides] = useState({})
  const [hasOverridesColumn, setHasOverridesColumn] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [pwTarget, setPwTarget] = useState(null)
  const [pwValue, setPwValue] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, settings] = await Promise.all([
        listProfiles(),
        getSettings().catch(() => null),
      ])
      setProfiles(rows)
      if (settings && settings.staff_overrides && typeof settings.staff_overrides === 'object') {
        setOverrides(settings.staff_overrides)
        setHasOverridesColumn(true)
      } else if (settings && !('staff_overrides' in settings)) {
        setHasOverridesColumn(false)
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? profiles.filter((p) =>
          [p.full_name, p.email, p.department].some((v) => String(v || '').toLowerCase().includes(q)),
        )
      : profiles.slice()
    // 관리자 먼저(가입순), 다음 직원(가입순)
    return list.sort((a, b) => {
      const rank = (p) => (p.role === 'admin' ? 0 : 1)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      return String(a.created_at || '').localeCompare(String(b.created_at || ''))
    })
  }, [profiles, search])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    setError('')
    setFormOpen(true)
  }

  const openEdit = (profile) => {
    setEditing(profile)
    setForm({
      full_name: profile.full_name || '',
      email: profile.email || '',
      password: '',
      role: profile.role || 'staff',
      department: profile.department || '',
      phone: profile.phone || '',
      menus: overrides[profile.id] || [],
    })
    setError('')
    setFormOpen(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (editing) {
        await callAdminFn({
          action: 'update',
          user_id: editing.id,
          full_name: form.full_name,
          department: form.department,
          phone: form.phone,
          role: form.role,
        })
        if (hasOverridesColumn) {
          try {
            const validIds = new Set([...profiles.map((p) => p.id), editing.id])
            const next = {}
            for (const [uid, menus] of Object.entries(overrides)) {
              if (uid !== editing.id && validIds.has(uid) && Array.isArray(menus) && menus.length) {
                next[uid] = menus
              }
            }
            const myMenus = form.role === 'staff' ? form.menus : []
            if (myMenus.length) next[editing.id] = myMenus
            await updateSettings({ staff_overrides: next })
            setOverrides(next)
          } catch (permErr) {
            toast.error(`계정은 수정됐지만 메뉴 권한 저장에 실패했습니다: ${permErr.message}`)
          }
        }
        toast.success('계정 정보가 수정되었습니다.')
        if (editing.id === user?.id) await refreshProfile()
      } else {
        await callAdminFn({
          action: 'create',
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          role: form.role,
          department: form.department,
          phone: form.phone,
        })
        toast.success('계정이 추가되었습니다.')
      }
      setFormOpen(false)
      setEditing(null)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (profile) => {
    try {
      await callAdminFn({
        action: 'update',
        user_id: profile.id,
        active: !profile.active,
      })
      toast.success(profile.active ? '사용 중지되었습니다.' : '다시 사용할 수 있게 했습니다.')
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const changePassword = async () => {
    if (pwValue.length < 6) {
      toast.error('비밀번호는 6자 이상이어야 합니다.')
      return
    }
    setPwSaving(true)
    try {
      await callAdminFn({ action: 'set-password', user_id: pwTarget.id, password: pwValue })
      toast.success(`${pwTarget.full_name || pwTarget.email} 님의 비밀번호를 변경했습니다.`)
      setPwTarget(null)
      setPwValue('')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setPwSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await callAdminFn({ action: 'delete', user_id: removing.id })
      toast.success('계정이 삭제되었습니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="계정관리" description="직원 계정과 권한을 관리합니다. 계정 추가·비밀번호 변경은 관리자만 가능합니다.">
        <button type="button" className="btn-primary" onClick={openCreate}>
          <Icon name="plus" size={16} />
          계정 추가
        </button>
      </PageHeader>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 px-4 py-3.5">
          <div className="relative max-w-sm">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              className="input pl-9"
              placeholder="이름, 이메일, 부서 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <LoadingBlock />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">이름</th>
                  <th className="th">이메일</th>
                  <th className="th">부서</th>
                  <th className="th">권한</th>
                  <th className="th">추가 메뉴</th>
                  <th className="th">상태</th>
                  <th className="th">연락처</th>
                  <th className="th text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map((profile) => (
                  <tr key={profile.id} className="transition hover:bg-ink-50/60">
                    <td className="td font-semibold text-ink-900">
                      {profile.full_name || '(이름 없음)'}
                      {profile.id === user?.id ? (
                        <span className="ml-1.5 chip bg-brand-50 text-brand-700">나</span>
                      ) : null}
                    </td>
                    <td className="td text-ink-600">{profile.email}</td>
                    <td className="td text-ink-600">{profile.department || '—'}</td>
                    <td className="td">
                      <span
                        className={`chip ${
                          profile.role === 'admin' ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-600'
                        }`}
                      >
                        {ROLE_LABEL[profile.role] || profile.role}
                      </span>
                    </td>
                    <td className="td">
                      {profile.role === 'admin' ? (
                        <span className="text-xs text-ink-400">전체</span>
                      ) : (
                        (() => {
                          const extra = (overrides[profile.id] || []).filter((k) => PERM_LABEL[k])
                          return extra.length ? (
                            <span className="flex flex-wrap gap-1">
                              {extra.map((key) => (
                                <span key={key} className="chip bg-brand-50 text-brand-700">
                                  {PERM_LABEL[key]}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-400">기본</span>
                          )
                        })()
                      )}
                    </td>
                    <td className="td">
                      <span
                        className={`chip ${
                          profile.active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {profile.active ? '사용중' : '중지'}
                      </span>
                    </td>
                    <td className="td num text-left text-ink-600">{profile.phone || '—'}</td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(profile)}
                          className="rounded-md p-1.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                          title="수정"
                        >
                          <Icon name="pencil" size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPwTarget(profile)
                            setPwValue('')
                          }}
                          className="rounded-md p-1.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                          title="비밀번호 변경"
                        >
                          <Icon name="lock" size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(profile)}
                          className="rounded-md p-1.5 text-ink-500 transition hover:bg-amber-50 hover:text-amber-700"
                          title={profile.active ? '사용 중지' : '사용 재개'}
                        >
                          <Icon name={profile.active ? 'close' : 'check'} size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(profile)}
                          className="rounded-md p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-loss"
                          title="삭제"
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={8} className="empty">
                      해당하는 계정이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InlineAlert tone="info">
          <strong className="font-semibold">권한 안내</strong> — 전 직원은 대시보드·설정이 공통으로 보입니다.
          나머지 메뉴(지출결의·거래처·프로젝트·매출·매입·운영비·보고서)는 설정 또는 계정별로 허용할 수 있습니다.
          장부에서는 등록·수정은 가능하고 삭제는 관리자만 가능합니다.
        </InlineAlert>
        <InlineAlert tone="warn">
          마지막 관리자 계정은 권한을 내리거나 삭제할 수 없습니다. 관리자 계정을 최소 1개 유지해 주세요.
        </InlineAlert>
      </div>

      {/* 계정 추가/수정 */}
      <Modal
        open={formOpen}
        onClose={saving ? undefined : () => setFormOpen(false)}
        title={editing ? '계정 수정' : '계정 추가'}
        subtitle={editing ? editing.email : '직원이 로그인할 이메일과 초기 비밀번호를 정해 주세요.'}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              취소
            </button>
            <button type="submit" form="user-form" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size={15} /> : null}
              {saving ? '저장 중…' : '저장'}
            </button>
          </>
        }
      >
        <form id="user-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {error ? (
            <div className="sm:col-span-2">
              <InlineAlert tone="error">{error}</InlineAlert>
            </div>
          ) : null}

          <Field label="이름" required>
            <input
              className="input"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
          </Field>

          <Field label="권한">
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value, menus: [] }))}
            >
              <option value="staff">직원</option>
              <option value="admin">관리자</option>
            </select>
          </Field>

          {form.role === 'staff' ? (
            <Field
              label="추가 메뉴 권한"
              hint="전체 직원 기본 권한에 더해 이 계정에만 허용합니다."
              className="sm:col-span-2"
            >
              {!hasOverridesColumn ? (
                <InlineAlert tone="warning">
                  개인별 권한을 쓰려면 Supabase SQL Editor에서
                  <strong> supabase/migration_user_menus.sql </strong>
                  파일을 실행해 주세요.
                </InlineAlert>
              ) : (
                <div className="flex flex-col gap-2">
                  {PERM_DEFS.map((perm) => (
                    <label
                      key={perm.key}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-ink-200 px-3.5 py-2.5 transition hover:bg-ink-50/60"
                    >
                      <span className="text-sm font-semibold text-ink-800">{perm.label}</span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        checked={form.menus.includes(perm.key)}
                        onChange={() =>
                          setForm((f) => ({
                            ...f,
                            menus: f.menus.includes(perm.key)
                              ? f.menus.filter((k) => k !== perm.key)
                              : [...f.menus, perm.key],
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </Field>
          ) : null}

          {!editing ? (
            <>
              <Field label="이메일" required>
                <input
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="name@company.co.kr"
                  required
                />
              </Field>

              <Field label="초기 비밀번호" required hint="6자 이상">
                <input
                  type="password"
                  className="input"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  required
                />
              </Field>
            </>
          ) : null}

          <Field label="부서">
            <input
              className="input"
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              placeholder="예: 경영지원"
            />
          </Field>

          <Field label="연락처">
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="010-0000-0000"
            />
          </Field>

          {editing ? (
            <p className="text-xs text-ink-500 sm:col-span-2">
              가입일 {formatDateHuman(editing.created_at)} · 이메일은 변경할 수 없습니다.
            </p>
          ) : null}
        </form>
      </Modal>

      {/* 비밀번호 변경 */}
      <Modal
        open={Boolean(pwTarget)}
        onClose={pwSaving ? undefined : () => setPwTarget(null)}
        title="비밀번호 변경"
        subtitle={pwTarget ? `${pwTarget.full_name || pwTarget.email} (${pwTarget.email})` : ''}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setPwTarget(null)} disabled={pwSaving}>
              취소
            </button>
            <button type="button" className="btn-primary" onClick={changePassword} disabled={pwSaving}>
              {pwSaving ? <Spinner size={15} /> : null}
              변경
            </button>
          </>
        }
      >
        <Field label="새 비밀번호" required hint="6자 이상">
          <input
            type="password"
            className="input"
            value={pwValue}
            onChange={(e) => setPwValue(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="계정을 삭제하시겠습니까?"
        message={
          removing
            ? `${removing.full_name || removing.email} 계정을 완전히 삭제합니다.\n이 사용자가 등록한 장부 내역은 '담당자 없음'으로 남습니다.`
            : ''
        }
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
