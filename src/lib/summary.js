import { monthKey, monthKeyOf } from './format'
import { isNonOperatingSale } from './constants'

const EMPTY = () => ({ supply: 0, vat: 0, total: 0, count: 0 })

function addTo(bucket, entry) {
  const supply = Number(entry.supply_amount || 0)
  const vat = Number(entry.vat_amount || 0)
  const total = Number(entry.total_amount ?? supply + vat)
  bucket.supply += supply
  bucket.vat += vat
  bucket.total += total
  bucket.count += 1
}

/**
 * 세무·회계 기준 손익 구조.
 *   순매출액(공급가액) → 매출원가(매입) → 매출총이익 → 경비(운영비) → 영업이익
 * 부가세는 통과 항목이므로 공급가액(부가세 제외)만 집계합니다.
 */
export function buildPnl(sale, purchase, opex) {
  const revenue = Number(sale || 0)
  const cogs = Number(purchase || 0)
  const gross = revenue - cogs
  const expense = Number(opex || 0)
  const operating = gross - expense
  return {
    revenue,
    cogs,
    gross,
    expense,
    operating,
    grossMargin: revenue ? (gross / revenue) * 100 : null,
    operatingMargin: revenue ? (operating / revenue) * 100 : null,
  }
}

/**
 * 매출/매입/운영비 집계.
 * 영업이익은 부가세를 제외한 "공급가액" 기준으로 계산합니다.
 * sale 중 지원금·보조금, 환급금·환입은 영업매출이 아니므로 revenue에서 제외하고
 * nonOp(영업외수익)으로 따로 집계합니다. 부가세도 과세 매출만으로 계산합니다.
 */
export function summarize(entries) {
  const sale = EMPTY()
  const purchase = EMPTY()
  const opex = EMPTY()
  const nonOp = EMPTY()

  for (const e of entries || []) {
    if (e.entry_type === 'sale') {
      if (isNonOperatingSale(e)) addTo(nonOp, e)
      else addTo(sale, e)
    } else if (e.entry_type === 'purchase') addTo(purchase, e)
    else if (e.entry_type === 'opex') addTo(opex, e)
  }

  const pnl = buildPnl(sale.supply, purchase.supply, opex.supply)
  // 부가세 납부 예상액 (매출세액 - 매입세액). 영업외(지원금·환입, VAT 0)는 제외.
  const vatPayable = sale.vat - purchase.vat - opex.vat

  return {
    sale,
    purchase,
    opex,
    nonOp,
    ...pnl,
    revenue: pnl.revenue,
    cost: pnl.cogs + pnl.expense,
    profit: pnl.operating,
    margin: pnl.operatingMargin,
    /** 영업외수익(지원금·환입) 공급가액. 영업이익에 포함되지 않습니다. */
    otherIncome: nonOp.supply,
    vatPayable,
    count: (entries || []).length,
  }
}

export function groupByMonth(entries, monthKeys) {
  const map = new Map(
    monthKeys.map((m) => [m, { month: m, sale: 0, purchase: 0, opex: 0, nonOp: 0, profit: 0 }]),
  )
  for (const e of entries || []) {
    const row = map.get(monthKeyOf(e.entry_date))
    if (!row) continue
    const supply = Number(e.supply_amount || 0)
    if (e.entry_type === 'sale') {
      if (isNonOperatingSale(e)) row.nonOp += supply
      else row.sale += supply
    } else if (e.entry_type === 'purchase') row.purchase += supply
    else if (e.entry_type === 'opex') row.opex += supply
  }
  for (const row of map.values()) row.profit = row.sale - row.purchase - row.opex
  return [...map.values()]
}

export function groupByProject(entries, projects) {
  const map = new Map()
  for (const p of projects || []) {
    map.set(p.id, { project: p, sale: 0, purchase: 0, opex: 0, nonOp: 0, saleVat: 0, purchaseVat: 0, opexVat: 0, profit: 0, margin: null, count: 0 })
  }
  const unassigned = {
    project: null,
    sale: 0,
    purchase: 0,
    opex: 0,
    nonOp: 0,
    saleVat: 0,
    purchaseVat: 0,
    opexVat: 0,
    profit: 0,
    margin: null,
    count: 0,
  }

  for (const e of entries || []) {
    const row = e.project_id && map.has(e.project_id) ? map.get(e.project_id) : unassigned
    const supply = Number(e.supply_amount || 0)
    const vat = Number(e.vat_amount || 0)
    if (e.entry_type === 'sale') {
      if (isNonOperatingSale(e)) { row.nonOp += supply }
      else { row.sale += supply; row.saleVat += vat }
    }
    else if (e.entry_type === 'purchase') { row.purchase += supply; row.purchaseVat += vat }
    else if (e.entry_type === 'opex') { row.opex += supply; row.opexVat += vat }
    row.count += 1
  }

  const rows = [...map.values()]
  if (unassigned.count) rows.push(unassigned)
  for (const r of rows) {
    const pnl = buildPnl(r.sale, r.purchase, r.opex)
    r.gross = pnl.gross
    r.grossMargin = pnl.grossMargin
    r.profit = pnl.operating
    r.margin = pnl.operatingMargin
  }
  return rows
}

export function groupByCategory(entries, type) {
  const map = new Map()
  for (const e of entries || []) {
    if (type && e.entry_type !== type) continue
    const key = e.category || '미분류'
    if (!map.has(key)) map.set(key, { category: key, type: e.entry_type, supply: 0, vat: 0, total: 0, count: 0 })
    const row = map.get(key)
    row.supply += Number(e.supply_amount || 0)
    row.vat += Number(e.vat_amount || 0)
    row.total += Number(e.total_amount || 0)
    row.count += 1
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

export function groupByCounterparty(entries, type) {
  const map = new Map()
  for (const e of entries || []) {
    if (type && e.entry_type !== type) continue
    const key = (e.counterparty || '').trim() || '미지정'
    if (!map.has(key)) map.set(key, { name: key, supply: 0, total: 0, count: 0 })
    const row = map.get(key)
    row.supply += Number(e.supply_amount || 0)
    row.total += Number(e.total_amount || 0)
    row.count += 1
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

/**
 * 고정비 자동 감지.
 * 같은 거래처가 여러 달에 걸��� 비슷한 금액으로 "나가는" 돈이면 고정비로 봅니다.
 * 기준: 최근 12개월 중 3개월 이상 등장 + 월 합계 편차(CV) 35% 이내
 *
 * 주의: 매출(sale)은 지출이 아니라 수입이므로 제외합니다.
 * 같은 거래처에 매출과 지출이 섞여 있어도(예: 부산광역시 广告료 용역 + 세금과공과)
 * 지출 쪽만 고정비 후보로 봅니다.
 */
export function detectFixedCosts(entries, { months = 12, minMonths = 3, maxCV = 0.35, exclude = [], types = ['purchase', 'opex'] } = {}) {
  const now = new Date()
  const fromKey = monthKey(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1))
  const perName = new Map()
  for (const e of entries || []) {
    if (types && !types.includes(e.entry_type)) continue
    const mk = monthKeyOf(e.entry_date)
    if (!mk || mk < fromKey) continue
    const name = (e.counterparty || '').trim()
    if (!name || name === '미지정') continue
    if (exclude.includes(name)) continue
    if (!perName.has(name)) perName.set(name, new Map())
    const byMonth = perName.get(name)
    byMonth.set(mk, (byMonth.get(mk) || 0) + Number(e.total_amount || 0))
  }
  const out = []
  for (const [name, byMonth] of perName) {
    const totals = [...byMonth.values()]
    if (byMonth.size < minMonths) continue
    const avg = totals.reduce((a, v) => a + v, 0) / totals.length
    if (!avg) continue
    const variance = totals.reduce((a, v) => a + (v - avg) ** 2, 0) / totals.length
    const cv = Math.sqrt(variance) / avg
    if (cv > maxCV) continue
    const monthsSorted = [...byMonth.keys()].sort()
    const lastKey = monthsSorted[monthsSorted.length - 1]
    out.push({
      name,
      months: byMonth.size,
      avg: Math.round(avg),
      last: Math.round(byMonth.get(lastKey) || 0),
      lastMonth: lastKey,
      count: totals.length,
    })
  }
  return out.sort((a, b) => b.avg - a.avg)
}
