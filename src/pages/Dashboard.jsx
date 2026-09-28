import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CompositionDonut, MonthlyTrendChart, ProfitBar } from '../components/Charts'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import EntryTable from '../components/EntryTable'
import { useToast } from '../components/Toast'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { useStaffPermissions } from '../lib/permissions'
import {
  listAttachments,
  listCollections,
  listEntries,
  listPartners,
  listProfiles,
  listProjects,
} from '../lib/api'
import { isStaffVisible, staffIdsFromProfiles } from '../lib/permissions'
import {
  changeRate,
  formatCompact,
  formatDateHuman,
  formatKRW,
  formatPercent,
  lastMonthKeys,
  monthEnd,
  monthLabel,
  previousPeriod,
} from '../lib/format'
import { groupByMonth, groupByProject, summarize } from '../lib/summary'

/* 홈페이지 확인 필요 목록 (브라우저에 저장, 관리자 수정 가능) */
const HOME_ALERTS_DEFAULT = [
  { id: 'yoon', text: '윤호식 직접지급 매입근거 확인 (5/8 1,298만·7/9 1,100만·8/14 167만 / 브이오디오 매입 913만원과 차이)' },
  { id: 'beaver', text: '비버웍스 입금 93만원 성격 확인' },
  { id: 'loan', text: '대출 원리금 원금·이자 분리 (금진 확인)' },
  { id: 'pg', text: 'PG 수수료 중복 의혹 (~15만원)' },
]

function loadHomeItems() {
  try {
    const raw = localStorage.getItem('bzen.home.alerts.items.v3')
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed) && parsed.every((x) => x && typeof x.id === 'string')) return parsed
  } catch {
    /* 무시 */
  }
  return HOME_ALERTS_DEFAULT
}

function loadHomeChecks() {
  try {
    const raw = localStorage.getItem('bzen.home.alerts.done.v3')
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveHomeItems(items) {
  try {
    localStorage.setItem('bzen.home.alerts.items.v3', JSON.stringify(items))
  } catch {
    /* 저장 실패 무시 */
  }
}

function saveHomeChecks(checks) {
  try {
    localStorage.setItem('bzen.home.alerts.done.v3', JSON.stringify(checks))
  } catch {
    /* 저장 실패 무시 */
  }
}

/* 회사 PC에서 업데이트할 때 확인할 목록 (관리자만, 브라우저에 저장) */
const SYNC_CHECKLIST_DEFAULT = [
  { id: 's-pull', text: '회사 PC에서 main pull 받기 (git pull --ff-only)' },
  { id: 's-sql-partners', text: 'SQL 실행: migration_project_partners.sql (프로젝트↔거래처 연결용, 미실행)' },
  { id: 's-payslip', text: '급여명세서 엑셀 대조 (장부 급여분 = 실지급 − 지출결의)' },
  { id: 's-balance', text: '통장 현재 잔고 입력 (자금관리 → 잔고 기록)' },
  { id: 's-card', text: '법인카드 명세서 파일 올리기 (자금관리 → 법인카드 내역)' },
  { id: 's-docs', text: '세금계산서·영수증 증빙 첨부 확인' },
  { id: 's-deploy', text: '작업 후 push → Actions 배포 성공 확인' },
  { id: 's-backup', text: '월 1회 CSV 전체 백업 (보고서 → 상세 CSV)' },
]

function loadSyncItems() {
  // 저장된 목록에 없는 기본 항목은 뒤에 덧붙입니다 (체크 상태 유지).
  const merge = (stored) => {
    const ids = new Set(stored.map((x) => x.id))
    return [...stored, ...SYNC_CHECKLIST_DEFAULT.filter((x) => !ids.has(x.id))]
  }
  try {
    const raw = localStorage.getItem('bzen.home.sync.items.v1')
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed) && parsed.every((x) => x && typeof x.id === 'string')) return merge(parsed)
  } catch {
    /* 무시 */
  }
  return SYNC_CHECKLIST_DEFAULT
}

function loadSyncChecks() {
  try {
    const raw = localStorage.getItem('bzen.home.sync.done.v1')
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
import { TaxAlertBanner } from './Tax'

export default function Dashboard() {
  const { isAdmin, profile, user } = useAuth()
  const { perms } = useStaffPermissions(profile)
  const toast = useToast()
  const period = usePeriod('thisMonth', 'bzen.period.dashboard')
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState([])
  const [previous, setPrevious] = useState([])
  const [trend, setTrend] = useState([])
  const [projects, setProjects] = useState([])
  const [profiles, setProfiles] = useState([])
  const [attachmentsByEntry, setAttachmentsByEntry] = useState({})
  const [showRecent, setShowRecent] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState(null)
  const [homeItems, setHomeItems] = useState(() => loadHomeItems())
  const [homeChecks, setHomeChecks] = useState(() => loadHomeChecks())
  const [showDone, setShowDone] = useState(false)
  const [newAlert, setNewAlert] = useState('')
  const [syncItems, setSyncItems] = useState(() => loadSyncItems())
  const [syncChecks, setSyncChecks] = useState(() => loadSyncChecks())
  const [newSync, setNewSync] = useState('')
  const [syncOpen, setSyncOpen] = useState(true)

  const saveSync = (items, checks) => {
    try {
      localStorage.setItem('bzen.home.sync.items.v1', JSON.stringify(items))
      localStorage.setItem('bzen.home.sync.done.v1', JSON.stringify(checks))
    } catch {
      /* 저장 실패 무시 */
    }
  }

  const toggleSyncCheck = (id) => {
    setSyncChecks((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      setSyncItems((items) => {
        saveSync(items, next)
        return items
      })
      return next
    })
  }

  const addSyncItem = (e) => {
    e.preventDefault()
    const text = newSync.trim()
    if (!text) return
    const id = `s${Date.now().toString(36)}`
    setSyncItems((prev) => {
      const next = [...prev, { id, text }]
      setSyncChecks((checks) => {
        saveSync(next, checks)
        return checks
      })
      return next
    })
    setNewSync('')
  }

  const removeSyncItem = (id) => {
    setSyncItems((prev) => {
      const next = prev.filter((x) => x.id !== id)
      setSyncChecks((checks) => {
        const nc = { ...checks }
        delete nc[id]
        saveSync(next, nc)
        return nc
      })
      return next
    })
  }

  const syncOpenCount = syncItems.filter((x) => !syncChecks[x.id]).length

  const toggleHomeCheck = (id) => {
    setHomeChecks((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      saveHomeChecks(next)
      return next
    })
  }

  const addHomeAlert = (e) => {
    e.preventDefault()
    const text = newAlert.trim()
    if (!text) return
    const id = `a${Date.now().toString(36)}`
    setHomeItems((prev) => {
      const next = [...prev, { id, text }]
      saveHomeItems(next)
      return next
    })
    setNewAlert('')
  }

  const removeHomeAlert = (id) => {
    setHomeItems((prev) => {
      const next = prev.filter((x) => x.id !== id)
      saveHomeItems(next)
      return next
    })
    setHomeChecks((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      saveHomeChecks(next)
      return next
    })
  }

  const homeOpen = homeItems.filter((x) => !homeChecks[x.id])
  const homeDone = homeItems.filter((x) => homeChecks[x.id])
  const [alertsOpen, setAlertsOpen] = useState(() => {
    try {
      return localStorage.getItem('bzen.home.alerts.open.v1') !== '0'
    } catch {
      return true
    }
  })
  const toggleAlertsOpen = () => {
    setAlertsOpen((v) => {
      try {
        localStorage.setItem('bzen.home.alerts.open.v1', v ? '0' : '1')
      } catch {
        /* 저장 실패 무시 */
      }
      return !v
    })
  }

  const canSee = (perm) => isAdmin || perms.includes(perm)

  /* 전체 검색: 프로젝트·거래처·장부·수금을 한 번에 찾아 메뉴로 연결합니다 */
  const runSearch = async (e) => {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      const [entryRows, projectRows, partnerRows, collectionRows] = await Promise.all([
        listEntries({ search: q, maxRows: 60 }),
        listProjects(),
        canSee('partners') ? listPartners().catch(() => []) : Promise.resolve([]),
        canSee('collections') ? listCollections().catch(() => []) : Promise.resolve([]),
      ])
      const ql = q.toLowerCase()
      const match = (...vals) => vals.some((v) => String(v || '').toLowerCase().includes(ql))
      /* 직원 검색: 사원 작성분만 (관리자 작성분 제외) */
      const staffIds = staffIdsFromProfiles(profiles)
      const visibleEntries = isAdmin
        ? entryRows || []
        : (entryRows || []).filter((e) => isStaffVisible(e, staffIds))
      setResults({
        q,
        projects: (projectRows || [])
          .filter((p) => !p.is_hidden && match(p.name, p.client, p.venue, p.memo))
          .slice(0, 7),
        partners: (partnerRows || [])
          .filter((p) => match(p.name, p.contact_person, p.phone, p.phone_main, p.email, p.memo))
          .slice(0, 7),
        entries: visibleEntries.slice(0, 10),
        collections: (collectionRows || [])
          .filter((c) => match(c.counterparty, c.memo))
          .slice(0, 7),
      })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSearching(false)
    }
  }

  const entryTarget = (e) => {
    if (e.source === 'expense_report') return { to: 'expense-reports', perm: 'expense-reports' }
    if (e.entry_type === 'sale') return { to: 'sales', perm: 'sales' }
    if (e.entry_type === 'purchase') return { to: 'purchases', perm: 'purchases' }
    return { to: 'expenses', perm: 'expenses' }
  }

  const monthKeys = useMemo(() => lastMonthKeys(12), [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const prev = period.range.from && period.range.to
        ? previousPeriod(period.range.from, period.range.to)
        : null

      const [currentRows, previousRows, trendRows, projectRows, profileRows] = await Promise.all([
        listEntries({ from: period.range.from, to: period.range.to }),
        prev ? listEntries({ from: prev.from, to: prev.to }) : Promise.resolve([]),
        isAdmin
          ? listEntries({ from: `${monthKeys[0]}-01`, to: monthEnd(new Date()) })
          : Promise.resolve([]),
        listProjects(),
        listProfiles(),
      ])

      setCurrent(currentRows)
      setPrevious(previousRows)
      setTrend(trendRows)
      setProjects(projectRows)
      setProfiles(profileRows)

      const files = await listAttachments(currentRows.slice(0, 200).map((r) => r.id))
      const map = {}
      for (const file of files) {
        if (!map[file.entry_id]) map[file.entry_id] = []
        map[file.entry_id].push(file)
      }
      setAttachmentsByEntry(map)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.range.from, period.range.to, isAdmin, toast])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => summarize(current), [current])
  const prevStats = useMemo(() => summarize(previous), [previous])
  const hasCompare = Boolean(period.range.from && period.range.to)

  const trendData = useMemo(() => groupByMonth(trend, monthKeys), [trend, monthKeys])

  const projectRows = useMemo(() => {
    const rows = groupByProject(current, projects).filter((r) => r.project && !r.project.is_hidden)
    return rows
      .slice()
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 6)
  }, [current, projects])

  const recentReports = useMemo(
    () =>
      current
        .filter((e) => e.source === 'expense_report')
        .slice()
        .sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))
        .slice(0, 6),
    [current],
  )

  const maxProjectSale = Math.max(1, ...projectRows.map((r) => Math.max(r.sale, r.profit)))

  const donutData = [
    { name: '매입', value: stats.purchase.supply, color: '#d97706' },
    { name: '운영비', value: stats.opex.supply, color: '#e11d48' },
  ]

  /* 직원 홈은 본인 내역만: 전사 공유(RLS 확대) 후에도 대시보드 숫자는 본인 기준 유지 */
  const ownEntries = useMemo(
    () =>
      isAdmin
        ? current
        : current.filter((e) => e?.created_by === user?.id || e?.requester_id === user?.id),
    [isAdmin, current, user],
  )

  if (!isAdmin) {
    return (
      <StaffHome
        period={period}
        loading={loading}
        stats={summarize(ownEntries)}
        current={ownEntries}
        projects={projects}
        profiles={profiles}
        attachmentsByEntry={attachmentsByEntry}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`안녕하세요, ${profile?.full_name || '관리자'}님`}
        description="회사 전체 숫자를 요약해 보여드립니다."
      >
        <form onSubmit={runSearch} className="relative flex-1 sm:max-w-xs">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
          />
          <input
            className="input pl-9"
            placeholder="전체 검색 (거래처·프로젝트·금액·적요)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <PeriodPicker period={period} />
      </PageHeader>

      {results ? (
        <section className="card overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
            <h2 className="text-sm font-bold text-ink-900">
              “{results.q}” 검색 결과
              <span className="ml-1.5 font-medium text-ink-500">
                프로젝트 {results.projects.length} · 거래처 {results.partners.length} · 장부 {results.entries.length} · 수금 {results.collections.length}
              </span>
            </h2>
            <button
              type="button"
              onClick={() => {
                setResults(null)
                setQuery('')
              }}
              className="btn-ghost shrink-0 !px-2 !py-1 text-xs"
            >
              <Icon name="close" size={14} />
              닫기
            </button>
          </header>
          {searching ? (
            <LoadingBlock />
          ) : (
            <div className="grid grid-cols-1 gap-0 divide-y divide-ink-100 lg:grid-cols-2 lg:divide-x">
              <div className="flex flex-col gap-4 p-4">
                {canSee('projects') && results.projects.length ? (
                  <div>
                    <p className="mb-1.5 text-xs font-bold text-ink-500">프로젝트</p>
                    <ul className="flex flex-col gap-1">
                      {results.projects.map((p) => (
                        <li key={p.id}>
                          <Link to={`/projects/${p.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                            {p.name}
                          </Link>
                          <span className="ml-1.5 text-xs text-ink-400">{p.client || ''}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {canSee('partners') && results.partners.length ? (
                  <div>
                    <p className="mb-1.5 text-xs font-bold text-ink-500">거래처</p>
                    <ul className="flex flex-col gap-1">
                      {results.partners.map((p) => (
                        <li key={p.id}>
                          <Link
                            to={`/partners?search=${encodeURIComponent(p.name)}`}
                            className="text-sm font-semibold text-brand-700 hover:underline"
                          >
                            {p.name}
                          </Link>
                          <span className="ml-1.5 text-xs text-ink-400">{p.contact_person || ''}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {canSee('collections') && results.collections.length ? (
                  <div>
                    <p className="mb-1.5 text-xs font-bold text-ink-500">수금 입금</p>
                    <ul className="flex flex-col gap-1">
                      {results.collections.map((c) => (
                        <li key={c.id} className="text-sm">
                          <Link
                            to={c.counterparty ? `/collections?vendor=${encodeURIComponent(c.counterparty)}` : '/collections'}
                            className="font-semibold text-brand-700 hover:underline"
                          >
                            {c.counterparty || '미지정'}
                          </Link>
                          <span className="ml-1.5 text-xs tabular-nums text-ink-500">
                            {formatKRW(c.amount)}원 · {formatDateHuman(c.collected_on)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="p-4">
                {results.entries.length ? (
                  <div>
                    <p className="mb-1.5 text-xs font-bold text-ink-500">장부 (전체 기간)</p>
                    <ul className="flex flex-col gap-1">
                      {results.entries.map((en) => {
                        const t = entryTarget(en)
                        const label = `${en.counterparty || en.description || '(내용 없음)'}`
                        const sub = (
                          <span className="ml-1.5 text-xs tabular-nums text-ink-500">
                            {formatKRW(en.total_amount)}원 · {formatDateHuman(en.entry_date)}
                          </span>
                        )
                        return (
                          <li key={en.id} className="text-sm">
                            {canSee(t.perm) ? (
                              <Link
                                to={`/${t.to}?search=${encodeURIComponent(query.trim())}&period=all`}
                                className="font-semibold text-brand-700 hover:underline"
                              >
                                {label}
                              </Link>
                            ) : (
                              <span className="font-semibold text-ink-800">{label}</span>
                            )}
                            {sub}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
                {!results.projects.length && !results.partners.length && !results.entries.length && !results.collections.length ? (
                  <EmptyState icon="search" title="검색 결과가 없습니다" description="다른 단어로 검색해 보세요." />
                ) : null}
              </div>
            </div>
          )}
        </section>
      ) : null}

      <TaxAlertBanner />

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label="매출 (공급가액)"
              value={stats.revenue}
              tone="sale"
              icon="trending-up"
              delta={hasCompare ? changeRate(stats.revenue, prevStats.revenue) : undefined}
              to={isAdmin || perms.includes('sales') ? '/sales' : undefined}
            />
            <StatCard
              label="매입 (공급가액)"
              value={stats.purchase.supply}
              tone="purchase"
              icon="cart"
              delta={hasCompare ? changeRate(stats.purchase.supply, prevStats.purchase.supply) : undefined}
              to={isAdmin || perms.includes('purchases') ? '/purchases' : undefined}
            />
            <StatCard
              label="운영비 (공급가액)"
              value={stats.opex.supply}
              tone="opex"
              icon="receipt"
              delta={hasCompare ? changeRate(stats.opex.supply, prevStats.opex.supply) : undefined}
              to={isAdmin || perms.includes('expenses') ? '/expenses' : undefined}
            />
            <StatCard
              label="영업이익"
              value={stats.profit}
              tone={stats.profit >= 0 ? 'profit' : 'loss'}
              icon="coins"
              delta={hasCompare ? changeRate(stats.profit, prevStats.profit) : undefined}
              hint={stats.margin === null ? '매출 없음' : `이익률 ${formatPercent(stats.margin)}`}
              to={isAdmin || perms.includes('reports') ? '/reports' : undefined}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MiniStat
              label={stats.vatPayable < 0 ? '부가세 환급 예상' : '부가세 납부 예상'}
              value={Math.abs(stats.vatPayable)}
              desc="매출세액 − 매입세액"
              tone="brand"
            />
            <MiniStat
              label="총 지출"
              value={stats.cost}
              desc="매입 + 운영비"
              tone="rose"
            />
            <MiniStat
              label="지출결의"
              value={recentReports.length ? current.filter((e) => e.source === 'expense_report').length : 0}
              unit="건"
              desc="선택 기간 접수"
              tone="ink"
            />
            <MiniStat
              label="전체 거래 건수"
              value={stats.count}
              unit="건"
              desc={`매출 ${stats.sale.count} · 매입 ${stats.purchase.count} · 운영비 ${stats.opex.count}`}
              tone="ink"
              to={isAdmin || perms.includes('reports') ? '/reports' : undefined}
            />
          </div>

          {homeOpen.length ? (
            <section className="card overflow-hidden border-amber-200">
              <header className="flex items-center justify-between gap-3 border-b border-ink-200 bg-amber-50/60 px-4 py-3">
                <button
                  type="button"
                  onClick={toggleAlertsOpen}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  aria-expanded={alertsOpen}
                >
                  <h2 className="truncate text-sm font-bold text-ink-900">
                    확인 필요 목록
                    <span className="ml-1.5 font-medium text-ink-500">{homeOpen.length}건</span>
                  </h2>
                  <Icon name={alertsOpen ? 'chevron-down' : 'chevron-right'} size={15} className="shrink-0 text-ink-500" />
                </button>
                <span className="shrink-0 text-[11px] text-ink-500">하나씩 확인되면 체크하세요</span>
              </header>
              {alertsOpen ? (
              <>
              <ul className="divide-y divide-ink-100">
                {homeOpen.map((item) => (
                  <li key={item.id} className="flex items-start gap-1 px-4 py-2.5 transition hover:bg-ink-50/60">
                    <button
                      type="button"
                      onClick={() => toggleHomeCheck(item.id)}
                      className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-ink-300 bg-white text-transparent">
                        <Icon name="check" size={13} strokeWidth={2.6} />
                      </span>
                      <span className="text-sm text-ink-800">{item.text}</span>
                    </button>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => removeHomeAlert(item.id)}
                        className="shrink-0 rounded-md p-1 text-ink-300 transition hover:bg-rose-50 hover:text-loss"
                        aria-label="삭제"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {isAdmin ? (
                <form onSubmit={addHomeAlert} className="flex items-center gap-2 border-t border-ink-100 px-4 py-2.5">
                  <input
                    className="input flex-1 py-1.5 text-xs"
                    placeholder="확인할 일 추가"
                    value={newAlert}
                    onChange={(e) => setNewAlert(e.target.value)}
                  />
                  <button type="submit" className="btn-ghost shrink-0 !px-2.5 !py-1.5 text-xs" disabled={!newAlert.trim()}>
                    추가
                  </button>
                </form>
              ) : null}
              </>
              ) : null}
            </section>
          ) : null}
          {homeDone.length ? (
            <section className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                className="flex w-full items-center gap-1.5 px-4 py-3 text-left"
                aria-expanded={showDone}
              >
                <h2 className="truncate text-sm font-bold text-ink-500">
                  완료됨
                  <span className="ml-1.5 font-medium text-ink-400">{homeDone.length}건</span>
                </h2>
                <Icon name={showDone ? 'chevron-down' : 'chevron-right'} size={15} className="shrink-0 text-ink-400" />
              </button>
              {showDone ? (
                <ul className="divide-y divide-ink-100 border-t border-ink-100">
                  {homeDone.map((item) => (
                    <li key={item.id} className="flex items-start gap-1 px-4 py-2.5 transition hover:bg-ink-50/60">
                      <button
                        type="button"
                        onClick={() => toggleHomeCheck(item.id)}
                        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                        title="클릭하면 미완료로 되돌립니다"
                      >
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white">
                          <Icon name="check" size={13} strokeWidth={2.6} />
                        </span>
                        <span className="text-sm text-ink-400 line-through">{item.text}</span>
                      </button>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => removeHomeAlert(item.id)}
                          className="shrink-0 rounded-md p-1 text-ink-300 transition hover:bg-rose-50 hover:text-loss"
                          aria-label="삭제"
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {isAdmin ? (
            <section className="card overflow-hidden border-sky-200">
              <header className="flex items-center justify-between gap-3 border-b border-ink-200 bg-sky-50/60 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSyncOpen((v) => !v)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  aria-expanded={syncOpen}
                >
                  <h2 className="truncate text-sm font-bold text-ink-900">
                    업데이트 체크리스트
                    <span className="ml-1.5 font-medium text-ink-500">{syncOpenCount}건 남음</span>
                  </h2>
                  <Icon name={syncOpen ? 'chevron-down' : 'chevron-right'} size={15} className="shrink-0 text-ink-500" />
                </button>
                <span className="shrink-0 text-[11px] text-ink-500">회사에서 작업할 때 확인</span>
              </header>
              {syncOpen ? (
                <>
                  <ul className="divide-y divide-ink-100">
                    {syncItems.map((item) => {
                      const done = Boolean(syncChecks[item.id])
                      return (
                        <li key={item.id} className="flex items-start gap-1 px-4 py-2.5 transition hover:bg-ink-50/60">
                          <button
                            type="button"
                            onClick={() => toggleSyncCheck(item.id)}
                            className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                          >
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                                done
                                  ? 'border-sky-600 bg-sky-600 text-white'
                                  : 'border-ink-300 bg-white text-transparent'
                              }`}
                            >
                              <Icon name="check" size={13} strokeWidth={2.6} />
                            </span>
                            <span className={`text-sm ${done ? 'text-ink-400 line-through' : 'text-ink-800'}`}>
                              {item.text}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSyncItem(item.id)}
                            className="shrink-0 rounded-md p-1 text-ink-300 transition hover:bg-rose-50 hover:text-loss"
                            aria-label="삭제"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  <form onSubmit={addSyncItem} className="flex items-center gap-2 border-t border-ink-100 px-4 py-2.5">
                    <input
                      className="input flex-1 py-1.5 text-xs"
                      placeholder="체크 항목 추가"
                      value={newSync}
                      onChange={(e) => setNewSync(e.target.value)}
                    />
                    <button type="submit" className="btn-ghost shrink-0 !px-2.5 !py-1.5 text-xs" disabled={!newSync.trim()}>
                      추가
                    </button>
                  </form>
                </>
              ) : null}
            </section>
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <section className="card xl:col-span-2">
              <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
                <div>
                  <h2 className="text-sm font-bold text-ink-900">최근 12개월 추이</h2>
                  <p className="mt-0.5 text-xs text-ink-500">공급가액 기준</p>
                </div>
                <Link to="/reports" className="text-xs font-semibold text-brand-700 hover:underline">
                  보고서 →
                </Link>
              </header>
              <div className="px-2 py-4 sm:px-4">
                <MonthlyTrendChart data={trendData} height={320} />
              </div>
            </section>

            <section className="card">
              <header className="border-b border-ink-200 px-4 py-3.5">
                <h2 className="text-sm font-bold text-ink-900">비용 구성</h2>
                <p className="mt-0.5 text-xs text-ink-500">{period.range.label}</p>
              </header>
              <div className="px-3 py-4">
                <CompositionDonut data={donutData} height={250} />
              </div>
              <dl className="border-t border-ink-100 px-4 py-3 text-xs">
                <div className="flex items-center justify-between py-1">
                  <dt className="text-ink-500">매입</dt>
                  <dd className="font-num font-semibold tabular-nums text-ink-800">
                    {formatKRW(stats.purchase.supply)}원
                  </dd>
                </div>
                <div className="flex items-center justify-between py-1">
                  <dt className="text-ink-500">운영비</dt>
                  <dd className="font-num font-semibold tabular-nums text-ink-800">
                    {formatKRW(stats.opex.supply)}원
                  </dd>
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-ink-100 pt-2">
                  <dt className="font-semibold text-ink-700">합계</dt>
                  <dd className="font-num font-extrabold tabular-nums text-ink-900">
                    {formatKRW(stats.cost)}원
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="card overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
                <h2 className="text-sm font-bold text-ink-900">프로젝트별 수익</h2>
                <Link to="/projects" className="text-xs font-semibold text-brand-700 hover:underline">
                  전체 →
                </Link>
              </header>
              {projectRows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse">
                    <thead className="bg-ink-50/70">
                      <tr>
                        <th className="th">프로젝트</th>
                        <th className="th text-right">매출</th>
                        <th className="th text-right">비용</th>
                        <th className="th text-right">영업이익</th>
                        <th className="th w-32">비중</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {projectRows.map((row) => (
                        <tr key={row.project.id} className="transition hover:bg-ink-50/60">
                          <td className="td max-w-[180px] truncate">
                            <Link
                              to={`/projects/${row.project.id}`}
                              className="font-medium text-ink-800 hover:text-brand-700 hover:underline"
                            >
                              {row.project.name}
                            </Link>
                          </td>
                          <td className="td num">{formatKRW(row.sale)}</td>
                          <td className="td num">{formatKRW(row.purchase + row.opex)}</td>
                          <td
                            className={`td num font-bold ${
                              row.profit >= 0 ? 'text-emerald-700' : 'text-loss'
                            }`}
                          >
                            {formatKRW(row.profit)}
                          </td>
                          <td className="td">
                            <ProfitBar
                              value={row.profit}
                              max={maxProjectSale}
                              tone={row.profit >= 0 ? 'profit' : 'loss'}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon="folder"
                  title="프로젝트 배분된 내역이 없습니다"
                  description="장부 입력 시 프로젝트를 선택하면 여기에 수익이 집계됩니다."
                />
              )}
            </section>

            <section className="card overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
                <h2 className="text-sm font-bold text-ink-900">최근 지출결의</h2>
                <Link
                  to="/expense-reports"
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  전체 →
                </Link>
              </header>
              {recentReports.length ? (
                <ul className="divide-y divide-ink-100">
                  {recentReports.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-800">
                          {entry.description || entry.counterparty || '(내용 없음)'}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          {formatDateHuman(entry.entry_date)}
                          {entry.category ? ` · ${entry.category}` : ''}
                          {entry.doc_no ? ` · ${entry.doc_no}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 font-num text-sm font-bold tabular-nums text-ink-900">
                        {formatKRW(entry.total_amount)}원
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon="coins"
                  title="접수된 지출결의가 없습니다"
                  description="직원이 등록하면 이곳에 바로 표시됩니다."
                />
              )}
            </section>
          </div>

          <section className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRecent((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-ink-50/60"
            >
              <span>
                <span className="block text-sm font-bold text-ink-900">
                  최근 거래 내역
                  <span className="ml-2 font-num text-xs font-semibold tabular-nums text-ink-400">
                    {current.length}건
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">펼쳐서 선택 기간의 최근 내역을 확인합니다</span>
              </span>
              <span className="flex items-center gap-2">
                <Link
                  to="/reports"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  보고서 →
                </Link>
                <Icon name={showRecent ? 'chevron-down' : 'chevron-right'} size={16} className="text-ink-400" />
              </span>
            </button>
            {showRecent ? (
              <div className="border-t border-ink-200">
                <EntryTable
                  entries={current.slice(0, 8)}
                  projects={projects}
                  profiles={profiles}
                  attachmentsByEntry={attachmentsByEntry}
                  showType
                  canEdit={false}
                  onOpenAttachments={() => {}}
                />
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}

function MiniStat({ label, value, unit = '원', desc, tone = 'ink', to }) {
  const tones = {
    brand: 'text-brand-700 bg-brand-50',
    rose: 'text-rose-700 bg-rose-50',
    ink: 'text-ink-700 bg-ink-100',
  }
  const body = (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon name="chart" size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink-500">{label}</p>
        <p className="mt-0.5 truncate">
          <span className="font-num text-base font-extrabold tabular-nums text-ink-900">
            {typeof value === 'number' ? formatKRW(value) : value}
          </span>
          <span className="ml-1 text-xs font-semibold text-ink-500">{unit}</span>
        </p>
        {desc ? <p className="mt-0.5 truncate text-[11px] text-ink-400">{desc}</p> : null}
      </div>
    </>
  )
  if (!to) {
    return <div className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3">{body}</div>
  }
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 transition hover:shadow-pop"
    >
      {body}
    </Link>
  )
}

function StaffHome({ period, loading, stats, current, projects, profiles, attachmentsByEntry }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="대시보드" />
        <LoadingBlock />
      </div>
    )
  }

  const costs = current.reduce((acc, e) => acc + Number(e.total_amount || 0), 0)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="내 지출결의" description="직원 계정에는 본인이 등록한 내역만 표시됩니다.">
        <PeriodPicker period={period} />
      </PageHeader>

      <TaxAlertBanner />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="지출 합계 (부가세 포함)" value={costs} tone="opex" icon="coins" />
        <StatCard label="등록 건수" value={String(current.length)} unit="건" tone="neutral" icon="file" />
        <StatCard
          label="공급가액 합계"
          value={current.reduce((acc, e) => acc + Number(e.supply_amount || 0), 0)}
          tone="neutral"
          icon="receipt"
        />
      </div>

      <section className="card overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
          <h2 className="text-sm font-bold text-ink-900">등록한 지출결의</h2>
          <Link to="/expense-reports" className="text-xs font-semibold text-brand-700 hover:underline">
            등록하러 가기 →
          </Link>
        </header>
        <EntryTable
          entries={current}
          projects={projects}
          profiles={profiles}
          attachmentsByEntry={attachmentsByEntry}
          showType={false}
          canEdit={false}
        />
      </section>
    </div>
  )
}
