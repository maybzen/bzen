/**
 * 급여대장 PDF 파서 검증 (3행 블록형 양식).
 *   node scripts/verify-payroll-pdf.mjs
 */
import { __testables } from '../src/lib/payrollPdf.js'

const { groupRows, blockName, blockPay, docDates, numOf, norm } = __testables

let failed = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? '  OK  ' : ' FAIL '}${label}: ${JSON.stringify(actual)}`)
}

// 실제 양식 축소판: 머리 + 헤더3줄 + 2명(각 3줄) + 합계
const items = []
const put = (y, texts, xs) => {
  texts.forEach((t, i) => items.push({ str: t, transform: [12, 0, 0, 12, xs[i], y] }))
}
const X = [50, 110, 200, 300, 420, 520, 620, 720]
put(860, ['2026년09월분 급여대장'], [250])
put(845, ['[귀속:2026년09월]', '[지급:2026년10월10일]'], [200, 400])
put(820, ['사원번호', '성 명', '기본급', '국민연금', '건강보험', '차인지급액'], [50, 110, 200, 420, 520, 720])
put(808, ['입사일', '직 급', '공제합계'], [50, 110, 620])
put(796, ['퇴사일', '부 서', '지급합계'], [50, 110, 620])
put(770, ['31', '이보람', '4,742,400', '249,990', '177,670', ''], [50, 110, 200, 420, 520, 720])
put(758, ['2023-02-01', '', '', '', '', '999,500'], [50, 110, 200, 420, 520, 720])
put(746, ['', '', '', '', '5,142,400', '4,142,900'], [50, 110, 200, 420, 520, 720])
put(720, ['46', '김혜린', '2,300,000', '31,350', '89,870', ''], [50, 110, 200, 420, 520, 720])
put(708, ['2026-07-06', '', '', '', '', '142,870'], [50, 110, 200, 420, 520, 720])
put(696, ['', '', '', '', '2,700,000', '2,557,130'], [50, 110, 200, 420, 520, 720])
put(670, ['합계', '28,039,573', '', '', '', '26,683,056'], [50, 110, 200, 420, 520, 720])

const rows = groupRows(items)
check('줄 수', rows.length, 12)
const meta = docDates(rows)
check('귀속 추출', meta.attrYm, '2026-09')
check('지급일 추출', meta.payDate, '2026-10-10')

// 블록 파싱 재현 (parsePayrollPdf 본문과 같은 규칙)
const out = []
for (let i = 0; i < rows.length; i += 1) {
  const cells = rows[i]
  const joined = norm(cells.join(''))
  if (!joined || /합계|총계|소계/.test(joined)) continue
  const name = blockName(cells)
  if (!name) continue
  const pay = blockPay(rows[i + 2]) || blockPay(rows[i + 1]) || blockPay(cells)
  if (pay > 0) out.push([name, pay])
}
check('인원·실지급액', out, [['이보람', 4142900], ['김혜린', 2557130]])
check('이름 공백 처리', norm('박 은 영'), '박은영')
check('금액 파싱', numOf('2,557,130'), 2557130)

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과')
process.exit(failed ? 1 : 0)
