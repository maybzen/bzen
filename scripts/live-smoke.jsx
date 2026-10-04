/**
 * 실제 DB 데이터로 페이지 전체를 렌더하는 점검 (live smoke).
 *
 * 빈 데이터로 돌면 "데이터가 있을 때만 깨지는" 문제를 못 잡습니다.
 * 여기서는 실제 장부(1천여 건)·프로젝트·구성원·일정을 그대로 읽어와
 * 각 화면이 끝까지 렌더되는지 봅니다. 쓰기는 하지 않습니다.
 *
 *   node scripts/run-live-smoke.mjs
 */
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../src/auth/AuthContext'
import { supabase } from '../src/lib/supabase'

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
import LedgerPage from '../src/pages/LedgerPage'
import Layout from '../src/components/Layout'
import ScheduleModal from '../src/components/ScheduleModal'
import EntryFormModal from '../src/components/EntryFormModal'
import PartnerFormModal from '../src/components/PartnerFormModal'
import ProjectFormModal from '../src/components/ProjectFormModal'

const UID = 'live-smoke-user'

function authOf(role) {
  return {
    session: { user: { id: UID, email: `${role}@bzen.kr` } },
    user: { id: UID, email: `${role}@bzen.kr` },
    profile: { id: UID, email: `${role}@bzen.kr`, full_name: '점검', role, active: true },
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

/* 실제 데이터 규모를 먼저 재서 "데이터가 있는 화면"만 검사합니다 */
let COUNT = {}
async function counts() {
  const [entries, projects, profiles, checklists, loans, payroll, funds] = await Promise.all([
    supabase.from('entries').select('id', { count: 'exact', head: true }).limit(1),
    supabase.from('projects').select('id', { count: 'exact', head: true }).limit(1),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).limit(1),
    supabase.from('checklist_items').select('id', { count: 'exact', head: true }).limit(1),
    supabase.from('loans').select('id', { count: 'exact', head: true }).limit(1),
    supabase.from('payroll_slips').select('id', { count: 'exact', head: true }).limit(1),
    supabase.from('fund_cards').select('id', { count: 'exact', head: true }).limit(1),
  ])
  const pick = (r) => (r.error ? `ERR(${r.error.message})` : r.count)
  COUNT = {
    entries: pick(entries),
    projects: pick(projects),
    profiles: pick(profiles),
    checklists: pick(checklists),
    loans: pick(loans),
    payroll: pick(payroll),
    fund_cards: pick(funds),
  }
  return COUNT
}

let PROJECT_ID = 'aaaaaaaa-1111-2222-3333-444444444444'
async function pickProject() {
  const { data } = await supabase.from('projects').select('id').order('created_at', { ascending: true }).limit(1)
  if (data && data[0]) PROJECT_ID = data[0].id
}

const CASES = [
  ['Dashboard(관리자)', () => <Dashboard />, '/dashboard', ADMIN],
  ['Dashboard(직원)', () => <Dashboard />, '/dashboard', STAFF],
  ['LedgerPage 매출', () => <LedgerPage type="sale" />, '/sales', ADMIN],
  ['LedgerPage 매입', () => <LedgerPage type="purchase" />, '/purchases', ADMIN],
  ['LedgerPage 운영비', () => <LedgerPage type="opex" />, '/expenses', ADMIN],
  ['LedgerPage 지출결의', () => <LedgerPage type="opex" source="expense_report" />, '/expense-reports', ADMIN],
  ['Projects', () => <Projects />, '/projects', ADMIN],
  ['Projects(직원)', () => <Projects />, '/projects', STAFF],
  ['ProjectDetail', () => <ProjectDetail />, `/projects/${PROJECT_ID}`, ADMIN],
  ['Partners', () => <Partners />, '/partners', ADMIN],
  ['Collections', () => <Collections />, '/collections', ADMIN],
  ['Tax', () => <Tax />, '/tax', ADMIN],
  ['TaxAlertBanner', () => <TaxAlertBanner />, '/tax', ADMIN],
  ['Payroll', () => <Payroll />, '/payroll', ADMIN],
  ['Leaves', () => <Leaves />, '/leaves', ADMIN],
  ['Members', () => <Members />, '/members', ADMIN],
  ['Funds', () => <Funds />, '/funds', ADMIN],
  ['Reports', () => <Reports />, '/reports', ADMIN],
  ['Reports(직원)', () => <Reports />, '/reports', STAFF],
  ['Settings', () => <Settings />, '/settings', ADMIN],
  ['FixedCosts', () => <FixedCosts />, '/fixed-costs', ADMIN],
  ['Users', () => <Users />, '/users', ADMIN],
  ['CardImport', () => <CardImport />, '/funds', ADMIN],
  ['ScheduleModal', () => <ScheduleModal open userId={UID} />, '/dashboard', ADMIN],
  ['ScheduleModal(직원)', () => <ScheduleModal open userId={UID} />, '/dashboard', STAFF],
  ['EntryFormModal(매출)', () => <EntryFormModal open type="sale" />, '/sales', ADMIN],
  ['EntryFormModal(매입)', () => <EntryFormModal open type="purchase" />, '/purchases', ADMIN],
  ['PartnerFormModal', () => <PartnerFormModal open />, '/partners', ADMIN],
  ['ProjectFormModal', () => <ProjectFormModal open />, '/projects', ADMIN],
]

export async function run() {
  const c = await counts()
  console.log('실제 데이터:', JSON.stringify(c), '\n')
  await pickProject()

  let bad = 0
  const errors = []
  const onErr = (e) => {
    const msg = e && e.error && e.error.message ? e.error.message : e && e.message ? e.message : String(e)
    errors.push(msg)
  }
  const origError = console.error
  const origWarn = console.warn

  for (const [name, make, route, auth] of CASES) {
    document.body.innerHTML = ''
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    errors.length = 0
    console.error = onErr
    console.warn = () => {}
    let thrown = null
    try {
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={[route]}>
            <AuthContext.Provider value={auth}>{make()}</AuthContext.Provider>
          </MemoryRouter>,
        )
      })
      /* 실제 데이터를 받아 그리려면 시간이 필요합니다 */
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1500))
      })
    } catch (err) {
      thrown = err
    } finally {
      console.error = origError
      console.warn = origWarn
    }

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
      await act(async () => root.unmount())
    } catch {
      /* 무시 */
    }
    host.remove()
  }

  console.log(bad ? `\n실패 ${bad}건 / 전체 ${CASES.length}건` : `\n전부 통과 (${CASES.length}건)`)
  return bad ? 1 : 0
}