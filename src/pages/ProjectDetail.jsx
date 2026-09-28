import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import EntryFormModal from '../components/EntryFormModal'
import EntryTable from '../components/EntryTable'
import Icon from '../components/Icon'
import ProjectFormModal from '../components/ProjectFormModal'
import { ProfitBar } from '../components/Charts'
import { AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, InlineAlert, LoadingBlock, SegmentedControl, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { isStaffVisible, staffIdsFromProfiles } from '../lib/permissions'
import { ENTRY_META, PROJECT_STATUS } from '../lib/constants'
import { contractSplit, formatDateHuman, formatKRW, formatPercent, monthLabel, normalizeVendorName } from '../lib/format'
import { groupByMonth, summarize } from '../lib/summary'
import { deleteEntry, isMissingTableError, linkProjectPartner, listAttachments, listEntries, listPartners, listProfiles, listProjectPartners, listProjects, unlinkProjectPartner } from '../lib/api'

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
  const [partners, setPartners] = useState([])
  const [attachmentsByEntry, setAttachmentsByEntry] = useState({})
  const [tab, setTab] = useState('all')
  const [formType, setFormType] = useState(null)
  const [editing, setEditing] = useState(null)
  const [projectForm, setProjectForm] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewerFiles, setViewerFiles] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [ledgerTab, setLedgerTab] = useState('entries')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [projectRows, entryRows, profileRows, partnerRows] = await Promise.all([
        listProjects(),
        listEntries({ projectId: id }),
        listProfiles(),
        listPartners().catch(() => []),
      ])
      const found = projectRows.find((p) => p.id === id)
      setProject(found || null)
      setEntries(entryRows)
      setProfiles(profileRows)
      setPartners(partnerRows || [])

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

  /* 직원은 운영비 중 사원 작성분만 봅니다. 매출·매입은 관리자가 관리합니다 */
  const staffIds = useMemo(() => staffIdsFromProfiles(profiles), [profiles])
  const staffRows = useMemo(
    () => filtered.filter((e) => e.entry_type === 'opex' && isStaffVisible(e, staffIds)),
    [filtered, staffIds],
  )
  const shown = isAdmin ? filtered : staffRows
  const staffTabs = useMemo(() => TABS.filter((t) => t.key === 'all' || t.key === 'opex'), [])

  const maxMonthly = Math.max(1, ...monthly.map((m) => Math.max(m.sale, Math.abs(m.profit))))

  /* 협력업체: 명시적 연결(linked) + 장부에서 나온 연결 후보(candidates) */
  const [links, setLinks] = useState(null)
  const [linkBusy, setLinkBusy] = useState(false)

  useEffect(() => {
    let alive = true
    listProjectPartners()
      .then((rows) => {
        if (alive) setLinks(rows || [])
      })
      .catch((err) => {
        if (alive) setLinks(isMissingTableError(err) ? null : [])
      })
    return () => {
      alive = false
    }
  }, [id, reloadKey])

  const refreshLinks = useCallback(async () => {
    try {
      setLinks(await listProjectPartners())
    } catch (err) {
      if (isMissingTableError(err)) setLinks(null)
      else toast.error(err.message)
    }
  }, [toast])

  const handleLink = async (partnerId) => {
    setLinkBusy(true)
    try {
      await linkProjectPartner(id, partnerId, user?.id)
      toast.success('연결했습니다.')
      await refreshLinks()
    } catch (err) {
      toast.error(isMissingTableError(err) ? 'SQL 1회 실행이 필요합니다 (supabase/migration_project_partners.sql)' : err.message)
    } finally {
      setLinkBusy(false)
    }
  }

  const handleUnlink = async (partnerId) => {
    setLinkBusy(true)
    try {
      await unlinkProjectPartner(id, partnerId)
      toast.success('연결을 해제했습니다. 장부 내역은 그대로 둡니다.')
      await refreshLinks()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLinkBusy(false)
    }
  }

  const vendors = useMemo(() => {
    const byNorm = new Map()
    for (const e of entries || []) {
      const name = String(e.counterparty || '').trim()
      if (!name || name === '미지정') continue
      const key = normalizeVendorName(name)
      if (!byNorm.has(key)) byNorm.set(key, { name, count: 0, total: 0 })
      const row = byNorm.get(key)
      row.count += 1
      row.total += Number(e.total_amount || 0)
    }
    const partnerByNorm = new Map(
      (partners || []).map((p) => [normalizeVendorName(p.name), p]),
    )
    return [...byNorm.values()]
      .map((v) => ({ ...v, partner: partnerByNorm.get(normalizeVendorName(v.name)) || null }))
      .sort((a, b) => b.total - a.total)
  }, [entries, partners])

  /* 명시적 연결 + 연결 후보(장부에 있는데 미연결) */
  const linkedVendors = useMemo(() => {
    if (!links) return []
    const vByPartner = new Map()
    for (const v of vendors) {
      if (v.partner) vByPartner.set(v.partner.id, v)
    }
    return links
      .filter((l) => l.project_id === id)
      .map((l) => {
        const p = (partners || []).find((x) => x.id === l.partner_id)
        if (!p) return null
        const stat = vByPartner.get(p.id) || { name: p.name, count: 0, total: 0 }
        return { ...stat, name: p.name, partner: p, linked: true }
      })
      .filter(Boolean)
      .sort((a, b) => b.total - a.total)
  }, [links, vendors, partners, id])

  const candidateVendors = useMemo(() => {
    const linkedIds = new Set(linkedVendors.map((v) => v.partner?.id).filter(Boolean))
    return vendors.filter((v) => !(v.partner && linkedIds.has(v.partner.id)))
  }, [vendors, linkedVendors])

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
  /* 계약 대비 순매출은 공급가액끼리 비교해야 맞습니다 */
  const csplit = contractSplit(project)
  const achieved = csplit.supply > 0 ? (stats.revenue / csplit.supply) * 100 : null

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
            <p className="mt-1 text-sm text-ink-600">
              {profiles.find((p) => p.id === project.manager_id)?.full_name
                ? `담당 ${profiles.find((p) => p.id === project.manager_id).full_name}`
                : '담당 미지정'}
              {project.venue ? ` · ${project.venue}` : ''}
            </p>
            {csplit.total > 0 ? (
              <p className="mt-1 text-sm font-semibold text-ink-800">
                계약 {formatKRW(csplit.supply)}원
                <span className="font-normal text-ink-400"> (합계 {formatKRW(csplit.total)}원)</span>
              </p>
            ) : null}
          </div>

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
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {isAdmin ? (
          <>
            <StatCard label="순매출액" value={stats.revenue} tone="sale" icon="trending-up" hint="공급가액 기준" />
            <StatCard label="매출원가" value={stats.cogs} tone="purchase" icon="cart" hint="매입" />
            <StatCard
              label="매출총이익"
              value={stats.gross}
              tone={stats.gross >= 0 ? 'profit' : 'loss'}
              icon="chart"
              hint={stats.grossMargin === null ? '매출 없음' : `매출총이익률 ${formatPercent(stats.grossMargin)}`}
            />
            <StatCard
              label="영업이익"
              value={stats.operating}
              tone={stats.operating >= 0 ? 'profit' : 'loss'}
              icon="coins"
              hint={stats.operatingMargin === null ? '매출 없음 · 비용만 반영' : `영업이익률 ${formatPercent(stats.operatingMargin)}`}
            />
          </>
        ) : (
          <>
            <StatCard label="매출원가" value={stats.cogs} tone="purchase" icon="cart" hint="매입" />
            <StatCard label="경비" value={stats.expense} tone="opex" icon="receipt" hint="운영비" />
          </>
        )}
      </div>

      {isAdmin && csplit.total > 0 ? (
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-ink-800">계약 대비 순매출</p>
            <p className="text-xs text-ink-500">
              계약(공급가액) {formatKRW(csplit.supply)}원 · 순매출 {formatKRW(stats.revenue)}원 ·{' '}
              <strong className="font-semibold text-brand-700">{formatPercent(achieved, 0)}</strong>
            </p>
          </div>
          <p className="mt-1 text-[11px] text-ink-400">
            공급가액끼리 비교한 값입니다. 계약 합계(부가세 포함)는 {formatKRW(csplit.total)}원입니다.
          </p>
          <div className="mt-2.5">
            <ProfitBar value={stats.revenue} max={csplit.supply} tone="sale" />
          </div>
          {project.memo ? (
            <p className="mt-3 whitespace-pre-line border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-600">
              {project.memo}
            </p>
          ) : null}
        </div>
      ) : null}

      {isAdmin && monthly.length ? (
        <section className="card overflow-hidden">
          <header className="border-b border-ink-200 px-4 py-3.5">
            <h2 className="text-sm font-bold text-ink-900">월별 손익</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">월</th>
                  <th className="th text-right">순매출액</th>
                  <th className="th text-right">매출원가</th>
                  <th className="th text-right">매출총이익</th>
                  <th className="th text-right">경비</th>
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
                    <td className={`td num font-semibold ${row.sale - row.purchase >= 0 ? '' : 'text-loss'}`}>
                      {formatKRW(row.sale - row.purchase)}
                    </td>
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
          <h2 className="text-sm font-bold text-ink-900">
            {ledgerTab === 'vendors' ? `협력업체 (${linkedVendors.length}곳)` : `거래 내역 (${shown.length}건)`}
            {!isAdmin && ledgerTab === 'entries' ? <span className="ml-1.5 font-normal text-ink-400">· 운영비만 표시됩니다</span> : null}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              value={ledgerTab}
              onChange={setLedgerTab}
              options={[
                { key: 'entries', label: '거래내역' },
                { key: 'vendors', label: `협력업체${linkedVendors.length ? ` ${linkedVendors.length}` : ''}` },
              ]}
            />
            {ledgerTab === 'entries' ? (
              <SegmentedControl size="sm" options={isAdmin ? TABS : staffTabs} value={tab} onChange={setTab} />
            ) : null}
          </div>
        </header>
        {ledgerTab === 'vendors' ? (
          <VendorPanel
            links={links}
            linked={linkedVendors}
            candidates={candidateVendors}
            linkBusy={linkBusy}
            isAdmin={isAdmin}
            onLink={handleLink}
            onUnlink={handleUnlink}
          />
        ) : (
          <EntryTable
            entries={shown}
            projects={[project]}
            profiles={profiles}
            attachmentsByEntry={attachmentsByEntry}
            showType
            canEdit
            canChangeAuthor={isAdmin}
            onEdit={(entry) => {
              setEditing({ ...entry, attachments: attachmentsByEntry[entry.id] || [] })
              setFormType(entry.entry_type)
            }}
            onDelete={(entry) => setRemoving(entry)}
            onOpenAttachments={setViewerFiles}
            canEditEntry={(e) => isAdmin || e?.created_by === user?.id || e?.requester_id === user?.id}
            canDeleteEntry={(e) => isAdmin || e?.created_by === user?.id || e?.requester_id === user?.id}
          />
        )}
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
        defaultProjectId={project.id}
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

/**
 * 협력업체 패널.
 * 명시적 연결(linked)이 중심입니다. 한 거래처가 여러 행사에 겹쳐도
 * 프로젝트마다 따로 연결하므로 중복 걱정 없습니다.
 * 장부에만 있고 미연결인 곳은 후보로 보여주고, 밥집처럼 엮지 않을 곳은 그냥 두면 됩니다.
 */
function VendorPanel({ links, linked, candidates, linkBusy, isAdmin, onLink, onUnlink }) {
  if (links === null) {
    return (
      <div className="p-4">
        {isAdmin ? (
          <InlineAlert tone="warn">
            <strong>연결 저장소가 아직 없습니다.</strong> Supabase Dashboard → SQL Editor에서{' '}
            <code>supabase/migration_project_partners.sql</code> 내용을 실행한 뒤 새로고침하세요. (1분 소요)
          </InlineAlert>
        ) : (
          <EmptyState icon="building" title="연결된 협력업체가 없습니다" />
        )}
      </div>
    )
  }
  if (!linked.length && !candidates.length) {
    return (
      <div className="p-4">
        <EmptyState icon="building" title="거래처가 없습니다" description="장부에 거래처명으로 입력하면 후보로 뜹니다." />
      </div>
    )
  }
  return (
    <div>
      {linked.length ? (
        <ul className="divide-y divide-ink-100">
          {linked.map((v) => (
            <li key={v.partner.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink-900">{v.name}</p>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {v.partner?.contact_person
                    ? `담당 ${v.partner.contact_person}${v.partner.job_title ? ` ${v.partner.job_title}` : ''}`
                    : '담당자 미등록'}
                  {v.partner?.phone || v.partner?.phone_main
                    ? ` · ${v.partner.phone || v.partner.phone_main}`
                    : ''}
                  {` · ${v.count}건`}
                </p>
              </div>
              <span className="shrink-0 font-num text-sm font-extrabold tabular-nums text-ink-900">
                {formatKRW(v.total)}원
              </span>
              <Link
                to={`/partners?search=${encodeURIComponent(v.name)}`}
                className="shrink-0 text-xs font-semibold text-brand-700 hover:underline"
              >
                거래처 →
              </Link>
              <button
                type="button"
                onClick={() => onUnlink(v.partner.id)}
                disabled={linkBusy}
                className="shrink-0 text-xs font-semibold text-ink-300 hover:text-loss hover:underline disabled:opacity-50"
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {candidates.length ? (
        <div className={linked.length ? 'border-t border-ink-100' : ''}>
          <p className="bg-ink-50/60 px-4 py-2 text-[11px] font-bold text-ink-500">
            연결 후보 (장부에만 있는 곳 · 밥집처럼 엮지 않을 곳은 두세요)
          </p>
          <ul className="divide-y divide-ink-100">
            {candidates.map((v) => (
              <li key={v.name} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-700">{v.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-400">
                    {v.count}건 · {formatKRW(v.total)}원
                    {v.partner ? ' · 대장 있음' : ' · 대장 없음'}
                  </p>
                </div>
                {v.partner ? (
                  <button
                    type="button"
                    onClick={() => onLink(v.partner.id)}
                    disabled={linkBusy}
                    className="shrink-0 rounded-md bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
                  >
                    연결
                  </button>
                ) : (
                  <Link
                    to={`/partners?search=${encodeURIComponent(v.name)}`}
                    className="shrink-0 text-xs font-semibold text-ink-400 hover:text-brand-700 hover:underline"
                  >
                    대장 등록 →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
