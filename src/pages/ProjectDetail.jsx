import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import EntryFormModal from '../components/EntryFormModal'
import EntryTable from '../components/EntryTable'
import Icon from '../components/Icon'
import ProjectFormModal from '../components/ProjectFormModal'
import { ProfitBar } from '../components/Charts'
import { AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, LoadingBlock, SegmentedControl, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { ENTRY_META, PROJECT_STATUS } from '../lib/constants'
import { formatDateHuman, formatKRW, formatPercent, monthLabel } from '../lib/format'
import { groupByMonth, summarize } from '../lib/summary'
import { deleteEntry, listAttachments, listEntries, listProfiles, listProjects } from '../lib/api'

const TABS = [
  { key: 'all', label: '전체' },
  { key: 'sale', label: '매출' },
  { key: 'purchase', label: '매입' },
  { key: 'opex', label: '운영비' },
]

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isAdmin, user } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState(null)
  const [entries, setEntries] = useState([])
  const [profiles, setProfiles] = useState([])
  const [attachmentsByEntry, setAttachmentsByEntry] = useState({})
  const [tab, setTab] = useState('all')
  const [formType, setFormType] = useState(null)
  const [editing, setEditing] = useState(null)
  const [projectForm, setProjectForm] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewerFiles, setViewerFiles] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [projectRows, entryRows, profileRows] = await Promise.all([
        listProjects(),
        listEntries({ projectId: id }),
        listProfiles(),
      ])
      const found = projectRows.find((p) => p.id === id)
      setProject(found || null)
      setEntries(entryRows)
      setProfiles(profileRows)

      const files = await listAttachments(entryRows.map((r) => r.id))
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
  }, [id, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => summarize(entries), [entries])
  const months = useMemo(() => {
    const keys = new Set(entries.map((e) => String(e.entry_date).slice(0, 7)))
    return [...keys].sort()
  }, [entries])
  const monthly = useMemo(() => groupByMonth(entries, months), [entries, months])

  const filtered = useMemo(
    () => (tab === 'all' ? entries : entries.filter((e) => e.entry_type === tab)),
    [entries, tab],
  )

  const maxMonthly = Math.max(1, ...monthly.map((m) => Math.max(m.sale, Math.abs(m.profit))))

  const handleDeleteEntry = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deleteEntry(removing.id)
      toast.success('삭제되었습니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <Link to="/projects" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-500 hover:text-ink-800">
          <Icon name="chevron-left" size={16} />
          프로젝트 목록
        </Link>
        <LoadingBlock />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="card">
        <EmptyState
          icon="folder"
          title="프로젝트를 찾을 수 없습니다"
          description="삭제되었거나 주소가 올바르지 않습니다."
          action={
            <button type="button" className="btn-primary" onClick={() => navigate('/projects')}>
              목록으로
            </button>
          }
        />
      </div>
    )
  }

  const status = PROJECT_STATUS[project.status] || PROJECT_STATUS.active
  const achieved = project.contract_amount > 0 ? (stats.revenue / project.contract_amount) * 100 : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Link
          to="/projects"
          className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-ink-500 transition hover:text-ink-800"
        >
          <Icon name="chevron-left" size={16} />
          프로젝트 목록
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`chip ${status.chip}`}>{status.label}</span>
              {project.code ? <span className="chip bg-ink-100 text-ink-500">{project.code}</span> : null}
            </div>
            <h1 className="mt-2 text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">
              {project.name}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {project.client || '발주처 미지정'}
              {project.start_date
                ? ` · ${formatDateHuman(project.start_date)}${project.end_date ? ` ~ ${formatDateHuman(project.end_date)}` : ''}`
                : ''}
            </p>
          </div>

          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-ghost" onClick={() => setProjectForm(true)}>
                <Icon name="pencil" size={16} />
                프로젝트 수정
              </button>
              {['sale', 'purchase', 'opex'].map((type) => (
                <button key={type} type="button" className="btn-soft" onClick={() => setFormType(type)}>
                  <Icon name="plus" size={15} />
                  {ENTRY_META[type].label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="매출" value={stats.revenue} tone="sale" icon="trending-up" />
        <StatCard label="매입" value={stats.purchase.supply} tone="purchase" icon="cart" />
        <StatCard label="운영비" value={stats.opex.supply} tone="opex" icon="receipt" />
        <StatCard
          label="영업이익"
          value={stats.profit}
          tone={stats.profit >= 0 ? 'profit' : 'loss'}
          icon="coins"
          hint={stats.margin === null ? '매출 없음' : `이익률 ${formatPercent(stats.margin)}`}
        />
      </div>

      {project.contract_amount > 0 ? (
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-ink-800">계약 대비 매출</p>
            <p className="text-xs text-ink-500">
              계약 {formatKRW(project.contract_amount)}원 · 매출 {formatKRW(stats.revenue)}원 ·{' '}
              <strong className="font-semibold text-brand-700">{formatPercent(achieved, 0)}</strong>
            </p>
          </div>
          <div className="mt-2.5">
            <ProfitBar value={stats.revenue} max={project.contract_amount} tone="sale" />
          </div>
          {project.memo ? (
            <p className="mt-3 whitespace-pre-line border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-600">
              {project.memo}
            </p>
          ) : null}
        </div>
      ) : null}

      {monthly.length ? (
        <section className="card overflow-hidden">
          <header className="border-b border-ink-200 px-4 py-3.5">
            <h2 className="text-sm font-bold text-ink-900">월별 손익</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">월</th>
                  <th className="th text-right">매출</th>
                  <th className="th text-right">매입</th>
                  <th className="th text-right">운영비</th>
                  <th className="th text-right">영업이익</th>
                  <th className="th w-28">비중</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {monthly.map((row) => (
                  <tr key={row.month} className="transition hover:bg-ink-50/60">
                    <td className="td font-medium">{monthLabel(row.month)}</td>
                    <td className="td num">{formatKRW(row.sale)}</td>
                    <td className="td num">{formatKRW(row.purchase)}</td>
                    <td className="td num">{formatKRW(row.opex)}</td>
                    <td
                      className={`td num font-bold ${row.profit >= 0 ? 'text-emerald-700' : 'text-loss'}`}
                    >
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
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-ink-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-ink-900">거래 내역 ({entries.length}건)</h2>
          <SegmentedControl size="sm" options={TABS} value={tab} onChange={setTab} />
        </header>
        <EntryTable
          entries={filtered}
          projects={[project]}
          profiles={profiles}
          attachmentsByEntry={attachmentsByEntry}
          showType
          canEdit={isAdmin}
          onEdit={(entry) => {
            setEditing({ ...entry, attachments: attachmentsByEntry[entry.id] || [] })
            setFormType(entry.entry_type)
          }}
          onDelete={setRemoving}
          onOpenAttachments={setViewerFiles}
        />
      </section>

      <EntryFormModal
        open={Boolean(formType)}
        onClose={() => {
          setFormType(null)
          setEditing(null)
        }}
        onSaved={() => setReloadKey((k) => k + 1)}
        entryType={formType || 'sale'}
        source={editing?.source || 'manual'}
        initial={editing}
        projects={[project]}
        profiles={profiles}
        isAdmin={isAdmin}
        userId={user?.id}
      />

      <ProjectFormModal
        open={projectForm}
        onClose={() => setProjectForm(false)}
        onSaved={() => setReloadKey((k) => k + 1)}
        initial={project}
        profiles={profiles}
        userId={user?.id}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="내역을 삭제하시겠습니까?"
        message={
          removing
            ? `${removing.entry_date} · ${removing.description || removing.counterparty || '내용 없음'} (${formatKRW(
                removing.total_amount,
              )}원)`
            : ''
        }
        onClose={() => setRemoving(null)}
        onConfirm={handleDeleteEntry}
      />

      <AttachmentModal
        open={Boolean(viewerFiles)}
        onClose={() => setViewerFiles(null)}
        attachments={viewerFiles || []}
      />
    </div>
  )
}
