import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import PartnerFormModal from '../components/PartnerFormModal'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, InlineAlert, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { useStaffPermissions } from '../lib/permissions'
import { formatDateHuman, formatKRW } from '../lib/format'
import {
  deletePartner,
  listEntries,
  listPartnerDocs,
  listPartners,
  partnersTableExists,
} from '../lib/api'

/**
 * 거래처 목록.
 * - 등록된 거래처(마스터)와 장부에만 있는 거래처명을 합쳐서 보여줍니다.
 * - 마스터 등록·수정·서류 관리는 관리자만, 조회·미리보기는 권한이 있는 직원도 가능합니다.
 */
export default function Partners() {
  const { isAdmin, user } = useAuth()
  const { perms } = useStaffPermissions()
  const toast = useToast()
  const period = usePeriod('thisYear', 'bzen.period.partners')

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [partners, setPartners] = useState([])
  const [docsByPartner, setDocsByPartner] = useState({})
  const [tableState, setTableState] = useState('checking')
  const [search, setSearch] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)

  const canSalesLedger = isAdmin || perms.includes('sales')
  const canPurchasesLedger = isAdmin || perms.includes('purchases')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, table] = await Promise.all([
        listEntries({ from: period.range.from, to: period.range.to }),
        partnersTableExists().catch(() => ({ available: false, missing: true })),
      ])
      setEntries(rows)
      if (table.available) {
        setTableState('ready')
        const master = await listPartners()
        setPartners(master || [])
        const ids = (master || []).map((p) => p.id)
        if (ids.length) {
          const docs = await listPartnerDocs(ids).catch(() => [])
          const map = {}
          for (const d of docs || []) {
            if (!map[d.partner_id]) map[d.partner_id] = []
            map[d.partner_id].push(d)
          }
          setDocsByPartner(map)
        } else {
          setDocsByPartner({})
        }
      } else {
        setTableState('missing')
        setPartners([])
        setDocsByPartner({})
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [period.range.from, period.range.to, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const rows = useMemo(() => {
    const map = new Map()
    for (const p of partners) {
      map.set(p.name.trim(), {
        key: `p:${p.id}`,
        name: p.name.trim(),
        partner: p,
        sale: 0,
        purchase: 0,
        opex: 0,
        count: 0,
        last: '',
      })
    }
    for (const e of entries) {
      const name = (e.counterparty || '').trim() || '미지정'
      if (!map.has(name)) {
        map.set(name, { key: `n:${name}`, name, partner: null, sale: 0, purchase: 0, opex: 0, count: 0, last: '' })
      }
      const row = map.get(name)
      const supply = Number(e.supply_amount || 0)
      if (e.entry_type === 'sale') row.sale += supply
      else if (e.entry_type === 'purchase') row.purchase += supply
      else if (e.entry_type === 'opex') row.opex += supply
      row.count += 1
      if (e.entry_date && e.entry_date > row.last) row.last = e.entry_date
    }
    const q = search.trim()
    const all = [...map.values()]
    const filtered = q ? all.filter((r) => r.name.includes(q)) : all
    return filtered.sort((a, b) => b.sale + b.purchase + b.opex - (a.sale + a.purchase + a.opex))
  }, [entries, partners, search])

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.sale += r.sale
          acc.purchase += r.purchase
          acc.count += r.count
          return acc
        },
        { sale: 0, purchase: 0, count: 0 },
      ),
    [rows],
  )

  const ledgerLink = (to, name) => (name === '미지정' ? null : `${to}?search=${encodeURIComponent(name)}`)

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deletePartner(removing)
      toast.success('거래처가 삭제되었습니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  const openNew = () => {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="거래처"
        description="등록된 거래처와 장부에 입력된 거래처를 함께 보여줍니다. 금액을 눌러 해당 장부로 이동할 수 있습니다."
      >
        <PeriodPicker period={period} />
        {isAdmin && tableState === 'ready' ? (
          <button type="button" className="btn-primary" onClick={openNew}>
            <Icon name="plus" size={16} />
            거래처 등록
          </button>
        ) : null}
      </PageHeader>

      {isAdmin && tableState === 'missing' ? (
        <InlineAlert tone="warning">
          거래처 등록·서류 기능을 쓰려면 Supabase 대시보드 → SQL Editor에서 저장소의
          <strong> supabase/migration_partners.sql </strong>
          파일을 실행해 주세요. 실행 전에는 장부 집계 목록만 표시됩니다.
        </InlineAlert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="거래처 수"
          value={String(rows.length)}
          unit="곳"
          tone="neutral"
          icon="building"
          hint={tableState === 'ready' ? `등록 ${partners.length}곳` : undefined}
        />
        <StatCard label="매출 합계" value={totals.sale} tone="sale" icon="trending-up" />
        <StatCard label="매입 합계" value={totals.purchase} tone="purchase" icon="cart" />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 px-4 py-3.5">
          <div className="relative">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              className="input pl-9"
              placeholder="거래처명 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading || tableState === 'checking' ? (
          <LoadingBlock />
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">거래처</th>
                  <th className="th">담당자</th>
                  <th className="th text-right">매출</th>
                  <th className="th text-right">매입</th>
                  <th className="th text-right">운영비</th>
                  <th className="th text-right">건수</th>
                  <th className="th text-right">최근 거래</th>
                  <th className="th text-right">서류</th>
                  {isAdmin && tableState === 'ready' ? <th className="th text-right">관리</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((row) => {
                  const saleLink = row.sale > 0 && canSalesLedger ? ledgerLink('/sales', row.name) : null
                  const purchaseLink =
                    row.purchase > 0 && canPurchasesLedger ? ledgerLink('/purchases', row.name) : null
                  const docCount = row.partner ? (docsByPartner[row.partner.id] || []).length : 0
                  return (
                    <tr key={row.key} className="transition hover:bg-ink-50/60">
                      <td className="td max-w-[200px]">
                        <span className="block truncate font-medium text-ink-800">{row.name}</span>
                        {row.partner ? (
                          <span className="chip mt-1 bg-brand-50 text-brand-700">등록됨</span>
                        ) : row.name !== '미지정' ? (
                          <span className="chip mt-1 bg-ink-100 text-ink-500">미등록</span>
                        ) : null}
                      </td>
                      <td className="td max-w-[160px] truncate text-xs text-ink-600">
                        {row.partner?.contact_person ? (
                          <>
                            {row.partner.contact_person}
                            {row.partner.job_title ? ` · ${row.partner.job_title}` : ''}
                          </>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                      <td className="td num">
                        {saleLink ? (
                          <Link to={saleLink} className="font-semibold text-brand-700 hover:underline">
                            {formatKRW(row.sale)}
                          </Link>
                        ) : (
                          formatKRW(row.sale)
                        )}
                      </td>
                      <td className="td num">
                        {purchaseLink ? (
                          <Link to={purchaseLink} className="font-semibold text-amber-700 hover:underline">
                            {formatKRW(row.purchase)}
                          </Link>
                        ) : (
                          formatKRW(row.purchase)
                        )}
                      </td>
                      <td className="td num">{formatKRW(row.opex)}</td>
                      <td className="td num">{row.count}건</td>
                      <td className="td num text-ink-500">{formatDateHuman(row.last)}</td>
                      <td className="td num">
                        {row.partner ? (
                          docCount ? (
                            <button
                              type="button"
                              onClick={() => (isAdmin ? (setEditing(row.partner), setFormOpen(true)) : setViewing(row.partner))}
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
                            >
                              <Icon name="paperclip" size={14} />
                              {docCount}
                            </button>
                          ) : (
                            <span className="text-xs text-ink-300">—</span>
                          )
                        ) : (
                          <span className="text-xs text-ink-300">—</span>
                        )}
                      </td>
                      {isAdmin && tableState === 'ready' ? (
                        <td className="td num whitespace-nowrap">
                          {row.partner ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing(row.partner)
                                  setFormOpen(true)
                                }}
                                className="mr-2 text-xs font-semibold text-brand-700 hover:underline"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => setRemoving(row.partner)}
                                className="text-xs font-semibold text-loss hover:underline"
                              >
                                삭제
                              </button>
                            </>
                          ) : row.name !== '미지정' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditing({ name: row.name })
                                setFormOpen(true)
                              }}
                              className="text-xs font-semibold text-brand-700 hover:underline"
                            >
                              등록
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="building"
            title={search ? '검색 결과가 없습니다' : '거래처 내역이 없습니다'}
            description={
              search
                ? '다른 거래처명으로 검색해 보세요.'
                : '기간을 넓히거나 장부에 거래처명을 입력해 보세요.'
            }
          />
        )}
      </div>

      {!loading && !entries.length && !search ? (
        <p className="text-center text-xs text-ink-400">
          선택한 기간에 장부 내역이 없습니다. 기간을 넓혀 보세요.
        </p>
      ) : null}

      <PartnerFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSaved={() => setReloadKey((k) => k + 1)}
        initial={editing}
        userId={user?.id}
      />

      <PartnerFormModal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        initial={viewing}
        readOnly
        userId={user?.id}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="거래처를 삭제하시겠습니까?"
        message={
          removing
            ? `${removing.name}\n등록된 서류도 함께 삭제됩니다. 장부 내역은 그대로 남습니다.`
            : ''
        }
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}
