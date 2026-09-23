import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { formatKRW, monthLabel, toISODate } from '../lib/format'
import { detectFixedCosts } from '../lib/summary'
import { listEntries } from '../lib/api'

/**
 * 고정비 현황 (별도 메뉴).
 * 최근 12개월 장부 전체에서 3개월 이상 · 월 금액 편차 35% 이내인
 * 거래처를 고정비로 자동 감지합니다.
 */
export default function FixedCosts() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const now = new Date()
    const from = toISODate(new Date(now.getFullYear(), now.getMonth() - 11, 1))
    listEntries({ from, to: toISODate(now), maxRows: 20000 })
      .then((rows) => {
        if (alive) setItems(detectFixedCosts(rows || []))
      })
      .catch((e) => toast.error(e.message))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [toast])

  const monthlyAvg = useMemo(() => items.reduce((a, f) => a + f.avg, 0), [items])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="고정비"
        description="매달 비슷하게 나가는 비용을 자동으로 찾아줍니다. 통신비처럼 성격별 항목은 장부에 그대로 두세요."
      />

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="고정비 거래처" value={String(items.length)} unit="곳" tone="neutral" icon="building" />
            <StatCard label="월 평균 합계" value={monthlyAvg} tone="brand" icon="coins" />
          </div>

          {items.length ? (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-xs">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">거래처</th>
                      <th className="th text-right">월 평균</th>
                      <th className="th text-right">감지 개월</th>
                      <th className="th text-right">최근 금액</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {items.map((f) => (
                      <tr key={f.name} className="transition hover:bg-ink-50/60">
                        <td className="td font-medium text-ink-900">{f.name}</td>
                        <td className="td num font-bold">{formatKRW(f.avg)}</td>
                        <td className="td num">{f.months}개월</td>
                        <td className="td num text-ink-500">
                          {formatKRW(f.last)} <span className="text-ink-400">({monthLabel(f.lastMonth)})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-ink-100 px-4 py-3 text-xs leading-relaxed text-ink-500">
                <Icon name="info" size={13} className="mr-1 inline text-ink-400" />
                기준: 최근 12개월 · 3개월 이상 등장 · 월 합계 편차 35% 이내. 자료가 쌓일수록 정확해집니다.
              </p>
            </div>
          ) : (
            <EmptyState
              icon="coins"
              title="감지된 고정비가 없습니다"
              description="자료가 3개월 이상 쌓이면 자동으로 잡힙니다."
            />
          )}
        </>
      )}
    </div>
  )
}
