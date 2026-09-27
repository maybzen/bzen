import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const APPLY = process.argv.includes('--apply')
const { SUPABASE_URL, SUPABASE_ANON_KEY, BZEN_EMAIL, BZEN_PASSWORD } = process.env
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
await sb.auth.signInWithPassword({ email: BZEN_EMAIL, password: BZEN_PASSWORD })

// ---------- 시트 파싱 ----------
function parseCSV(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (q) {
      if (c === '"') { if (clean[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}
const normNum = (s) => Number(String(s || '').replace(/[\s,]/g, '')) || 0
const lines = parseCSV(fs.readFileSync('/tmp/sheet.csv', 'utf8'))
const sheet = []
for (const r of lines) {
  if (!/^\d+$/.test((r[0] || '').trim())) continue
  let d = (r[2] || '').trim().replace(/\./g, '-')
  const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const amt = normNum(r[10])
  if (!amt) continue
  sheet.push({
    no: r[0].trim(), proj: (r[1] || '').trim(), date: d, amt,
    merch: (r[6] || '').trim(), users: (r[7] || '').replace(/\s/g, ''),
    pay: (r[11] || '').trim(),
  })
}
console.log('시트 유효행:', sheet.length)

// ---------- DB ----------
const { data: projects } = await sb.from('projects').select('id,name')
const projByName = Object.fromEntries(projects.map((p) => [p.name, p.id]))
const PROJMAP = {
  '비젠': '비젠내부',
  'WDC 부산 컨퍼런스': '2028 세계디자인수도부산 국제컨퍼런스',
  'NR2026': 'Next Rise 2026',
  'KCCV': 'KCCV2026',
  '(제안서)KOBC BADA': 'KOBC BADA 컨퍼런스',
  '(제안서)IMO': '2026년 IMO SMART-C Women 프로그램 용역',
  'Kiwigame': 'Kiwigame',
  '유니콘브릿지': '유니콘브릿지',
  'FLY ASIA': 'FLY ASIA',
}
let db = [], s = 0
for (;;) {
  const { data } = await sb.from('entries').select('*').gte('entry_date', '2026-01-01').lte('entry_date', '2026-12-31').in('entry_type', ['opex', 'purchase']).range(s, s + 999)
  db.push(...(data || []))
  if (!data || data.length < 1000) break
  s += 1000
}
const memoUser = (memo) => {
  const mm = String(memo || '').match(/이용자\s+([^·]+)/)
  return mm ? mm[1].trim().replace(/\s/g, '') : ''
}
const withMemoUser = (memo, user) => {
  const base = String(memo || '').replace(/\s*·\s*이용자\s+[^·]*/, '').trim()
  return user ? `${base} · 이용자 ${user}`.replace(/^ · /, '') : base
}
const isSheetRow = (r) => /시트 일괄등록|운영비 정산 시트/.test(r.memo || '')
const isCardTwin = (r) => /부산은행_이용대금|카드명세서 일괄등록|법인카드 일괄등록/.test(r.memo || '')

// 명세서(부산은행 9월) 라인 수
const stmt = [['2026-07-01',400],['2026-08-03',204600],['2026-08-03',391000],['2026-08-04',204600],['2026-08-04',404600],['2026-08-04',60000],['2026-08-05',50000],['2026-08-05',36000],['2026-08-05',185400],['2026-08-05',193800],['2026-08-05',92000],['2026-08-11',4000],['2026-08-11',900],['2026-08-12',19800],['2026-08-12',210000],['2026-08-13',63000],['2026-08-14',44700],['2026-08-19',7800],['2026-08-19',12000],['2026-08-19',6000],['2026-08-19',2500],['2026-08-19',76000],['2026-08-19',8000],['2026-08-19',24500],['2026-08-20',5000],['2026-08-20',39500],['2026-08-20',4500],['2026-08-21',69830],['2026-08-21',25170],['2026-08-22',11900],['2026-08-24',2700],['2026-08-24',63000],['2026-08-25',52000],['2026-08-26',53400],['2026-08-26',105000],['2026-08-27',86000],['2026-08-30',57500],['2026-08-31',60000],['2026-09-01',126900],['2026-09-01',61100],['2026-09-02',150000],['2026-09-02',16400],['2026-09-02',13000]]
const stmtCount = {}
for (const [d, a] of stmt) stmtCount[d + '|' + a] = (stmtCount[d + '|' + a] || 0) + 1

let updUser = 0, updProj = 0, delRows = []
const unmappedProj = new Set()

for (const sh of sheet) {
  const cands = db.filter((r) => r.entry_date === sh.date && Number(r.total_amount) === sh.amt)
  if (!cands.length) continue
  // keeper: 동일 이용자 메모 최우선 → 지결건은 expense_report, 법카건은 시트행 우선
  const wantReport = /지결/.test(sh.pay)
  const rank = (r) => {
    const userBonus = memoUser(r.memo) === sh.users ? -10 : 0
    if (wantReport) return userBonus + (r.source === 'expense_report' ? 0 : isSheetRow(r) ? 1 : 2)
    if (r.source === 'expense_report') return userBonus + 9
    return userBonus + (isSheetRow(r) ? 0 : 1)
  }
  const sorted = [...cands].sort((a, b) => rank(a) - rank(b))
  const keeper = sorted[0]
  const twins = sorted.slice(1).filter(isCardTwin)
  const key = sh.date + '|' + sh.amt
  const backed = stmtCount[key] || 0
  const cardCount = cands.filter((r) => r.source === 'card').length
  const over = backed > 0 ? cardCount - backed : 0

  // 1) 이용자 동기화 (keeper 기준)
  if (sh.users && memoUser(keeper.memo) !== sh.users) {
    console.log(`USER No.${sh.no} ${sh.date} ${sh.amt.toLocaleString()} [${memoUser(keeper.memo) || '-'} → ${sh.users}] ${(keeper.counterparty || '').slice(0, 18)}`)
    updUser++
    if (APPLY) await sb.from('entries').update({ memo: withMemoUser(keeper.memo, sh.users) }).eq('id', keeper.id)
  }
  // 2) 프로젝트 동기화
  const targetProj = PROJMAP[sh.proj] || null
  if (!PROJMAP[sh.proj]) unmappedProj.add(sh.proj)
  if (targetProj && keeper.project_id !== projByName[targetProj]) {
    const cur = projects.find((p) => p.id === keeper.project_id)?.name || '(없음)'
    console.log(`PROJ No.${sh.no} ${sh.date} ${sh.amt.toLocaleString()} [${cur} → ${targetProj}]`)
    updProj++
    if (APPLY) await sb.from('entries').update({ project_id: projByName[targetProj] }).eq('id', keeper.id)
  }
  // 3) 중복 삭제: keeper 외 카드 twin (명세서 뒷받침 있을 때만)
  if (twins.length && over > 0) {
    for (const t of twins.slice(0, over)) {
      // keeper에 이용자 없으면 twin 것 이전
      const tu = memoUser(t.memo)
      if (tu && !memoUser(keeper.memo)) {
        console.log(`MERGE-USER ${t.id.slice(0, 8)} → keeper (${tu})`)
        if (APPLY) {
          const { data: k } = await sb.from('entries').select('memo').eq('id', keeper.id).single()
          await sb.from('entries').update({ memo: withMemoUser(k.memo, tu) }).eq('id', keeper.id)
        }
      }
      console.log(`DEL ${t.id.slice(0, 8)} ${t.entry_date} ${Number(t.total_amount).toLocaleString()} ${(t.counterparty || '').slice(0, 20)} | ${(t.memo || '').slice(0, 45)}`)
      delRows.push(t.id)
    }
  }
}

// 9/02 합산행(29,400) 특별 처리: 분할 카드행이 따로 있으면 삭제 (합산 시트행 유지)
const split1 = db.filter((r) => r.entry_date === '2026-09-02' && Number(r.total_amount) === 16400 && /부산은행_이용대금/.test(r.memo || ''))
const split2 = db.filter((r) => r.entry_date === '2026-09-02' && Number(r.total_amount) === 13000 && /부산은행_이용대금/.test(r.memo || ''))
const merged = db.filter((r) => r.entry_date === '2026-09-02' && Number(r.total_amount) === 29400)
if (merged.length && (split1.length || split2.length)) {
  for (const r of [...split1, ...split2]) {
    console.log(`DEL-SPLIT ${r.id.slice(0, 8)} 2026-09-02 ${Number(r.total_amount).toLocaleString()} ${(r.counterparty || '').slice(0, 20)}`)
    delRows.push(r.id)
  }
}
// 시트 오타행 확인 (No.23: 2025-06-10)
const typo = db.filter((r) => r.entry_date === '2026-06-10' && Number(r.total_amount) === 18200)
console.log('No.23 대응(2026-06-10 GS25 18,200):', typo.map((r) => `${r.id.slice(0, 8)} ${(r.counterparty || '')} ${(r.memo || '').slice(0, 30)}`).join(' / ') || '없음')
console.log('---')
console.log(`이용자 수정: ${updUser}건 / 프로젝트 수정: ${updProj}건 / 삭제: ${delRows.length}건`)
console.log('미매핑 프로젝트:', [...unmappedProj].join(', ') || '없음')

if (APPLY && delRows.length) {
  const uniq = [...new Set(delRows)]
  console.log(`삭제 고유: ${uniq.length}건 (중복제거 전 ${delRows.length})`)
  const { error } = await sb.from('entries').delete().in('id', uniq)
  if (error) { console.error('삭제 실패:', error.message); process.exit(1) }
  console.log('삭제 완료')
}
if (!APPLY) console.log('dry-run: --apply 없이 종료 (DB 변경 없음)')
