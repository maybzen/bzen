export const APP_NAME = '회계관리 시스템'
export const DEFAULT_COMPANY = '비젠커뮤니케이션'
export const COMPANY_EN = 'BZen Communication'

/** 통합 장부에서 사용하는 3가지 유형 */
export const ENTRY_META = {
  sale: {
    key: 'sale',
    label: '매출',
    plural: '매출 내역',
    icon: 'trending-up',
    bar: '#2148e6',
    chip: 'bg-brand-50 text-brand-700',
    dot: 'bg-brand-500',
    text: 'text-brand-700',
  },
  purchase: {
    key: 'purchase',
    label: '매입',
    plural: '매입 내역',
    icon: 'cart',
    bar: '#d97706',
    chip: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
    text: 'text-amber-700',
  },
  opex: {
    key: 'opex',
    label: '운영비',
    plural: '운영비 내역',
    icon: 'receipt',
    bar: '#e11d48',
    chip: 'bg-rose-50 text-rose-700',
    dot: 'bg-rose-500',
    text: 'text-rose-700',
  },
}

export const ENTRY_TYPE_KEYS = ['sale', 'purchase', 'opex']

export const CATEGORIES = {
  sale: ['용역매출', '제작매출', '광고대행', '유지보수', '라이선스', '기타매출'],
  purchase: ['외주용역비', '원재료비', '상품매입', '운반비', '장비구입', '기타매입'],
  opex: [
    '인건비',
    '임차료',
    '통신비',
    '수도광열비',
    '차량유지비',
    '소모품비',
    '접대비',
    '여비교통비',
    '세금과공과',
    '광고선전비',
    '교육훈련비',
    '보험료',
    '지급수수료',
    '수선비',
    '기타운영비',
  ],
}

export const PAYMENT_METHODS = ['계좌이체', '카드', '현금', '세금계산서', '기타']

export const PROJECT_STATUS = {
  planned: { label: '예정', chip: 'bg-ink-100 text-ink-600' },
  active: { label: '진행중', chip: 'bg-brand-50 text-brand-700' },
  hold: { label: '보류', chip: 'bg-amber-50 text-amber-700' },
  done: { label: '완료', chip: 'bg-emerald-50 text-emerald-700' },
}

export const PROJECT_STATUS_KEYS = ['planned', 'active', 'hold', 'done']

export const ROLE_LABEL = {
  admin: '관리자',
  staff: '직원',
}

export const PERIOD_PRESETS = [
  { key: 'thisMonth', label: '이번 달' },
  { key: 'lastMonth', label: '지난 달' },
  { key: 'quarter', label: '이번 분기' },
  { key: 'thisYear', label: '올해' },
  { key: 'lastYear', label: '작년' },
  { key: 'last12', label: '최근 12개월' },
  { key: 'all', label: '전체' },
]
