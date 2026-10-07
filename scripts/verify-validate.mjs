import { auditEntries, checkEntryDraft, normalizeParty, findBrokenText, checkVat, summarizeAudit } from '../src/lib/validate'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/* 실제 장부 fixture: 환경변수 > 리포지토리 fixtures > (구)Mac 절대경로 순으로 찾고,
   없으면 합성 데이터로 코드 경로만 점검합니다 (다른 PC에서도 실행되게) */
function loadEntries() {
  const candidates = [
    process.env.BZEN_AUDIT_FIXTURE,
    path.join(HERE, 'fixtures', 'db_entries.json'),
    '/private/var/folders/xv/lqrg0xyn1x7b6qlj09fmzfzm0000gn/T/opencode/audit/db_entries.json',
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      const rows = JSON.parse(fs.readFileSync(p, 'utf8'))
      console.log(`fixture: ${p} (${rows.length}건)`)
      return rows
    } catch {
      /* 다음 후보 */
    }
  }
  console.log('fixture 없음 → 합성 데이터로 점검합니다')
  return [
    { id: 'e1', entry_type: 'opex', entry_date: '2026-05-26', counterparty: '택시회사', category: '여비교통비', supply_amount: 7527, vat_amount: 753, total_amount: 8280, description: '택시', memo: '', project_id: '' },
    { id: 'e2', entry_type: 'opex', entry_date: '2026-09-30', counterparty: 'BPEX 부산항시설관리센터', category: '기타운영비', supply_amount: 100000, vat_amount: 10000, total_amount: 110000, description: '', memo: '', project_id: '' },
    { id: 'e3', entry_type: 'opex', entry_date: '2026-09-30', counterparty: '웨이브통신_김미하', category: '통신비', supply_amount: 50000, vat_amount: 5000, total_amount: 55000, description: '', memo: '', project_id: '' },
  ]
}
const entries = loadEntries()

console.log('대상:', entries.length, '건')
console.log('')

// ── 단위 점검 ──
console.log('=== 1) 깨진 텍스트 탐지 ===')
for (const s of ['${memo}', '정상 메모 · 이용자 H', '금액 ${total}원', '이름 undefined 입력', 'NaN 계산됨', '[object Object]']) {
  const r = findBrokenText({ memo: s, description: '', counterparty: '테스트' })
  console.log(`  ${JSON.stringify(s).padEnd(30)} → ${r ? r.where + ': ' + r.why : '정상'}`)
}

console.log('')
console.log('=== 2) 부가세 10% 판정 ===')
for (const [s, v, note] of [
  [30000, 3000, '정상 10%'],
  [1000000, 100000, '정상 10%'],
  [1000000, 90000, '9%'],
  [1000000, 0, '면세(세액0)'],
  [0, 0, '급여'],
  [33000, 0, '카드불공제'],
  [500000, 50000, '정상 10%'],
  [367952, 0, '관세(면세)'],
]) {
  const r = checkVat(s, v)
  console.log(`  공급가액 ${String(s).padStart(9)} / 세액 ${String(v).padStart(7)} (${note.padEnd(12)}) → ${r ? `⚠ ${r.rate.toFixed(1)}% (기대 ${r.expected})` : '이상 없음'}`)
}

console.log('')
console.log('=== 3) 표기 정규화 ===')
for (const s of ['(주)블루컴', '（주）블루컴', '블루컴 ', 'BPEX 부산항시설관리센터', '(사)부산항시설관리센터', '137-85-49637', '에이치디씨현대산업개발(주)부산호텔']) {
  console.log(`  ${s.padEnd(30)} → ${normalizeParty(s)}`)
}

console.log('')
console.log('=== 4) 저장 직전 점검 (실제 장부와 대조) ===')
// 실제 장부의 5/26 택시 8,280원 중복 건을 그대로 다시 등록해본다
const taxi = entries.find((e) => e.entry_date === '2026-05-26' && Math.round(Number(e.total_amount)) === 8280)
if (taxi) {
  const draft = {
    entry_type: 'opex',
    entry_date: taxi.entry_date,
    counterparty: taxi.counterparty,
    category: taxi.category,
    supply_amount: taxi.supply_amount,
    vat_amount: taxi.vat_amount,
    memo: '',
    project_id: taxi.project_id,
  }
  const issues = checkEntryDraft(draft, { entries })
  console.log(`  5/26 택시 8,280원 재등록 → ${issues.length}건 경고`)
  for (const i of issues) console.log(`    [${i.code}/${i.level}] ${i.title} — ${i.detail || ''}`)
  // 수정 중(자기 자신 제외)일 때는 조용해야 한다
  const selfIssues = checkEntryDraft(draft, { entries, excludeId: taxi.id })
  console.log(`  같은 행을 "수정"으로 저장 → ${selfIssues.length}건 (자기 자신과 비교 안 함)`)
} else {
  console.log('  ⚠ 대상 행 못 찾음')
}
console.log('')
// 깨진 텍스트로 저장 시도
const brokenIssues = checkEntryDraft({ entry_type: 'purchase', entry_date: '2026-09-30', counterparty: '테스트사', category: '기타매입', supply_amount: 100000, vat_amount: 10000, memo: '${memo}', project_id: '' }, { entries })
console.log('  깨진 텍스트로 저장 시도 →')
for (const i of brokenIssues) console.log(`    [${i.code}/${i.level}] ${i.title}${i.detail ? ' — ' + i.detail : ''}`)
console.log('')
// 비목 오류 + 부가세 틀림
const badIssues = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-09-30', counterparty: '새거래처', category: '복리후생비', supply_amount: 1000000, vat_amount: 90000, memo: '', project_id: '' }, { entries })
console.log('  부가세 9% + 비어있는 프로젝트 →')
for (const i of badIssues) console.log(`    [${i.code}/${i.level}] ${i.title}${i.detail ? ' — ' + i.detail : ''}`)
console.log('')
// 표기 흔들림: DB에 "BPEX 부산항시설관리센터"로 들어있는데 다른 표기로 등록
const varIssues = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-09-30', counterparty: '(사)부산항시설관리센터', category: '기타운영비', supply_amount: 100000, vat_amount: 0, memo: '', project_id: '' }, { entries })
console.log('  다른 표기로 등록(BPEX ↔ (사)부산항시설관리센터) →')
for (const i of varIssues) console.log(`    [${i.code}/${i.level}] ${i.title}${i.detail ? ' — ' + i.detail : ''}`)

// 다른 이름(김미하 붙은 것)으로 등록
const varIssues2 = checkEntryDraft({ entry_type: 'opex', entry_date: '2026-09-30', counterparty: '웨이브통신', category: '통신비', supply_amount: 100000, vat_amount: 10000, memo: '', project_id: '' }, { entries })
console.log('  다른 이름으로 등록(웨이브통신 ↔ 웨이브통신_김미하) →')
for (const i of varIssues2) console.log(`    [${i.code}/${i.level}] ${i.title}${i.detail ? ' — ' + i.detail : ''}`)

console.log('')
console.log('=== 5) 장부 전체 스캔 ===')
const t0 = Date.now()
const issues = auditEntries(entries)
const sum = summarizeAudit(issues)
console.log(`  소요 ${Date.now() - t0}ms / 지적 ${issues.length}건`)
console.log('  요약:', JSON.stringify(sum.byCode))
for (const r of sum.ranked) console.log(`    ${r.label.padEnd(12)} ${r.count}건  — ${r.hint}`)

console.log('')
console.log('  상위 12건:')
for (const i of issues.slice(0, 12)) {
  console.log(`   [${i.code}] ${(i.date || '-').padEnd(11)} ${String(i.party || '-').slice(0, 20).padEnd(20)} ${String(i.amount).padStart(10)}  ${i.title} ${i.detail.slice(0, 60)}`)
}

// 깨진 텍스트는 현재 0건이어야 한다
const broken = issues.filter((i) => i.code === 'broken')
console.log('')
console.log(broken.length === 0 ? '  ✓ 깨진 텍스트 0건 (앞선 수정 반영 확인)' : `  ⚠ 깨진 텍스트 ${broken.length}건`)
