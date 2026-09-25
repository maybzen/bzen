#!/usr/bin/env node
/**
 * bzen-accounting: 시트 등록분 운영비 행에 결제수단 라벨 부여 + source 정정 (1회성)
 * - memo='시트 일괄등록 (운영비 정산)' 행만 대상으로 시트 원본과 대조합니다.
 * - 법카/카드 결제 → source='card', memo 에 카드 라벨 추가
 * - *지결 → source='expense_report', memo 에 결의자 표기 추가
 * - 그 외/매칭 실패 행은 손대지 않습니다.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... BZEN_EMAIL=... BZEN_PASSWORD=... \
 *     node scripts/enrich-opex-memo.mjs --sheet /tmp/sheet_op.csv --dry-run
 *   확인 후 --commit
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const SHEET = opt('--sheet', '')
const COMMIT = args.includes('--commit')
if (!SHEET) {
  console.error('사용법: node scripts/enrich-opex-memo.mjs --sheet <원본csv> [--commit]')
  process.exit(1)
}

const { SUPABASE_URL, SUPABASE_ANON_KEY, BZEN_EMAIL, BZEN_PASSWORD } = process.env
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BZEN_EMAIL || !BZEN_PASSWORD) {
  console.error('환경변수 SUPABASE_URL / SUPABASE_ANON_KEY / BZEN_EMAIL / BZEN_PASSWORD 가 필요합니다.')
  process.exit(1)
}

function parseCSV(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let q = false
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i]
    if (q) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1 } else q = false
      } else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}
const num = (s) => {
  const t = String(s ?? '').replace(/[^0-9-]/g, '')
  return t && t !== '-' ? parseInt(t, 10) : 0
}
const isCard = (s) => /법카|카드|코스트코|직불/.test(String(s || ''))
const isGyol = (s) => /지결/.test(String(s || ''))

// 시트: 결제수단 매핑 (date|merchant|total → label), 순서대로 소진
const sheetRows = parseCSV(fs.readFileSync(SHEET, 'utf-8'))
const payMap = new Map()
for (const r of sheetRows.slice(1)) {
  if (r.length < 12) continue
  const d = (r[2] || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
  const total = num(r[10])
  if (!total) continue
  const key = `${d}|${(r[6] || '').trim()}|${total}`
  if (!payMap.has(key)) payMap.set(key, [])
  payMap.get(key).push((r[11] || '').trim())
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

const { data: rows, error } = await supabase
  .from('entries')
  .select('id,entry_date,counterparty,supply_amount,vat_amount,source,payment_method,memo')
  .eq('entry_type', 'opex')
  .gte('entry_date', '2026-01-01')
  .eq('source', 'manual')
  .order('entry_date', { ascending: true })
if (error) {
  console.error('조회 실패:', error.message)
  process.exit(1)
}
console.log(`시트 등록분 ${rows.length}건`)

let nCard = 0
let nGyol = 0
let nSkip = 0
const updates = []
for (const e of rows) {
  const total = Number(e.supply_amount || 0) + Number(e.vat_amount || 0)
  const key = `${e.entry_date}|${(e.counterparty || '').trim()}|${total}`
  const labels = payMap.get(key)
  const label = labels && labels.length ? labels.shift() : ''
  if (!label || /법카|지결|카드/.test(String(e.memo || ''))) {
    nSkip += 1
    continue
  }
  if (isCard(label)) {
    updates.push({ id: e.id, source: 'card', memo: `${e.memo} · ${label}`, _label: label })
    nCard += 1
  } else if (isGyol(label)) {
    updates.push({ id: e.id, source: 'expense_report', memo: `${e.memo} · ${label}`, _label: label })
    nGyol += 1
  } else {
    updates.push({ id: e.id, source: e.source, memo: `${e.memo} · ${label}`, _label: label })
    nSkip += 1
  }
}
console.log(`법인카드 ${nCard}건 / 지출결의 ${nGyol}건 / 기타·미매칭 ${nSkip}건`)
const byLabel = {}
for (const u of updates) byLabel[u._label] = (byLabel[u._label] || 0) + 1
for (const [k, v] of Object.entries(byLabel)) console.log(`  ${k}: ${v}건`)

if (!COMMIT) {
  console.log('dry-run: --commit 없이 종료 (DB 변경 없음)')
  process.exit(0)
}
let done = 0
for (const u of updates) {
  const { error: uErr } = await supabase
    .from('entries')
    .update({ source: u.source, memo: u.memo })
    .eq('id', u.id)
  if (uErr) {
    console.error(`업데이트 실패 ${u.id}:`, uErr.message)
    process.exit(1)
  }
  done += 1
}
console.log(`업데이트 완료 ${done}건`)
