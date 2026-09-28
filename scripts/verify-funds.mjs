/**
 * 자금관리 로직 검증.
 *   node scripts/verify-funds.mjs (esbuild 번들 후 실행)
 */
import { maskCardNo, nextPayDate } from '../src/pages/Funds.jsx'

let failed = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failed += 1
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}: ${actual} / 기대 ${expected}`)
}

console.log('== 카드번호 마스킹 ==')
check('앞자리 숨김', maskCardNo('6541-3211-9406-9988'), '••••-••••-••••-9988')
check('빈값', maskCardNo(''), '—')

console.log('\n== 다음 상환일 ==')
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// 9/28 기준 납입일 25일 → 10/25
check('25일(지남) → 다음달', fmt(nextPayDate(25, new Date(2026, 8, 28))), '2026-10-25')
// 9/28 기준 납입일 29일 → 9/29
check('29일(앞) → 이번달', fmt(nextPayDate(29, new Date(2026, 8, 28))), '2026-09-29')
// 9/28 기준 납입일 2일 → 10/2
check('2일(지남) → 다음달', fmt(nextPayDate(2, new Date(2026, 8, 28))), '2026-10-02')

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과')
process.exit(failed ? 1 : 0)
