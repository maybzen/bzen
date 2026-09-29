import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import PartnerPicker from '../components/PartnerPicker'
import { useToast } from '../components/Toast'
import { AmountInput, ConfirmDialog, EmptyState, InlineAlert, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import {
  createCollection,
  deleteCollection,
  ensurePartnerByName,
  listCollections,
  listEntries,
  listPartners,
  listProfiles,
  listProjects,
  updateCollection,
} from '../lib/api'
import { formatDateHuman, formatKRW, formatPercent, normalizeVendorName, todayISO } from '../lib/format'

/* 법인격 표기 차이((주)·주식회사 등)를 무시하고 거래처명을 비교합니다 */
const normVendor = normalizeVendorName

function isMissingTable(error) {
  const msg = String(error?.message || '')
  return /relation .* does not exist|Could not find the table|42P01/i.test(msg)
}

export default function Collections() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  /* 거래처 화면에서 넘어올 때 (?vendor=이름) 해당 거래처를 바로 보여줍니다. */
  const [searchParams, setSearchParams] = useSearchParams()
  const focusVendor = (searchParams.get('vendor') || '').trim()
  const clearFocus = () => {
    searchParams.delete('vendor')
    setSearchParams(searchParams, { replace: true })
  }
  const [loading, setLoading] = useState(true)
  const [missingTable, setMissingTable] = useState(false)
  const [projects, setProjects] = useState([])
  const [entries, setEntries] = useState([])
  const [collections, setCollections] = useState([])
  const [partners, setPartners] = useState([])
  const [profiles, setProfiles] = useState([])
  const profileName = (id) => {
    if (!id) return ''
    const p = profiles.find((x) => x.id === id)
    return p?.full_name || p?.email || ''
  }
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [viewTab, setViewTab] = useState('project')
  const [form, setForm] = useState({ project_id: '', counterparty: '', collected_on: todayISO(), amount: '', memo: '' })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [p, e, c, pt, pf] = await Promise.all([listProjects(), listEntries({}), listCollections(), listPartners().catch(() => []), listProfiles().catch(() => [])])
      setProjects(p || [])
      setEntries(e || [])
      setCollections(c || [])
      setPartners(pt || [])
      setProfiles(pf || [])
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

  /* 거래처 화면에서 넘어온 경우 거래처별 탭을 자동으로 엽니다. */
  useEffect(() => {
    if (focusVendor) setViewTab('vendor')
  }, [focusVendor])

  const rows = useMemo(() => {
    const saleByProject = new Map()
    const costByProject = new Map()
    for (const e of entries) {
      if (!e.project_id) continue
      const supply = Number(e.supply_amount || 0)
      if (e.entry_type === 'sale') saleByProject.set(e.project_id, (saleByProject.get(e.project_id) || 0) + supply)
      else if (e.entry_type === 'purchase' || e.entry_type === 'opex') {
        costByProject.set(e.project_id, (costByProject.get(e.project_id) || 0) + supply)
      }
    }
    const colByProject = new Map()
    for (const c of collections) {
      if (c.project_id) colByProject.set(c.project_id, (colByProject.get(c.project_id) || 0) + Number(c.amount || 0))
    }
    return projects
      .filter((p) => !p.is_hidden)
      .map((p) => {
        const contract = Number(p.contract_amount || 0)
        const collected = colByProject.get(p.id) || 0
        const revenue = saleByProject.get(p.id) || 0
        const cost = costByProject.get(p.id) || 0
        const profit = revenue - cost
        return {
          project: p,
          contract,
          revenue,
          margin: revenue ? (profit / revenue) * 100 : null,
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

  /* 거래처별: 주거래처 15곳만 표시 (매출·수금·매입 + 미지급 확정잔액) */
  const FOCUS_VENDORS = [
    { label: '에이플러스', names: ['에이플러스무대', '에이플러스'] },
    { label: '영일미디어', names: ['영일미디어'] },
    { label: '브이오디오', names: ['브이오디오'] },
    { label: '티에스엠', names: ['티에스엠(주)부산지점', 'TSM', '티엠스엠(주)부산지점'] },
    { label: '트윈스라이팅', names: ['트윈스라이팅', '트윈스조명'] },
    { label: '블루컴', names: ['블루컴'] },
    { label: '윤커뮤니케이션', names: ['윤커뮤니케이션', '윤컴 / 윤커뮤니케이션'] },
    { label: '이웃사촌', names: ['이웃사촌'] },
    { label: '마이스커뮤니케이션', names: ['마이스커뮤니케이션'] },
    { label: '프렉스', names: ['프렉스'] },
    { label: '스마일콘텐츠', names: ['스마일콘텐츠'] },
    { label: '밴타고', names: ['밴타고'] },
    { label: '스튜디오감', names: ['스튜디오감'] },
    { label: 'BT애드', names: ['BT애드'] },
    { label: '위치팩토리', names: ['위치팩토리', '위치펙토리'] },
  ]
  const vendorRows = useMemo(() => {
    const canonByNorm = new Map()
    FOCUS_VENDORS.forEach((f) => f.names.forEach((n) => canonByNorm.set(normVendor(n), f.label)))
    const map = new Map(
      FOCUS_VENDORS.map((f) => [f.label, { name: f.label, revenue: 0, collected: 0, purchase: 0, payable: 0 }]),
    )
    const rowFor = (name) => {
      const n = (name || '').trim()
      if (!n || n === '미지정') return null
      const hit = canonByNorm.get(normVendor(n))
      return hit ? map.get(hit) : null
    }
    for (const e of entries) {
      const row = rowFor(e.counterparty)
      if (!row) continue
      if (e.entry_type === 'sale') row.revenue += Number(e.total_amount || 0)
      else if (e.entry_type === 'purchase') row.purchase += Number(e.total_amount || 0)
    }
    for (const c of collections) {
      const row = rowFor(c.counterparty)
      if (row) row.collected += Number(c.amount || 0)
    }
    // 거래처 확정 미지급잔액 연동
    for (const p of partners) {
      const row = rowFor(p.name)
      if (row) row.payable += Number(p.payable_balance || 0)
    }
    return FOCUS_VENDORS.map((f) => {
      const r = map.get(f.label)
      return { ...r, due: r.revenue - r.collected }
    })
  }, [entries, collections, partners])
  const vendorDue = vendorRows.reduce((a, r) => a + Math.max(0, r.due), 0)
  const payableTotal = useMemo(() => (partners || []).reduce((a, p) => a + Number(p.payable_balance || 0), 0), [partners])
  const monthCollected = collections
    .filter((c) => String(c.collected_on || '').startsWith(thisMonth))
    .reduce((a, c) => a + Number(c.amount || 0), 0)

  /* 거래처 화면에서 지정한 거래처 1곳의 수금 현황.
     주거래처 15곳 목록에 없어도 보여주도록 장부 전체에서 이름으로 직접 집계합니다. */
  const focusRow = useMemo(() => {
    const name = focusVendor.trim()
    if (!name) return null
    const target = normVendor(name)
    const matches = (v) => normVendor(v) === target
    let revenue = 0
    let purchase = 0
    for (const e of entries) {
      if (!matches(e.counterparty)) continue
      if (e.entry_type === 'sale') revenue += Number(e.total_amount || 0)
      else if (e.entry_type === 'purchase') purchase += Number(e.total_amount || 0)
    }
    let collected = 0
    const items = []
    for (const c of collections) {
      if (!matches(c.counterparty)) continue
      collected += Number(c.amount || 0)
      items.push(c)
    }
    const payable = (partners || [])
      .filter((p) => matches(p.name))
      .reduce((a, p) => a + Number(p.payable_balance || 0), 0)
    return {
      name,
      revenue,
      purchase,
      collected,
      payable,
      due: revenue - collected,
      count: items.length,
      items,
    }
  }, [focusVendor, entries, collections, partners])

  /* 거래처를 지정한 동안에는 그 거래처 입금 내역만 아래에 보여줍니다. */
  const listedCollections = useMemo(() => {
    if (!focusRow) return collections
    const ids = new Set(focusRow.items.map((c) => c.id))
    return collections.filter((c) => ids.has(c.id))
  }, [collections, focusRow])

  const openNew = () => {
    setEditing(null)
    setForm({ project_id: '', counterparty: '', collected_on: todayISO(), amount: '', memo: '' })
    setFormOpen(true)
  }

  const openEdit = (c) => {
    setEditing(c)
    setForm({
      project_id: c.project_id || '',
      counterparty: c.counterparty || '',
      collected_on: c.collected_on || todayISO(),
      amount: String(c.amount ?? ''),
      memo: c.memo || '',
    })
    setFormOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    const amount = Math.round(Number(String(form.amount).replace(/[^0-9.-]/g, '')) || 0)
    if (!form.collected_on) return toast.error('입금일을 선택해 주세요.')
    if (amount <= 0) return toast.error('입금액을 입력해 주세요.')
    setSaving(true)
    try {
      const payload = {
        project_id: form.project_id || null,
        counterparty: form.counterparty.trim(),
        collected_on: form.collected_on,
        amount,
        memo: form.memo.trim(),
      }
      if (editing?.id) {
        await updateCollection(editing.id, payload)
        toast.success('입금 내역을 수정했습니다.')
      } else {
        await createCollection(payload, user?.id)
        toast.success('입금을 등록했습니다.')
      }
      if (payload.counterparty) {
        ensurePartnerByName(payload.counterparty, user?.id).catch(() => {})
      }
      setFormOpen(false)
      setEditing(null)
      setForm({ project_id: '', counterparty: '', collected_on: todayISO(), amount: '', memo: '' })
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
          <button type="button" className="btn-primary" onClick={openNew}>
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
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <StatCard label="미수금 합계" value={totalDue} tone={totalDue > 0 ? 'loss' : 'profit'} icon="coins" hint="계약 − 수금 (계약 있는 프로젝트)" />
            <StatCard label="미지급금 합계" value={payableTotal} tone={payableTotal > 0 ? 'loss' : 'profit'} icon="card" hint="외주 확정잔액 (9/28 확인)" />
            <StatCard label="이번달 수금" value={monthCollected} tone="sale" icon="trending-up" />
            <StatCard label="전체 수금" value={totalCollected} tone="neutral" icon="chart" hint={`${collections.length}건`} />
            <StatCard label="계약 프로젝트" value={String(withContract.length)} unit="건" tone="neutral" icon="folder" />
          </div>

          {focusRow ? (
            <section className="card overflow-hidden ring-2 ring-brand-200">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-brand-50/60 px-4 py-3.5">
                <h2 className="text-sm font-bold text-ink-900">
                  <span className="text-brand-700">거래처</span> {focusRow.name} · 수금 현황
                </h2>
                <button
                  type="button"
                  onClick={clearFocus}
                  className="btn-ghost !px-2 !py-1 text-xs"
                >
                  <Icon name="close" size={14} />
                  선택 해제
                </button>
              </header>
              <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">
                <StatCard label="매출(합계)" value={focusRow.revenue} tone="sale" icon="trending-up" />
                <StatCard label="수금" value={focusRow.collected} tone="profit" icon="check" hint={`${focusRow.count}건`} />
                <StatCard
                  label="잔금"
                  value={Math.abs(focusRow.due)}
                  tone={focusRow.due > 0 ? 'loss' : 'profit'}
                  icon="coins"
                  hint={focusRow.due > 0 ? '미수금' : focusRow.due < 0 ? '반환 초과' : '정산 완료'}
                />
                <StatCard label="매입(합계)" value={focusRow.purchase} tone="opex" icon="cart" />
                <StatCard
                  label="미지급(확정)"
                  value={focusRow.payable}
                  tone={focusRow.payable > 0 ? 'loss' : 'neutral'}
                  icon="card"
                />
              </div>
              <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-500">
                거래처 대장에서 넘어온 값입니다. 아래 입금 내역도 이 거래처만 표시됩니다.
              </p>
            </section>
          ) : null}

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                {viewTab === 'project' ? '프로젝트별 수금 현황' : '거래처별 수금 현황'}
              </h2>
              <div className="inline-flex flex-wrap gap-1 rounded-lg bg-ink-100 p-1">
                {[
                  { key: 'project', label: '프로젝트별' },
                  { key: 'vendor', label: '거래처별' },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setViewTab(t.key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      t.key === viewTab ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </header>
            {viewTab === 'project' ? (
              rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">프로젝트</th>
                      <th className="th text-right">계약금액</th>
                      <th className="th text-right">매출(공급가)</th>
                      <th className="th text-right">이익률</th>
                      <th className="th text-right">수금</th>
                      <th className="th text-right">미수금</th>
                      <th className="th w-28">수금률</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {rows.map((r) => (
                      <tr key={r.project.id} className="transition hover:bg-ink-50/60">
                        <td className="td font-medium">
                          <Link
                            to={`/projects/${r.project.id}`}
                            className="text-ink-800 hover:text-brand-700 hover:underline"
                          >
                            {r.project.name}
                          </Link>
                        </td>
                        <td className="td num">{r.contract ? `${formatKRW(r.contract)}` : '—'}</td>
                        <td className="td num text-ink-500">{formatKRW(r.revenue)}</td>
                        <td className="td num">{r.margin === null ? '—' : formatPercent(r.margin)}</td>
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
            )
            ) : vendorRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">거래처</th>
                      <th className="th text-right">매출(합계)</th>
                      <th className="th text-right">수금</th>
                      <th className="th text-right">잔금</th>
                      <th className="th text-right">매입(합계)</th>
                      <th className="th text-right">미지급(확정)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {vendorRows.map((r) => (
                      <tr key={r.name} className="transition hover:bg-ink-50/60">
                        <td className="td font-medium">
                          <Link
                            to={`/partners?search=${encodeURIComponent(r.name)}`}
                            className="text-ink-800 hover:text-brand-700 hover:underline"
                          >
                            {r.name}
                          </Link>
                        </td>
                        <td className="td num text-ink-500">{formatKRW(r.revenue)}</td>
                        <td className="td num text-emerald-700">{formatKRW(r.collected)}</td>
                        <td className={`td num font-bold ${r.due > 0 ? 'text-loss' : 'text-ink-500'}`}>
                          {formatKRW(r.due)}
                        </td>
                        <td className="td num text-ink-500">{formatKRW(r.purchase)}</td>
                        <td className={`td num font-bold ${r.payable > 0 ? 'text-loss' : 'text-ink-300'}`}>
                          {r.payable ? formatKRW(r.payable) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="building" title="거래처 내역이 없습니다" />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                입금 내역
                {focusRow ? <span className="ml-1.5 font-normal text-brand-700">· {focusRow.name}</span> : null}
              </h2>
              {focusRow ? (
                <button type="button" onClick={clearFocus} className="btn-ghost !px-2 !py-1 text-xs">
                  전체 입금 보기
                </button>
              ) : null}
            </header>
            {listedCollections.length ? (
              <ul className="divide-y divide-ink-100">
                {listedCollections.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-24 shrink-0 text-xs font-semibold text-ink-500">
                      {formatDateHuman(c.collected_on)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800">
                      {projects.find((p) => p.id === c.project_id)?.name || '미지정'}
                      {c.counterparty ? <span className="ml-1.5 font-normal text-ink-500">{c.counterparty}</span> : null}
                      {c.memo ? <span className="ml-1.5 font-normal text-ink-400">· {c.memo}</span> : null}
                      {profileName(c.created_by) ? <span className="ml-1.5 font-normal text-ink-400">· 등록 {profileName(c.created_by)}</span> : null}
                    </span>
                    <span className="shrink-0 font-num text-sm font-extrabold tabular-nums text-ink-900">
                      {formatKRW(c.amount)}원
                    </span>
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="shrink-0 rounded-md p-1.5 text-ink-400 transition hover:bg-brand-50 hover:text-brand-700"
                          aria-label="수정"
                        >
                          <Icon name="pencil" size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoving(c)}
                          className="shrink-0 rounded-md p-1.5 text-ink-400 transition hover:bg-rose-50 hover:text-loss"
                          aria-label="삭제"
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="coins"
                title={focusRow ? `${focusRow.name} 입금 내역이 없습니다` : '입금 내역이 없습니다'}
                description={
                  focusRow
                    ? '이 거래처로 받은 돈이 아직 없습니다. 입금 등록으로 기록하세요.'
                    : '입금 등록으로 받으신 돈을 기록하세요.'
                }
              />
            )}
          </section>
        </>
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
          <div
            className="absolute inset-0 bg-ink-900/50"
            onClick={() => {
              if (!saving) {
                setFormOpen(false)
                setEditing(null)
              }
            }}
          />
          <form
            onSubmit={handleSave}
            className="relative z-10 w-full animate-fade-in rounded-t-2xl bg-white p-5 shadow-pop sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-base font-bold text-ink-900">{editing?.id ? '입금 수정' : '입금 등록'}</h2>
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
                입금처(거래처)
                <div className="mt-1.5">
                  <PartnerPicker
                    value={form.counterparty}
                    onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))}
                    placeholder="예: (주)이즈피엠피"
                  />
                </div>
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
                <AmountInput
                  className="input mt-1.5 text-left font-num tabular-nums"
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
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setFormOpen(false)
                  setEditing(null)
                }}
                disabled={saving}
              >
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
