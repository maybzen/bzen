import { Component, Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Icon from './components/Icon'
import { Spinner } from './components/ui'
import { ToastProvider } from './components/Toast'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { useStaffPermissions } from './lib/permissions'

/**
 * 배포 직후 낡은 index.html이 이미 지워진 청크를 요청하면(404)
 * 한 번만 새로고침해서 새 파일을 받습니다.
 */
/* 새로고침해도 같은 낡은 파일이 나오면 쿼리를 바꿔 캐시를 우회합니다 */
function bustReload() {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('v', Date.now().toString(36))
    window.location.href = url.toString()
  } catch {
    window.location.reload()
  }
}

function lazyWithRetry(factory) {
  const KEY = 'bzen.chunk-retry'
  return lazy(async () => {
    try {
      const mod = await factory()
      try {
        window.sessionStorage.removeItem(KEY)
      } catch {
        /* 무시 */
      }
      return mod
    } catch (error) {
      let count = 0
      try {
        count = Number(window.sessionStorage.getItem(KEY) || 0)
      } catch {
        /* 무시 */
      }
      if (count < 2) {
        try {
          window.sessionStorage.setItem(KEY, String(count + 1))
        } catch {
          /* 무시 */
        }
        bustReload()
      }
      throw error
    }
  })
}

// 화면별 분할 로딩: 첫 화면은 가볍게, 각 메뉴는 들어갈 때 받아옵니다.
const Login = lazyWithRetry(() => import('./pages/Login'))
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'))
const LedgerPage = lazyWithRetry(() => import('./pages/LedgerPage'))
const CardImport = lazyWithRetry(() => import('./pages/CardImport'))
const Partners = lazyWithRetry(() => import('./pages/Partners'))
const FixedCosts = lazyWithRetry(() => import('./pages/FixedCosts'))
const Projects = lazyWithRetry(() => import('./pages/Projects'))
const ProjectDetail = lazyWithRetry(() => import('./pages/ProjectDetail'))
const Reports = lazyWithRetry(() => import('./pages/Reports'))
const Tax = lazyWithRetry(() => import('./pages/Tax'))
const Collections = lazyWithRetry(() => import('./pages/Collections'))
const Users = lazyWithRetry(() => import('./pages/Users'))
const Settings = lazyWithRetry(() => import('./pages/Settings'))
const Trash = lazyWithRetry(() => import('./pages/Trash'))
const Leaves = lazyWithRetry(() => import('./pages/Leaves'))
const Payroll = lazyWithRetry(() => import('./pages/Payroll'))
const Funds = lazyWithRetry(() => import('./pages/Funds'))
const Members = lazyWithRetry(() => import('./pages/Members'))

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink-100 text-ink-500">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-black text-white">
        BZ
      </span>
      <span className="flex items-center gap-2 text-sm">
        <Spinner size={16} />
        불러오는 중…
      </span>
    </div>
  )
}

/* 배포 직후 낡은 파일이 남으면 흰 화면 대신 새로고침 안내를 보여줍니다 */
class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink-100 px-5 text-center text-ink-500">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-black text-white">
          BZ
        </span>
        <p className="text-sm font-bold text-ink-800">새 버전으로 새로고침이 필요합니다</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            try {
              window.sessionStorage.removeItem('bzen.chunk-retry')
            } catch {
              /* 무시 */
            }
            bustReload()
          }}
        >
          새로고침
        </button>
      </div>
    )
  }
}

function PendingApproval() {
  const { profile, signOut } = useAuth()
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-100 px-5">
      <div className="card w-full max-w-md p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Icon name="alert" size={22} />
        </span>
        <h1 className="mt-4 text-lg font-extrabold text-ink-900">사용 승인 대기 중</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          <strong className="font-semibold">{profile?.email}</strong> 계정은 아직 사용이 허가되지 않았습니다.
          <br />
          관리자에게 사용 요청을 알려 주세요.
        </p>
        <button
          type="button"
          className="btn-ghost mx-auto mt-5"
          onClick={() => signOut()}
        >
          <Icon name="logout" size={16} />
          로그아웃
        </button>
      </div>
    </div>
  )
}

function Guard({ children, adminOnly = false, perm = null }) {
  const { loading, user, profile, isActive, isAdmin } = useAuth()
  const { perms, loading: permsLoading } = useStaffPermissions(profile)
  const location = useLocation()

  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) return <Splash />
  if (!isActive) return <PendingApproval />
  /* 직원 첫 화면은 지출결의 (대시보드 관리자 전용) */
  const fallback = isAdmin ? '/dashboard' : STAFF_LANDING
  if (adminOnly && !isAdmin) return <Navigate to={fallback} replace />
  if (perm && !isAdmin) {
    if (permsLoading) return <Splash />
    if (!perms.includes(perm)) return <Navigate to={fallback} replace />
  }
  /* 직원 대시보드 직접 접근도 지출결의로 */
  if (!isAdmin && location.pathname === '/dashboard') return <Navigate to={STAFF_LANDING} replace />
  return children
}

function HomeRedirect() {
  const { loading, isAdmin } = useAuth()
  if (loading) return <Splash />
  return <Navigate to={isAdmin ? '/dashboard' : STAFF_LANDING} replace />
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <ChunkErrorBoundary>
        <Suspense fallback={<Splash />}>
          <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <Guard>
                <Layout />
              </Guard>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />

            <Route
              path="/sales"
              element={
                <Guard perm="sales">
                  <LedgerPage
                    type="sale"
                    title="매출"
                    description="계약·용역 매출을 기록합니다. 프로젝트를 지정하면 손익에 자동 반영됩니다."
                  />
                </Guard>
              }
            />
            <Route
              path="/purchases"
              element={
                <Guard perm="purchases">
                  <LedgerPage
                    type="purchase"
                    title="매입"
                    description="외주비·상품매입 등 원가성 지출을 기록합니다."
                  />
                </Guard>
              }
            />
            <Route
              path="/expenses"
              element={
                <Guard perm="expenses">
                  <LedgerPage
                    type="opex"
                    title="운영비"
                    description="인건비·임차료·통신비 등 고정 운영 비용을 기록합니다."
                  />
                </Guard>
              }
            />
            {/* 법인카드는 자금관리 안으로 이동. 옛 주소는 자금관리 카드 탭으로 보냅니다. */}
            <Route path="/cards" element={<Navigate to="/funds?tab=cards" replace />} />

            <Route
              path="/expense-reports"
              element={
                <Guard perm="expense-reports">
                  <LedgerPage
                    type="opex"
                    source="expense_report"
                    title="지출결의"
                    description="직원이 사용한 비용을 증빙과 함께 기록합니다."
                  />
                </Guard>
              }
            />

            <Route
              path="/projects"
              element={
                <Guard perm="projects">
                  <Projects />
                </Guard>
              }
            />
            <Route
              path="/projects/:id"
              element={
                <Guard perm="projects">
                  <ProjectDetail />
                </Guard>
              }
            />

            <Route
              path="/partners"
              element={
                <Guard perm="partners">
                  <Partners />
                </Guard>
              }
            />

            <Route
              path="/fixed-costs"
              element={
                <Guard perm="fixed">
                  <FixedCosts />
                </Guard>
              }
            />

            <Route
              path="/reports"
              element={
                <Guard perm="reports">
                  <Reports />
                </Guard>
              }
            />
            <Route
              path="/tax"
              element={
                <Guard perm="tax">
                  <Tax />
                </Guard>
              }
            />
            <Route
              path="/collections"
              element={
                <Guard perm="collections">
                  <Collections />
                </Guard>
              }
            />
            <Route
              path="/users"
              element={
                <Guard adminOnly>
                  <Users />
                </Guard>
              }
            />
            <Route
              path="/payroll"
              element={
                <Guard adminOnly>
                  <Payroll />
                </Guard>
              }
            />
            <Route
              path="/members"
              element={
                <Guard adminOnly>
                  <Members />
                </Guard>
              }
            />
            <Route
              path="/leaves"
              element={
                <Guard perm="leaves">
                  <Leaves />
                </Guard>
              }
            />
            <Route
              path="/funds"
              element={
                <Guard adminOnly>
                  <Funds />
                </Guard>
              }
            />
            <Route
              path="/trash"
              element={
                <Guard adminOnly>
                  <Trash />
                </Guard>
              }
            />
            <Route path="/settings" element={<Settings />} />

            <Route path="/" element={<HomeRedirect />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
        </ChunkErrorBoundary>
      </AuthProvider>
    </ToastProvider>
  )
}
