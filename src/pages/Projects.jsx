import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import ProjectFormModal from '../components/ProjectFormModal'
import PartnerPicker from '../components/PartnerPicker'
import { ProfitBar } from '../components/Charts'
import { useToast } from '../components/Toast'
import { AmountInput, ConfirmDialog, EmptyState, Field, InlineAlert, LoadingBlock, Modal, PageHeader, SegmentedControl, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { PROJECT_STATUS } from '../lib/constants'
import { contractSplit, formatDateHuman, formatKRW, formatPercent, normalizeVendorName } from '../lib/format'
import { buildPnl, groupByProject, summarize } from '../lib/summary'
import { createEntry, createProject, deleteProject, isMissingTableError, linkProjectPartner, listEntries, listPartners, listProfiles, listProjectPartners, listProjects, unlinkProjectPartner, updateProject } from '../lib/api'

/**
 * 카드에 쓰는 손익 표기. 세무·회계 표현을 그대로 씁니다.
 * 직원 화면(bare)에서는 매출·이익을 숨기고 비용만 보여줍니다.
 */
function PnlGrid({ pnl, achieved, contractAmount, showContract, bare = false }) {
  if (bare) {
    return (
      <>
        <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-ink-50/80 p-3 text-center">
          <div>
            <dt className="text-[11px] font-semibold text-ink-500">매출원가</dt>
            <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
              {formatKRW(pnl.cogs)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-ink-500">경비</dt>
            <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
              {formatKRW(pnl.expense)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-ink-500">비용 합계</dt>
            <dd className="mt-0.5 font-num text-sm font-extrabold tabular-nums text-ink-900">
              {formatKRW(pnl.cogs + pnl.expense)}
            </dd>
          </div>
        </dl>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
          매출원가 = 이 일에 외부로 나간 돈(외주·매입) · 경비 = 운영비(교통·식대·수수료 등)
        </p>
      </>
    )
  }
  const neg = (v) => v < 0
  return (
    <>
      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-ink-50/80 p-3 text-center">
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">순매출액</dt>
          <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
            {formatKRW(pnl.revenue)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">매출원가</dt>
          <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
            {formatKRW(pnl.cogs)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">매출총이익</dt>
          <dd
            className={`mt-0.5 font-num text-sm font-extrabold tabular-nums ${
              neg(pnl.gross) ? 'text-loss' : 'text-ink-900'
            }`}
          >
            {formatKRW(pnl.gross)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">경비</dt>
          <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
            {formatKRW(pnl.expense)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">영업이익</dt>
          <dd
            className={`mt-0.5 font-num text-sm font-extrabold tabular-nums ${
              neg(pnl.operating) ? 'text-loss' : 'text-emerald-700'
            }`}
          >
            {pnl.operating ? formatKRW(pnl.operating) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">영업이익률</dt>
          <dd
            className={`mt-0.5 font-num text-sm font-bold tabular-nums ${
              pnl.operatingMargin === null ? 'text-ink-300' : neg(pnl.operatingMargin) ? 'text-loss' : 'text-ink-900'
            }`}
          >
            {pnl.operatingMargin === null ? '—' : formatPercent(pnl.operatingMargin)}
          </dd>
        </div>
      </dl>

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
        매출원가 = 이 일에 외부로 나간 돈(외주·매입) · 경비 = 운영비(인건비·교통·식대 등)
        <br />
        매출총이익 = 순매출액 − 매출원가 · 영업이익 = 매출총이익 − 경비 (남은 순수익)
      </p>

      {showContract && achieved !== null ? (
        <p className="mt-2 text-xs text-ink-500">
          계약 {formatKRW(contractAmount)}원 · 계약 대비 매출{' '}
          <strong className="font-semibold text-ink-700">{formatPercent(achieved, 0)}</strong>
        </p>
      ) : null}
    </>
  )
}

export default function Projects() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [profiles, setProfiles] = useState([])
  const [partners, setPartners] = useState([])
  const [links, setLinks] = useState([])
  const [expandedVendors, setExpandedVendors] = useState({})

  const managerName = (id) => profiles.find((p) => p.id === id)?.full_name || ''
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [statusFilter, setStatusFilter] = useState('active')
  /* 금액 표시 기준: 공급가액(세무 기준) ↔ 부가세포함(계약서 대조용) */
  const [vatMode, setVatMode] = useState(() => {
    try {
      return localStorage.getItem('bzen.vatmode.projects') || 'supply'
    } catch {
      return 'supply'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('bzen.vatmode.projects', vatMode)
    } catch {
      /* 저장 실패 무시 */
    }
  }, [vatMode])
  const incl = vatMode === 'incl'
  /* 표시용 금액: 부가세포함 모드에서는 세액 합산 (계약서 대조용 금액 표시만. 이익은 항상 공급가액 기준) */
  const dispSale = (r) => r.sale + (incl ? Number(r.saleVat || 0) : 0)
  const dispPurchase = (r) => r.purchase + (incl ? Number(r.purchaseVat || 0) : 0)
  const dispOpex = (r) => r.opex + (incl ? Number(r.opexVat || 0) : 0)
  const [sortOrder, setSortOrder] = useState(() => {
    try {
      return localStorage.getItem('bzen.sort.projects') || 'desc'
    } catch {
      return 'desc'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('bzen.sort.projects', sortOrder)
    } catch {
      /* 저장 실패 무시 */
    }
  }, [sortOrder])
  const [yearFilter, setYearFilter] = useState(() => {
    try {
      return localStorage.getItem('bzen.year.projects') || ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('bzen.year.projects', yearFilter)
    } catch {
      /* 저장 실패 무시 */
    }
  }, [yearFilter])
  /* 카드가 많으면 끊어서 보여줍니다 (렌더 부담 완화) */
  const [visibleCount, setVisibleCount] = useState(24)
  useEffect(() => {
    setVisibleCount(24)
  }, [statusFilter, yearFilter, sortOrder])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 카드 금액은 "프로젝트 전체 기간" 기준입니다. 상세 화면(listEntries({projectId}))과
      // 동일해야 하므로 기간 필터를 걸지 않습니다. 연간 일정 전체를 한 번에 봐야 해서 기간 조회는 두지 않습니다.
      const [projectRows, entryRows, profileRows, partnerRows, linkRows] = await Promise.all([
        listProjects(),
        listEntries(),
        listProfiles(),
        listPartners().catch(() => []),
        listProjectPartners().catch(() => []),
      ])
      setProjects(projectRows)
      setEntries(entryRows)
      setProfiles(profileRows)
      setPartners(partnerRows || [])
      setLinks(linkRows || [])
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 내부 귀속용(사내 공통)은 목록에서 숨기고 선택지에는 둡니다.
  const visibleProjects = useMemo(() => projects.filter((p) => !p.is_hidden), [projects])

  /** 프로젝트별 활동 연도. 거래가 있는 연도 + 시작일 연도 + 종료일 연도. */
  const yearsByProject = useMemo(() => {
    const map = new Map()
    const add = (pid, y) => {
      if (!pid || !y) return
      if (!map.has(pid)) map.set(pid, new Set())
      map.get(pid).add(y)
    }
    for (const e of entries) add(e.project_id, String(e.entry_date || '').slice(0, 4))
    for (const p of projects) {
      const y = (d) => String(d || '').slice(0, 4)
      add(p.id, y(p.start_date))
      add(p.id, y(p.end_date))
    }
    return map
  }, [entries, projects])

  const years = useMemo(() => {
    const set = new Set()
    for (const set0 of yearsByProject.values()) for (const y of set0) if (y) set.add(y)
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [yearsByProject])

  /* 선택한 연도에 활동한 프로젝트만. 금액은 연도와 무관하게 전체 기간 기준입니다. */
  const yearScoped = useMemo(() => {
    if (!yearFilter) return visibleProjects
    return visibleProjects.filter((p) => yearsByProject.get(p.id)?.has(yearFilter))
  }, [visibleProjects, yearsByProject, yearFilter])

  const rows = useMemo(() => {
    const visible = yearScoped
    const grouped = groupByProject(entries, visible)
    const map = new Map(grouped.map((r) => [r.project?.id || 'none', r]))
    const all = visible.map((p) => map.get(p.id) || { project: p, sale: 0, purchase: 0, opex: 0, gross: 0, profit: 0, margin: null, count: 0 })
    const filtered = statusFilter === 'all' ? all : all.filter((r) => r.project.status === statusFilter)
    // 기간순: 시작일 기준. 시작일 없으면 등록순. 시작일 없는 건 뒤로 보냅니다.
    const dir = sortOrder === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const da = a.project.start_date || ''
      const db = b.project.start_date || ''
      if (!da && !db) {
        return dir * String(a.project.created_at || '').localeCompare(String(b.project.created_at || ''))
      }
      if (!da) return 1
      if (!db) return -1
      if (da !== db) return dir * da.localeCompare(db)
      return dir * String(a.project.created_at || '').localeCompare(String(b.project.created_at || ''))
    })
  }, [entries, yearScoped, statusFilter, sortOrder])

  const statusCounts = useMemo(() => {
    const counts = { all: yearScoped.length }
    for (const p of yearScoped) counts[p.status] = (counts[p.status] || 0) + 1
    return counts
  }, [yearScoped])

  const vendorsByProject = useMemo(() => {
    const partnerById = new Map((partners || []).map((p) => [p.id, p]))
    const map = new Map()
    for (const l of links || []) {
      if (!map.has(l.project_id)) map.set(l.project_id, [])
      const p = partnerById.get(l.partner_id)
      map.get(l.project_id).push(p ? p.name : '')
    }
    return map
  }, [links, partners])

  const totals = useMemo(() => summarize(entries), [entries])
  /* 표시용 금액(부가세포함 모드에서는 계약서 대조용으로 세액 합산).
     이익·이익률은 세무 기준(공급가액)으로 항상 고정합니다. */
  const totalsSale = totals.revenue + (incl ? totals.sale.vat : 0)
  const totalsCogs = totals.cogs + (incl ? totals.purchase.vat : 0)
  const totalsExpense = totals.expense + (incl ? totals.opex.vat : 0)
  const totalsGross = totals.gross
  const totalsProfit = totals.profit
  const basisHint = incl ? '금액은 부가세포함(계약서 대조용) · 이익은 공급가액 기준' : '공급가액 기준'
  const maxSale = Math.max(1, ...rows.map((r) => Math.max(dispSale(r), Math.abs(r.profit))))

  /* 대행계약 (대표만): 계약만 하고 행사는 업체가 진행, 수수료 수취 */
  const [viewTab, setViewTab] = useState('projects')
  const [dealInitial, setDealInitial] = useState(null)
  const agencyRows = useMemo(() => {
    const partnerById = new Map((partners || []).map((p) => [p.id, p]))
    const projectById = new Map((projects || []).filter((p) => !p.is_hidden).map((p) => [p.id, p]))
    const paidByProjectName = new Map()
    for (const e of entries || []) {
      if (e.entry_type !== 'purchase' || !e.project_id) continue
      const key = `${e.project_id}||${normalizeVendorName(e.counterparty)}`
      paidByProjectName.set(key, (paidByProjectName.get(key) || 0) + Number(e.total_amount || 0))
    }
    const byAgency = new Map()
    for (const l of links || []) {
      if ((l.role || '협력') !== '대행') continue
      const p = partnerById.get(l.partner_id)
      const project = projectById.get(l.project_id)
      if (!p || !project) continue
      if (!byAgency.has(p.id)) byAgency.set(p.id, { partner: p, deals: [], contract: 0, paid: 0 })
      /* 대행은 부가세포함가 기준 (구글시트와 동일) */
      const contract = Number(project.contract_amount || 0)
      const paid = paidByProjectName.get(`${project.id}||${normalizeVendorName(p.name)}`) || 0
      const deal = { project, agencyId: p.id, agencyName: p.name, contract, paid, fee: contract - paid }
      const row = byAgency.get(p.id)
      row.deals.push(deal)
      row.contract += deal.contract
      row.paid += deal.paid
    }
    return [...byAgency.values()]
      .map((r) => ({ ...r, fee: r.contract - r.paid, deals: r.deals.sort((a, b) => b.contract - a.contract) }))
      .sort((a, b) => b.fee - a.fee)
  }, [links, partners, projects, entries])
  const agencyTotals = useMemo(
    () => agencyRows.reduce((a, r) => ({ contract: a.contract + r.contract, paid: a.paid + r.paid, fee: a.fee + r.fee }), { contract: 0, paid: 0, fee: 0 }),
    [agencyRows],
  )

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deleteProject(removing.id)
      toast.success('프로젝트가 삭제되었습니다. 연결된 장부는 유지됩니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="프로젝트"
        description="세무·회계 기준으로 순매출액 − 매출원가 = 매출총이익, − 경비 = 영업이익을 자동 집계합니다. 금액은 프로젝트 전체 기간 기준입니다."
      >
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Icon name="plus" size={16} />
          프로젝트 등록
        </button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="프로젝트 수"
          value={String(yearScoped.length)}
          unit="개"
          tone="neutral"
          icon="folder"
          hint={yearFilter ? `${yearFilter}년` : '전체 연도'}
        />
        {isAdmin ? (
          <>
            <StatCard label="순매출액" value={totalsSale} tone="sale" icon="trending-up" hint={basisHint} />
            <StatCard label="매출총이익" value={totalsGross} tone={totalsGross >= 0 ? 'profit' : 'loss'} icon="chart" hint={totals.revenue ? `매출총이익률 ${formatPercent(totals.grossMargin)}` : '매출 없음'} />
            <StatCard
              label="영업이익"
              value={totalsProfit}
              tone={totalsProfit >= 0 ? 'profit' : 'loss'}
              icon="coins"
              hint={totals.revenue ? `영업이익률 ${formatPercent(totals.operatingMargin)}` : '매출 없음'}
            />
          </>
        ) : (
          <>
            <StatCard label="전체 비용" value={totalsCogs + totalsExpense} tone="opex" icon="cart" hint={`매입 + 운영비 · ${basisHint}`} />
            <StatCard label="진행중" value={String(statusCounts.active || 0)} unit="개" tone="neutral" icon="folder" />
            <StatCard label="완료" value={String(statusCounts.done || 0)} unit="개" tone="neutral" icon="check" />
          </>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-ink-200 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin ? (
              <SegmentedControl
                size="sm"
                value={viewTab}
                onChange={setViewTab}
                options={[
                  { key: 'projects', label: '프로젝트' },
                  { key: 'agency', label: `대행계약${agencyRows.length ? ` ${agencyRows.length}` : ''}` },
                ]}
              />
            ) : null}
            <SegmentedControl
              size="sm"
              value={statusFilter}
              onChange={setStatusFilter}
            options={[
              { key: 'active', label: `진행중 ${statusCounts.active || 0}` },
              { key: 'proposal', label: `${PROJECT_STATUS.proposal.label} ${statusCounts.proposal || 0}` },
              { key: 'done', label: `완료 ${statusCounts.done || 0}` },
              { key: 'dropped', label: `${PROJECT_STATUS.dropped.label} ${statusCounts.dropped || 0}` },
              { key: 'all', label: `전체 ${statusCounts.all || 0}` },
            ]}
          />
            <SegmentedControl
              size="sm"
              value={sortOrder}
              onChange={setSortOrder}
              options={[
                { key: 'desc', label: '최신순' },
                { key: 'asc', label: '과거순' },
              ]}
            />
            <SegmentedControl
              size="sm"
              value={vatMode}
              onChange={setVatMode}
              options={[
                { key: 'supply', label: '공급가액' },
                { key: 'incl', label: '부가세포함' },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink-500">연도</span>
            <div className="inline-flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setYearFilter('')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  yearFilter === ''
                    ? 'bg-brand-600 text-white'
                    : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                }`}
              >
                전체
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYearFilter(y)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    yearFilter === y
                      ? 'bg-brand-600 text-white'
                      : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-ink-400">
              연도는 프로젝트를 고르는 기준입니다. 카드 금액은 항상 전체 기간 기준입니다.
              {incl ? ' · 부가세포함 보기는 계약서 대조용 금액 표시이며, 이익·이익률은 항상 공급가액 기준입니다.' : ''}
            </span>
          </div>
        </div>
      </div>

      {isAdmin && viewTab === 'agency' ? (
        agencyRows.length ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="대행계약" value={String(agencyRows.reduce((a, r) => a + r.deals.length, 0))} unit="건" tone="neutral" icon="building" />
              <StatCard label="대행 계약" value={agencyTotals.contract} tone="sale" icon="trending-up" hint="부가세포함 기준" />
              <StatCard label="업체 지급" value={agencyTotals.paid} tone="opex" icon="cart" hint="해당 업체명 매입 합계" />
              <StatCard label="수수료" value={agencyTotals.fee} tone={agencyTotals.fee >= 0 ? 'profit' : 'loss'} icon="coins" hint="계약 − 지급" />
            </div>
            <p className="text-xs leading-relaxed text-ink-500">
              계약만 하고 행사는 업체가 진행하는 건입니다. 여성기업·소기업 수의계약 한도는 5,500만원입니다.
              총계약금이 들어오면 수수료만 매출로 잡고, 나머지는 대행업체에 전달합니다.
            </p>
            <div>
              <button type="button" className="btn-primary" onClick={() => setDealInitial({})}>
                <Icon name="plus" size={16} />
                대행계약 등록
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {agencyRows.flatMap((a) =>
                a.deals.map((d) => (
                  <article key={d.project.id} className="card flex flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="chip bg-amber-100 text-amber-800">대행계약</span>
                        </div>
                        <Link
                          to={`/projects/${d.project.id}`}
                          className="mt-2 block truncate text-base font-bold text-ink-900 hover:text-brand-700"
                        >
                          {d.project.name}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          {d.project.client || '발주처 미지정'}
                          {d.project.referrer ? ` · 연결자 ${d.project.referrer}` : ''}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          수행 {d.agencyName}
                          {d.project.start_date
                            ? ` · ${formatDateHuman(d.project.start_date)}${d.project.end_date ? ` ~ ${formatDateHuman(d.project.end_date)}` : ''}`
                            : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDealInitial({ project: d.project, partnerId: d.agencyId })}
                        className="shrink-0 rounded-md px-1.5 py-1.5 text-xs font-semibold text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                        title="대행계약 수정"
                      >
                        수정
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3 text-right">
                      <div>
                        <p className="text-[11px] text-ink-400">계약</p>
                        <p className="font-num text-sm font-extrabold tabular-nums text-ink-900">{formatKRW(d.contract)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-ink-400">업체 지급</p>
                        <p className="font-num text-sm font-extrabold tabular-nums text-ink-500">
                          {d.paid ? formatKRW(d.paid) : '0'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-ink-400">수수료</p>
                        <p className={`font-num text-sm font-extrabold tabular-nums ${d.fee >= 0 ? 'text-emerald-700' : 'text-loss'}`}>
                          {formatKRW(d.fee)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end">
                      <Link
                        to={`/projects/${d.project.id}`}
                        className="text-xs font-semibold text-brand-700 hover:underline"
                      >
                        상세 →
                      </Link>
                    </div>
                  </article>
                )),
              )}
            </div>
          </div>
        ) : (
          <div className="card">
            <EmptyState
              icon="building"
              title="대행계약이 없습니다"
              description="프로젝트 상세 → 협력업체에서 업체를 대행계약으로 지정하세요."
            />
          </div>
        )
      ) : loading ? (
        <LoadingBlock />
      ) : !visibleProjects.length ? (
        <div className="card">
          <EmptyState
            icon="folder"
            title="등록된 프로젝트가 없습니다"
            description="프로젝트를 만들면 매출·비용을 연결해 손익을 볼 수 있습니다."
            action={
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Icon name="plus" size={16} />
                프로젝트 등록
              </button>
            }
          />
        </div>
      ) : !rows.length ? (
        <div className="card">
          <EmptyState
            icon="folder"
            title="조건에 맞는 프로젝트가 없습니다"
            description={`${yearFilter ? `${yearFilter}년에 활동한` : ''} 프로젝트 중 ${PROJECT_STATUS[statusFilter]?.label || ''} 상태가 없습니다. 연도나 상태를 바꿔 보세요.`}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.slice(0, visibleCount).map((row) => {
            const project = row.project
            const status = PROJECT_STATUS[project.status] || PROJECT_STATUS.active
            /* 계약 대비 매출은 같은 기준으로 비교해야 맞습니다 */
            const csplit = contractSplit(project)
            const baseSupply = incl ? csplit.total : csplit.supply
            const baseSale = incl ? dispSale(row) : row.sale
            const achieved = baseSupply > 0 ? (baseSale / baseSupply) * 100 : null

            // 제안서·미진행은 장부 집계 대신 제안 정보 위주로 보여줍니다.
            if (project.status === 'proposal' || project.status === 'dropped') {
              return (
                <ProposalCard
                  key={project.id}
                  project={project}
                  row={row}
                  status={status}
                  isAdmin={isAdmin}
                  managerName={managerName(project.manager_id)}
                  onEdit={() => {
                    setEditing(project)
                    setFormOpen(true)
                  }}
                  onDelete={() => setRemoving(project)}
                />
              )
            }

            return (
              <article key={project.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`chip ${status.chip}`}>{status.label}</span>
                    </div>
                    <Link
                      to={`/projects/${project.id}`}
                      className="mt-2 block truncate text-base font-bold text-ink-900 hover:text-brand-700"
                    >
                      {project.name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {project.client || '발주처 미지정'}
                      {project.start_date
                        ? ` · ${formatDateHuman(project.start_date)}${project.end_date ? ` ~ ${formatDateHuman(project.end_date)}` : ''}`
                        : ''}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {managerName(project.manager_id)
                        ? `담당 ${managerName(project.manager_id)}`
                        : '담당 미지정'}
                      {project.venue ? ` · ${project.venue}` : ''}
                      {managerName(project.created_by) ? ` · 등록 ${managerName(project.created_by)}` : ''}
                    </p>
                    {csplit.total > 0 ? (
                      <p className="mt-0.5 truncate text-xs font-semibold text-ink-700">
                        계약 {formatKRW(csplit.supply)}원
                        <span className="font-normal text-ink-400"> (합계 {formatKRW(csplit.total)}원)</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {isAdmin ? (
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-loss"
                        onClick={() => setRemoving(project)}
                        aria-label="삭제"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    ) : null}
                  </div>
                </div>

                <PnlGrid
                  pnl={buildPnl(row.sale, row.purchase, row.opex)}
                  achieved={achieved}
                  contractAmount={incl ? csplit.total : csplit.supply}
                  showContract
                  bare={!isAdmin}
                />

                {!isAdmin ? null : (
                  <div className="mt-3">
                    <ProfitBar value={Math.abs(row.profit)} max={maxSale} tone={row.profit >= 0 ? 'profit' : 'loss'} />
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                  <span>
                    거래 {row.count}건 · 전체 기간 기준
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-expanded={Boolean(expandedVendors[project.id])}
                      onClick={() =>
                        setExpandedVendors((m) => ({ ...m, [project.id]: !m[project.id] }))
                      }
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      협력업체{(vendorsByProject.get(project.id) || []).length
                        ? ` ${(vendorsByProject.get(project.id) || []).length}`
                        : ''}
                      {expandedVendors[project.id] ? ' ▲' : ' ▼'}
                    </button>
                    <Link
                      to={`/projects/${project.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      상세 →
                    </Link>
                  </span>
                </div>
                {expandedVendors[project.id] ? (
                  <div className="mt-2 rounded-lg bg-ink-50/80 px-3 py-2.5">
                    {(vendorsByProject.get(project.id) || []).filter(Boolean).length ? (
                      <ul className="flex flex-col gap-1">
                        {(vendorsByProject.get(project.id) || [])
                          .filter(Boolean)
                          .map((name) => (
                            <li key={name}>
                              <Link
                                to={`/partners?search=${encodeURIComponent(name)}`}
                                className="text-xs font-semibold text-ink-700 hover:text-brand-700 hover:underline"
                              >
                                {name}
                              </Link>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-ink-400">
                        연결된 거래처가 없습니다.{' '}
                        <Link
                          to={`/projects/${project.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          상세 협력업체 탭에서 연결 →
                        </Link>
                      </p>
                    )}
                  </div>
                ) : null}
              </article>
            )
          })}
          {rows.length > visibleCount ? (
            <div className="col-span-full flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 24)}
                className="btn-ghost"
              >
                더 보기 ({rows.length - visibleCount}개 남음)
              </button>
            </div>
          ) : null}
        </div>
      )}

      <ProjectFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSaved={() => setReloadKey((k) => k + 1)}
        initial={editing}
        profiles={profiles}
        userId={user?.id}
      />

      {isAdmin && dealInitial ? (
        <AgencyDealModal
          partners={partners}
          userId={user?.id}
          initial={dealInitial.project ? dealInitial : null}
          onClose={() => setDealInitial(null)}
          onSaved={() => {
            setDealInitial(null)
            setReloadKey((k) => k + 1)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="프로젝트를 삭제하시겠습니까?"
        message={
          removing
            ? `"${removing.name}" 을(를) 삭제합니다.\n장부에 입력된 매출·비용은 삭제되지 않고 '프로젝트 미지정'으로 남습니다.`
            : ''
        }
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

/**
 * 대행계약 등록 (대표 전용).
 * 행사이름·발주처·대행업체·총계약·수수료를 받아 프로젝트(계약=수수료) +
 * 대행 연결 + 수수료 매출까지 한 번에 만듭니다. 없는 업체는 거래처에서 먼저 등록하세요.
 */
function AgencyDealModal({ partners, userId, initial = null, onClose, onSaved }) {
  const toast = useToast()
  const parseTotalRate = (memo) => {
    const t = String(memo || '').match(/총계약 ([\d,]+)원/)
    const r = String(memo || '').match(/수수료 ([\d.]+)%/)
    return { total: t ? t[1].replace(/,/g, '') : '', rate: r ? r[1] : '3' }
  }
  const initParsed = initial?.project ? parseTotalRate(initial.project.memo) : { total: '', rate: '3' }
  const initAgencyName = (() => {
    if (!initial?.partnerId) return ''
    return (partners || []).find((p) => p.id === initial.partnerId)?.name || ''
  })()
  const [form, setForm] = useState({
    name: initial?.project?.name || '',
    client: initial?.project?.client || '',
    agencyName: initAgencyName,
    total: initParsed.total,
    rate: initParsed.rate,
    fee: initial?.project?.contract_amount ? String(initial.project.contract_amount) : '',
    start: initial?.project?.start_date || '',
    end: initial?.project?.end_date || '',
    referrer: initial?.project?.referrer || '',
    memo: initial?.project?.memo || '',
  })
  const [feeTouched, setFeeTouched] = useState(Boolean(initial))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key, transform) => (e) => {
    const v = transform ? transform(e.target.value) : e.target.value
    setForm((f) => {
      const next = { ...f, [key]: v }
      if ((key === 'total' || key === 'rate') && !feeTouched) {
        const t = Number(String(next.total).replace(/[^0-9]/g, '')) || 0
        const r = Number(next.rate) || 0
        // 수수료율은 공급가액 기준이라 VAT를 얹어 계산 (2025년 대행계약 시트와 동일).
        // VAT 제외 특약이면 수수료를 직접 고치세요 (고치면 자동 계산이 멈춥니다).
        next.fee = t && r ? String(Math.round(((t * r) / 100) * 1.1)) : ''
      }
      return next
    })
  }
  const feeNum = Number(String(form.fee).replace(/[^0-9]/g, '')) || 0
  const totalNum = Number(String(form.total).replace(/[^0-9]/g, '')) || 0

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('행사이름을 입력해 주세요.')
    if (!form.client.trim()) return setError('발주처를 입력해 주세요.')
    if (!form.agencyName.trim()) return setError('대행업체를 입력해 주세요.')
    setSaving(true)
    setError('')
    try {
      const allPartners = await listPartners().catch(() => partners)
      const target = normalizeVendorName(form.agencyName.trim())
      const partner = (allPartners || []).find((p) => normalizeVendorName(p.name) === target)
      if (!partner) return setError('대행업체를 먼저 등록해 주세요 (입력창에서 + 새로 등록).')
      if (initial?.project?.id) {
        await updateProject(initial.project.id, {
          name: form.name.trim(),
          client: form.client.trim(),
          start_date: form.start || null,
          end_date: form.end || null,
          contract_amount: feeNum,
          referrer: form.referrer.trim(),
          memo: form.memo.trim(),
        })
        if (initial.partnerId && initial.partnerId !== partner.id) {
          await unlinkProjectPartner(initial.project.id, initial.partnerId).catch(() => {})
        }
        await linkProjectPartner(initial.project.id, partner.id, userId, '대행')
        toast.success('대행계약을 수정했습니다. 수수료 매출 행은 금액이 바뀌었으면 따로 고쳐주세요.')
        onSaved?.()
        return
      }
      const project = await createProject({
        name: form.name.trim(),
        client: form.client.trim(),
        venue: '',
        status: 'active',
        start_date: form.start || null,
        end_date: form.end || null,
        contract_amount: feeNum,
        referrer: form.referrer.trim(),
        memo: [
          `대행계약: 총계약 ${formatKRW(totalNum)}원 중 수수료 ${form.rate || 0}%만 매출.`,
          `수행 ${partner.name} (나머지 ${formatKRW(totalNum - feeNum)}원 전달).`,
          String(form.memo || '').trim(),
        ]
          .filter(Boolean)
          .join('\n'),
      })
      await linkProjectPartner(project.id, partner.id, userId, '대행')
      let clientMissing = false
      if (form.client.trim()) {
        const all2 = await listPartners().catch(() => partners)
        clientMissing = !(all2 || []).some(
          (p) => normalizeVendorName(p.name) === normalizeVendorName(form.client.trim()),
        )
      }
      if (feeNum > 0) {
        const supply = Math.round(feeNum / 1.1)
        await createEntry(
          {
            entry_date: form.start || new Date().toISOString().slice(0, 10),
            counterparty: form.client.trim(),
            project_id: project.id,
            category: '용역매출',
            description: `대행 수수료 (총계약 ${formatKRW(totalNum)}원의 ${form.rate || 0}%)`,
            supply_amount: supply,
            vat_amount: feeNum - supply,
            payment_method: '계좌이체',
            memo: '대행계약 수수료만 매출',
            entry_type: 'sale',
          },
          userId,
        )
      }
      toast.success(
        clientMissing
          ? '대행계약을 등록했습니다. 발주처는 목록에서 + 새로 등록으로 추가해 주세요.'
          : '대행계약을 등록했습니다.',
      )
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title="대행계약 등록"
      subtitle="계약은 수수료만 매출로 잡고, 나머지는 대행업체 전달금입니다."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" form="agency-deal-form" className="btn-primary" disabled={saving}>
            {saving ? '저장 중…' : '등록'}
          </button>
        </>
      }
    >
      <form id="agency-deal-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error ? (
          <div className="sm:col-span-2">
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        ) : null}
        <Field label="행사이름" required className="sm:col-span-2">
          <input className="input" value={form.name} onChange={set('name')} placeholder="예: BMICE 인증제 관광 개발 컨설팅 및 운영" />
        </Field>
        <Field label="발주처 (원청)" required>
          <PartnerPicker value={form.client} onChange={set('client')} placeholder="예: 부산관광고등학교" userId={userId} />
        </Field>
        <Field label="대행업체 (실제 수행사)" required hint="치면 검색되고, 없으면 + 새로 등록으로 추가하세요">
          <PartnerPicker value={form.agencyName} onChange={set('agencyName')} placeholder="예: (사)부산컨벤션산업협회" userId={userId} />
        </Field>
        <Field label="총계약액 (원, VAT포함)" hint="대행업체에 전달되는 금액 포함 전체">
          <AmountInput
            className="input text-right font-num tabular-nums"
            value={form.total}
            onChange={set('total')}
            placeholder="예: 49000000"
          />
        </Field>
        <Field label="수수료율 (%)" hint="공급가액 기준. VAT 포함 수수료로 자동 계산됩니다">
          <input
            type="text"
            inputMode="decimal"
            className="input text-right font-num tabular-nums"
            value={form.rate}
            onChange={set('rate')}
            placeholder="3"
          />
        </Field>
        <Field label="수수료 (원, VAT포함)" hint="장부 계약금액·매출이 됩니다. VAT 제외 특약이면 직접 고치세요" className="sm:col-span-2">
          <AmountInput
            className="input text-right font-num tabular-nums"
            value={form.fee}
            onChange={(e) => {
              setFeeTouched(true)
              set('fee')(e)
            }}
            placeholder="예: 1617000"
          />
        </Field>
        <Field label="시작일">
          <input type="date" className="input" value={form.start} onChange={set('start')} />
        </Field>
        <Field label="종료일">
          <input type="date" className="input" value={form.end} onChange={set('end')} />
        </Field>
        <Field label="연결자" hint="이 건을 연결해준 분 (예: 협회 담당자)">
          <input
            className="input"
            value={form.referrer}
            onChange={set('referrer')}
            placeholder="예: 정가희 국장(부산컨벤션산업협회)"
          />
        </Field>
        <Field label="메모" className="sm:col-span-2">
          <textarea className="input min-h-[64px] resize-y" value={form.memo} onChange={set('memo')} />
        </Field>
      </form>
    </Modal>
  )
}

function ProposalCard({ project, row, status, isAdmin, managerName, onEdit, onDelete }) {  /* 제안서·미진행도 손익은 장부에서 자동 계산합니다.
     제안 준비에 쓴 부대비용은 잡히고 매출은 없으므로 영업이익이 그대로(-) 손실이 됩니다.
     매출이 없으면 이익률은 산출할 수 없어 '—'로 둡니다. */
  const pnl = buildPnl(row?.sale, row?.purchase, row?.opex)
  return (
    <article className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${status.chip}`}>{status.label}</span>
          </div>
          <Link
            to={`/projects/${project.id}`}
            className="mt-2 block truncate text-base font-bold text-ink-900 hover:text-brand-700"
          >
            {project.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-ink-500">
            {project.client || '발주처 미지정'}
            {project.start_date
              ? ` · ${formatDateHuman(project.start_date)}${project.end_date ? ` ~ ${formatDateHuman(project.end_date)}` : ''}`
              : ''}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-500">
            {managerName ? `담당 ${managerName}` : '담당 미지정'}
            {project.venue ? ` · ${project.venue}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isAdmin ? (
            <button
              type="button"
              className="rounded-md p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-loss"
              onClick={onDelete}
              aria-label="삭제"
            >
              <Icon name="trash" size={15} />
            </button>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-ink-50/80 p-3 text-center">
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">제안 금액</dt>
          <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
            {project.contract_amount > 0 ? formatKRW(project.contract_amount) : '—'}
          </dd>
        </div>
        {isAdmin ? (
          <>
            <div>
              <dt className="text-[11px] font-semibold text-ink-500">매출총이익</dt>
              <dd
                className={`mt-0.5 font-num text-sm font-extrabold tabular-nums ${
                  pnl.gross < 0 ? 'text-loss' : 'text-ink-900'
                }`}
              >
                {pnl.gross ? formatKRW(pnl.gross) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-ink-500">영업이익</dt>
              <dd
                className={`mt-0.5 font-num text-sm font-extrabold tabular-nums ${
                  pnl.operating < 0 ? 'text-loss' : 'text-ink-900'
                }`}
              >
                {pnl.operating ? formatKRW(pnl.operating) : '—'}
              </dd>
            </div>
          </>
        ) : (
          <div className="col-span-2">
            <dt className="text-[11px] font-semibold text-ink-500">투입 비용</dt>
            <dd className="mt-0.5 font-num text-sm font-extrabold tabular-nums text-ink-900">
              {formatKRW(pnl.cogs + pnl.expense)}
            </dd>
          </div>
        )}
      </dl>
      {row.count ? (
        <p className="mt-2 text-[11px] text-ink-500">
          장부 {row.count}건 기준
          {isAdmin ? (
            <>
              {' '}· 순매출 {formatKRW(pnl.revenue)}원 − 매출원가 {formatKRW(pnl.cogs)}원 − 경비{' '}
              {formatKRW(pnl.expense)}원
              {pnl.operating < 0 ? ' · 제안 부대비용 때문에 영업손실입니다.' : ''}
            </>
          ) : (
            <> · 매출원가 {formatKRW(pnl.cogs)}원 + 경비 {formatKRW(pnl.expense)}원</>
          )}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-ink-500">
          아직 장부에 내역이 없어 영업이익은 0원입니다. 매출·비용을 입력하면 자동 계산됩니다.
        </p>
      )}

      {project.memo ? (
        <p className="mt-3 line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-ink-500">
          {project.memo}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-end">
        <Link to={`/projects/${project.id}`} className="text-xs font-semibold text-brand-700 hover:underline">
          상세 →
        </Link>
      </div>
    </article>
  )
}
