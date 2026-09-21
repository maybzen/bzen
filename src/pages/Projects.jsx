import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import ProjectFormModal from '../components/ProjectFormModal'
import { ProfitBar } from '../components/Charts'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { PROJECT_STATUS } from '../lib/constants'
import { formatDateHuman, formatKRW, formatPercent } from '../lib/format'
import { groupByProject, summarize } from '../lib/summary'
import { deleteProject, listEntries, listProfiles, listProjects } from '../lib/api'

export default function Projects() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const period = usePeriod('thisYear')

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [profiles, setProfiles] = useState([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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

  const rows = useMemo(() => {
    const grouped = groupByProject(entries, projects)
    const map = new Map(grouped.map((r) => [r.project?.id || 'none', r]))
    return projects.map((p) => map.get(p.id) || { project: p, sale: 0, purchase: 0, opex: 0, profit: 0, margin: null, count: 0 })
  }, [entries, projects])

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
        <StatCard label="프로젝트 수" value={String(projects.length)} unit="개" tone="neutral" icon="folder" />
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

      {loading ? (
        <LoadingBlock />
      ) : !projects.length ? (
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

            return (
              <article key={project.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`chip ${status.chip}`}>{status.label}</span>
                      {project.code ? (
                        <span className="chip bg-ink-100 text-ink-500">{project.code}</span>
                      ) : null}
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
