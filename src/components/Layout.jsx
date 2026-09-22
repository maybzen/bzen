import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { useAuth } from '../auth/AuthContext'
import { useToast } from './Toast'
import { getSettings } from '../lib/api'
import { useStaffPermissions } from '../lib/permissions'
import { APP_NAME, COMPANY_EN, DEFAULT_COMPANY } from '../lib/constants'

export const NAV = [
  { to: '/dashboard', label: '대시보드', icon: 'dashboard', base: true },
  { to: '/sales', label: '매출', icon: 'trending-up', perm: 'sales' },
  { to: '/purchases', label: '매입', icon: 'cart', perm: 'purchases' },
  { to: '/expenses', label: '운영비', icon: 'receipt', perm: 'expenses' },
  { to: '/cards', label: '법인카드', icon: 'card', perm: 'cards' },
  { to: '/expense-reports', label: '지출결의', icon: 'coins', perm: 'expense-reports' },
  { to: '/projects', label: '프로젝트', icon: 'folder', perm: 'projects' },
  { to: '/partners', label: '거래처', icon: 'building', perm: 'partners' },
  { to: '/reports', label: '보고서', icon: 'chart', perm: 'reports' },
  { to: '/users', label: '계정관리', icon: 'users', adminOnly: true },
  { to: '/settings', label: '설정', icon: 'settings', base: true },
]

const NAV_GROUPS = [
  { title: '장부', items: ['/dashboard', '/sales', '/purchases', '/expenses', '/cards', '/expense-reports'] },
  { title: '분석', items: ['/projects', '/partners', '/reports'] },
  { title: '관리', items: ['/users', '/settings'] },
]

function Brand({ company, compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-[13px] font-black tracking-tight text-white shadow-sm">
        BZ
      </span>
      {!compact ? (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[13px] font-bold text-white">{company}</span>
          <span className="block truncate text-[10.5px] font-medium tracking-wide text-ink-400">
            {COMPANY_EN} · {APP_NAME}
          </span>
        </span>
      ) : null}
    </div>
  )
}

function NavList({ items, onNavigate }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              isActive
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-ink-300 hover:bg-white/5 hover:text-white'
            }`
          }
        >
          <Icon name={item.icon} size={18} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const { perms } = useStaffPermissions(profile)
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const [drawer, setDrawer] = useState(false)
  const [menu, setMenu] = useState(false)
  const [company, setCompany] = useState(DEFAULT_COMPANY)
  const menuRef = useRef(null)

  const visible = NAV.filter(
    (item) => isAdmin || item.base || (item.perm && perms.includes(item.perm)),
  )
  const current = visible.find((item) => location.pathname.startsWith(item.to))

  useEffect(() => {
    setDrawer(false)
    setMenu(false)
  }, [location.pathname])

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s?.company_name) setCompany(s.company_name)
      })
      .catch(() => {})
  }, [])

  const handleSignOut = async () => {
    try {
      await signOut()
      toast.info('로그아웃되었습니다.')
      navigate('/login', { replace: true })
    } catch (e) {
      toast.error(e.message)
    }
  }

  const sidebar = (onNavigate) => (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="px-5 pb-5 pt-5">
        <Brand company={company} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => {
          const items = visible.filter((v) => group.items.includes(v.to))
          if (!items.length) return null
          return (
            <div key={group.title} className="mb-4">
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-500">
                {group.title}
              </p>
              <NavList items={items} onNavigate={onNavigate} />
            </div>
          )
        })}
      </div>
      <div className="border-t border-white/10 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
            {(profile?.full_name || profile?.email || '?').slice(0, 1)}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-xs font-semibold text-white">
              {profile?.full_name || '이름 미등록'}
            </span>
            <span className="block truncate text-[10.5px] text-ink-400">
              {isAdmin ? '관리자' : '직원'}
              {profile?.department ? ` · ${profile.department}` : ''}
            </span>
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-ink-100">
      {/* 데스크톱 사이드바 */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 print:hidden lg:block">{sidebar()}</aside>

      {/* 모바일 드로어 */}
      {drawer ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-ink-900/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[17rem] animate-slide-in shadow-pop">
            {sidebar(() => setDrawer(false))}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-ink-200 bg-white/85 px-4 backdrop-blur print:hidden sm:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="rounded-lg p-2 text-ink-600 transition hover:bg-ink-100 lg:hidden"
            aria-label="메뉴"
          >
            <Icon name="menu" size={19} />
          </button>

          <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink-800">
            {current?.label || APP_NAME}
          </p>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition hover:bg-ink-100"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                {(profile?.full_name || profile?.email || '?').slice(0, 1)}
              </span>
              <span className="hidden text-xs font-semibold text-ink-700 sm:block">
                {profile?.full_name || profile?.email}
              </span>
              <Icon name="chevron-down" size={14} className="text-ink-400" />
            </button>

            {menu ? (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-56 animate-fade-in overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
                <div className="border-b border-ink-100 px-4 py-3">
                  <p className="truncate text-sm font-bold text-ink-900">
                    {profile?.full_name || '이름 미등록'}
                  </p>
                  <p className="truncate text-xs text-ink-500">{profile?.email}</p>
                  <p className="mt-1.5">
                    <span className="chip bg-brand-50 text-brand-700">{isAdmin ? '관리자' : '직원'}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-ink-700 transition hover:bg-ink-50"
                >
                  <Icon name="settings" size={16} />
                  내 정보 · 설정
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 border-t border-ink-100 px-4 py-2.5 text-left text-sm font-medium text-loss transition hover:bg-rose-50"
                >
                  <Icon name="logout" size={16} />
                  로그아웃
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 print:px-0 print:py-0 sm:px-6 sm:py-7">
          <div className="mx-auto w-full max-w-[110rem]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
