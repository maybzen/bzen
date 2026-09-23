import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Icon from './components/Icon'
import { Spinner } from './components/ui'
import { ToastProvider } from './components/Toast'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { useStaffPermissions } from './lib/permissions'

// 화면별 분할 로딩: 첫 화면은 가볍게, 각 메뉴는 들어갈 때 받아옵니다.
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const LedgerPage = lazy(() => import('./pages/LedgerPage'))
const CardImport = lazy(() => import('./pages/CardImport'))
const Partners = lazy(() => import('./pages/Partners'))
const FixedCosts = lazy(() => import('./pages/FixedCosts'))
const Projects = lazy(() => import('./pages/Projects'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const Reports = lazy(() => import('./pages/Reports'))
const Users = lazy(() => import('./pages/Users'))
const Settings = lazy(() => import('./pages/Settings'))

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
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />
  if (perm && !isAdmin) {
    if (permsLoading) return <Splash />
    if (!perms.includes(perm)) return <Navigate to="/dashboard" replace />
  }
  return children
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
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
            <Route
              path="/cards"
              element={
                <Guard perm="cards">
                  <CardImport />
                </Guard>
              }
            />

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
              path="/users"
              element={
                <Guard adminOnly>
                  <Users />
                </Guard>
              }
            />
            <Route path="/settings" element={<Settings />} />

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ToastProvider>
  )
}
