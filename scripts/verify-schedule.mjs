import { buildSchedule, dday, ddayLabel, monthGrid, ruleDates, TAX_RULES } from '../src/lib/schedule'

let pass = 0
let fail = 0
const fails = []
function t(name, cond) {
  if (cond) pass++
  else { fail++; fails.push(name); console.log('  ✗ FAIL:', name) }
}

// 10월 규칙: 급여·원천·보험 10일, 부가세 10/25, 법인세 없음
const oct = TAX_RULES.flatMap((r) => ruleDates(r, 2026, 10).map((d) => `${r.title}@${d}`))
t('10월 급여 10/10', oct.includes('급여 지급@2026-10-10'))
t('10월 부가세 10/25', oct.includes('부가가치세 신고·납부@2026-10-25'))
t('10월 법인세 없음', !oct.some((s) => s.startsWith('법인세')))
// 3월 법인세 3/31
t('3월 법인세 3/31', ruleDates(TAX_RULES.find((r) => r.key === 'corp'), 2026, 3).includes('2026-03-31'))
// 2월 법인세일 clamp (31→28)
t('2월 대출 29일→28일 clamp', ruleDates({ key: 'x', title: 't', day: 29, months: 'every' }, 2026, 2).includes('2026-02-28'))

const loans = [
  { id: 'l1', bank: '부산은행A', product: '운전', pay_day: 25, monthly_pay: 1228668 },
  { id: 'l2', bank: '부산은행B', product: '기보', pay_day: 29, monthly_pay: 428579 },
  { id: 'l3', bank: '부산은행C', product: '성공시대', pay_day: 2, monthly_pay: 239754 },
  { id: 'l4', bank: 'X', product: 'Y', pay_day: 0, monthly_pay: 0 },
]
const items = buildSchedule({ loans, manuals: [], fromISO: '2026-09-29', toISO: '2026-10-31' })
const titles = items.map((i) => `${i.date} ${i.title}`)
t('9/29 대출상환 포함', titles.some((s) => s.startsWith('2026-09-29') && s.includes('부산은행B')))
t('10/02 대출 포함', titles.some((s) => s.startsWith('2026-10-02')))
t('10/25 2건 (대출+부가세)', items.filter((i) => i.date === '2026-10-25').length === 2)
t('pay_day 0 제외', !titles.some((s) => s.includes('부산은행X') || s.includes('(X)')))
t('정렬 오름차순', items.every((v, i, a) => i === 0 || a[i - 1].date <= v.date))

// 수동
const manuals = [
  { id: 'm1', text: '고지서 확인', done: false, due_date: '2026-10-05' },
  { id: 'm2', text: '완료된 것', done: true, due_date: '2026-10-06' },
  { id: 'm3', text: '날짜 없음', done: false, due_date: null },
  { id: 'm4', text: '범위 밖', done: false, due_date: '2026-12-01' },
]
const items2 = buildSchedule({ loans: [], manuals, fromISO: '2026-09-29', toISO: '2026-10-31' })
t('수동 날짜 있음 포함', items2.some((i) => i.key === 'manual-m1'))
t('완료 제외', !items2.some((i) => i.key === 'manual-m2'))
t('날짜 없음 포함(끝 정렬)', items2.some((i) => i.key === 'manual-m3'))
t('범위 밖 제외', !items2.some((i) => i.key === 'manual-m4'))

// D-day
t('D-day 당일', ddayLabel('2026-09-30', '2026-09-30') === 'D-day')
t('D-3', ddayLabel('2026-10-03', '2026-09-30') === 'D-3')
t('지남', ddayLabel('2026-09-28', '2026-09-30') === 'D+2 지남')
t('날짜 없음', ddayLabel(null) === '날짜 없음')
t('dday null', dday(null) === null)

// 달력 그리드: 2026-10 (10/1 목요일, 일요일 시작 → 9/27 시작, 42칸)
const g = monthGrid(2026, 10)
t('그리드 42칸', g.length === 42)
t('그리드 시작 일요일', g[0] === '2026-09-27')
t('그리드 10/1 포함', g.includes('2026-10-01') && g.includes('2026-10-31'))

console.log(`결과: ${pass} 통과 / ${fail} 실패 (총 ${pass + fail})`)
if (fails.length) process.exit(1)
