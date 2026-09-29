import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import ProjectFormModal from '../components/ProjectFormModal'
import { ProfitBar } from '../components/Charts'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, LoadingBlock, PageHeader, SegmentedControl, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { PROJECT_STATUS } from '../lib/constants'
import { contractSplit, formatDateHuman, formatKRW, formatPercent, normalizeVendorName } from '../lib/format'
import { buildPnl, groupByProject, summarize } from '../lib/summary'
import { deleteProject, isMissingTableError, listEntries, listPartners, listProfiles, listProjectPartners, listProjects } from '../lib/api'

/**
 * 카드에 쓰는 손익 표기. 세무·회계 표현을 그대로 씁니다.
 * 직원 화면(bare)에서는 매출·이익을 숨기고 비용만 보여줍니다.
 */
function PnlGrid({ pnl, achieved, contractAmount, showContract, bare = false }) {
  if (bare) {
    return (
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
    return filtered.sort((a, b) => {
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
  const maxSale = Math.max(1, ...rows.map((r) => Math.max(r.sale, Math.abs(r.profit))))

  /* 대행업체 (대표만): 계약만 하고 행사는 업체가 진행, 수수료 수취 */
  const [viewTab, setViewTab] = useState('projects')
  const agencyRows = useMemo(() => {
    const partnerById = new Map((partners || []).map((p) => [p.id, p]))
    const projectById = new Map((projects || []).filter((p) => !p.is_hidden).map((p) => [p.id, p]))
    const paidByProjectName = new Map()
    for (const e of entries || []) {
      if (e.entry_type !== 'purchase' || !e.project_id) continue
      const key = `${e.project_id}||${normalizeVendorName(e.counterparty)}`
      paidByProjectName.set(key, (paidByProjectName.get(key) || 0) + Number(e.supply_amount || 0))
    }
    const byAgency = new Map()
    for (const l of links || []) {
      if ((l.role || '협력') !== '대행') continue
      const p = partnerById.get(l.partner_id)
      const project = projectById.get(l.project_id)
      if (!p || !project) continue
      if (!byAgency.has(p.id)) byAgency.set(p.id, { partner: p, deals: [], contract: 0, paid: 0 })
      const csplit = contractSplit(project)
      const paid = paidByProjectName.get(`${project.id}||${normalizeVendorName(p.name)}`) || 0
      const deal = { project, contract: csplit.supply, paid, fee: csplit.supply - paid }
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
            <StatCard label="순매출액" value={totals.revenue} tone="sale" icon="trending-up" hint="공급가액 기준" />
            <StatCard label="매출총이익" value={totals.gross} tone={totals.gross >= 0 ? 'profit' : 'loss'} icon="chart" hint={totals.grossMargin === null ? '매출 없음' : `매출총이익률 ${formatPercent(totals.grossMargin)}`} />
            <StatCard
              label="영업이익"
              value={totals.operating}
              tone={totals.operating >= 0 ? 'profit' : 'loss'}
              icon="coins"
              hint={totals.operatingMargin === null ? '매출 없음' : `영업이익률 ${formatPercent(totals.operatingMargin)}`}
            />
          </>
        ) : (
          <>
            <StatCard label="전체 비용" value={totals.cost} tone="opex" icon="cart" hint="매입 + 운영비" />
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
                  { key: 'agency', label: `대행업체${agencyRows.length ? ` ${agencyRows.length}` : ''}` },
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
            </span>
          </div>
        </div>
      </div>

      {isAdmin && viewTab === 'agency' ? (
        agencyRows.length ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="대행업체" value={String(agencyRows.length)} unit="곳" tone="neutral" icon="building" />
              <StatCard label="대행 계약" value={agencyTotals.contract} tone="sale" icon="trending-up" hint="공급가액 기준" />
              <StatCard label="업체 지급" value={agencyTotals.paid} tone="opex" icon="cart" hint="해당 업체명 매입 합계" />
              <StatCard label="수수료" value={agencyTotals.fee} tone={agencyTotals.fee >= 0 ? 'profit' : 'loss'} icon="coins" hint="계약 − 지급" />
            </div>
            <p className="text-xs leading-relaxed text-ink-500">
              계약만 하고 행사는 업체가 진행하는 건입니다. 여성기업·소기업 수의계약 한도는 5,500만원입니다.
            </p>
            {agencyRows.map((a) => (
              <section key={a.partner.id} className="card overflow-hidden">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
                  <Link
                    to={`/partners?search=${encodeURIComponent(a.partner.name)}`}
                    className="text-sm font-bold text-ink-900 hover:text-brand-700 hover:underline"
                  >
                    {a.partner.name}
                  </Link>
                  <p className="text-xs text-ink-500">
                    계약 <strong className="font-num tabular-nums text-ink-900">{formatKRW(a.contract)}원</strong>
                    {' · '}수수료{' '}
                    <strong className={`font-num tabular-nums ${a.fee >= 0 ? 'text-emerald-700' : 'text-loss'}`}>
                      {formatKRW(a.fee)}원
                    </strong>
                  </p>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-xs">
                    <thead className="bg-ink-50/70">
                      <tr>
                        <th className="th">프로젝트</th>
                        <th className="th text-right">계약(공급가)</th>
                        <th className="th text-right">업체 지급</th>
                        <th className="th text-right">수수료</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {a.deals.map((d) => (
                        <tr key={d.project.id} className="transition hover:bg-ink-50/60">
                          <td className="td font-medium">
                            <Link to={`/projects/${d.project.id}`} className="text-ink-800 hover:text-brand-700 hover:underline">
                              {d.project.name}
                            </Link>{' '}
                            <span className="chip bg-emerald-50 text-emerald-700">수의계약</span>
                          </td>
                          <td className="td num">{formatKRW(d.contract)}</td>
                          <td className="td num text-ink-500">
                            {d.paid ? formatKRW(d.paid) : <span className="text-ink-300" title="장부 거래처명이 다르면 0으로 뜹니다">0 · 명칭확인</span>}
                          </td>
                          <td className={`td num font-bold ${d.fee >= 0 ? 'text-emerald-700' : 'text-loss'}`}>
                            {formatKRW(d.fee)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              icon="building"
              title="대행업체가 없습니다"
              description="프로젝트 상세 → 협력업체에서 업체를 대행으로 지정하세요."
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
          {rows.map((row) => {
            const project = row.project
            const status = PROJECT_STATUS[project.status] || PROJECT_STATUS.active
            /* 계약 대비 매출은 공급가액끼리 비교해야 맞습니다 */
            const csplit = contractSplit(project)
            const achieved = csplit.supply > 0 ? (row.sale / csplit.supply) * 100 : null

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
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                      onClick={() => {
                        setEditing(project)
                        setFormOpen(true)
                      }}
                      aria-label="수정"
                    >
                      <Icon name="pencil" size={15} />
                    </button>
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
                  contractAmount={csplit.supply}
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

function ProposalCard({ project, row, status, isAdmin, managerName, onEdit, onDelete }) {
  /* 제안서·미진행도 손익은 장부에서 자동 계산합니다.
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
          <button
            type="button"
            className="rounded-md p-1.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
            onClick={onEdit}
            aria-label="수정"
          >
            <Icon name="pencil" size={15} />
          </button>
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
