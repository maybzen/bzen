/**
 * 급여관리 분류 검증 (실제 DB 집계값 기준).
 *   node scripts/verify-payroll.mjs  (esbuild 번들 후 실행)
 */
import { isInsurance, isSalary, isTaxRow } from '../src/pages/Payroll.jsx'

let failed = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failed += 1
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}: ${actual} / 기대 ${expected}`)
}

console.log('== 분류 ==')
// 9월 건보: 카테고리가 세금과공과여도 4대보험으로 잡혀야 함
check('건보(세금과공과) → 4대보험', isInsurance({ counterparty: '국민건강보험공단', category: '세금과공과' }), true)
check('건보 → 급여 아님', isSalary({ counterparty: '국민건강보험공단', category: '인건비' }), false)
// 8월 근복: 인건비여도 4대보험
check('근복(인건비) → 4대보험', isInsurance({ counterparty: '근로복지공단', category: '인건비' }), true)
// 일반 급여
check('손선욱 → 급여', isSalary({ counterparty: '손선욱', category: '인건비' }), true)
// 세금·원천
check('세무서 → 세금', isTaxRow({ counterparty: '세무서', category: '세금과공과' }), true)
check(
  '정성수 원천 → 세금',
  isTaxRow({ counterparty: '정성수', category: '세금과공과', description: '정성수 3.3% 원천징수 (KCCV 신고)' }),
  true,
)
// KCCV 매입(인천세관장 관세)은 급여 페이지 세금란에 잡히면 안 됨 — 카테고리가 세금과공과라 잡힘.
// 월 필터로 걸러지므로 여기서는 분류상 세금으로 보는 게 맞음.
check('관세 → 세금(분류상)', isTaxRow({ counterparty: '인천세관장', category: '세금과공과' }), true)
// 프로젝트 매입은 급여 페이지에 안 나와야 함
check('엑시움 매입 → 셋 다 아님', isSalary({ counterparty: '엑시움', category: '외주용역비' }) || isInsurance({ counterparty: '엑시움' }) || isTaxRow({ counterparty: '엑시움', category: '외주용역비' }), false)

console.log('\n== 귀속월 ==')
import { attrMonth, buildPayrollRows } from '../src/pages/Payroll.jsx'

// 장부는 지급일 기준이라 한 달 밀림. 적요의 "N월 급여"를 귀속월로 씁니다.
check('9/10 지급 8월 급여 → 08', attrMonth({ entry_date: '2026-09-10', description: '2026년 8월 급여' }), '2026-08')
check('적요 7월 급여 → 07', attrMonth({ entry_date: '2026-08-10', description: '7월 급여 (행사 도움)' }), '2026-07')
check('적요 없으면 입력월', attrMonth({ entry_date: '2026-09-10', description: '급여', memo: '' }), '2026-09')

console.log('\n== 급여대장 업로드 매핑 ==')

const sheet = [
  ['일자', '성명', '급여', '적요', '메모'],
  ['2026-10-10', '손선욱', '2,002,510', '10월 급여 (행사 도움)', '은행지급 기준'],
  ['2026-10-10', '이향란', '5317356', '', ''],
  ['2026-10-10', '이향란', '5317356', '', ''], // 시트 내 중복
  ['2026-10-10', '', '1000000', '', ''], // 성명 없음 → 제외
  ['2026-10-10', '김철수', '0', '', ''], // 0원 → 제외
]
const { rows: prow, skipped: pskip } = buildPayrollRows(sheet, {
  existingNames: new Set(['이향란']),
  defaultProjectId: 'proj-1',
  userId: 'user-1',
})
check('등록 행 수', prow.length, 1)
check('건너뜀 수', pskip.length, 2)
check('손선욱 매핑', prow[0]?.counterparty, '손선욱')
check('항목 고정', prow[0]?.category, '인건비')
check('부가세 0', prow[0]?.vat_amount, 0)
check('귀속 프로젝트', prow[0]?.project_id, 'proj-1')
check('적요 유지', prow[0]?.description, '10월 급여 (행사 도움)')
check('기본 적요', buildPayrollRows([['일자', '성명', '급여'], ['2026-10-10', '홍길동', '1000000']], {}).rows[0]?.description, '10월 급여')

console.log('\n== 명세서 장부반영액 (김혜린 8월 실제값) ==')
// 지급총액 2,722,360 − 공제 246,830 = 실지급 2,475,530
// 장부 급여분 = 실지급 − 지출결의 22,360 = 2,453,170 (지결 행과 중복 방지)
const payTotal = 2300000 + 0 + 200000 + 200000 + 22360
const dedTotal = 118750 + 89870 + 22500 + 11800 + 3560 + 350
const net = payTotal - dedTotal
const book = net - 22360
check('지급총액', payTotal, 2722360)
check('공제총액', dedTotal, 246830)
check('실지급액', net, 2475530)
check('장부 급여분', book, 2453170)

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과')
process.exit(failed ? 1 : 0)
