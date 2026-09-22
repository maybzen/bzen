import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { Field, InlineAlert, LoadingBlock, PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { COMPANY_EN, ROLE_LABEL } from '../lib/constants'
import { PERM_DEFS } from '../lib/permissions'
import { formatDateHuman } from '../lib/format'
import { callAdminFn, getSettings, updateProfile, updateSettings } from '../lib/api'

export default function Settings() {
  const { profile, isAdmin, refreshProfile, signOut, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [me, setMe] = useState({ full_name: '', department: '', phone: '' })
  const [savingMe, setSavingMe] = useState(false)

  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [savingPw, setSavingPw] = useState(false)

  const [company, setCompany] = useState({ company_name: '', biz_no: '' })
  const [loadingCompany, setLoadingCompany] = useState(isAdmin)
  const [savingCompany, setSavingCompany] = useState(false)

  const [staffPerms, setStaffPerms] = useState([])
  const [hasPermColumn, setHasPermColumn] = useState(true)
  const [savingPerms, setSavingPerms] = useState(false)

  useEffect(() => {
    if (profile) {
      setMe({
        full_name: profile.full_name || '',
        department: profile.department || '',
        phone: profile.phone || '',
      })
    }
  }, [profile])

  const loadCompany = useCallback(async () => {
    if (!isAdmin) return
    setLoadingCompany(true)
    try {
      const data = await getSettings()
      if (data) {
        setCompany({ company_name: data.company_name || '', biz_no: data.biz_no || '' })
        if (data && 'staff_permissions' in data && Array.isArray(data.staff_permissions)) {
          setStaffPerms(data.staff_permissions)
          setHasPermColumn(true)
        } else {
          setHasPermColumn(false)
        }
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoadingCompany(false)
    }
  }, [isAdmin, toast])

  useEffect(() => {
    loadCompany()
  }, [loadCompany])

  const saveMe = async (e) => {
    e.preventDefault()
    if (!me.full_name.trim()) {
      toast.error('이름을 입력해 주세요.')
      return
    }
    setSavingMe(true)
    try {
      await updateProfile(profile.id, {
        full_name: me.full_name.trim(),
        department: me.department.trim(),
        phone: me.phone.trim(),
      })
      await refreshProfile()
      toast.success('저장되었습니다.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingMe(false)
    }
  }

  const savePassword = async (e) => {
    e.preventDefault()
    if (pw.next.length < 6) {
      toast.error('비밀번호는 6자 이상이어야 합니다.')
      return
    }
    if (pw.next !== pw.confirm) {
      toast.error('비밀번호가 서로 다릅니다.')
      return
    }
    setSavingPw(true)
    try {
      await callAdminFn({ action: 'self-password', password: pw.next })
      setPw({ next: '', confirm: '' })
      toast.success('비밀번호가 변경되었습니다.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingPw(false)
    }
  }

  const savePerms = async (e) => {
    e.preventDefault()
    setSavingPerms(true)
    try {
      await updateSettings({ staff_permissions: staffPerms })
      toast.success('직원 권한이 저장되었습니다. 직원은 다음 접속부터 적용됩니다.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingPerms(false)
    }
  }

  const togglePerm = (key) => {
    setStaffPerms((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const saveCompany = async (e) => {
    e.preventDefault()
    setSavingCompany(true)
    try {
      await updateSettings({
        company_name: company.company_name.trim(),
        biz_no: company.biz_no.trim(),
      })
      toast.success('회사 정보가 저장되었습니다.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingCompany(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="설정" description="내 정보와 시스템 설정을 관리합니다." />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* 내 정보 */}
        <section className="card p-5">
          <header className="mb-4">
            <h2 className="text-sm font-bold text-ink-900">내 정보</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              {ROLE_LABEL[profile?.role] || ''} · {profile?.email}
            </p>
          </header>
          <form onSubmit={saveMe} className="flex flex-col gap-4">
            <Field label="이름" required>
              <input
                className="input"
                value={me.full_name}
                onChange={(e) => setMe((v) => ({ ...v, full_name: e.target.value }))}
                required
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="부서">
                <input
                  className="input"
                  value={me.department}
                  onChange={(e) => setMe((v) => ({ ...v, department: e.target.value }))}
                  placeholder="예: 경영지원"
                />
              </Field>
              <Field label="연락처">
                <input
                  className="input"
                  value={me.phone}
                  onChange={(e) => setMe((v) => ({ ...v, phone: e.target.value }))}
                  placeholder="010-0000-0000"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={savingMe}>
                {savingMe ? <Spinner size={15} /> : <Icon name="check" size={15} />}
                저장
              </button>
            </div>
          </form>
        </section>

        {/* 비밀번호 */}
        <section className="card p-5">
          <header className="mb-4">
            <h2 className="text-sm font-bold text-ink-900">비밀번호 변경</h2>
            <p className="mt-0.5 text-xs text-ink-500">6자 이상으로 설정해 주세요.</p>
          </header>
          <form onSubmit={savePassword} className="flex flex-col gap-4">
            <Field label="새 비밀번호" required>
              <input
                type="password"
                className="input"
                value={pw.next}
                onChange={(e) => setPw((v) => ({ ...v, next: e.target.value }))}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="새 비밀번호 확인" required>
              <input
                type="password"
                className="input"
                value={pw.confirm}
                onChange={(e) => setPw((v) => ({ ...v, confirm: e.target.value }))}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </Field>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={savingPw}>
                {savingPw ? <Spinner size={15} /> : <Icon name="lock" size={15} />}
                변경
              </button>
            </div>
          </form>
        </section>

        {/* 회사 정보 */}
        {isAdmin ? (
          <section className="card p-5">
            <header className="mb-4">
              <h2 className="text-sm font-bold text-ink-900">회사 정보</h2>
              <p className="mt-0.5 text-xs text-ink-500">화면 상단과 보고서에 표시됩니다.</p>
            </header>
            {loadingCompany ? (
              <LoadingBlock label="불러오는 중…" />
            ) : (
              <form onSubmit={saveCompany} className="flex flex-col gap-4">
                <Field label="회사명" required>
                  <input
                    className="input"
                    value={company.company_name}
                    onChange={(e) => setCompany((v) => ({ ...v, company_name: e.target.value }))}
                    required
                  />
                </Field>
                <Field label="사업자등록번호">
                  <input
                    className="input"
                    value={company.biz_no}
                    onChange={(e) => setCompany((v) => ({ ...v, biz_no: e.target.value }))}
                    placeholder="000-00-00000"
                  />
                </Field>
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary" disabled={savingCompany}>
                    {savingCompany ? <Spinner size={15} /> : <Icon name="check" size={15} />}
                    저장
                  </button>
                </div>
              </form>
            )}
          </section>
        ) : null}

        {/* 직원 권한 */}
        {isAdmin ? (
          <section className="card p-5">
            <header className="mb-4">
              <h2 className="text-sm font-bold text-ink-900">직원 권한</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                직원이 볼 수 있는 메뉴를 정합니다. 대시보드·지출결의·프로젝트·설정은 항상 보입니다.
              </p>
            </header>
            {loadingCompany ? (
              <LoadingBlock label="불러오는 중…" />
            ) : !hasPermColumn ? (
              <InlineAlert tone="warning">
                권한 설정을 쓰려면 Supabase 대시보드 → SQL Editor에서 저장소의
                <strong> supabase/migration_partners.sql </strong>
                파일을 실행해 주세요.
              </InlineAlert>
            ) : (
              <form onSubmit={savePerms} className="flex flex-col gap-2.5">
                {PERM_DEFS.map((perm) => (
                  <label
                    key={perm.key}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-ink-200 px-3.5 py-2.5 transition hover:bg-ink-50/60"
                  >
                    <span className="text-sm font-semibold text-ink-800">{perm.label}</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-600"
                      checked={staffPerms.includes(perm.key)}
                      onChange={() => togglePerm(perm.key)}
                    />
                  </label>
                ))}
                <div className="flex justify-end pt-1">
                  <button type="submit" className="btn-primary" disabled={savingPerms}>
                    {savingPerms ? <Spinner size={15} /> : <Icon name="check" size={15} />}
                    저장
                  </button>
                </div>
              </form>
            )}
          </section>
        ) : null}

        {/* 시스템 정보 */}
        <section className="card p-5">
          <header className="mb-4">
            <h2 className="text-sm font-bold text-ink-900">시스템 정보</h2>
          </header>
          <dl className="flex flex-col gap-2.5 text-sm">
            <Row label="로그인 계정" value={user?.email || '—'} />
            <Row label="권한" value={ROLE_LABEL[profile?.role] || '—'} />
            <Row label="계정 생성일" value={formatDateHuman(profile?.created_at)} />
            <Row label="서비스" value={`${COMPANY_EN} 회계관리 시스템`} />
            <Row label="데이터 저장소" value="Supabase (서울 리전)" />
          </dl>

          <div className="mt-5 flex flex-col gap-2">
            <InlineAlert tone="info">
              장부 데이터는 클라우드에 저장됩니다. 첨부한 증빙 파일은 비공개 저장소에 보관되며, 열람 시에만 임시
              주소가 발급됩니다.
            </InlineAlert>
            <button
              type="button"
              className="btn-danger mt-1 self-start"
              onClick={async () => {
                await signOut()
                navigate('/login', { replace: true })
              }}
            >
              <Icon name="logout" size={16} />
              로그아웃
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ink-100 pb-2.5 last:border-0">
      <dt className="shrink-0 text-xs font-semibold text-ink-500">{label}</dt>
      <dd className="truncate text-right text-sm font-medium text-ink-800">{value}</dd>
    </div>
  )
}
