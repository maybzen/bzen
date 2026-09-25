#!/usr/bin/env node
/**
 * bzen-accounting: 시트 누락분 1회성 보충 (2026-09-25)
 * - 날짜가 비어 있던 7월 2건 → 2026-07-31 로 추정 등록 (memo 에 추정 표기)
 * - 9월 KT 2건 → 매월 6일 패턴으로 2026-09-06 등록 (memo 에 추정 표기)
 * - [WADA] AC MIC 외화 매출 → 입금일 2026-05-06, 거래처 미확인 표기로 등록
 * 추정 일자는 memo 에 남기며, 화면에서 수정 가능합니다.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... BZEN_EMAIL=... BZEN_PASSWORD=... \
 *     node scripts/backfill-sheet-gaps.mjs --commit
 */
import { createClient } from '@supabase/supabase-js'

const COMMIT = process.argv.includes('--commit')
const { SUPABASE_URL, SUPABASE_ANON_KEY, BZEN_EMAIL, BZEN_PASSWORD } = process.env
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BZEN_EMAIL || !BZEN_PASSWORD) {
  console.error('환경변수 SUPABASE_URL / SUPABASE_ANON_KEY / BZEN_EMAIL / BZEN_PASSWORD 가 필요합니다.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email: BZEN_EMAIL,
  password: BZEN_PASSWORD,
})
if (authErr || !auth?.user) {
  console.error('로그인 실패:', authErr?.message || '알 수 없음')
  process.exit(1)
}

const { data: projects } = await supabase.from('projects').select('id,name')
const findProj = (name) => (projects || []).find((p) => p.name === name)?.id || null
const bizProj = findProj('비젠내부')
const wadaProj = findProj('WADA총회')

const rows = [
  {
    entry_type: 'purchase', source: 'manual', entry_date: '2026-07-31',
    counterparty: '(재)부산디자인진흥원', description: '7월 관리비(면세)',
    category: '기타매입', supply_amount: 15603, vat_amount: 0,
    payment_method: '세금계산서',
    memo: '시트 일괄등록 (매입) · 일자미확인: 7월분으로 추정 등록',
    project_id: bizProj, created_by: auth.user.id,
  },
  {
    entry_type: 'purchase', source: 'manual', entry_date: '2026-07-31',
    counterparty: '인천공항세관', description: '관세',
    category: '기타매입', supply_amount: 277939, vat_amount: 0,
    payment_method: '세금계산서',
    memo: '시트 일괄등록 (매입) · 일자미확인: 7월분으로 추정 등록',
    project_id: null, created_by: auth.user.id,
  },
  {
    entry_type: 'purchase', source: 'manual', entry_date: '2026-09-06',
    counterparty: '주식회사 케이티', description: '[비젠내부] 인터넷',
    category: '기타매입', supply_amount: 35615, vat_amount: 3561,
    payment_method: '세금계산서',
    memo: '시트 일괄등록 (매입) · 작성일 미기재: 매월 6일 패턴일 적용',
    project_id: bizProj, created_by: auth.user.id,
  },
  {
    entry_type: 'purchase', source: 'manual', entry_date: '2026-09-06',
    counterparty: '주식회사 케이티', description: '[비젠내부] 전화비',
    category: '기타매입', supply_amount: 16669, vat_amount: 1666,
    payment_method: '세금계산서',
    memo: '시트 일괄등록 (매입) · 작성일 미기재: 매월 6일 패턴일 적용',
    project_id: bizProj, created_by: auth.user.id,
  },
  {
    entry_type: 'sale', source: 'manual', entry_date: '2026-05-06',
    counterparty: '수출(거래처 미확인)', description: '[WADA] AC MIC',
    category: '기타매출', supply_amount: 1465478, vat_amount: 0,
    payment_method: '계좌이체',
    memo: '시트 일괄등록 (매출) · 입금일 5월6일 · 우리은행외화계좌로 이체(수출)',
    project_id: wadaProj, created_by: auth.user.id,
  },
]

console.log(`보충 대상 ${rows.length}건`)
for (const r of rows) console.log(`  ${r.entry_date} ${r.counterparty} ${(r.supply_amount + r.vat_amount).toLocaleString()}원`);
if (!COMMIT) {
  console.log('dry-run: --commit 없이 종료 (DB 변경 없음)')
  process.exit(0)
}
const { error } = await supabase.from('entries').insert(rows)
if (error) {
  console.error('등록 실패:', error.message)
  process.exit(1)
}
console.log('등록 완료')
