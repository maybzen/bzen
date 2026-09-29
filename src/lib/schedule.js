/**
 * "이번 달 챙길 일" — 자동(대출 상환일·세금 캘린더) + 수동(날짜 체크리스트).
 *
 * 수동 항목의 due_date 컬럼은 supabase/migration_schedules.sql 로 추가합니다.
 * 실행 전에는 날짜 없이도 동작합니다 (날짜 미지정 그룹으로 표시).
 */
import { supabase } from './supabase'
import { parseISO, toISODate, todayISO } from './format'

export const SCHEDULE_LIST = 'schedule'

/* ------------------------------------------------------------------ */
/* 고정 캘린더 (매년 반복)                                               */
/* ------------------------------------------------------------------ */

export const TAX_RULES = [
  { key: 'salary', title: '급여 지급', day: 10, months: 'every', desc: '정기 급여 이체일' },
  { key: 'withholding', title: '원천세·지방세 납부', day: 10, months: 'every', desc: '전월 귀속분 납부기한' },
  { key: 'insurance', title: '4대보험료 납부', day: 10, months: 'every', desc: '고지분 납부' },
  { key: 'vat', title: '부가가치세 신고·납부', day: 25, months: [1, 4, 7, 10], desc: '예정(4·10월) / 확정(1·7월)' },
  { key: 'corp', title: '법인세 신고·납부', day: 31, months: [3], desc: '직전연도분 (3/31)' },
]

function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate()
}

function clampDay(year, month1, day) {
  return Math.min(day, daysInMonth(year, month1))
}

/** 규칙이 해당 연월에 만드는 날짜(ISO) 목록 */
export function ruleDates(rule, year, month1) {
  const months = rule.months === 'every' ? null : rule.months
  if (months && !months.includes(month1)) return []
  return [toISODate(new Date(year, month1 - 1, clampDay(year, month1, rule.day)))]
}

/** 대출 상환일이 해당 연월에 만드는 항목 */
export function loanDates(loan, year, month1) {
  const day = Number(loan?.pay_day) || 0
  if (!day) return []
  return [toISODate(new Date(year, month1 - 1, clampDay(year, month1, day)))]
}

/* ------------------------------------------------------------------ */
/* 기간 내 일정 합성                                                     */
/* ------------------------------------------------------------------ */

/**
 * @returns [{ key, date, title, detail, kind: 'auto'|'manual', source, done, refId }]
 * kind=auto 는 계산된 항목(수정 불가), manual 은 checklist_items 행입니다.
 */
export function buildSchedule({ loans = [], manuals = [], fromISO, toISO }) {
  const out = []
  const seenMonths = new Set()
  const d0 = parseISO(fromISO)
  const d1 = parseISO(toISO)
  const cursor = new Date(d0.getFullYear(), d0.getMonth(), 1)
  const end = new Date(d1.getFullYear(), d1.getMonth(), 1)
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const m = cursor.getMonth() + 1
    const tag = `${y}-${m}`
    if (!seenMonths.has(tag)) {
      seenMonths.add(tag)
      for (const rule of TAX_RULES) {
        for (const date of ruleDates(rule, y, m)) {
          if (date >= fromISO && date <= toISO) {
            out.push({ key: `tax-${rule.key}-${date}`, date, title: rule.title, detail: rule.desc, kind: 'auto', source: '세금·급여' })
          }
        }
      }
      for (const loan of loans) {
        for (const date of loanDates(loan, y, m)) {
          if (date >= fromISO && date <= toISO) {
            out.push({
              key: `loan-${loan.id}-${date}`,
              date,
              title: `${loan.bank || '대출'} 상환`,
              detail: `${loan.product || ''}${loan.monthly_pay ? ` · 월 ${Number(loan.monthly_pay).toLocaleString()}원` : ''}`,
              kind: 'auto',
              source: '대출',
            })
          }
        }
      }
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }

  for (const row of manuals || []) {
    if (row.done) continue
    const date = row.due_date || ''
    if (date && (date < fromISO || date > toISO)) continue
    out.push({
      key: `manual-${row.id}`,
      date,
      title: row.text,
      detail: '',
      kind: 'manual',
      source: '직접 등록',
      done: !!row.done,
      refId: row.id,
    })
  }

  out.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title, 'ko'))
  return out
}

/* ------------------------------------------------------------------ */
/* D-day                                                              */
/* ------------------------------------------------------------------ */

export function dday(dateISO, baseISO = todayISO()) {
  if (!dateISO) return null
  const ms = parseISO(dateISO).getTime() - parseISO(baseISO).getTime()
  return Math.round(ms / 86400000)
}

export function ddayLabel(dateISO, baseISO = todayISO()) {
  const d = dday(dateISO, baseISO)
  if (d === null) return '날짜 없음'
  if (d === 0) return 'D-day'
  if (d > 0) return `D-${d}`
  return `D+${-d} 지남`
}

/** 달력 그리드용: 해당 월의 6주(일~토) 날짜 배열 */
export function monthGrid(year, month1) {
  const first = new Date(year, month1 - 1, 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return toISODate(d)
  })
}

export function monthTitle(year, month1) {
  return `${year}.${String(month1).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* due_date 컬럼 유무 (마이그레이션 전 graceful fallback)                 */
/* ------------------------------------------------------------------ */

let dueDateCache = null

export async function dueDateSupported() {
  if (dueDateCache !== null) return dueDateCache
  try {
    const { error } = await supabase.from('checklist_items').select('due_date').limit(1)
    dueDateCache = !error
  } catch {
    dueDateCache = false
  }
  return dueDateCache
}
