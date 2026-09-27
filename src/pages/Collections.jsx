import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, InlineAlert, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import {
  createCollection,
  deleteCollection,
  listCollections,
  listEntries,
  listProjects,
} from '../lib/api'
import { formatDateHuman, formatKRW, todayISO } from '../lib/format'

function isMissingTable(error) {
  const msg = String(error?.message || '')
  return /relation .* does not exist|Could not find the table|42P01/i.test(msg)
}

export default function Collections() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [missingTable, setMissingTable] = useState(false)
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [collections, setCollections] = useState([])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ project_id: '', collected_on: todayISO(), amount: '', memo: '' })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [p, e, c] = await Promise.all([listProjects(), listEntries({}), listCollections()])
      setProjects(p || [])
      setEntries(e || [])
      setCollections(c || [])
      setMissingTable(false)
    } catch (err) {
      if (isMissingTable(err)) setMissingTable(true)
      else toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => {
    const saleByProject = new Map()
    for (const e of entries) {
      if (e.entry_type !== 'sale' || !e.project_id) continue
      saleByProject.set(e.project_id, (saleByProject.get(e.project_id) || 0) + Number(e.supply_amount || 0))
    }
    const colByProject = new Map()
    let unassigned = 0
    for (const c of collections) {
      const amt = Number(c.amount || 0)
      if (c.project_id && colByProject.has(c.project_id)) colByProject.set(c.project_id, colByProject.get(c.project_id) + amt)
      else if (c.project_id) colByProject.set(c.project_id, amt)
      else unassigned += amt
    }
    return projects
      .map((p) => {
        const contract = Number(p.contract_amount || 0)
        const collected = colByProject.get(p.id) || 0
        return {
          project: p,
          contract,
          revenue: saleByProject.get(p.id) || 0,
          collected,
          due: contract - collected,
        }
      })
      .sort((a, b) => String(b.project.start_date || '').localeCompare(String(a.project.start_date || '')))
  }, [projects, entries, collections])

  const withContract = rows.filter((r) => r.contract > 0)
  const totalDue = withContract.reduce((a, r) => a + r.due, 0)
  const totalCollected = collections.reduce((a, c) => a + Number(c.amount || 0), 0)
  const thisMonth = todayISO().slice(0, 7)
  const monthCollected = collections
    .filter((c) => String(c.collected_on || '').startsWith(thisMonth))
    .reduce((a, c) => a + Number(c.amount || 0), 0)

  const handleSave = async (e) => {
    e.preventDefault()
    const amount = Math.round(Number(String(form.amount).replace(/[^0-9.-]/g, '')) || 0)
    if (!form.collected_on) return toast.error('입금일을 선택해 주세요.')
    if (amount <= 0) return toast.error('입금액을 입력해 주세요.')
    setSaving(true)
    try {
      await createCollection(
        {
          project_id: form.project_id || null,
          collected_on: form.collected_on,
          amount,
          memo: form.memo.trim(),
        },
        user?.id,
      )
      toast.success('입금을 등록했습니다.')
      setFormOpen(false)
      setForm({ project_id: '', collected_on: todayISO(), amount: '', memo: '' })
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!removing) return
    try {
      await deleteCollection(removing.id)
      toast.success('삭제되었습니다.')
      setRemoving(null)
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="수금·미수금" description="프로젝트 계약금 대비 입금액을 관리합니다.">
        {isAdmin && !missingTable ? (
          <button type="button" className="btn-primary" onClick={() => setFormOpen(true)}>
            <Icon name="plus" size={16} />
            입금 등록
          </button>
        ) : null}
      </PageHeader>

      {missingTable ? (
        <InlineAlert tone="warn">
          <strong>수금 테이블이 아직 없습니다.</strong> Supabase Dashboard → SQL Editor에서{' '}
          <code>supabase/migration_collections.sql</code> 내용을 실행한 뒤 새로고침하세요. (1분 소요)
        </InlineAlert>
      ) : loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="미수금 합계" value={totalDue} tone={totalDue > 0 ? 'loss' : 'profit'} icon="coins" hint="계약 − 수금 (계약 있는 프로젝트)" />
            <StatCard label="이번달 수금" value={monthCollected} tone="sale" icon="trending-up" />
            <StatCard label="전체 수금" value={totalCollected} tone="neutral" icon="chart" hint={`${collections.length}건`} />
            <StatCard label="계약 프로젝트" value={String(withContract.length)} unit="건" tone="neutral" icon="folder" />
          </div>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">프로젝트별 수금 현황</h2>
            </header>
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">프로젝트</th>
                      <th className="th text-right">계약금액</th>
                      <th className="th text-right">매출(공급가)</th>
                      <th className="th text-right">수금</th>
                      <th className="th text-right">미수금</th>
                      <th className="th w-28">수금률</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {rows.map((r) => (
                      <tr key={r.project.id} className="transition hover:bg-ink-50/60">
                        <td className="td font-medium">{r.project.name}</td>
                        <td className="td num">{r.contract ? `${formatKRW(r.contract)}` : '—'}</td>
                        <td className="td num text-ink-500">{formatKRW(r.revenue)}</td>
                        <td className="td num text-emerald-700">{formatKRW(r.collected)}</td>
                        <td className={`td num font-bold ${r.contract && r.due !== 0 ? 'text-loss' : 'text-ink-500'}`}>
                          {r.contract ? formatKRW(r.due) : '—'}
                        </td>
                        <td className="td">
                          {r.contract ? (
                            <span className="font-num text-xs font-bold tabular-nums text-ink-700">
                              {Math.round((r.collected / r.contract) * 100)}%
                            </span>
                          ) : (
                            <span className="text-xs text-ink-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="folder" title="프로젝트가 없습니다" />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">입금 내역</h2>
            </header>
            {collections.length ? (
              <ul className="divide-y divide-ink-100">
                {collections.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-24 shrink-0 text-xs font-semibold text-ink-500">
                      {formatDateHuman(c.collected_on)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800">
                      {projects.find((p) => p.id === c.project_id)?.name || '미지정'}
                      {c.memo ? <span className="ml-1.5 font-normal text-ink-500">{c.memo}</span> : null}
                    </span>
                    <span className="shrink-0 font-num text-sm font-extrabold tabular-nums text-ink-900">
                      {formatKRW(c.amount)}원
                    </span>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => setRemoving(c)}
                        className="shrink-0 rounded-md p-1.5 text-ink-400 transition hover:bg-rose-50 hover:text-loss"
                        aria-label="삭제"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="coins" title="입금 내역이 없습니다" description="입금 등록으로 받으신 돈을 기록하세요." />
            )}
          </section>
        </>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
          <div className="absolute inset-0 bg-ink-900/50" onClick={() => !saving && setFormOpen(false)} />
          <form
            onSubmit={handleSave}
            className="relative z-10 w-full animate-fade-in rounded-t-2xl bg-white p-5 shadow-pop sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-base font-bold text-ink-900">입금 등록</h2>
            <div className="mt-4 flex flex-col gap-4">
              <label className="label">
                프로젝트
                <select
                  className="input mt-1.5"
                  value={form.project_id}
                  onChange={(e) => setForm((f) => ({ ...f, project_id: e.target.value }))}
                >
                  <option value="">미지정</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                입금일
                <input
                  type="date"
                  className="input mt-1.5"
                  value={form.collected_on}
                  onChange={(e) => setForm((f) => ({ ...f, collected_on: e.target.value }))}
                  required
                />
              </label>
              <label className="label">
                입금액
                <input
                  className="input mt-1.5 text-left font-num tabular-nums"
                  inputMode="numeric"
                  placeholder="0"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  required
                />
              </label>
              <label className="label">
                메모
                <input
                  className="input mt-1.5"
                  placeholder="예: 계약금, 1차 중도금"
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setFormOpen(false)} disabled={saving}>
                취소
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(removing)}
        title="입금 내역을 삭제하시겠습니까?"
        message={removing ? `${removing.collected_on} · ${formatKRW(removing.amount)}원` : ''}
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
