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
    case 'last12': {
      const s = addMonths(now, -11)
      return { from: monthStart(s), to: monthEnd(now), label: '최근 12개월' }
    }
    case 'all':
      return { from: '', to: '', label: '전체 기간' }
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
