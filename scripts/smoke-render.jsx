/**
 * 페이지 렌더 스모크 테스트 (jsdom + react-dom/client).
 *
 * 왜 필요한가: 실제로 메뉴를 눌러봐야만 터지는 TDZ/변수 오류(예: yearFilter)가
 * 빌드 통과 → 배포까지 됩니다. 이 스크립트는 전 페이지를 실제로 DOM 에
 * 마운트해 에러를 잡아냅니다. fetch 는 빈 응답 stub 이라 네트워크 불필요.
 *
 *   node scripts/run-smoke.mjs
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../src/auth/AuthContext'

import Dashboard from '../src/pages/Dashboard'
import Projects from '../src/pages/Projects'
import ProjectDetail from '../src/pages/ProjectDetail'
import Partners from '../src/pages/Partners'
import Collections from '../src/pages/Collections'
import CardImport from '../src/pages/CardImport'
import Tax, { TaxAlertBanner } from '../src/pages/Tax'
import Payroll from '../src/pages/Payroll'
import Leaves from '../src/pages/Leaves'
import Members from '../src/pages/Members'
import Funds from '../src/pages/Funds'
import Reports from '../src/pages/Reports'
import Settings from '../src/pages/Settings'
import FixedCosts from '../src/pages/FixedCosts'
import Users from '../src/pages/Users'
import Login from '../src/pages/Login'
import LedgerPage from '../src/pages/LedgerPage'
import Layout from '../src/components/Layout'
import ScheduleModal from '../src/components/ScheduleModal'
import EntryFormModal from '../src/components/EntryFormModal'
import PartnerFormModal from '../src/components/PartnerFormModal'
import ProjectFormModal from '../src/components/ProjectFormModal'
import PeriodPicker, { usePeriod } from '../src/components/PeriodPicker'

const UID = 'e0000000-0000-0000-0000-000000000001'

function authOf(role) {
  const id = role === 'admin' ? UID : 'e0000000-0000-0000-0000-000000000002'
  return {
    session: { user: { id, email: `${role}@bzen.kr` } },
    user: { id, email: `${role}@bzen.kr` },
    profile: { id, email: `${role}@bzen.kr`, full_name: role, role, active: true },
    isAdmin: role === 'admin',
    realIsAdmin: role === 'admin',
    staffView: false,
    setStaffView: () => {},
    setProfile: () => {},
    refreshProfile: async () => {},
    signIn: async () => {},
    signOut: async () => {},
    loading: false,
    isActive: true,
  }
}

const ADMIN = authOf('admin')
const STAFF = authOf('staff')

const CASES = [
  ['Login', () => <Login />, '/login'],
  ['Layout(관리자)', () => <Layout />, '/dashboard'],
  ['Layout(직원)', () => <Layout />, '/dashboard'],
  ['Dashboard(관리자)', () => <Dashboard />, '/dashboard'],
  ['Dashboard(직원)', () => <Dashboard />, '/dashboard'],
  ['LedgerPage 매출', () => <LedgerPage type="sale" />, '/sales'],
  ['LedgerPage 매입', () => <LedgerPage type="purchase" />, '/purchases'],
  ['LedgerPage 운영비', () => <LedgerPage type="opex" />, '/expenses'],
  ['LedgerPage 지출결의', () => <LedgerPage type="opex" source="expense_report" />, '/expense-reports'],
  ['Projects', () => <Projects />, '/projects'],
  ['Projects(직원)', () => <Projects />, '/projects'],
  ['ProjectDetail', () => <ProjectDetail />, '/projects/aaaaaaaa-1111-2222-3333-444444444444'],
  ['Partners', () => <Partners />, '/partners'],
  ['Collections', () => <Collections />, '/collections'],
  ['Tax', () => <Tax />, '/tax'],
  ['TaxAlertBanner', () => <TaxAlertBanner />, '/tax'],
  ['Payroll', () => <Payroll />, '/payroll'],
  ['Payroll(직원)', () => <Payroll />, '/payroll'],
  ['Leaves', () => <Leaves />, '/leaves'],
  ['Members', () => <Members />, '/members'],
  ['Funds', () => <Funds />, '/funds'],
  ['Reports', () => <Reports />, '/reports'],
  ['Reports(직원)', () => <Reports />, '/reports'],
  ['Settings', () => <Settings />, '/settings'],
  ['FixedCosts', () => <FixedCosts />, '/fixed-costs'],
  ['FixedCosts(직원)', () => <FixedCosts />, '/fixed-costs'],
  ['Users', () => <Users />, '/users'],
  ['CardImport', () => <CardImport />, '/funds'],
  ['CardImport(embed)', () => <CardImport embed />, '/funds'],
  ['ScheduleModal(관리자)', () => <ScheduleModal open userId={UID} />, '/dashboard'],
  ['ScheduleModal(직원)', () => <ScheduleModal open userId={STAFF.user.id} />, '/dashboard'],
  ['EntryFormModal(매출)', () => <EntryFormModal open type="sale" />, '/sales'],
  ['EntryFormModal(매입)', () => <EntryFormModal open type="purchase" />, '/purchases'],
  ['PartnerFormModal', () => <PartnerFormModal open />, '/partners'],
  ['ProjectFormModal', () => <ProjectFormModal open />, '/projects'],
  ['PeriodPicker(이번달)', () => <Picker preset="thisMonth" />, '/dashboard'],
  ['PeriodPicker(분기선택)', () => <Picker preset="quarterPick" />, '/dashboard'],
  ['PeriodPicker(직접선택)', () => <Picker preset="custom" />, '/dashboard'],
  ['PeriodPicker(올해)', () => <Picker preset="thisYear" />, '/dashboard'],
]

function Picker({ preset }) {
  const period = usePeriod(preset, null)
  return <PeriodPicker period={period} />
}

function makeHost() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

export async function run() {
  let bad = 0
  const errors = []
  const onErr = (e) => {
    const msg = e && e.error && e.error.message ? e.error.message : e && e.message ? e.message : String(e)
    errors.push(msg)
  }
  const origError = console.error
  const origWarn = console.warn

  for (const [name, make, route] of CASES) {
    const auth = name.includes('직원') ? STAFF : ADMIN
    /* 이전 케이스가 body 에 남긴 포털 노드를 정리합니다 */
    document.body.innerHTML = ''
    const host = makeHost()
    const root = createRoot(host)
    errors.length = 0
    console.error = onErr
    console.warn = () => {}
    let thrown = null
    try {
      await act(async () => {
        root.render(
          <StrictMode>
            <MemoryRouter initialEntries={[route]}>
              <AuthContext.Provider value={auth}>{make()}</AuthContext.Provider>
            </MemoryRouter>
          </StrictMode>,
        )
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30))
      })
    } catch (err) {
      thrown = err
    } finally {
      console.error = origError
      console.warn = origWarn
    }

    /* 모달은 createPortal(document.body) 로 나가므로 body 전체를 봅니다 */
    const text = (document.body.textContent || '').trim()
    const hasNode = Boolean(document.body.querySelector('div, svg, table, input, button'))
    if (thrown) {
      bad++
      console.log(`XX ${name}\n   예외: ${String(thrown.message).split('\n')[0]}`)
    } else if (errors.length) {
      bad++
      console.log(`XX ${name}\n   콘솔 오류: ${errors[0].split('\n')[0]}`)
      if (errors.length > 1) console.log(`   (+${errors.length - 1}건 더)`)
    } else if (!hasNode) {
      bad++
      console.log(`XX ${name}\n   흰 화면 (렌더 결과 없음)`)
    } else {
      console.log(`OK ${name} (${text.length}자)`)
    }
    try {
      await act(async () => {
        root.unmount()
      })
    } catch {
      /* 무시 */
    }
    host.remove()
  }

  console.log(bad ? `\n실패 ${bad}건 / 전체 ${CASES.length}건` : `\n전부 통과 (${CASES.length}건)`)
  return bad ? 1 : 0
}