import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { ConfirmDialog, EmptyState, LoadingBlock, PageHeader, SegmentedControl, StatCard } from '../components/ui'
import { useToast } from '../components/Toast'
import { ENTRY_META } from '../lib/constants'
import { formatDateHuman, formatDateTime, formatKRW } from '../lib/format'
import {
  listProfiles,
  listTrashedEntries,
  listTrashedProjects,
  purgeEntry,
  purgeProject,
  restoreEntry,
  restoreProject,
} from '../lib/api'

/**
 * 휴지통 (관리자 전용).
 * 삭제 버튼은 모두 휴지통 이동(soft delete)이며, 여기서 복원·영구삭제합니다.
 * 영구삭제된 내역은 되돌릴 수 없습니다.
 */
export default function Trash() {
  const toast = useToast()
  const [tab, setTab] = useState('entries')
  const [entries, setEntries] = useState([])
  const [projects, setProjects] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [purging, setPurging] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [e, p, profs] = await Promise.all([
        listTrashedEntries(),
        listTrashedProjects(),
        listProfiles().catch(() => []),
      ])
      setEntries(e)
      setProjects(p)
      setProfiles(profs)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const nameOf = useMemo(() => {
    const map = new Map((profiles || []).map((p) => [p.id, p.full_name || p.email || '알 수 없음']))
    return (id) => (id ? map.get(id) || '알 수 없음' : '—')
  }, [profiles])

  const handleRestore = async (row) => {
    setBusy(true)
    try {
      if (tab === 'entries') await restoreEntry(row.id)
      else await restoreProject(row.id)
      toast.success('복원했습니다.')
      load()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  const handlePurge = async () => {
    if (!purging) return
    setBusy(true)
    try {
      if (tab === 'entries') await purgeEntry(purging.id)
      else await purgeProject(purging.id)
      toast.success('영구삭제했습니다. 되돌릴 수 없습니다.')
      setPurging(null)
      load()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  const typeLabel = (e) => {
    const base = ENTRY_META[e?.entry_type]?.label || e?.entry_type || ''
    return e?.source === 'expense_report' ? `지출결의` : base
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="휴지통"
        description="삭제한 내역이 여기 보관됩니다. 복원하거나 영구삭제하세요. 영구삭제는 되돌릴 수 없습니다."
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="휴지통 장부" value={String(entries.length)} unit="건" tone="neutral" icon="trash" />
        <StatCard label="휴지통 프로젝트" value={String(projects.length)} unit="개" tone="neutral" icon="folder" />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-3.5">
          <SegmentedControl
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { key: 'entries', label: `장부 ${entries.length ? `${entries.length}` : ''}` },
              { key: 'projects', label: `프로젝트 ${projects.length ? `${projects.length}` : ''}` },
            ]}
          />
        </div>

        {loading ? (
          <LoadingBlock />
        ) : tab === 'entries' ? (
          entries.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50/70 text-left text-xs text-ink-500">
                    <th className="px-4 py-2.5 font-semibold">일자</th>
                    <th className="px-4 py-2.5 font-semibold">유형</th>
                    <th className="px-4 py-2.5 font-semibold">거래처·적요</th>
                    <th className="px-4 py-2.5 text-right font-semibold">합계</th>
                    <th className="px-4 py-2.5 font-semibold">삭제일시·삭제자</th>
                    <th className="px-4 py-2.5 text-right font-semibold">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-ink-100 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5">{formatDateHuman(e.entry_date)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{typeLabel(e)}</td>
                      <td className="max-w-[22rem] truncate px-4 py-2.5">
                        {[e.counterparty, e.description].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-num tabular-nums">
                        {formatKRW(e.total_amount)}원
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500">
                        {formatDateTime(e.deleted_at)} · {nameOf(e.deleted_by)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <button
                          type="button"
                          className="btn-soft mr-1.5"
                          disabled={busy}
                          onClick={() => handleRestore(e)}
                        >
                          <Icon name="refresh" size={14} />
                          복원
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={busy}
                          onClick={() => setPurging(e)}
                        >
                          <Icon name="trash" size={14} />
                          영구삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="휴지통이 비어 있습니다" description="삭제한 장부는  여기에 보관됩니다." />
          )
        ) : projects.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50/70 text-left text-xs text-ink-500">
                  <th className="px-4 py-2.5 font-semibold">프로젝트</th>
                  <th className="px-4 py-2.5 font-semibold">발주처</th>
                  <th className="px-4 py-2.5 font-semibold">삭제일시·삭제자</th>
                  <th className="px-4 py-2.5 text-right font-semibold">관리</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-ink-100 last:border-0">
                    <td className="max-w-[20rem] truncate px-4 py-2.5 font-semibold">{p.name}</td>
                    <td className="px-4 py-2.5">{p.client || '발주처 미지정'}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500">
                      {formatDateTime(p.deleted_at)} · {nameOf(p.deleted_by)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <button
                        type="button"
                        className="btn-soft mr-1.5"
                        disabled={busy}
                        onClick={() => handleRestore(p)}
                      >
                        <Icon name="refresh" size={14} />
                        복원
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={busy}
                        onClick={() => setPurging(p)}
                      >
                        <Icon name="trash" size={14} />
                        영구삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="휴지통이 비어 있습니다" description="삭제한 프로젝트는 여기에 보관됩니다." />
        )}
      </div>

      <ConfirmDialog
        open={Boolean(purging)}
        busy={busy}
        title="영구삭제하시겠습니까?"
        message={
          purging
            ? `선택한 내역을 완전히 지웁니다. 되돌릴 수 없습니다.\n장부는 증빙 첨부까지 함께 지워집니다.`
            : ''
        }
        confirmLabel="영구삭제"
        onClose={() => setPurging(null)}
        onConfirm={handlePurge}
      />
    </div>
  )
}
