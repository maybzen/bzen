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
    '식대',
    '다과비',
    '임차료',
    '통신비',
    '우편요금',
    '수도광열비',
    '차량유지비',
    '소모품비',
    '비품',
    '도서인쇄비',
    '구독료',
    '고정비',
    '복리후생비',
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

/** 항목 선택 시 보여주는 한 줄 설명 */
export const CATEGORY_HINTS = {
  // 매출
  용역매출: '용역 제공 대가로 받은 매출',
  제작매출: '제작·납품하고 받은 매출',
  광고대행: '광고 대행 수수료·매출',
  유지보수: '유지보수 계약 매출',
  라이선스: '라이선스 판매 매출',
  기타매출: '위에 해당하지 않는 매출',
  // 매입
  외주용역비: '외부 업체에 맡긴 일 비용',
  원재료비: '제작에 들어간 재료비',
  상품매입: '되팔 상품 매입',
  운반비: '화물·택배 운송비',
  장비구입: '장비·기기 구입',
  기타매입: '위에 해당하지 않는 매입',
  // 운영비
  인건비: '급여·상여·4대보험 회사부담분',
  식대: '평소 점심·저녁 등 식사비',
  다과비: '커피·케이크·면접 다과 등',
  임차료: '사무실·장비 임차료',
  통신비: '휴대폰·인터넷·와이파이 요금',
  우편요금: '우체국·등기·택배비',
  수도광열비: '수도·전기·가스 요금',
  차량유지비: '주유·주차·정비·통행료',
  소모품비: '문구류 등 쓰고 버리는 물품',
  비품: '책상·의자 등 오래 쓰는 물품',
  도서인쇄비: '명함·감사패·인쇄물·도서',
  구독료: 'Notion 등 매달 나가는 구독',
  고정비: '매달 고정 지출 묶음용 바구니',
  복리후생비: '면접·경조사 등 사람 챙기는 비용',
  접대비: '거래처 접대·선물·상품권',
  여비교통비: '택시·KTX 등 출장 이동비',
  세금과공과: '세금·공과금·협회비 등',
  광고선전비: '광고·홍보·마케팅비',
  교육훈련비: '강의·세미나·도서 구입 등 교육비',
  보험료: '화재·상해 등 각종 보험료',
  지급수수료: '은행·PG·대행 수수료',
  수선비: '수리·유지보수비',
  기타운영비: '위에 해당하지 않는 운영비',
}

export function categoryHint(name) {
  return CATEGORY_HINTS[String(name || '').trim()] || ''
}

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
