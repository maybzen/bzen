import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CompositionDonut, MonthlyTrendChart, ProfitBar } from '../components/Charts'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import EntryTable from '../components/EntryTable'
import { useToast } from '../components/Toast'
import { EmptyState, LoadingBlock, PageHeader, Spinner, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { useStaffPermissions } from '../lib/permissions'
import {
  addChecklistItem,
  deleteChecklistItem,
  listAttachments,
  listChecklistItems,
  listCollections,
  listEntries,
  listFundRows,
  listPartners,
  listProfiles,
  listProjects,
  updateChecklistItem,
} from '../lib/api'
import { refreshLedgerIndex, useLedgerIndex } from '../lib/ledgerIndex'
import { ISSUE_META, summarizeAudit } from '../lib/validate'
import ScheduleModal from '../components/ScheduleModal'
import { SCHEDULE_DONE_LIST, SCHEDULE_LIST, buildSchedule, dday, ddayLabel, dueDateSupported, doneKeysFrom } from '../lib/schedule'
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

/* 홈페이지 확인 필요 목록 (DB 공유, 없으면 브라우저 저장으로 폴백) */
const HOME_ALERTS_DEFAULT = [
  { id: 'yoon', text: '윤호식 직접지급 매입근거 확인 (5/8 1,298만·7/9 1,100만·8/14 167만 / 브이오디오 매입 913만원과 차이)' },
  { id: 'beaver', text: '비버웍스 입금 93만원 성격 확인' },
  { id: 'loan', text: '대출 원리금 원금·이자 분리 (금진 확인)' },
  { id: 'pg', text: 'PG 수수료 중복 의혹 (~15만원)' },
]

/* 회사 PC에서 업데이트할 때 확인할 목록 (관리자만, DB 공유) */
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

function readLocalList(itemsKey, doneKey, defaults, mergeDefaults = false) {
  try {
    const raw = localStorage.getItem(itemsKey)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed) && parsed.every((x) => x && typeof x.id === 'string')) {
      let checks = {}
      try {
        const c = JSON.parse(localStorage.getItem(doneKey))
        if (c && typeof c === 'object') checks = c
      } catch {
        /* 무시 */
      }
      const items = parsed.map((x) => ({ id: x.id, text: String(x.text || ''), done: Boolean(checks[x.id]) }))
      if (mergeDefaults) {
        const ids = new Set(items.map((x) => x.id))
        for (const d of defaults) if (!ids.has(d.id)) items.push({ ...d, done: false })
      }
      return items
    }
  } catch {
    /* 무시 */
  }
  return defaults.map((d) => ({ ...d, done: false }))
}

function saveLocalList(itemsKey, doneKey, items) {
  try {
    localStorage.setItem(itemsKey, JSON.stringify(items.map(({ id, text }) => ({ id, text }))))
    const checks = {}
    for (const x of items) if (x.done) checks[x.id] = true
    localStorage.setItem(doneKey, JSON.stringify(checks))
  } catch {
    /* 저장 실패 무시 */
  }
}

/* DB 우선, 테이블 없으면 로컬 모드. DB가 비어 있으면 로컬 내용을 1회 이관합니다. */
function useChecklist(listKey, itemsKey, doneKey, defaults, userId, mergeDefaults = false) {
  const [items, setItems] = useState(() => readLocalList(itemsKey, doneKey, defaults, mergeDefaults))
  const [useDb, setUseDb] = useState(false)

  useEffect(() => {
    let alive = true
    listChecklistItems(listKey)
      .then(async (rows) => {
        if (!alive) return
        if (rows && rows.length) {
          setItems(rows.map((r) => ({ id: r.id, text: r.text, done: !!r.done })))
          setUseDb(true)
          return
        }
        const local = readLocalList(itemsKey, doneKey, defaults, mergeDefaults)
        const seeded = []
        for (const it of local) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const row = await addChecklistItem(listKey, it.text, userId)
            if (it.done) await updateChecklistItem(row.id, { done: true })
            seeded.push({ id: row.id, text: row.text, done: !!it.done })
          } catch {
            return // 중간 실패 시 로컬 모드 유지
          }
        }
        if (!alive) return
        setItems(seeded)
        setUseDb(true)
      })
      .catch(() => {
        /* 테이블 없음 → 로컬 모드 유지 */
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey])

  const persistLocal = (next) => {
    setItems(next)
    saveLocalList(itemsKey, doneKey, next)
  }
  const toggle = async (id) => {
    const cur = items.find((x) => x.id === id)
    if (!cur) return
    if (useDb) {
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, done: !x.done } : x)))
      try {
        await updateChecklistItem(id, { done: !cur.done })
      } catch {
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, done: cur.done } : x)))
      }
    } else {
      persistLocal(items.map((x) => (x.id === id ? { ...x, done: !x.done } : x)))
    }
  }
  const add = async (text) => {
    const t = String(text || '').trim()
    if (!t) return
    if (useDb) {
      try {
        const row = await addChecklistItem(listKey, t, userId)
        setItems((prev) => [...prev, { id: row.id, text: row.text, done: false }])
      } catch {
        /* 무시 */
      }
    } else {
      persistLocal([...items, { id: `a${Date.now().toString(36)}`, text: t, done: false }])
    }
  }
  const remove = async (id) => {
    if (useDb) {
      setItems((prev) => prev.filter((x) => x.id !== id))
      try {
        await deleteChecklistItem(id)
      } catch {
        /* 무시 */
      }
    } else {
      persistLocal(items.filter((x) => x.id !== id))
    }
  }
  const rename = async (id, text) => {
    const t = String(text || '').trim()
    if (!t) return
    if (useDb) {
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, text: t } : x)))
      try {
        await updateChecklistItem(id, { text: t })
      } catch {
        /* 무시 */
      }
    } else {
      persistLocal(items.map((x) => (x.id === id ? { ...x, text: t } : x)))
    }
  }
  return { items, useDb, toggle, add, remove, rename }
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
  const home = useChecklist('home', 'bzen.home.alerts.items.v3', 'bzen.home.alerts.done.v3', HOME_ALERTS_DEFAULT, user?.id)
  const sync = useChecklist('sync', 'bzen.home.sync.items.v1', 'bzen.home.sync.done.v1', SYNC_CHECKLIST_DEFAULT, user?.id, true)
  const [newSync, setNewSync] = useState('')
  const [syncOpen, setSyncOpen] = useState(true)
  const [editing, setEditing] = useState(null) // { list: 'sync', id, text }

  const syncOpenCount = sync.items.filter((x) => !x.done).length

  const addSyncItem = (e) => {
    e.preventDefault()
    sync.add(newSync)
    setNewSync('')
  }
  const saveEditing = (e) => {
    e.preventDefault()
    if (!editing) return
    sync.rename(editing.id, editing.text)
    setEditing(null)
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

      {isAdmin ? <DataAuditPanel /> : null}

      {isAdmin ? (
        <ScheduleCard
          userId={user?.id}
          home={home}
          isAdmin={isAdmin}
          profiles={profiles}
          projects={projects}
          syncBundle={{ sync, editing, setEditing, saveEditing, newSync, setNewSync, addSyncItem }}
        />
      ) : null}

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

/* ------------------------------------------------------------------ */
/* 데이터 점검 — 장부 전체를 훑어 어긋난 내역을 모아 보여줍니다          */
/* ------------------------------------------------------------------ */

const AUDIT_LIMIT = 25

function DataAuditPanel() {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const { issues, loading, ready, entries } = useLedgerIndex()
  const navigate = useNavigate()
  const [reloading, setReloading] = useState(false)

  const reload = async () => {
    setReloading(true)
    try {
      await refreshLedgerIndex()
    } finally {
      setReloading(false)
    }
  }

  const summary = useMemo(() => summarizeAudit(issues), [issues])
  const shown = useMemo(() => {
    const list = filter === 'all' ? issues : issues.filter((i) => i.code === filter)
    // 깨진 텍스트 → 중복 → 표기 → 부가세 → 입력누락 순으로 보여주고, 같은 종류는 금액 큰 순
    const rank = { broken: 0, duplicate: 1, variant: 2, vat: 3, field: 4 }
    return [...list].sort((a, b) => (rank[a.code] - rank[b.code]) || (b.amount - a.amount))
  }, [issues, filter])

  if (loading && !ready) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-3 text-xs text-ink-500">
        <Spinner size={14} />
        장부를 검사하는 중입니다…
      </div>
    )
  }

  if (!issues.length) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
        <Icon name="check" size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <strong className="font-bold">데이터 점검 통과</strong> · {entries.length.toLocaleString()}건 중 중복·표기·부가세·입력 누락이 없습니다.
        </span>
      </div>
    )
  }

  const tone =
    summary.byCode.broken > 0
      ? { ring: 'border-rose-200 bg-rose-50', text: 'text-rose-800', chip: 'bg-rose-100 text-rose-700', line: 'border-rose-100' }
      : summary.byCode.duplicate > 0 || summary.byCode.variant > 0
        ? { ring: 'border-amber-200 bg-amber-50', text: 'text-amber-800', chip: 'bg-amber-100 text-amber-700', line: 'border-amber-100' }
        : { ring: 'border-sky-200 bg-sky-50', text: 'text-sky-800', chip: 'bg-sky-100 text-sky-700', line: 'border-sky-100' }

  return (
    <section className={`rounded-xl border ${tone.ring}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Icon name="alert" size={16} className={`shrink-0 ${tone.text}`} />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-bold ${tone.text}`}>
            데이터 점검 · {summary.total}건
          </span>
          <span className={`mt-0.5 block text-[11px] opacity-80 ${tone.text}`}>
            {entries.length.toLocaleString()}건을 검사했습니다. 내용을 눌러 항목을 확인하세요.
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {summary.ranked.map((r) => (
            <span key={r.code} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>
              {r.label} {r.count}
            </span>
          ))}
        </span>
        <span className={`shrink-0 transition-transform ${tone.text} ${open ? 'rotate-180' : ''}`}>
          <Icon name="chevron-down" size={16} />
        </span>
      </button>

      {reloading ? (
        <div className={`border-t px-4 py-2 text-center text-[11px] text-ink-500 ${tone.line}`}>
          다시 검사하는 중…
        </div>
      ) : null}

      {open ? (
        <div className={`border-t bg-white/70 px-4 py-3 ${tone.line}`}>
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                filter === 'all' ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
              }`}
            >
              전체 {summary.total}
            </button>
            {summary.ranked.map((r) => (
              <button
                key={r.code}
                type="button"
                onClick={() => setFilter(r.code)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  filter === r.code ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                }`}
              >
                {r.label} {r.count}
              </button>
            ))}
            <button
              type="button"
              onClick={reload}
              disabled={reloading}
              className="ml-auto rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-semibold text-ink-600 transition hover:bg-ink-200 disabled:opacity-50"
            >
              {reloading ? '검사 중…' : '다시 검사'}
            </button>
          </div>

          {shown.length ? (
            <ul className="flex flex-col divide-y divide-ink-100">
              {shown.slice(0, AUDIT_LIMIT).map((i) => {
                const meta = ISSUE_META[i.code] || {}
                const target = i.entryId ? auditTargetFor(entries, i.entryId) : null
                const body = (
                  <>
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${tone.chip}`}>
                      {meta.label || i.code}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-bold text-ink-900">{i.title}</span>
                        {i.party ? <span className="text-xs text-ink-700">{i.party}</span> : null}
                        {i.date ? <span className="text-[11px] tabular-nums text-ink-500">{formatDateHuman(i.date)}</span> : null}
                        {i.amount ? (
                          <span className="text-[11px] tabular-nums text-ink-500">{formatKRW(i.amount)}원</span>
                        ) : null}
                      </span>
                      {i.detail ? <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-500">{i.detail}</span> : null}
                    </span>
                    {target ? <Icon name="chevron-right" size={14} className="mt-0.5 shrink-0 text-ink-300" /> : null}
                  </>
                )
                return (
                  <li key={i.id}>
                    {target ? (
                      <button
                        type="button"
                        onClick={() => navigate(auditLink(target, i))}
                        className="flex w-full items-start gap-2.5 py-2 text-left transition hover:bg-ink-50"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex items-start gap-2.5 py-2">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="py-3 text-xs text-ink-500">이 항목은 없습니다.</p>
          )}

          {shown.length > AUDIT_LIMIT ? (
            <p className="mt-2 text-[11px] text-ink-400">
              그 밖에 {shown.length - AUDIT_LIMIT}건이 있습니다. 항목을 눌러 해당 장부에서 확인하세요.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 이번 달 챙길 일 — 자동(대출·세금) + 직접 등록. 관리자만. 누르면 일정 화면 */
/* ------------------------------------------------------------------ */

function ScheduleCard({ userId, home, isAdmin, profiles, projects, syncBundle }) {
  const [open, setOpen] = useState(false)
  const [loans, setLoans] = useState([])
  const [manuals, setManuals] = useState([])
  const [markers, setMarkers] = useState([])
  const [dateOk, setDateOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const ledger = useLedgerIndex()

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [loanRows, schedRows, markerRows, supported] = await Promise.all([
        listFundRows('fund_loans').catch(() => []),
        listChecklistItems(SCHEDULE_LIST).catch(() => []),
        listChecklistItems(SCHEDULE_DONE_LIST).catch(() => []),
        dueDateSupported().catch(() => false),
      ])
      setLoans(loanRows || [])
      setManuals(schedRows || [])
      setMarkers(markerRows || [])
      setDateOk(!!supported)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 모달을 다시 열 때마다 최신 목록으로 (다른 탭·직접 등록분 반영)
  useEffect(() => {
    if (open) loadAll()
  }, [open, loadAll])

  // 최신 4대보험 고지액을 일정 설명에 붙입니다 (없으면 기본 문구)
  const overrides = useMemo(() => {
    const rows = (ledger.entries || []).filter((e) =>
      String(e.counterparty || '').includes('국민건강보험공단'),
    )
    if (!rows.length) return {}
    rows.sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))
    const top = rows[0]
    const m = String(top.description || '').match(/(\d+)\s*월/)
    const label = m ? `${m[1]}월분 ` : ''
    return { insurance: `${label}${formatKRW(top.total_amount)}원 고지 · 말일 자동이체` }
  }, [ledger.entries])

  const items = useMemo(() => {
    const base = new Date()
    const from = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
    const end = new Date(base)
    end.setDate(end.getDate() + 35)
    const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    return buildSchedule({ loans, manuals, fromISO: from, toISO: to, overrides, doneKeys: doneKeysFrom(markers), profiles, projects })
  }, [loans, manuals, overrides, markers, profiles, projects])

  const overdue = items.filter((it) => it.date && dday(it.date) < 0 && !it.done)
  const top = items.filter((it) => (!it.date || dday(it.date) >= 0) && !it.done).slice(0, 4)
  const homeOpenCount = (home?.items || []).filter((x) => !x.done).length

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-left transition hover:shadow-pop"
      >
        <Icon name="calendar" size={16} className="shrink-0 text-brand-700" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-brand-800">
            이번 달 챙길 일 · {items.length}건
            {overdue.length ? (
              <span className="ml-1.5 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                지남 {overdue.length}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-brand-800/70">
            {loading
              ? '불러오는 중…'
              : top.length
                ? `${top
                    .slice(0, 2)
                    .map((it) => `${ddayLabel(it.date)} ${it.title}`)
                    .join(' · ')}${homeOpenCount ? ` · 확인필요 ${homeOpenCount}건` : ''}`
                : homeOpenCount
                  ? `확인 필요 ${homeOpenCount}건 — 눌러서 확인하세요.`
                  : '잡힌 일정이 없습니다. 눌러서 등록하세요.'}
          </span>
        </span>
        <Icon name="chevron-right" size={16} className="shrink-0 text-brand-300" />
      </button>

      <ScheduleModal
        open={open}
        onClose={() => setOpen(false)}
        loans={loans}
        manuals={manuals}
        markers={markers}
        dateSupported={dateOk}
        userId={userId}
        onChanged={loadAll}
        home={home}
        isAdmin={isAdmin}
        overrides={overrides}
        profiles={profiles}
        projects={projects}
        syncBundle={syncBundle}
      />
    </>
  )
}

/** 지적된 건이 속한 장부 메뉴 (홈 화면 메뉴 경로) */
function auditTargetFor(entries, entryId) {
  const e = entries.find((x) => x.id === entryId)
  if (!e) return null
  if (e.source === 'expense_report') return 'expense-reports'
  if (e.entry_type === 'sale') return 'sales'
  if (e.entry_type === 'purchase') return 'purchases'
  return 'expenses'
}

/** 데이터 점검 → 장부 딥링크. 의심 항목 id + 사유코드를 넘겨 색으로 표시합니다. */
function auditLink(target, issue) {
  const params = new URLSearchParams({ period: 'all', search: issue.party || '' })
  const ids = issue.entryIds?.length ? issue.entryIds : issue.entryId ? [issue.entryId] : []
  if (ids.length) params.set('highlight', ids.join(','))
  if (issue.code) params.set('issue', issue.code)
  return `/${target}?${params.toString()}`
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
