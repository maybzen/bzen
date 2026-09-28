import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { EmptyState, LoadingBlock, PageHeader, SegmentedControl, StatCard } from '../components/ui'
import { formatKRW, monthEnd, monthKey, monthKeyOf, monthLabel, todayISO, toISODate } from '../lib/format'
import { INTERNAL_PROJECT_NAME } from '../lib/constants'
import { detectFixedCosts } from '../lib/summary'
import { listEntries, listProjects } from '../lib/api'

/**
 * 고정비 현황 (별도 메뉴).
 * 최근 12개월 장부 전체에서 3개월 이상 · 월 금액 편차 35% 이내인
 * 거래처를 고정비로 자동 감지합니다.
 * 항목표 탭은 사내 고정비·변동비 항목(출금예상표 기준)과 장부 실제를 대조합니다.
 */
const OVERHEAD_RULES = [
  { name: '4대보험 회사부담분', kind: '고정비', test: (e) => (e.counterparty || '') === '국민건강보험공단' },
  { name: '퇴직연금', kind: '고정비', test: (e) => /퇴직연금/.test(`${e.description || ''} ${e.memo || ''}`) },
  { name: '원천세', kind: '고정비', test: (e) => /원천세/.test(`${e.description || ''} ${e.memo || ''}`) },
  { name: '급여', kind: '고정비', test: (e) => e.entry_type === 'opex' && e.category === '인건비' && e.counterparty !== '국민건강보험공단' },
  { name: '사무실 관리비', kind: '고정비', test: (e) => /진흥원/.test(e.counterparty || '') },
  { name: 'LG 공기청정기', kind: '고정비', test: (e) => /엘지전자/.test(e.counterparty || '') },
  { name: '포켓와이파이', kind: '고정비', test: (e) => /포켓|에그/.test(`${e.description || ''} ${e.memo || ''}`) },
  { name: '부영 복합기', kind: '고정비', test: (e) => /부영사무기/.test(e.counterparty || '') },
  { name: 'KT 인터넷·전화', kind: '고정비', test: (e) => /케이티|^KT|KT[0-9]/.test(e.counterparty || '') },
  { name: '기장수수료', kind: '고정비', test: (e) => /기장/.test(`${e.description || ''} ${e.memo || ''}`) },
  { name: '생수', kind: '고정비', test: (e) => {
    const t = `${e.counterparty || ''} ${e.description || ''} ${e.memo || ''}`
    if (/몽베스트|생수/.test(t)) return true
    return /쿠팡/.test(e.counterparty || '') && /생수|몽베스트|워터|음료/.test(`${e.description || ''} ${e.memo || ''}`)
  } },
  { name: '대출이자·원리금', kind: '고정비', test: (e) => /대출/.test(`${e.description || ''} ${e.memo || ''}`) },
  { name: 'AI 구독료', kind: '변동비', test: (e) => /GPT|Claude|Perplexity|Grok|구독|AI /.test(`${e.counterparty || ''} ${e.description || ''} ${e.memo || ''}`) },
  { name: '법인카드', kind: '변동비', test: (e) => e.source === 'card' },
  { name: '연말정산·세금', kind: '변동비', test: (e) => /연말정산|자동차세|면허세/.test(`${e.description || ''} ${e.memo || ''}`) || (e.category === '세금과공과' && !/원천세/.test(`${e.description || ''} ${e.memo || ''}`)) },
]
export default function FixedCosts() {
  const toast = useToast()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [internalId, setInternalId] = useState('')
  const [excluded, setExcluded] = useState(() => {
    try {
      const raw = localStorage.getItem('bzen.fixed.excluded.v1')
      if (!raw) return ['영일미디어', 'BT애드']
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('bzen.fixed.excluded.v1', JSON.stringify(excluded))
    } catch {
      /* 저장 실패 무시 */
    }
  }, [excluded])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const now = new Date()
    const from = toISODate(new Date(now.getFullYear(), now.getMonth() - 11, 1))
    Promise.all([listEntries({ from, to: toISODate(now), maxRows: 20000 }), listProjects()])
      .then(([rows, projectRows]) => {
        if (!alive) return
        setEntries(rows || [])
        setInternalId((projectRows || []).find((p) => p.name === INTERNAL_PROJECT_NAME)?.id || '')
      })
      .catch((e) => toast.error(e.message))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [toast])


  /* 고정비 감지에서는 급여(인건비) 제외 — 외주·업체 고정비만 봅니다 */
  const items = useMemo(
    () => detectFixedCosts((entries || []).filter((e) => e.category !== '인건비'), { exclude: excluded }),
    [entries, excluded],
  )

  const monthlyAvg = useMemo(() => items.reduce((a, f) => a + f.avg, 0), [items])

  /** 월별 인건비 (급여) 추이 — 고정비 자동감지와 별도로 합산 */
  const payrollByMonth = useMemo(() => {
    const map = new Map()
    for (const e of entries) {
      if (e.entry_type !== 'opex' || e.category !== '인건비') continue
      const mk = monthKeyOf(e.entry_date)
      if (!mk) continue
      if (!map.has(mk)) map.set(mk, { total: 0, byPerson: new Map() })
      const row = map.get(mk)
      const amt = Number(e.total_amount || 0)
      row.total += amt
      const name = (e.counterparty || '').trim() || '미지정'
      row.byPerson.set(name, (row.byPerson.get(name) || 0) + amt)
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-12)
      .map(([mk, row]) => ({
        mk,
        total: row.total,
        persons: [...row.byPerson.entries()].sort((a, b) => b[1] - a[1]),
      }))
  }, [entries])
  const payrollAvg = useMemo(
    () => (payrollByMonth.length ? Math.round(payrollByMonth.reduce((a, r) => a + r.total, 0) / payrollByMonth.length) : 0),
    [payrollByMonth],
  )
  const thisMonthKey = monthKey(new Date())
  const thisMonthPayroll = payrollByMonth.find((r) => r.mk === thisMonthKey)?.total || 0
  const [tab, setTab] = useState('overhead')

  /** 고정비·변동비 항목표 (출금예상표 기준 항목과 장부 대조, 첫 매칭 항목에만 귀속) */
  const overhead = useMemo(() => {
    const months = new Set((entries || []).map((e) => monthKeyOf(e.entry_date)).filter(Boolean)).size || 1
    const rows = OVERHEAD_RULES.map((rule) => ({ ...rule, total: 0, count: 0 }))
    for (const e of entries || []) {
      if (e.entry_type !== 'purchase' && e.entry_type !== 'opex') continue
      const hit = rows.find((r) => r.test(e))
      if (!hit) continue
      hit.total += Number(e.total_amount || 0)
      hit.count += 1
    }
    return { rows, months }
  }, [entries])
  /** 공통(사내 귀속) 월별 지출 — 프로젝트 미지정분이 모이는 곳 */
  const internalByMonth = useMemo(() => {
    if (!internalId) return []
    const map = new Map()
    for (const e of entries) {
      if (e.project_id !== internalId) continue
      if (e.entry_type !== 'purchase' && e.entry_type !== 'opex') continue
      const mk = monthKeyOf(e.entry_date)
      if (!mk) continue
      map.set(mk, (map.get(mk) || 0) + Number(e.total_amount || 0))
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-12)
  }, [entries, internalId])
  const internalAvg = useMemo(
    () => (internalByMonth.length ? Math.round(internalByMonth.reduce((a, [, v]) => a + v, 0) / internalByMonth.length) : 0),
    [internalByMonth],
  )

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
            <StatCard label="고정비 월 평균" value={monthlyAvg} tone="neutral" icon="chart" />
            <StatCard label="급여 월 평균" value={payrollAvg} tone="opex" icon="coins" hint="인건비 기준" />
            <StatCard
              label="이번달 고정지출"
              value={monthlyAvg + thisMonthPayroll}
              tone="brand"
              icon="coins"
              hint={thisMonthPayroll ? '고정비 평균 + 이번달 급여' : '고정비 평균 기준'}
            />
          </div>

          <div className="card px-4 py-3">
            <SegmentedControl
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { key: 'overhead', label: '항목표' },
                { key: 'fixed', label: `고정비 (${items.length})` },
                { key: 'payroll', label: '월별급여' },
                { key: 'internal', label: '공통월별지출' },
              ]}
            />
          </div>

          {tab === 'overhead' ? (
            <section className="flex flex-col gap-4">
              {['고정비', '변동비'].map((kind) => {
                const list = overhead.rows.filter((r) => r.kind === kind)
                const kindTotal = list.reduce((a, r) => a + r.total, 0)
                return (
                  <div key={kind} className="card overflow-hidden">
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
                      <h2 className="text-sm font-bold text-ink-900">{kind}</h2>
                      <p className="text-xs text-ink-500">
                        합계 <strong className="font-num tabular-nums text-ink-900">{formatKRW(kindTotal)}원</strong>
                        {' · '}월 평균{' '}
                        <strong className="font-num tabular-nums text-brand-700">
                          {formatKRW(Math.round(kindTotal / overhead.months))}원
                        </strong>
                      </p>
                    </header>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] border-collapse text-xs">
                        <thead className="bg-ink-50/70">
                          <tr>
                            <th className="th">항목</th>
                            <th className="th text-right">합계</th>
                            <th className="th text-right">월 평균</th>
                            <th className="th text-right">상태</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100">
                          {list.map((r) => (
                            <tr
                              key={r.name}
                              className="cursor-pointer transition hover:bg-ink-50/60"
                              onClick={() => navigate(`/expenses?search=${encodeURIComponent(r.name)}&from=2026-01-01&to=${todayISO()}`)}
                              title="운영비 내역 보기"
                            >
                              <td className="td font-medium text-ink-900">{r.name}</td>
                              <td className="td num font-bold">{formatKRW(r.total)}</td>
                              <td className="td num text-ink-500">{formatKRW(Math.round(r.total / overhead.months))}</td>
                              <td className="td num">
                                {r.count ? (
                                  <span className="text-ink-500">{r.count}건</span>
                                ) : (
                                  <span className="chip bg-amber-50 text-amber-700">미등록</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
              <p className="text-xs leading-relaxed text-ink-500">
                출금예상표 항목 순서대로 첫 매칭 항목에만 집계됩니다. 미등록 항목은 장부에 없는 고정 지출일 수 있으니 확인해 주세요.
              </p>
            </section>
          ) : null}

          {tab === 'payroll' && payrollByMonth.length ? (
            <section className="card overflow-hidden">
              <header className="border-b border-ink-200 px-4 py-3.5">
                <h2 className="text-sm font-bold text-ink-900">월별 급여 (최근 12개월)</h2>
              </header>
              <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-3 xl:grid-cols-4">
                {payrollByMonth.map((r) => {
                  const [y, m] = r.mk.split('-').map(Number)
                  const from = `${r.mk}-01`
                  const to = monthEnd(new Date(y, m, 0))
                  return (
                    <Link
                      key={r.mk}
                      to={`/expenses?search=${encodeURIComponent('인건비')}&from=${from}&to=${to}`}
                      className="group rounded-xl border border-ink-200 px-3.5 py-3 transition hover:border-brand-300 hover:shadow-card"
                    >
                      <p className="text-xs font-semibold text-ink-500">{monthLabel(r.mk)}</p>
                      <p className="mt-1 font-num text-base font-extrabold tabular-nums tracking-tight text-ink-900">
                        {formatKRW(r.total)}
                        <span className="text-xs font-semibold text-ink-400">원</span>
                      </p>
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        {r.persons.slice(0, 3).map(([name, v]) => (
                          <p key={name} className="flex items-baseline justify-between gap-2 text-[11px] text-ink-500">
                            <span className="truncate">{name}</span>
                            <span className="shrink-0 font-num tabular-nums">{formatKRW(v)}</span>
                          </p>
                        ))}
                        {r.persons.length > 3 ? (
                          <p className="text-[11px] text-ink-400">외 {r.persons.length - 3}명</p>
                        ) : null}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          ) : null}

          {tab === 'internal' && internalByMonth.length ? (
            <section className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
                <h2 className="text-sm font-bold text-ink-900">공통 월별 지출</h2>
                <p className="text-xs text-ink-500">
                  월 평균 <strong className="font-num tabular-nums text-brand-700">{formatKRW(internalAvg)}원</strong>
                </p>
              </header>
              <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-3 xl:grid-cols-4">
                {internalByMonth.map(([mk, v]) => {
                  const [y, m] = mk.split('-').map(Number)
                  const from = `${mk}-01`
                  const to = monthEnd(new Date(y, m, 0))
                  return (
                    <Link
                      key={mk}
                      to={`/expenses?project=${internalId}&from=${from}&to=${to}`}
                      className="group rounded-xl border border-ink-200 px-3.5 py-3 transition hover:border-brand-300 hover:shadow-card"
                    >
                      <p className="text-xs font-semibold text-ink-500">{monthLabel(mk)}</p>
                      <p className="mt-1 font-num text-base font-extrabold tabular-nums tracking-tight text-ink-900">
                        {formatKRW(v)}
                        <span className="text-xs font-semibold text-ink-400">원</span>
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-brand-700 opacity-0 transition group-hover:opacity-100">
                        내역 보기 →
                      </p>
                    </Link>
                  )
                })}
              </div>
              <p className="border-t border-ink-100 px-4 py-3 text-xs leading-relaxed text-ink-500">
                프로젝트 미지정분은 모두 여기로 모입니다. 카드를 누르면 운영비 내역으로 이동합니다.
              </p>
            </section>
          ) : null}

          {tab === 'fixed' && items.length ? (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-xs">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">거래처</th>
                      <th className="th text-right">월 평균</th>
                      <th className="th text-right">감지 개월</th>
                      <th className="th text-right">최근 금액</th>
                      <th className="th w-20">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {items.map((f) => (
                      <tr
                        key={f.name}
                        className="cursor-pointer transition hover:bg-ink-50/60"
                        onClick={() => navigate(`/expenses?search=${encodeURIComponent(f.name)}&from=2026-01-01&to=${todayISO()}`)}
                        title="운영비 내역 보기"
                      >
                        <td className="td font-medium text-ink-900">{f.name}</td>
                        <td className="td num font-bold">{formatKRW(f.avg)}</td>
                        <td className="td num">{f.months}개월</td>
                        <td className="td num text-ink-500">
                          {formatKRW(f.last)} <span className="text-ink-400">({monthLabel(f.lastMonth)})</span>
                        </td>
                        <td className="td">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExcluded((prev) => (prev.includes(f.name) ? prev : [...prev, f.name]))
                              toast.success(`'${f.name}'을(를) 고정비에서 제외했습니다.`)
                            }}
                            className="text-xs font-semibold text-ink-400 hover:text-loss hover:underline"
                          >
                            제외
                          </button>
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
              {excluded.length ? (
                <div className="border-t border-ink-100 px-4 py-3">
                  <p className="mb-2 text-xs font-bold text-ink-600">제외된 거래처 {excluded.length}곳</p>
                  <div className="flex flex-wrap gap-1.5">
                    {excluded.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setExcluded((prev) => prev.filter((n) => n !== name))}
                        className="chip bg-ink-100 text-ink-600 transition hover:bg-emerald-50 hover:text-emerald-700"
                        title="클릭하면 복원됩니다"
                      >
                        {name} ×
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : tab === 'fixed' ? (
            <EmptyState
              icon="coins"
              title="감지된 고정비가 없습니다"
              description="자료가 3개월 이상 쌓이면 자동으로 잡힙니다."
            />
          ) : null}
        </>
      )}
    </div>
  )
}
