/**
 * 세무·회계 손익 계산 검증.
 * projects/entries 실제 집계값(Supabase SQL 확인값)을 그대로 넣어
 * src/lib/summary.js 의 계산 결과가 카드·상세 화면 값과 일치하는지 봅니다.
 *
 *   node scripts/verify-pnl.mjs
 */
import { buildPnl, groupByProject, summarize } from '../src/lib/summary.js'
import { formatKRW, formatPercent } from '../src/lib/format.js'

let failed = 0
function check(label, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.051
  if (!ok) failed += 1
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}: ${formatKRW(actual)} / 기대 ${formatKRW(expected)}`)
}

console.log('== buildPnl ==')
/* 2028 세계디자인수도부산 국제컨퍼런스 (완료) */
const a = buildPnl(238906908, 209244600, 7128)
check('2028 세계디자인  순매출액', a.revenue, 238906908)
check('2028 세계디자인  매출원가', a.cogs, 209244600)
check('2028 세계디자인  매출총이익', a.gross, 29662308)
check('2028 세계디자인  영업이익', a.operating, 29655180)
console.log(`        영업이익률 ${formatPercent(a.operatingMargin)} (기대 12.4%)`)
if (formatPercent(a.operatingMargin) !== '12.4%') {
  failed += 1
  console.log(' FAIL  영업이익률 산식 불일치')
}

/* 제안서처럼 매출 0에 부대비용만 잡힌 경우 → 손실로 나와야 함 */
console.log('\n== 제안서 부대비용 → 영업손실 ==')
const b = buildPnl(0, 0, 1034371)
check('KOBC BADA  영업이익', b.operating, -1034371)
if (b.operatingMargin !== null) {
  failed += 1
  console.log(' FAIL  매출이 없으면 영업이익률은 null 이어야 합니다')
} else {
  console.log('  OK   영업이익률 null (매출 없음 → "—" 표시)')
}

/* 그룹 집계가 같은 값을 내는지 */
console.log('\n== groupByProject ==')
const projects = [
  { id: 'p1', name: 'KCCV2026', status: 'done' },
  { id: 'p2', name: 'WADA총회', status: 'done' },
]
const entries = [
  { project_id: 'p1', entry_type: 'sale', supply_amount: 201592671, vat_amount: 20159267, total_amount: 221751938 },
  { project_id: 'p1', entry_type: 'purchase', supply_amount: 63735308, vat_amount: 6373531, total_amount: 70108839 },
  { project_id: 'p1', entry_type: 'opex', supply_amount: 4569208, vat_amount: 456921, total_amount: 5026129 },
  { project_id: 'p2', entry_type: 'sale', supply_amount: 154031840, vat_amount: 15403184, total_amount: 169435024 },
  { project_id: 'p2', entry_type: 'purchase', supply_amount: 26782508, vat_amount: 2678251, total_amount: 29460759 },
]
const rows = groupByProject(entries, projects)
const k = rows.find((r) => r.project.id === 'p1')
check('KCCV2026 매출총이익', k.gross, 201592671 - 63735308)
check('KCCV2026 영업이익', k.profit, 133288155)
console.log(`        영업이익률 ${formatPercent(k.margin)}`)
if (formatPercent(k.margin) !== '66.1%') {
  failed += 1
  console.log(' FAIL  KCCV2026 영업이익률 불일치')
}

console.log('\n== contractSplit ==')
import { contractSplit } from '../src/lib/format.js'

// 마이그레이션 전: 합계만 있으면 역산
const old = contractSplit({ contract_amount: 222330207 })
check('KCCV 합계 유지', old.total, 222330207)
check('KCCV 공급가액 역산', old.supply, 202118370)
check('KCCV 부가세 역산', old.vat, 20211837)
// 마이그레이션 후: 저장값 우선
const now = contractSplit({ contract_amount: 222330207, contract_supply: 202118370, contract_vat: 20211837 })
check('분리값 우선 합계', now.total, 222330207)
check('분리값 우선 공급가액', now.supply, 202118370)
check('분리값 우선 부가세', now.vat, 20211837)
// 0원
const zero = contractSplit({ contract_amount: 0 })
check('0원 합계', zero.total, 0)

console.log('\n== summarize ==')
const t = summarize(entries)
/* 355,624,511 − (63,735,308 + 26,782,508) − 4,569,208 = 260,537,487 */
check('합계 순매출액', t.revenue, 355624511)
check('합계 매출원가', t.cogs, 90517816)
check('합계 영업이익', t.operating, 260537487)
/* 35,562,451 − 9,051,782 − 456,921 = 26,053,748 */
check('합계 부가세납부예상', t.vatPayable, 26053748)

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과')
process.exit(failed ? 1 : 0)
