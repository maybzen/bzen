/**
 * 급여대장 PDF 파서 검증 (pdfjs 없이 좌표 스트림 수준에서 테스트).
 *   node scripts/verify-payroll-pdf.mjs
 */
import { __testables } from '../src/lib/payrollPdf.js'

const { groupRows, isHeaderRow, colIndex, numOf, norm } = __testables

let failed = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? '  OK  ' : ' FAIL '}${label}: ${JSON.stringify(actual)}`)
}

// 세무사무실 양식 흉내: 헤더 + 3명 + 합계행 (y좌표 포함 가짜 아이템)
const items = []
const put = (row, y, texts, xs) => {
  texts.forEach((t, i) => items.push({ str: t, transform: [12, 0, 0, 12, xs[i], y] }))
}
put(0, 800, ['성명', '지급합계', '공제합계', '차인지급액'], [50, 200, 320, 440])
put(1, 780, ['김혜린', '2,800,000', '324,470', '2,475,530'], [50, 200, 320, 440])
put(2, 760, ['박 은 영', '2,500,000', '250,000', '2,250,000'], [50, 200, 320, 440])
put(3, 740, ['합계', '5,300,000', '574,470', '4,725,530'], [50, 200, 320, 440])

const rows = groupRows(items)
check('줄 묶음', rows.length, 4)
check('헤더 감지', isHeaderRow(rows[0]), true)
check('데이터행은 헤더 아님', isHeaderRow(rows[1]), false)
check('성명 열', colIndex(rows[0], [/^성\s*명$/, /^이\s*름$/, /^성명$/, /^이름$/]), 0)
check('지급 열(차인지급액 우선)', colIndex(rows[0], [/차인지급액/, /실지급액/, /지급합계/]), 3)
check('이름 공백 제거', norm('박 은 영'), '박은영')
check('금액 파싱', numOf('2,475,530'), 2475530)
check('합계행 감지', /합계|총계|^계$|소계/.test(norm('합계')), true)

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과')
process.exit(failed ? 1 : 0)
