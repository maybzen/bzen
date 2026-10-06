const krw = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })

export function formatKRW(value) {
  return krw.format(Math.round(Number(value) || 0))
}

export function formatWon(value) {
  return `${formatKRW(value)}원`
}

export function formatSignedKRW(value) {
  const n = Math.round(Number(value) || 0)
  return `${n > 0 ? '+' : ''}${krw.format(n)}`
}

/** 축/요약용 축약 표기: 1.2억, 3,400만 */
export function formatCompact(value) {
  const n = Number(value) || 0
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 100000000) {
    const x = abs / 100000000
    return `${sign}${x >= 10 ? Math.round(x) : x.toFixed(1)}억`
  }
  if (abs >= 10000) {
    const x = abs / 10000
    return `${sign}${x >= 100 ? Math.round(x) : x.toFixed(1)}만`
  }
  return `${sign}${krw.format(abs)}`
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toFixed(digits)}%`
}

export function formatFileSize(bytes) {
  const b = Number(bytes) || 0
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`
  return `${(b / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 거래처명 비교용 정규화.
 * 법인격 표기 차이((주)·주식회사 등)와 공백을 무시해 같은 거래처로 묶습니다.
 * 수금관리 ↔ 거래처 화면이 같은 이름으로 매칭되도록 양쪽에서 씁니다.
 */
export function normalizeVendorName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/\(주\)|\(재\)|\(사\)|주식회사|㈜/g, '')
    .toLowerCase()
}

/**
 * 프로젝트 계약금액 3종 (합계·공급가액·부가세).
 * migration_projects_contract.sql 실행 전에는 합계만 있어서 합계/1.1로 역산합니다.
 * 계약 대비 매출 비교는 공급가액끼리 해야 맞아서 supply 기준을 씁니다.
 */
export function contractSplit(p) {
  const total = Math.round(Number(p?.contract_amount) || 0)
  if (!total) return { total: 0, supply: 0, vat: 0 }
  const hasSplit = p?.contract_supply !== undefined && p?.contract_supply !== null
  if (hasSplit) {
    const supply = Math.round(Number(p.contract_supply) || 0)
    const vat = Math.round(Number(p.contract_vat) || 0)
    /* 면세 계약(공급가액 = 합계, 세액 0)도 정상 입력입니다.
       나눗셈 역산(합계 ÷ 1.1)으로 되돌리지 않고 입력값을 그대로 씁니다. */
    if (supply > 0) return { total, supply, vat }
    /* 둘 다 0이면 아직 분할 입력이 없는 상태로 보고 아래 역산으로 처리합니다 */
  }
  const supply = Math.round(total / 1.1)
  return { total, supply, vat: total - supply }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

export function toISODate(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

export function todayISO() {
  return toISODate(new Date())
}

/** 한국 시간(KST) 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKST() {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000)
  return toISODate(kst)
}

export function parseISO(s) {
  if (!s) return new Date()
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

export function monthStart(d = new Date()) {
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export function monthEnd(d = new Date()) {
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

export function monthKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function monthKeyOf(iso) {
  return String(iso || '').slice(0, 7)
}

export function monthLabel(key) {
  const [y, m] = String(key).split('-')
  return `${String(y).slice(2)}.${m}`
}

export function formatDateHuman(iso) {
  if (!iso) return '—'
  const d = parseISO(iso)
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function lastMonthKeys(n, endDate = new Date()) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(endDate, -i)))
  return out
}

export function changeRate(current, previous) {
  if (!previous) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** 대시보드/보고서 기간 프리셋 */
export function getPeriodRange(preset) {
  const now = new Date()
  switch (preset) {
    case 'thisMonth':
      return { from: monthStart(now), to: monthEnd(now), label: `${now.getFullYear()}년 ${now.getMonth() + 1}월` }
    case 'lastMonth': {
      const d = addMonths(now, -1)
      return { from: monthStart(d), to: monthEnd(d), label: `${d.getFullYear()}년 ${d.getMonth() + 1}월` }
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3)
      const s = new Date(now.getFullYear(), q * 3, 1)
      const e = new Date(now.getFullYear(), q * 3 + 3, 0)
      return { from: toISODate(s), to: toISODate(e), label: `${now.getFullYear()}년 ${q + 1}분기` }
    }
    case 'lastQuarter': {
      const d = addMonths(now, -3)
      const q = Math.floor(d.getMonth() / 3)
      const s = new Date(d.getFullYear(), q * 3, 1)
      const e = new Date(d.getFullYear(), q * 3 + 3, 0)
      return { from: toISODate(s), to: toISODate(e), label: `${d.getFullYear()}년 ${q + 1}분기` }
    }
    case 'thisYear':
      return {
        from: `${now.getFullYear()}-01-01`,
        to: `${now.getFullYear()}-12-31`,
        label: `${now.getFullYear()}년`,
      }
    case 'lastYear': {
      const y = now.getFullYear() - 1
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}년` }
    }
    default:
      return null
  }
}

/** 바로 앞의 동일 길이 기간(증감 비교용) */
export function previousPeriod(from, to) {
  if (!from || !to) return { from: '', to: '' }
  const a = parseISO(from)
  const b = parseISO(to)
  const days = Math.max(1, Math.round((b - a) / 86400000) + 1)
  const prevTo = new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1)
  const prevFrom = new Date(prevTo.getFullYear(), prevTo.getMonth(), prevTo.getDate() - (days - 1))
  return { from: toISODate(prevFrom), to: toISODate(prevTo) }
}
