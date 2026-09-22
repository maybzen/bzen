import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import PeriodPicker, { usePeriod } from '../components/PeriodPicker'
import { useToast } from '../components/Toast'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { formatDateHuman, formatKRW } from '../lib/format'
import { listEntries } from '../lib/api'

/**
 * 거래처 목록.
 * 별도 테이블 없이 장부에 입력된 거래처명(counterparty)을 자동 집계합니다.
 * 거래처를 등록·수정하려면 장부 입력/수정에서 거래처명을 고치면 됩니다.
 */
export default function Partners() {
  const toast = useToast()
  const period = usePeriod('thisYear', 'bzen.period.partners')

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listEntries({ from: period.range.from, to: period.range.to })
      setEntries(rows)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [period.range.from, period.range.to, toast])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      const name = (e.counterparty || '').trim() || '미지정'
      if (!map.has(name)) {
        map.set(name, { name, sale: 0, purchase: 0, opex: 0, count: 0, last: '' })
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
  }, [entries, search])

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

  const ledgerLink = (to, name) =>
    name === '미지정' ? null : `${to}?search=${encodeURIComponent(name)}`

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="거래처"
        description="장부에 입력된 거래처명을 자동 집계합니다. 매출·매입 금액을 눌러 해당 장부로 이동할 수 있습니다."
      >
        <PeriodPicker period={period} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="거래처 수" value={String(rows.length)} unit="곳" tone="neutral" icon="building" />
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

        {loading ? (
          <LoadingBlock />
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">거래처</th>
                  <th className="th text-right">매출</th>
                  <th className="th text-right">매입</th>
                  <th className="th text-right">운영비</th>
                  <th className="th text-right">건수</th>
                  <th className="th text-right">최근 거래</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((row) => {
                  const saleLink = row.sale > 0 ? ledgerLink('/sales', row.name) : null
                  const purchaseLink = row.purchase > 0 ? ledgerLink('/purchases', row.name) : null
                  return (
                    <tr key={row.name} className="transition hover:bg-ink-50/60">
                      <td className="td max-w-[220px] truncate font-medium text-ink-800">{row.name}</td>
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
    </div>
  )
}
