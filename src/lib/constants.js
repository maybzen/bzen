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
    '도서인쇄비',
    '접대비',
    '회의비',
    '여비교통비',
    '복리후생비',
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
  임차료: '사무실·장비 임차료',
  통신비: '휴대폰·인터넷·와이파이·우편요금',
  수도광열비: '수도·전기·가스 요금',
  차량유지비: '주유·주차·정비·통행료',
  소모품비: '문구·사무용품',
  도서인쇄비: '명함·감사패·인쇄물·도서',
  접대비: '거래처 접대·선물·상품권',
  회의비: '회의비·세미나 catering 등',
  여비교통비: '택시·KTX 등 출장 이동비',
  복리후생비: '식대·다과·면접·경조사 등 직원 복지',
  세금과공과: '세금·공과금·협회비 등',
  광고선전비: '광고·홍보·마케팅비',
  교육훈련비: '강의·세미나·도서 구입 등 교육비',
  보험료: '화재·상해 등 각종 보험료',
  지급수수료: '외주 인쇄·구독료·은행·PG 수수료',
  수선비: '수리·유지보수비',
  기타운영비: '위에 해당하지 않는 운영비',
}

export function categoryHint(name) {
  return CATEGORY_HINTS[String(name || '').trim()] || ''
}

/**
 * 이용내역으로 계정과목 추천. 위에서부터 순서대로 매칭됩니다.
 * entryType이 주어지면 해당 유형 규칙만 봅니다 (장부 입력용).
 */
const SUGGEST_RULES = [
  { re: /상품권/, type: 'opex', category: '접대비' },
  { re: /골프|유흥|노래방|접대/, type: 'opex', category: '접대비' },
  { re: /수리|수선/, type: 'opex', category: '수선비' },
  { re: /주유|주유소|에너지|충전|기름/, type: 'opex', category: '차량유지비' },
  { re: /주차|파킹/, type: 'opex', category: '차량유지비' },
  { re: /택시|티머니|코레일|KTX|항공|고속버스|공항|철도|지하철|버스/, type: 'opex', category: '여비교통비' },
  { re: /인쇄|명함|프린트|감사패|현수막|플래카드/, type: 'opex', category: '도서인쇄비' },
  { re: /교보|알라딘|예스24|서점|도서/, type: 'opex', category: '도서인쇄비' },
  { re: /세무|세금|구청|법원|등기소|국세|지방세|국민연금|건강보험|고용보험/, type: 'opex', category: '세금과공과' },
  {
    re: /김밥|식당|레스토랑|급식|뷔페|족발|치킨|피자|햄버거|국밥|냉면|분식|돈까스|삼겹|갈비|초밥|중식|양식|한식|일식|카페|커피|베이커리|제과|과자|빵집|아이스크림|빙수|설빙|투마미|미분당|케이크|도넛|샌드위치|샐러드|포케|마라탕|떡볶이|순대|쌀국수|칼국수|국수|라면|짬뽕|짜장|탕수육|카레|커리|횟집|사시미|참가자미|참치|광어|연어|파스타|스테이크|고깃집|술집|호프|이자카야|브런치|도시락|후식|다과|음료|주스/,
    type: 'opex',
    category: '복리후생비',
  },
  { re: /KT|SKT|LGU|SK텔레콤|통신|인터넷|와이파이|휴대폰|포켓와이파이/, type: 'opex', category: '통신비' },
  { re: /우체국|우편|등기/, type: 'opex', category: '통신비' },
  {
    re: /구독|Notion|노션|Adobe|어도비|Microsoft|MS365|AWS|클라우드|GPT|ChatGPT|Claude|클로드|Anthropic|OpenAI|오픈AI|유튜브|넷플릭스|멜론|스포티파이|한글과컴퓨터|안랩|백신/,
    type: 'opex',
    category: '지급수수료',
  },
  { re: /광고|마케팅|홍보/, type: 'opex', category: '광고선전비' },
  { re: /학원|세미나|강의|교육/, type: 'opex', category: '교육훈련비' },
  { re: /보험/, type: 'opex', category: '보험료' },
  { re: /은행|토스|카카오페이|페이코|수수료/, type: 'opex', category: '지급수수료' },
  { re: /다이소|문구|마트|편의점|올리브영|이케아|하이마트|전자랜드|쿠팡|GS25|지에스|CU\b|씨유|세븐일레븐|이마트24|미니스톱|홈플러스|롯데마트/, type: 'opex', category: '소모품비' },
  { re: /렌탈|리스|임대/, type: 'opex', category: '임차료' },
  { re: /한전|전기요금|가스요금|수도요금|수돗물/, type: 'opex', category: '수도광열비' },
  { re: /급여|월급|상여|인건/, type: 'opex', category: '인건비' },
  { re: /외주|용역|프리랜서|컨설팅|자문/, type: 'purchase', category: '외주용역비' },
  { re: /원재료|자재|원단/, type: 'purchase', category: '원재료비' },
  { re: /택배|운송|화물|퀵서비스|용달/, type: 'purchase', category: '운반비' },
  { re: /노트북|컴퓨터|모니터|키보드|마우스|장비|가전|냉장고/, type: 'purchase', category: '장비구입' },
  { re: /상품|도매/, type: 'purchase', category: '상품매입' },
]

export function suggestCategory(merchant, memo, entryType = null) {
  const text = `${merchant || ''} ${memo || ''}`
  if (!text.trim()) return null
  for (const rule of SUGGEST_RULES) {
    if (entryType && rule.type !== entryType) continue
    if (rule.re.test(text)) return { type: rule.type, category: rule.category }
  }
  return null
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
