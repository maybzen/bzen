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
  listEntries,
  listProfiles,
  listProjects,
} from '../lib/api'
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

export default function Dashboard() {
  const { isAdmin, profile } = useAuth()
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
    const rows = groupByProject(current, projects).filter((r) => r.project)
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

  if (!isAdmin) {
    return (
      <StaffHome
        period={period}
        loading={loading}
        stats={stats}
        current={current}
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
        <PeriodPicker period={period} />
      </PageHeader>

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
              label="부가세 납부 예상"
              value={stats.vatPayable}
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
              desc={period.range.label}
              tone="ink"
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
            <header className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">최근 거래 내역</h2>
              <Link to="/reports" className="text-xs font-semibold text-brand-700 hover:underline">
                보고서 →
              </Link>
            </header>
            <EntryTable
              entries={current.slice(0, 8)}
              projects={projects}
              profiles={profiles}
              attachmentsByEntry={attachmentsByEntry}
              showType
              canEdit={false}
              onOpenAttachments={() => {}}
            />
          </section>
        </>
      )}
    </div>
  )
}

function MiniStat({ label, value, unit = '원', desc, tone = 'ink' }) {
  const tones = {
    brand: 'text-brand-700 bg-brand-50',
    rose: 'text-rose-700 bg-rose-50',
    ink: 'text-ink-700 bg-ink-100',
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3">
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
    </div>
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
