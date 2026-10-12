import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import BackupPanel from '../components/BackupPanel'
import { useToast } from '../components/Toast'
import { Field, InlineAlert, LoadingBlock, PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { APP_NAME, APP_VERSION, COMPANY_EN, ROLE_LABEL } from '../lib/constants'
import { PERM_DEFS } from '../lib/permissions'
import { formatDateHuman } from '../lib/format'
import { callAdminFn, getSettings, listProfiles, updateProfile, updateSettings } from '../lib/api'

export default function Settings() {
  const { profile, isAdmin, refreshProfile, signOut, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [me, setMe] = useState({ full_name: '', department: '', position: '', phone: '' })
  const [savingMe, setSavingMe] = useState(false)

  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [savingPw, setSavingPw] = useState(false)

  const [loadingCompany, setLoadingCompany] = useState(isAdmin)

  const [staffPerms, setStaffPerms] = useState([])
  const [hasPermColumn, setHasPermColumn] = useState(true)
  const [savingPerms, setSavingPerms] = useState(false)

  /* 프로젝트 금액을 볼 수 있는 직원 id 목록 (관리자 외 예외) */
  const [staffList, setStaffList] = useState([])
  const [financeViewers, setFinanceViewers] = useState([])
  const [savingFinance, setSavingFinance] = useState(false)

  useEffect(() => {
    if (profile) {
      setMe({
        full_name: profile.full_name || '',
        department: profile.department || '',
        position: profile.position || '',
        phone: profile.phone || '',
      })
    }
  }, [profile])

  const loadCompany = useCallback(async () => {
    if (!isAdmin) return
    setLoadingCompany(true)
    try {
      const [data, profiles] = await Promise.all([
        getSettings(),
        listProfiles().catch(() => []),
      ])
      if (data) {
        if (data && 'staff_permissions' in data && Array.isArray(data.staff_permissions)) {
          setStaffPerms(data.staff_permissions)
          setHasPermColumn(true)
        } else {
          setHasPermColumn(false)
        }
        if (Array.isArray(data.finance_viewers)) {
          setFinanceViewers(data.finance_viewers.filter((v) => typeof v === 'string'))
        }
      }
      setStaffList(profiles || [])
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
        position: me.position.trim(),
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

  const saveFinance = async (e) => {
    e.preventDefault()
    setSavingFinance(true)
    try {
      await updateSettings({ finance_viewers: financeViewers })
      toast.success('저장되었습니다. 해당 직원은 다음 접속부터 프로젝트 금액을 봅니다.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingFinance(false)
    }
  }

  const toggleFinance = (id) => {
    setFinanceViewers((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
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
              <Field label="직함">
                <input
                  className="input"
                  value={me.position}
                  onChange={(e) => setMe((v) => ({ ...v, position: e.target.value }))}
                  placeholder="예: 팀장, 대리, 과장"
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

        {/* 프로젝트 금액 열람자 */}
        {isAdmin ? (
          <section className="card p-5">
            <header className="mb-4">
              <h2 className="text-sm font-bold text-ink-900">프로젝트 금액 볼 수 있는 직원</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                관리자가 아니면 프로젝트 금액(계약·매출·이익)이 숨겨집니다. 체크한 직원은 금액을 볼 수 있습니다.
              </p>
            </header>
            {loadingCompany ? (
              <LoadingBlock label="불러오는 중…" />
            ) : (
              <form onSubmit={saveFinance} className="flex flex-col gap-2.5">
                {staffList
                  .filter((p) => p.role !== 'admin' && p.active !== false)
                  .map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-ink-200 px-3.5 py-2.5 transition hover:bg-ink-50/60"
                    >
                      <span className="text-sm font-semibold text-ink-800">
                        {p.full_name || p.email}
                        {p.position ? <span className="ml-1.5 font-normal text-ink-500">{p.position}</span> : null}
                      </span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        checked={financeViewers.includes(p.id)}
                        onChange={() => toggleFinance(p.id)}
                      />
                    </label>
                  ))}
                <div className="flex justify-end pt-1">
                  <button type="submit" className="btn-primary" disabled={savingFinance}>
                    {savingFinance ? <Spinner size={15} /> : <Icon name="check" size={15} />}
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
                전체 직원에게 공통으로 보여줄 추가 메뉴를 정합니다. 특정 직원에게만 더 보여주려면 계정관리에서
                정하세요. 체크를 모두 끄면 설정 메뉴만 보입니다.
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
                <p className="rounded-lg bg-ink-50/70 px-3.5 py-2.5 text-[11px] leading-relaxed text-ink-500">
                  프로젝트 담당자로 지정된 직원은 담당 프로젝트의 금액(계약·매출·이익)을 볼 수 있습니다.
                  담당자 지정은 프로젝트 등록·수정창에서 합니다.
                </p>
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

        {/* 데이터 백업 */}
        {isAdmin ? (
          <section className="card p-5">
            <header className="mb-4">
              <h2 className="text-sm font-bold text-ink-900">데이터 백업</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                월 1회 백업을 권장합니다. 엑셀 파일의 시트별로 저장됩니다.
              </p>
            </header>
            <BackupPanel />
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
            <Row label="서비스" value={`${COMPANY_EN} ${APP_NAME}`} />
            <Row label="버전" value={APP_VERSION} />
            {isAdmin ? <Row label="데이터 저장소" value="Supabase (서울 리전)" /> : null}
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
