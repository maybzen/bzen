import { monthKeyOf } from './format'

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
 * 매출/매입/운영비 집계.
 * 영업이익은 부가세를 제외한 "공급가액" 기준으로 계산합니다.
 */
export function summarize(entries) {
  const sale = EMPTY()
  const purchase = EMPTY()
  const opex = EMPTY()

  for (const e of entries || []) {
    if (e.entry_type === 'sale') addTo(sale, e)
    else if (e.entry_type === 'purchase') addTo(purchase, e)
    else if (e.entry_type === 'opex') addTo(opex, e)
  }

  const revenue = sale.supply
  const cost = purchase.supply + opex.supply
  const profit = revenue - cost
  const margin = revenue ? (profit / revenue) * 100 : null
  // 부가세 납부 예상액 (매출세액 - 매입세액)
  const vatPayable = sale.vat - purchase.vat - opex.vat

  return {
    sale,
    purchase,
    opex,
    revenue,
    cost,
    profit,
    margin,
    vatPayable,
    count: (entries || []).length,
  }
}

export function groupByMonth(entries, monthKeys) {
  const map = new Map(
    monthKeys.map((m) => [m, { month: m, sale: 0, purchase: 0, opex: 0, profit: 0 }]),
  )
  for (const e of entries || []) {
    const row = map.get(monthKeyOf(e.entry_date))
    if (!row) continue
    const supply = Number(e.supply_amount || 0)
    if (e.entry_type === 'sale') row.sale += supply
    else if (e.entry_type === 'purchase') row.purchase += supply
    else if (e.entry_type === 'opex') row.opex += supply
  }
  for (const row of map.values()) row.profit = row.sale - row.purchase - row.opex
  return [...map.values()]
}

export function groupByProject(entries, projects) {
  const map = new Map()
  for (const p of projects || []) {
    map.set(p.id, { project: p, sale: 0, purchase: 0, opex: 0, profit: 0, margin: null, count: 0 })
  }
  const unassigned = {
    project: null,
    sale: 0,
    purchase: 0,
    opex: 0,
    profit: 0,
    margin: null,
    count: 0,
  }

  for (const e of entries || []) {
    const row = e.project_id && map.has(e.project_id) ? map.get(e.project_id) : unassigned
    const supply = Number(e.supply_amount || 0)
    if (e.entry_type === 'sale') row.sale += supply
    else if (e.entry_type === 'purchase') row.purchase += supply
    else if (e.entry_type === 'opex') row.opex += supply
    row.count += 1
  }

  const rows = [...map.values()]
  if (unassigned.count) rows.push(unassigned)
  for (const r of rows) {
    r.profit = r.sale - r.purchase - r.opex
    r.margin = r.sale ? (r.profit / r.sale) * 100 : null
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
