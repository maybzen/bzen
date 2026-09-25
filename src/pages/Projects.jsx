import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import ProjectFormModal from '../components/ProjectFormModal'
import { ProfitBar } from '../components/Charts'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, LoadingBlock, PageHeader, SegmentedControl, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { PROJECT_STATUS } from '../lib/constants'
import { formatDateHuman, formatKRW, formatPercent } from '../lib/format'
import { groupByProject, summarize } from '../lib/summary'
import { deleteProject, listEntries, listProfiles, listProjects } from '../lib/api'

export default function Projects() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const period = usePeriod('thisYear', 'bzen.period.projects')

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [profiles, setProfiles] = useState([])

  const managerName = (id) => profiles.find((p) => p.id === id)?.full_name || ''
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [statusFilter, setStatusFilter] = useState('active')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [projectRows, entryRows, profileRows] = await Promise.all([
        listProjects(),
        listEntries({ from: period.range.from, to: period.range.to }),
        listProfiles(),
      ])
      setProjects(projectRows)
      setEntries(entryRows)
      setProfiles(profileRows)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [period.range.from, period.range.to, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 내부 귀속용(비젠내부·비젠채용)은 목록에서 숨기고 선택지에는 둡니다.
  const visibleProjects = useMemo(() => projects.filter((p) => !p.is_hidden), [projects])

  const rows = useMemo(() => {
    const visible = visibleProjects
    const grouped = groupByProject(entries, visible)
    const map = new Map(grouped.map((r) => [r.project?.id || 'none', r]))
    const all = visible.map((p) => map.get(p.id) || { project: p, sale: 0, purchase: 0, opex: 0, profit: 0, margin: null, count: 0 })
    const filtered = statusFilter === 'all' ? all : all.filter((r) => r.project.status === statusFilter)
    // 최신순: 시작일 내림차순 (없으면 등록순)
    return filtered.sort((a, b) => {
      const da = a.project.start_date || ''
      const db = b.project.start_date || ''
      if (da !== db) return db.localeCompare(da)
      return String(b.project.created_at || '').localeCompare(String(a.project.created_at || ''))
    })
  }, [entries, visibleProjects, statusFilter])

  const statusCounts = useMemo(() => {
    const counts = { all: visibleProjects.length }
    for (const p of visibleProjects) counts[p.status] = (counts[p.status] || 0) + 1
    return counts
  }, [visibleProjects])

  const totals = useMemo(() => summarize(entries), [entries])
  const maxSale = Math.max(1, ...rows.map((r) => Math.max(r.sale, Math.abs(r.profit))))

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
      <PageHeader title="프로젝트" description="프로젝트별 매출·비용·수익을 자동으로 집계합니다.">
        <PeriodPicker period={period} />
        {isAdmin ? (
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
        ) : null}
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="프로젝트 수" value={String(visibleProjects.length)} unit="개" tone="neutral" icon="folder" />
        <StatCard label="전체 매출" value={totals.revenue} tone="sale" icon="trending-up" />
        <StatCard label="전체 비용" value={totals.cost} tone="opex" icon="cart" />
        <StatCard
          label="전체 영업이익"
          value={totals.profit}
          tone={totals.profit >= 0 ? 'profit' : 'loss'}
          icon="coins"
          hint={totals.margin === null ? '' : `이익률 ${formatPercent(totals.margin)}`}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 px-4 py-3.5">
          <SegmentedControl
            size="sm"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { key: 'active', label: `진행중 ${statusCounts.active || 0}` },
              { key: 'proposal', label: `제안서 ${statusCounts.proposal || 0}` },
              { key: 'done', label: `완료 ${statusCounts.done || 0}` },
              { key: 'dropped', label: `탈락 ${statusCounts.dropped || 0}` },
              { key: 'all', label: `전체 ${statusCounts.all || 0}` },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : !visibleProjects.length ? (
        <div className="card">
          <EmptyState
            icon="folder"
            title="등록된 프로젝트가 없습니다"
            description="프로젝트를 만들면 매출·비용을 연결해 수익을 볼 수 있습니다."
            action={
              isAdmin ? (
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
              ) : null
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => {
            const project = row.project
            const status = PROJECT_STATUS[project.status] || PROJECT_STATUS.active
            const achieved =
              project.contract_amount > 0 ? (row.sale / project.contract_amount) * 100 : null

            // 제안서·탈락은 장부 집계 대신 제안 정보 위주로 보여줍니다.
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
                    </p>
                    {(project.contract_amount > 0 || Number(project.profit_rate) || Number(project.profit_amount)) ? (
                      <p className="mt-0.5 truncate text-xs font-semibold text-ink-700">
                        {project.contract_amount > 0 ? `계약 ${formatKRW(project.contract_amount)}원` : ''}
                        {project.contract_amount > 0 && (Number(project.profit_rate) || Number(project.profit_amount)) ? ' · ' : ''}
                        {Number(project.profit_rate) ? `수익률 ${formatPercent(Number(project.profit_rate))}` : ''}
                        {Number(project.profit_rate) && Number(project.profit_amount) ? ' · ' : ''}
                        {Number(project.profit_amount) ? (
                          <span className={Number(project.profit_amount) >= 0 ? '' : 'text-loss'}>
                            수익 {formatKRW(Number(project.profit_amount))}원
                          </span>
                        ) : (
                          ''
                        )}
                      </p>
                    ) : null}
                  </div>

                  {isAdmin ? (
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
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-loss"
                        onClick={() => setRemoving(project)}
                        aria-label="삭제"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ) : null}
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-ink-50/80 p-3 text-center">
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-500">매출</dt>
                    <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
                      {formatKRW(row.sale)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-500">비용</dt>
                    <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
                      {formatKRW(row.purchase + row.opex)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-500">이익</dt>
                    <dd
                      className={`mt-0.5 font-num text-sm font-extrabold tabular-nums ${
                        row.profit >= 0 ? 'text-emerald-700' : 'text-loss'
                      }`}
                    >
                      {formatKRW(row.profit)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3">
                  <ProfitBar value={Math.abs(row.profit)} max={maxSale} tone={row.profit >= 0 ? 'profit' : 'loss'} />
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                  <span>
                    이익률{' '}
                    <strong className="font-semibold text-ink-700">
                      {row.margin === null ? '—' : formatPercent(row.margin)}
                    </strong>
                    {achieved !== null ? (
                      <>
                        {' · '}계약 대비{' '}
                        <strong className="font-semibold text-ink-700">{formatPercent(achieved, 0)}</strong>
                      </>
                    ) : null}
                  </span>
                  <Link
                    to={`/projects/${project.id}`}
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    상세 →
                  </Link>
                </div>
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
  // 탈락 제안: 수기 수익금이 없으면 장부에 찍힌 투입 비용을 손실(-)로 보여줍니다.
  const spent = Number(row?.purchase || 0) + Number(row?.opex || 0) - Number(row?.sale || 0)
  const showLedgerLoss =
    project.status === 'dropped' && !Number(project.profit_amount) && spent > 0
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

        {isAdmin ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded-md p-1.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
              onClick={onEdit}
              aria-label="수정"
            >
              <Icon name="pencil" size={15} />
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-loss"
              onClick={onDelete}
              aria-label="삭제"
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-ink-50/80 p-3 text-center">
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">제안 금액</dt>
          <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
            {project.contract_amount > 0 ? formatKRW(project.contract_amount) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">수익률</dt>
          <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
            {Number(project.profit_rate) ? formatPercent(Number(project.profit_rate)) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-ink-500">수익</dt>
          <dd
            className={`mt-0.5 font-num text-sm font-extrabold tabular-nums ${
              Number(project.profit_amount) >= 0 && !showLedgerLoss ? 'text-ink-900' : 'text-loss'
            }`}
          >
            {Number(project.profit_amount)
              ? `${formatKRW(Number(project.profit_amount))}`
              : showLedgerLoss
                ? `-${formatKRW(spent)}`
                : '—'}
          </dd>
        </div>
      </dl>
      {showLedgerLoss ? (
        <p className="mt-2 text-[11px] text-ink-500">
          탈락 제안 투입 비용 {row.count}건을 손실로 집계합니다.
        </p>
      ) : null}

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
