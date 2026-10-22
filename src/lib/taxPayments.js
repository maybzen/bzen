/**
 * 세금·법정부담금 납부 기록.
 *
 * 별도 테이블을 만들려면 Supabase SQL 실행(DDL)이 필요한데,
 * 이 앱은 브라우저의 anon 키로만 접속하므로 DDL을 실행할 수 없습니다.
 * 그래서 이미 있는 checklist_items 테이블을 저장소로 씁니다.
 *   list = 'tax-payments' 로만 조회하므로 화면 체크리스트와 섞이지 않습니다.
 *   text 칸에 아래 JSON 한 건을 넣고, due_date 에 납부기한을 같이 저장합니다.
 *
 * 나중에 전용 테이블(tax_payments)을 만들게 되면 이 파일만 바꾸면 됩니다.
 */
import { addChecklistItem, deleteChecklistItem, listChecklistItems, updateChecklistItem } from './api'

export const TAX_PAYMENT_LIST = 'tax-payments'

/** 세금 + 4대보험(법정부담금) 구분 */
export const TAX_PAYMENT_TYPES = [
  { key: 'vat', label: '부가세', chip: 'bg-brand-50 text-brand-700', title: '부가세' },
  { key: 'withholding', label: '원천세', chip: 'bg-amber-50 text-amber-700', title: '원천세' },
  { key: 'corporate', label: '법인세', chip: 'bg-emerald-50 text-emerald-700', title: '법인세' },
  { key: 'local', label: '지방소득세', chip: 'bg-ink-100 text-ink-700', title: '지방소득세' },
  { key: 'insurance', label: '4대보험', chip: 'bg-sky-50 text-sky-700', title: '4대보험' },
  { key: 'other', label: '기타', chip: 'bg-ink-100 text-ink-600', title: '기타 법정부담금' },
]

export function taxPaymentType(type) {
  return TAX_PAYMENT_TYPES.find((t) => t.key === type) || TAX_PAYMENT_TYPES[5]
}

/** 부가세 신고 단위(q1/h1/q3/h2)의 고정 키 */
export function vatPaymentKey(year, key) {
  return `vat-${year}-${key}`
}

/** 달력 일정 id (with-2026-10, ins-2026-10, corp-2025 …) 를 그대로 키로 씁니다 */
export function deadlinePaymentKey(deadlineId) {
  return String(deadlineId || '')
}

export function newPaymentKey() {
  const rand = Math.random().toString(36).slice(2, 8)
  return `custom-${Date.now()}-${rand}`
}

export function parseTaxPayment(row) {
  if (!row) return null
  let data = null
  try {
    data = JSON.parse(row.text || '')
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const type = TAX_PAYMENT_TYPES.some((t) => t.key === data.type) ? data.type : 'other'
  return {
    id: row.id,
    key: String(data.key || row.id),
    type,
    title: String(data.title || taxPaymentType(type).title),
    period: String(data.period || ''),
    due: data.due || row.due_date || '',
    expected: Number(data.expected || 0),
    paid: Number(data.paid || 0),
    paidOn: String(data.paidOn || ''),
    memo: String(data.memo || ''),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function serializeTaxPayment(rec) {
  return JSON.stringify({
    key: rec.key,
    type: rec.type,
    title: rec.title,
    period: rec.period || '',
    due: rec.due || '',
    expected: Number(rec.expected || 0),
    paid: Number(rec.paid || 0),
    paidOn: rec.paidOn || '',
    memo: rec.memo || '',
  })
}

export async function listTaxPayments() {
  const rows = await listChecklistItems(TAX_PAYMENT_LIST)
  return (rows || []).map(parseTaxPayment).filter(Boolean)
}

export async function saveTaxPayment(rec, userId) {
  const text = serializeTaxPayment(rec)
  if (rec.id) {
    const row = await updateChecklistItem(rec.id, { text, due_date: rec.due || null })
    return parseTaxPayment(row)
  }
  const row = await addChecklistItem(TAX_PAYMENT_LIST, text, userId, {
    due_date: rec.due || undefined,
  })
  return parseTaxPayment(row)
}

export function removeTaxPayment(id) {
  return deleteChecklistItem(id)
}

/** 저장된 기록을 key 로 빠르게 찾기 */
export function paymentMap(payments) {
  const map = new Map()
  for (const p of payments || []) map.set(p.key, p)
  return map
}

/** 실납부 − 예상. 예상이 환급(음수)이면 비교하지 않습니다. */
export function paymentDiff(rec) {
  if (!rec) return null
  if (!rec.paid) return null
  if (Number(rec.expected || 0) < 0) return null
  return Number(rec.paid || 0) - Number(rec.expected || 0)
}
