#!/usr/bin/env node
/**
 * bzen-accounting: 시트 정제 CSV → entries 일괄 등록
 *
 * 사용법 (프로젝트 루트에서):
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... BZEN_EMAIL=... BZEN_PASSWORD=... \
 *     node scripts/import-entries.mjs --file /tmp/bzen-import/clean_opex.csv --dry-run
 *   확인 후 --commit 으로 실제 등록 (--from 2026-07-01 --to 2026-09-30 형식으로 분기 지정 가능)
 *
 * - 로그인은 앱 계정(이메일/비밀번호)으로 하며, 키·비밀번호는 환경변수로만 받습니다.
 * - project_hint 로 projects 를 퍼지 매칭하고, 못 찾으면 project_id=null 로 둡니다.
 * - (entry_date, counterparty, total, entry_type) 기준으로 기존 장부와 중복을 걸러냅니다.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const FILE = opt('--file', '')
const FROM = opt('--from', '2026-01-01')
const TO = opt('--to', '2026-12-31')
const COMMIT = args.includes('--commit')
if (!FILE) {
  console.error('사용법: node scripts/import-entries.mjs --file <csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--commit]')
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
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''))
}

const norm = (s) =>
  String(s || '').toLowerCase().replace(/[\s()[\]{}"'·.,\-_/\\|]+/g, '')
const tokens = (s) =>
  String(s || '').toLowerCase().split(/[\s()[\]{}"'·.,\-_/\\|]+/).filter((t) => t.length >= 2)

const PROJECT_ALIASES = {
  wdc: '2028 세계디자인수도부산 국제컨퍼런스',
  nr2026: 'Next Rise 2026',
  kccv: 'KCCV2026',
}

function matchProject(hint, projects) {
  if (!hint) return null
  const alias = PROJECT_ALIASES[norm(hint)]
  const target = alias || hint
  const h = norm(target)
  if (!h) return null
  let best = null
  let bestScore = 0
  for (const p of projects) {
    const n = norm(p.name)
    if (!n) continue
    let score = 0
    if (n === h) score = 100
    else if (n.includes(h) || h.includes(n)) score = 60
    else {
      const ht = new Set(tokens(target))
      const pt = new Set(tokens(p.name))
      let shared = 0
      for (const t of ht) if (pt.has(t)) shared += 1
      if (shared > 0) score = shared * 20
    }
    if (score > bestScore) { bestScore = score; best = p }
  }
  return bestScore >= 20 ? best : null
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
console.log(`로그인: ${auth.user.email}`)

const { data: projects, error: pErr } = await supabase.from('projects').select('id,name')
if (pErr) {
  console.error('프로젝트 조회 실패:', pErr.message)
  process.exit(1)
}
console.log(`프로젝트 ${projects.length}건 로드`)

// 기존 장부 (중복 검사 + 프로젝트 매칭 확인용)
let existing = []
let start = 0
for (;;) {
  const { data, error } = await supabase
    .from('entries')
    .select('entry_date,counterparty,total_amount,supply_amount,vat_amount,entry_type')
    .gte('entry_date', FROM)
    .lte('entry_date', TO)
    .range(start, start + 999)
  if (error) {
    console.error('기존 장부 조회 실패:', error.message)
    process.exit(1)
  }
  existing.push(...(data || []))
  if (!data || data.length < 1000) break
  start += 1000
}
const seen = new Set(
  existing.map(
    (e) =>
      `${e.entry_date}|${(e.counterparty || '').trim()}|${Number(e.total_amount ?? (Number(e.supply_amount || 0) + Number(e.vat_amount || 0)))}|${e.entry_type}`,
  ),
)
console.log(`기존 장부 ${existing.length}건 로드 (중복 검사 기준)`)

const lines = parseCSV(fs.readFileSync(FILE, 'utf-8'))
const header = lines[0].map((h) => h.trim())
const idx = (name) => header.indexOf(name)
const need = ['entry_type', 'entry_date', 'counterparty', 'description', 'category', 'supply_amount', 'vat_amount']
for (const n of need) {
  if (idx(n) < 0) {
    console.error(`CSV에 '${n}' 열이 없습니다.`)
    process.exit(1)
  }
}

const toInsert = []
const skipped = { range: 0, dup: 0, invalid: 0 }
const unmatched = new Set()
for (const r of lines.slice(1)) {
  const g = (n) => (idx(n) >= 0 ? String(r[idx(n)] ?? '').trim() : '')
  const entry_date = g('entry_date')
  const counterparty = g('counterparty')
  const supply = Number(g('supply_amount')) || 0
  const vat = Number(g('vat_amount')) || 0
  const entry_type = g('entry_type')
  if (!entry_date || !counterparty || !entry_type || supply + vat <= 0) {
    skipped.invalid += 1
    continue
  }
  if (entry_date < FROM || entry_date > TO) {
    skipped.range += 1
    continue
  }
  const key = `${entry_date}|${counterparty}|${supply + vat}|${entry_type}`
  if (seen.has(key)) {
    skipped.dup += 1
    continue
  }
  seen.add(key)
  const hint = g('project_hint')
  const proj = matchProject(hint, projects)
  if (hint && !proj) unmatched.add(hint)
  toInsert.push({
    entry_type,
    source: 'manual',
    entry_date,
    counterparty,
    description: g('description'),
    category: g('category'),
    supply_amount: supply,
    vat_amount: vat,
    payment_method: g('payment_method') || '기타',
    memo: g('memo'),
    project_id: proj ? proj.id : null,
    created_by: auth.user.id,
  })
}

console.log(`등록 대상 ${toInsert.length}건 (제외: 기간외 ${skipped.range}, 중복 ${skipped.dup}, 형식오류 ${skipped.invalid})`)
if (unmatched.size) {
  console.log('프로젝트 미매칭 힌트 (project_id=null 로 등록됨):')
  for (const h of unmatched) console.log(`  - ${h}`)
}
const byType = {}
for (const r of toInsert) {
  byType[r.entry_type] = byType[r.entry_type] || { n: 0, sum: 0 }
  byType[r.entry_type].n += 1
  byType[r.entry_type].sum += r.supply_amount + r.vat_amount
}
for (const [k, v] of Object.entries(byType)) console.log(`  ${k}: ${v.n}건 / ${v.sum.toLocaleString()}원`)

if (!COMMIT) {
  console.log('dry-run: --commit 없이 종료 (DB 변경 없음)')
  process.exit(0)
}

const PAGE = 200
let done = 0
for (let i = 0; i < toInsert.length; i += PAGE) {
  const chunk = toInsert.slice(i, i + PAGE)
  const { error } = await supabase.from('entries').insert(chunk)
  if (error) {
    console.error(`등록 실패 (${i + 1}~${i + chunk.length}건):`, error.message)
    process.exit(1)
  }
  done += chunk.length
  console.log(`등록 ${done}/${toInsert.length}`)
}
console.log('완료')
