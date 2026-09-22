import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import { MonthlyTrendChart, ProfitBar } from '../components/Charts'
import { useToast } from '../components/Toast'
import { LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { ENTRY_META } from '../lib/constants'
import { downloadTextFile, toCSV } from '../lib/csv'
import {
  changeRate,
  formatCompact,
  formatKRW,
  formatPercent,
  monthLabel,
  previousPeriod,
} from '../lib/format'
import { groupByCategory, groupByCounterparty, groupByMonth, groupByProject, summarize } from '../lib/summary'
import { listEntries, listProjects } from '../lib/api'

function allMonthKeys(entries) {
  const keys = new Set(entries.map((e) => String(e.entry_date).slice(0, 7)))
  return [...keys].sort()
}

export default function Reports() {
  const { profile } = useAuth()
  const toast = useToast()
  const period = usePeriod('thisYear', 'bzen.period.reports')

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [previous, setPrevious] = useState([])
  const [projects, setProjects] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const prev =
        period.range.from && period.range.to ? previousPeriod(period.range.from, period.range.to) : null
      const [rows, prevRows, projectRows] = await Promise.all([
        listEntries({ from: period.range.from, to: period.range.to }),
        prev ? listEntries({ from: prev.from, to: prev.to }) : Promise.resolve([]),
        listProjects(),
      ])
      setEntries(rows)
      setPrevious(prevRows)
      setProjects(projectRows)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [period.range.from, period.range.to, toast])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => summarize(entries), [entries])
  const prevStats = useMemo(() => summarize(previous), [previous])
  const hasCompare = Boolean(period.range.from && period.range.to)

  const monthKeys = useMemo(() => allMonthKeys(entries), [entries])
  const monthly = useMemo(() => groupByMonth(entries, monthKeys), [entries, monthKeys])
  const maxMonthly = Math.max(1, ...monthly.map((m) => Math.max(m.sale, Math.abs(m.profit))))

  const projectRows = useMemo(
    () =>
      groupByProject(entries, projects)
        .filter((r) => r.project)
        .sort((a, b) => b.profit - a.profit),
    [entries, projects],
  )

  const opexByCategory = useMemo(() => groupByCategory(entries, 'opex'), [entries])
  const purchaseByCategory = useMemo(() => groupByCategory(entries, 'purchase'), [entries])
  const salesByClient = useMemo(() => groupByCounterparty(entries, 'sale').slice(0, 12), [entries])
  const maxCategory = Math.max(1, ...opexByCategory.map((c) => c.supply))

  const exportSummary = () => {
    const lines = []
    lines.push(['■ 손익 요약', period.range.label])
    lines.push(['항목', '공급가액', '부가세', '합계'])
    lines.push(['매출', stats.sale.supply, stats.sale.vat, stats.sale.total])
    lines.push(['매입', stats.purchase.supply, stats.purchase.vat, stats.purchase.total])
    lines.push(['운영비', stats.opex.supply, stats.opex.vat, stats.opex.total])
    lines.push(['영업이익', stats.profit, '', ''])
    lines.push(['이익률(%)', stats.margin === null ? '' : stats.margin.toFixed(1), '', ''])
    lines.push([])
    lines.push(['■ 월별 손익'])
    lines.push(['월', '매출', '매입', '운영비', '영업이익'])
    for (const row of monthly) {
      lines.push([row.month, row.sale, row.purchase, row.opex, row.profit])
    }
    lines.push([])
    lines.push(['■ 프로젝트별 손익'])
    lines.push(['프로젝트', '매출', '매입', '운영비', '영업이익', '이익률(%)'])
    for (const row of projectRows) {
      lines.push([
        row.project.name,
        row.sale,
        row.purchase,
        row.opex,
        row.profit,
        row.margin === null ? '' : row.margin.toFixed(1),
      ])
    }
    lines.push([])
    lines.push(['■ 운영비 항목별'])
    lines.push(['항목', '공급가액', '합계'])
    for (const row of opexByCategory) lines.push([row.category, row.supply, row.total])

    downloadTextFile(
      `손익보고서_${period.range.from || 'all'}_${period.range.to || 'all'}.csv`,
      linesToCsv(lines),
    )
  }

  const exportDetail = () => {
    const headers = ['일자', '유형', '결의번호', '프로젝트', '거래처', '항목', '적요', '공급가액', '부가세', '합계', '결제수단', '비고']
    const rows = entries.map((e) => [
      e.entry_date,
      ENTRY_META[e.entry_type]?.label || e.entry_type,
      e.doc_no,
      projects.find((p) => p.id === e.project_id)?.name || '',
      e.counterparty,
      e.category,
      e.description,
      Number(e.supply_amount || 0),
      Number(e.vat_amount || 0),
      Number(e.total_amount || 0),
      e.payment_method,
      e.memo,
    ])
    downloadTextFile(
      `장부상세_${period.range.from || 'all'}_${period.range.to || 'all'}.csv`,
      toCSV(headers, rows),
    )
  }

  const trendData = useMemo(() => groupByMonth(entries, monthKeys), [entries, monthKeys])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="손익 보고서" description="임원 보고용 요약입니다. 그대로 인쇄하거나 CSV 로 내려받을 수 있습니다.">
        <PeriodPicker period={period} />
        <button type="button" className="btn-ghost" onClick={exportSummary}>
          <Icon name="download" size={16} />
          요약 CSV
        </button>
        <button type="button" className="btn-ghost" onClick={exportDetail}>
          <Icon name="download" size={16} />
          상세 CSV
        </button>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          <Icon name="file" size={16} />
          인쇄 / PDF
        </button>
      </PageHeader>

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label="매출"
              value={stats.revenue}
              tone="sale"
              icon="trending-up"
              delta={hasCompare ? changeRate(stats.revenue, prevStats.revenue) : undefined}
            />
            <StatCard
              label="매입 + 운영비"
              value={stats.cost}
              tone="opex"
              icon="cart"
              delta={hasCompare ? changeRate(stats.cost, prevStats.cost) : undefined}
            />
            <StatCard
              label="영업이익"
              value={stats.profit}
              tone={stats.profit >= 0 ? 'profit' : 'loss'}
              icon="coins"
              delta={hasCompare ? changeRate(stats.profit, prevStats.profit) : undefined}
            />
            <StatCard
              label="이익률"
              value={stats.margin === null ? '—' : formatPercent(stats.margin)}
              unit=""
              tone="neutral"
              icon="chart"
              hint={`거래 ${stats.count}건`}
            />
          </div>

          {/* 1. 손익 요약 */}
          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">1. 손익 요약</h2>
              <p className="text-xs text-ink-500">
                {period.range.label} · 부가세 제외 공급가액 기준
              </p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead className="bg-ink-50/70">
                  <tr>
                    <th className="th">항목</th>
                    <th className="th text-right">공급가액</th>
                    <th className="th text-right">부가세</th>
                    <th className="th text-right">합계</th>
                    <th className="th text-right">구성비</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  <ReportRow label="매출" tone="sale" data={stats.sale} base={stats.revenue} />
                  <ReportRow label="매입" tone="purchase" data={stats.purchase} base={stats.revenue} />
                  <ReportRow label="운영비" tone="opex" data={stats.opex} base={stats.revenue} />
                </tbody>
                <tfoot className="border-t-2 border-ink-200 bg-ink-50/80">
                  <tr>
                    <td className="td font-bold">영업이익</td>
                    <td className="td num font-extrabold" colSpan={2}>
                      <span className={stats.profit >= 0 ? 'text-emerald-700' : 'text-loss'}>
                        {formatKRW(stats.profit)}원
                      </span>
                    </td>
                    <td className="td" />
                    <td className="td num font-bold text-ink-700">
                      {stats.margin === null ? '—' : formatPercent(stats.margin)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-ink-100 px-4 py-4 sm:grid-cols-3">
              <SmallFigure label="매출세액" value={stats.sale.vat} />
              <SmallFigure label="매입세액 (매입+운영비)" value={stats.purchase.vat + stats.opex.vat} />
              <SmallFigure
                label="부가세 납부 예상"
                value={stats.vatPayable}
                highlight
                hint="매출세액 − 매입세액"
              />
            </div>
          </section>

          {/* 2. 월별 추이 */}
          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">2. 월별 손익 추이</h2>
            </header>
            <div className="px-2 py-4 sm:px-4">
              <MonthlyTrendChart data={trendData} height={300} />
            </div>
            <div className="overflow-x-auto border-t border-ink-100">
              <table className="w-full min-w-[620px] border-collapse">
                <thead className="bg-ink-50/70">
                  <tr>
                    <th className="th">월</th>
                    <th className="th text-right">매출</th>
                    <th className="th text-right">매입</th>
                    <th className="th text-right">운영비</th>
                    <th className="th text-right">영업이익</th>
                    <th className="th w-24">비중</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {monthly.map((row) => (
                    <tr key={row.month}>
                      <td className="td font-medium">{monthLabel(row.month)}</td>
                      <td className="td num">{formatKRW(row.sale)}</td>
                      <td className="td num">{formatKRW(row.purchase)}</td>
                      <td className="td num">{formatKRW(row.opex)}</td>
                      <td className={`td num font-bold ${row.profit >= 0 ? 'text-emerald-700' : 'text-loss'}`}>
                        {formatKRW(row.profit)}
                      </td>
                      <td className="td">
                        <ProfitBar
                          value={Math.abs(row.profit)}
                          max={maxMonthly}
                          tone={row.profit >= 0 ? 'profit' : 'loss'}
                        />
                      </td>
                    </tr>
                  ))}
                  {!monthly.length ? (
                    <tr>
                      <td colSpan={6} className="empty">
                        해당 기간에 내역이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. 프로젝트별 손익 */}
          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">3. 프로젝트별 손익</h2>
            </header>
            {projectRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">프로젝트</th>
                      <th className="th text-right">매출</th>
                      <th className="th text-right">매입</th>
                      <th className="th text-right">운영비</th>
                      <th className="th text-right">영업이익</th>
                      <th className="th text-right">이익률</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {projectRows.map((row) => (
                      <tr key={row.project.id} className="transition hover:bg-ink-50/60">
                        <td className="td">
                          <Link
                            to={`/projects/${row.project.id}`}
                            className="font-medium text-ink-800 hover:text-brand-700 hover:underline"
                          >
                            {row.project.name}
                          </Link>
                        </td>
                        <td className="td num">{formatKRW(row.sale)}</td>
                        <td className="td num">{formatKRW(row.purchase)}</td>
                        <td className="td num">{formatKRW(row.opex)}</td>
                        <td className={`td num font-bold ${row.profit >= 0 ? 'text-emerald-700' : 'text-loss'}`}>
                          {formatKRW(row.profit)}
                        </td>
                        <td className="td num">{row.margin === null ? '—' : formatPercent(row.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">이 기간에 프로젝트로 배분된 내역이 없습니다.</p>
            )}
          </section>

          {/* 4. 항목별 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <section className="card overflow-hidden">
              <header className="border-b border-ink-200 px-4 py-3.5">
                <h2 className="text-sm font-bold text-ink-900">4. 운영비 항목별</h2>
              </header>
              {opexByCategory.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse">
                    <thead className="bg-ink-50/70">
                      <tr>
                        <th className="th">항목</th>
                        <th className="th text-right">공급가액</th>
                        <th className="th text-right">비중</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {opexByCategory.map((row) => (
                        <tr key={row.category}>
                          <td className="td">{row.category}</td>
                          <td className="td num">{formatKRW(row.supply)}</td>
                          <td className="td num text-ink-500">
                            {stats.opex.supply ? formatPercent((row.supply / stats.opex.supply) * 100, 0) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-ink-200 bg-ink-50/80">
                      <tr>
                        <td className="td font-bold">합계</td>
                        <td className="td num font-bold">{formatKRW(stats.opex.supply)}</td>
                        <td className="td" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="empty">운영비 내역이 없습니다.</p>
              )}
              {purchaseByCategory.length ? (
                <div className="border-t border-ink-100 px-4 py-3">
                  <p className="mb-2 text-xs font-bold text-ink-600">매입 항목별 (상위 5)</p>
                  <ul className="flex flex-col gap-1.5">
                    {purchaseByCategory.slice(0, 5).map((row) => (
                      <li key={row.category} className="flex items-center gap-3">
                        <span className="w-28 shrink-0 truncate text-xs text-ink-600">{row.category}</span>
                        <span className="flex-1">
                          <ProfitBar value={row.supply} max={maxCategory} tone="profit" />
                        </span>
                        <span className="shrink-0 font-num text-xs font-semibold tabular-nums text-ink-800">
                          {formatCompact(row.supply)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="card overflow-hidden">
              <header className="border-b border-ink-200 px-4 py-3.5">
                <h2 className="text-sm font-bold text-ink-900">5. 매출 거래처별 (상위 12)</h2>
              </header>
              {salesByClient.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse">
                    <thead className="bg-ink-50/70">
                      <tr>
                        <th className="th">거래처</th>
                        <th className="th text-right">건수</th>
                        <th className="th text-right">매출(공급가액)</th>
                        <th className="th text-right">비중</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {salesByClient.map((row) => (
                        <tr key={row.name}>
                          <td className="td max-w-[220px] truncate">{row.name}</td>
                          <td className="td num text-ink-500">{row.count}</td>
                          <td className="td num font-semibold">{formatKRW(row.supply)}</td>
                          <td className="td num text-ink-500">
                            {stats.revenue ? formatPercent((row.supply / stats.revenue) * 100, 0) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty">매출 내역이 없습니다.</p>
              )}
            </section>
          </div>

          <p className="pb-2 text-center text-xs text-ink-400">
            {profile?.full_name ? `${profile.full_name} · ` : ''}
            {period.range.label} 기준 · 영업이익은 부가세를 제외한 공급가액으로 계산됩니다.
          </p>
        </>
      )}
    </div>
  )
}

function ReportRow({ label, data, tone, base }) {
  const meta = ENTRY_META[tone]
  const share = base ? (data.supply / base) * 100 : null
  return (
    <tr>
      <td className="td">
        <span className={`chip ${meta.chip}`}>{label}</span>
      </td>
      <td className="td num font-semibold">{formatKRW(data.supply)}</td>
      <td className="td num text-ink-500">{formatKRW(data.vat)}</td>
      <td className="td num">{formatKRW(data.total)}</td>
      <td className="td num text-ink-500">{share === null ? '—' : formatPercent(share, 0)}</td>
    </tr>
  )
}

function SmallFigure({ label, value, hint, highlight = false }) {
  return (
    <div className={`rounded-lg border px-3.5 py-3 ${highlight ? 'border-brand-100 bg-brand-50/60' : 'border-ink-200'}`}>
      <p className="text-xs font-semibold text-ink-500">{label}</p>
      <p className="mt-1 font-num text-base font-extrabold tabular-nums text-ink-900">
        {formatKRW(value)}원
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p> : null}
    </div>
  )
}

function linesToCsv(lines) {
  return lines.map((row) => row.map((v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\r\n')
}
