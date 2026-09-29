import { checkEntryDraft, findBrokenText, checkVat, similarKey, normalizeParty, findSimilarParties } from '../src/lib/validate'

let pass = 0
let fail = 0
const fails = []
function t(name, cond) {
  if (cond) { pass++ }
  else { fail++; fails.push(name); console.log('  ✗ FAIL:', name) }
}
function codes(issues) { return issues.map((i) => i.code) }

// ── 픽스처: 실제 DB에 있는 행들 흉내 ──
const LEDGER = [
  { id: 'a1', entry_date: '2026-05-26', entry_type: 'opex', source: 'expense_report', counterparty: '카카오택시', category: '여비교통비', description: '택시비', supply_amount: 7527, vat_amount: 753, total_amount: 8280, memo: '이용자 H', project_id: 'p1' },
  { id: 'a2', entry_date: '2026-05-26', entry_type: 'opex', source: 'expense_report', counterparty: '카카오택시', category: '여비교통비', description: '택시비', supply_amount: 7527, vat_amount: 753, total_amount: 8280, memo: '이용자 N', project_id: 'p1' },
  { id: 'b1', entry_date: '2026-03-20', entry_type: 'purchase', source: 'manual', counterparty: 'BPEX 부산항시설관리센터', category: '임차료', description: '시설사용료', supply_amount: 7805236, vat_amount: 780524, total_amount: 8585760, memo: '홈택스 승인번호 20260320-xxx', project_id: 'p1' },
  { id: 'c1', entry_date: '2026-03-24', entry_type: 'opex', source: 'card', counterparty: '웨이브통신_김미하', category: '통신비', description: '인터넷', supply_amount: 300000, vat_amount: 30000, total_amount: 330000, memo: '법카 9988', project_id: 'p1' },
  { id: 'd1', entry_date: '2026-07-27', entry_type: 'purchase', source: 'manual', counterparty: '인천공항세관', category: '세금과공과', description: '관세', supply_amount: 367952, vat_amount: 0, total_amount: 367952, memo: '', project_id: 'p1' },
  { id: 'e1', entry_date: '2026-02-10', entry_type: 'opex', source: 'manual', counterparty: '김혜린', category: '인건비', description: '2월 급여', supply_amount: 2500000, vat_amount: 0, total_amount: 2500000, memo: '', project_id: 'p1' },
]

console.log('── A. 중복 ──')
// A1. 똑같은 걸 다시 등록 → duplicate
let r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-05-26', counterparty: '카카오택시', category: '여비교통비', description: '택시비', supply_amount: 7527, vat_amount: 753, memo: '', project_id: 'p1' }, { entries: LEDGER })
t('A1 똑같은 재등록 → duplicate', codes(r).includes('duplicate'))
// A2. 다른 이름이지만 정규화키가 같은 거래처로 같은 금액 → duplicate (fuzzy)
r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-03-24', counterparty: '웨이브통신', category: '통신비', description: '인터넷', supply_amount: 300000, vat_amount: 30000, memo: '', project_id: 'p1' }, { entries: LEDGER })
t('A2 표기만 다른 동일거래 duplicate', codes(r).includes('duplicate'))
// A3. 수정 중인 행은 자기 자신 제외 → 단일행 수정 시 duplicate 없음
r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-03-24', counterparty: '웨이브통신_김미하', category: '통신비', description: '인터넷', supply_amount: 300000, vat_amount: 30000, memo: '', project_id: 'p1' }, { entries: [LEDGER[3]], excludeId: 'c1' })
t('A3 자기 자신 수정 → duplicate 없음', !codes(r).includes('duplicate'))
// A4. 같은 날짜·같은 금액·다른 거래처 → 약한 경고(다른 거래)
r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-05-26', counterparty: '전혀다른곳', category: '복리후생비', description: '식대', supply_amount: 7527, vat_amount: 753, memo: '', project_id: 'p1' }, { entries: LEDGER })
t('A4 동액 타거래 → duplicate(약한)', codes(r).includes('duplicate') && r.find((i) => i.code === 'duplicate').title.includes('다른 거래'))
// A5. 금액 다르면 조용
r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-05-26', counterparty: '카카오택시', category: '여비교통비', description: '택시비', supply_amount: 8000, vat_amount: 800, memo: '', project_id: 'p1' }, { entries: LEDGER })
t('A5 금액 다름 → duplicate 없음', !codes(r).includes('duplicate'))
// A6. 장부 데이터 없으면 duplicate 검사 불가 → 조용 (로컬 검사는 동작)
r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-05-26', counterparty: '카카오택시', category: '여비교통비', description: '택시비', supply_amount: 7527, vat_amount: 753, memo: '${x}', project_id: 'p1' }, { entries: [] })
t('A6 빈 장부 → duplicate 없음, broken은 잡음', !codes(r).includes('duplicate') && codes(r).includes('broken'))

console.log('── B. 깨진 텍스트 ──')
for (const s of ['${memo}', '합계 ${total}원', '{memo}', '값 undefined 발생', '결과 NaN', '[object Object]', 'null 반환']) {
  r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-09-30', counterparty: '어딘가', category: '복리후생비', description: 'd', supply_amount: 10000, vat_amount: 1000, memo: s, project_id: 'p1' }, { entries: LEDGER })
  t(`B broken 잡음: ${s}`, codes(r).includes('broken'))
}
// B8. 정상 메모는 조용
r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-09-30', counterparty: '어딘가', category: '복리후생비', description: 'd', supply_amount: 10000, vat_amount: 1000, memo: '운영비 정산 · 이용자 H · 영수증 O', project_id: 'p1' }, { entries: LEDGER })
t('B8 정상 메모 → broken 없음', !codes(r).includes('broken'))
// B9. 적요/거래처/증빙번호 깨짐도 잡음
t('B9 적요 깨짐', !!findBrokenText({ description: '출력 ${qty}부' }))
t('B9 거래처 깨짐', !!findBrokenText({ counterparty: 'undefined' }))
t('B9 증빙번호 깨짐', !!findBrokenText({ doc_no: '[object Object]' }))

console.log('── C. 표기 흔들림 ──')
r = checkEntryDraft({ entry_type: 'purchase', entry_date: '2026-09-30', counterparty: '(사)부산항시설관리센터', category: '임차료', description: 'd', supply_amount: 500000, vat_amount: 50000, memo: '', project_id: 'p1' }, { entries: LEDGER })
t('C1 BPEX↔(사) variant', codes(r).includes('variant'))
r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-09-30', counterparty: '웨이브통신', category: '통신비', description: 'd', supply_amount: 100000, vat_amount: 10000, memo: '', project_id: 'p1' }, { entries: LEDGER })
t('C2 웨이브통신 variant', codes(r).includes('variant'))
// C3. 사업자번호만 적힌 표기는 variant 검사 제외
r = checkEntryDraft({ entry_type: 'purchase', entry_date: '2026-09-30', counterparty: '137-85-49637', category: '기타매입', description: 'd', supply_amount: 2826818, vat_amount: 282682, memo: '', project_id: 'p1' }, { entries: LEDGER })
t('C3 사업자번호 표기 → variant 없음', !codes(r).includes('variant'))
// C4. 완전히 새로운 거래처 → 조용
r = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-09-30', counterparty: '세상에없는상호 주식회사', category: '소모품비', description: 'd', supply_amount: 10000, vat_amount: 1000, memo: '', project_id: 'p1' }, { entries: LEDGER })
t('C4 신규 거래처 → variant 없음', !codes(r).includes('variant'))
// C5. 짧은 이름(4자 미만)은 fuzzy 매칭 안 함 — "택시" vs "카카오택시"? endsWith지만 short<4 제외
t('C5 짧은 이름 매칭 제외', similarKey(normalizeParty('택시'), normalizeParty('카카오택시')) === false)
t('C5b 4자 이상은 매칭', similarKey(normalizeParty('카카오택시'), normalizeParty('카카오택시센텀')) === true)

console.log('── D. 부가세 ──')
const vatCase = (s, v) => codes(checkEntryDraft({ entry_type: 'purchase', entry_date: '2026-09-30', counterparty: '어딘가', category: '기타매입', description: 'd', supply_amount: s, vat_amount: v, memo: '', project_id: 'p1' }, { entries: LEDGER })).includes('vat')
t('D1 10% 정상', !vatCase(1000000, 100000))
t('D2 9% 경고', vatCase(1000000, 90000))
t('D3 세액 0 (면세) → 조용', !vatCase(1000000, 0))
t('D4 공급가액 0 → 조용', !vatCase(0, 0))
t('D5 반올림 오차 허용 (33000→3000은 기대 3300, 차 300>100 → 경고)', vatCase(33000, 3000))
t('D6 작은 금액 오차 허용 (1000→100, 기대 100 → 조용)', !vatCase(1000, 100))
t('D7 작은 금액 ±50 허용 (1000→150, 차 50<100 → 조용)', !vatCase(1000, 150))
t('D8 11% 경고', vatCase(1000000, 110000))

console.log('── E. 비목·프로젝트 ──')
const fieldCase = (type, cat, proj) => checkEntryDraft({ entry_type: type, entry_date: '2026-09-30', counterparty: '어딘가', category: cat, description: 'd', supply_amount: 100000, vat_amount: 10000, memo: '', project_id: proj }, { entries: LEDGER }).filter((i) => i.code === 'field')
t('E1 opex 정상비목 → 조용', fieldCase('opex', '복리후생비', '').length === 0)
t('E2 비목 비어있음 → 경고', fieldCase('opex', '', '').length === 1)
t('E3 purchase+임차료 → 관행상 조용', fieldCase('purchase', '임차료', 'p1').length === 0)
t('E4 purchase+외주용역비 → 조용', fieldCase('purchase', '외주용역비', 'p1').length === 0)
t('E5 sale+지급수수료 → 경고', fieldCase('sale', '지급수수료', 'p1').length === 1)
t('E6 sale+용역매출 → 조용', fieldCase('sale', '용역매출', 'p1').length === 0)
t('E7 sale 프로젝트 없음 → 경고', fieldCase('sale', '용역매출', '').some((f) => f.field === 'project_id'))
t('E8 purchase 프로젝트 없음 → 경고', fieldCase('purchase', '외주용역비', '').some((f) => f.field === 'project_id'))
t('E9 opex 프로젝트 없음 → 조용 (공통비용 정상)', fieldCase('opex', '복리후생비', '').length === 0)
t('E10 등록 안 된 비목 → 경고', fieldCase('opex', '없는비목', '').length === 1)

console.log('')
console.log(`결과: ${pass} 통과 / ${fail} 실패 (총 ${pass + fail})`)
if (fails.length) { console.log('실패 목록:'); fails.forEach((f) => console.log('  -', f)); process.exit(1) }
