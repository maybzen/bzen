import { todayISO } from './format'

const STORE_KEY = 'bzen.tax.v1'

/** 인수인계 기준일: 이 날짜 이전 납부기한은 이전 담당자 처리분으로 표시 */
export const INCHARGE_FROM = '2026-09-01'

export function isPrior(due) {
  return String(due) < INCHARGE_FROM
}

export const TAX_TYPES = {
  vat: { label: '부가세', chip: 'bg-brand-50 text-brand-700' },
  withholding: { label: '원천세', chip: 'bg-amber-50 text-amber-700' },
  corporate: { label: '법인세', chip: 'bg-emerald-50 text-emerald-700' },
  local: { label: '지방소득세', chip: 'bg-ink-100 text-ink-700' },
}

/** 신고별 준비물 체크리스트 */
export const TAX_DOCS = {
  vat: [
    '매출 세금계산서·현금영수증 정리 (홈택스 금액과 대조)',
    '매입 세금계산서·카드매입·현금영수증 정리',
    '불공제 매입 제외 확인 (접대비·차량유지비 등)',
    '장부 합계 ↔ 홈택스 합계 대조',
    '금진 전달: 과세기간 장부 CSV + 증빙 파일',
  ],
  withholding: [
    '급여·상여 대장 확정',
    '프리랜서·외주 지급명세 정리 (3.3% 원천징수)',
    '원천징수이행상황 신고서 작성',
    '납부서 출력·납부 (10일까지)',
  ],
  corporate: [
    '12월 결산 재무제표 확정',
    '세무조정 자료 정리 (감가상각·접대비·기부금 등)',
    '중간예납 납부액 확인',
    '금진 전달: 연간 장부 + 통장·카드 내역',
  ],
  local: ['법인세 신고 접수증 확인', '위택스에서 지방소득세 신고·납부'],
}

/**
 * 해당 연도에 납부기한이 돌아오는 신고 일정.
 * (12월 결산법인·일반과세자 기준. 기한이 주말·공휴일이면 다음 영업일로 미뤄지니
 *  임박 시 홈택스 공지로 재확인하세요.)
 */
export function buildTaxCalendar(year) {
  const y = Number(year)
  const list = [
    {
      id: `vat-final-${y - 1}h2`,
      type: 'vat',
      title: '부가세 2기 확정신고',
      period: `${y - 1}.7~12월분`,
      due: `${y}-01-25`,
      dataFrom: `${y - 1}-07-01`,
      dataTo: `${y - 1}-12-31`,
    },
    {
      id: `corp-${y - 1}`,
      type: 'corporate',
      title: '법인세 신고·납부',
      period: `${y - 1}년 귀속 (12월 결산)`,
      due: `${y}-03-31`,
    },
    {
      id: `vat-pre-${y}q1`,
      type: 'vat',
      title: '부가세 1기 예정신고',
      period: '1~3월분',
      due: `${y}-04-25`,
      dataFrom: `${y}-01-01`,
      dataTo: `${y}-03-31`,
    },
    {
      id: `local-${y - 1}`,
      type: 'local',
      title: '지방소득세 신고·납부',
      period: `${y - 1}년 귀속`,
      due: `${y}-04-30`,
    },
    {
      id: `vat-final-${y}h1`,
      type: 'vat',
      title: '부가세 1기 확정신고',
      period: '1~6월분',
      due: `${y}-07-25`,
      dataFrom: `${y}-01-01`,
      dataTo: `${y}-06-30`,
    },
    {
      id: `vat-pre-${y}q3`,
      type: 'vat',
      title: '부가세 2기 예정신고',
      period: '7~9월분',
      due: `${y}-10-25`,
      dataFrom: `${y}-07-01`,
      dataTo: `${y}-09-30`,
    },
  ]
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0')
    list.push({
      id: `with-${y}-${mm}`,
      type: 'withholding',
      title: '원천세 신고·납부',
      period: m === 1 ? `${y - 1}.12월분` : `${m - 1}월분`,
      due: `${y}-${mm}-10`,
    })
  }
  return list.sort((a, b) => (a.due < b.due ? -1 : 1))
}

/** YYYY-MM-DD 기준 일수 차이 (b - a) */
export function dayDiff(a, b) {
  const ms = Date.parse(`${b}T00:00:00+09:00`) - Date.parse(`${a}T00:00:00+09:00`)
  return Math.round(ms / 86400000)
}

export function dDayLabel(due, today = todayISO()) {
  const n = dayDiff(today, due)
  if (n > 0) return `D-${n}`
  if (n === 0) return 'D-day'
  return `D+${Math.abs(n)}`
}

export function isDone(state, id) {
  return Boolean(state?.[id]?.done)
}

export function checkProgress(state, deadline) {
  const docs = TAX_DOCS[deadline.type] || []
  if (!docs.length) return null
  const checks = state?.[deadline.id]?.checks || {}
  const done = docs.filter((_, i) => checks[i]).length
  return { done, total: docs.length }
}

/** 임박(앞으로 60일) + 최근 마감(지난 14일, 미완료만). 인수인계 이전분 제외 */
export function getUpcoming(deadlines, today = todayISO(), state = null) {
  return deadlines.filter((d) => {
    if (isPrior(d.due)) return false
    if (isDone(state, d.id)) return false
    const n = dayDiff(today, d.due)
    return n >= -14 && n <= 60
  })
}

/* ------------------------------ 저장소 ------------------------------ */

export function loadTaxState() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveTaxState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
  } catch {
    /* 저장 실패 무시 */
  }
}

export function toggleTaxCheck(state, id, index) {
  const prev = state?.[id] || {}
  const checks = { ...(prev.checks || {}) }
  if (checks[index]) delete checks[index]
  else checks[index] = true
  return { ...state, [id]: { ...prev, checks } }
}

export function setTaxDone(state, id, done) {
  const prev = state?.[id] || {}
  return { ...state, [id]: { ...prev, done } }
}

/* --------------------------- 부가세 예상 집계 --------------------------- */

function vatOf(entries, from, to) {
  let saleVat = 0
  let buyVat = 0
  let count = 0
  for (const e of entries || []) {
    const d = String(e.entry_date || '')
    if (d < from || d > to) continue
    count += 1
    if (e.entry_type === 'sale') saleVat += Number(e.vat_amount || 0)
    else buyVat += Number(e.vat_amount || 0)
  }
  return { saleVat, buyVat, net: saleVat - buyVat, count }
}

/** 선택 연도의 부가세 신고 단위(예정·확정)별 예상액 */
export function vatEstimateByFiling(entries, year) {
  const y = Number(year)
  const rows = [
    { key: 'q1', label: '1기 예정 (1~3월)', due: `${y}-04-25`, ...vatOf(entries, `${y}-01-01`, `${y}-03-31`) },
    { key: 'h1', label: '1기 확정 (1~6월)', due: `${y}-07-25`, ...vatOf(entries, `${y}-01-01`, `${y}-06-30`) },
    { key: 'q3', label: '2기 예정 (7~9월)', due: `${y}-10-25`, ...vatOf(entries, `${y}-07-01`, `${y}-09-30`) },
    { key: 'h2', label: '2기 확정 (7~12월)', due: `${y + 1}-01-25`, ...vatOf(entries, `${y}-07-01`, `${y}-12-31`) },
  ]
  return rows
}
