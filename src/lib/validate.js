/**
 * 장부 데이터 검증.
 *
 * 두 가지를 한다:
 *   1) checkEntryDraft()  — 한 건을 저장하기 직전에 붙는 경고
 *   2) auditEntries()     — 장부 전체를 훑어 이미 어긋난 건을 목록으로 모음
 *
 * 저장 자체를 막지 않는다. 판단은 사람이 한다.
 */
import { CATEGORIES } from './constants'

/* ------------------------------------------------------------------ */
/* 점검 항목 코드                                                      */
/* ------------------------------------------------------------------ */

export const ISSUE = {
  DUPLICATE: 'duplicate',
  BROKEN: 'broken',
  VARIANT: 'variant',
  VAT: 'vat',
  FIELD: 'field',
}

export const ISSUE_META = {
  [ISSUE.DUPLICATE]: { label: '중복 의심', tone: 'warn', hint: '같은 내역이 이미 있습니다' },
  [ISSUE.BROKEN]: { label: '깨진 텍스트', tone: 'error', hint: '입력값이 치환되지 않은 채 저장된 것 같습니다' },
  [ISSUE.VARIANT]: { label: '표기 흔들림', tone: 'warn', hint: '같은 거래처가 여러 이름으로 들어 있습니다' },
  [ISSUE.VAT]: { label: '부가세 확인', tone: 'warn', hint: '공급가액 대비 세액이 10%가 아닙니다' },
  [ISSUE.FIELD]: { label: '입력 누락', tone: 'info', hint: '비목·프로젝트를 확인해 주세요' },
}

/* ------------------------------------------------------------------ */
/* 거래처 표기 정규화                                                   */
/* ------------------------------------------------------------------ */

/**
 * (주)/(재) 표기·공백·괄호·사업자번호만 다른 같은 거래처를 같은 키로 모읍니다.
 *   엑시움 / 디자인엑시움        → 디자인엑시움
 *   웨이브통신 / 웨이브통신_김미하 → 웨이브통신김미하
 *   137-85-49637 / 에이치디씨…   → 서로 다름 (사업자번호는 따로 둠)
 */
export function normalizeParty(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/(주식회사|유한회사|㈜|\(주\)|\(재\)|\(사\)|\(유\))/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** 사업자번호만 들어온 거래처 표기 판별 (예: 137-85-49637) */
function isBizNumber(raw) {
  return /^[\d-]{9,13}$/.test(String(raw || '').trim())
}

export function partyVariants(entries) {
  // 정규화키 → { 총액, 표기들:Set, 건수 }
  const map = new Map()
  for (const e of entries) {
    const raw = String(e?.counterparty || '').trim()
    if (!raw) continue
    const key = normalizeParty(raw)
    if (!key) continue
    const o = map.get(key) || { key, total: 0, names: new Set(), count: 0 }
    o.names.add(raw)
    o.total += Math.round(Number(e?.total_amount) || 0)
    o.count += 1
    map.set(key, o)
  }
  return map
}

/**
 * 정규화키만으로는 못 잡는 표기 흔들림.
 *   (사)부산항시설관리센터 / BPEX 부산항시설관리센터
 *   웨이브통신 / 웨이브통신_김미하
 * 두 이름이 접두사 관계이고 짧은 쪽이 MIN_PREFIX 자 이상이면 같은 곳으로 봅니다.
 */
export const MIN_PREFIX = 4

export function similarKey(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length < MIN_PREFIX) return false
  // 서로 붙은 이름:  BPEX + 부산항시설관리센터  /  웨이브통신 + _김미하
  const gap = long.length - short.length
  if (gap > 8) return false
  return long.startsWith(short) || long.endsWith(short)
}

/** 여러 표기의 공통 부분 (장부 검색용). 공백 제거 후 2자 이상 공통 문자열 중 가장 긴 것. */
export function longestCommonSubstring(names) {
  const clean = (names || []).map((n) => String(n || '').replace(/\s+/g, '')).filter((s) => s.length >= 2)
  if (clean.length < 2) return ''
  let best = ''
  const [first, ...rest] = clean
  for (let i = 0; i < first.length; i += 1) {
    for (let j = i + 2; j <= first.length; j += 1) {
      const sub = first.slice(i, j)
      if (sub.length <= best.length) continue
      if (rest.every((s) => s.includes(sub))) best = sub
    }
  }
  return best
}

/** DB에 이미 있는 표기 중 draft 의 표기와 같은 거래처로 보이는 이름들 */
export function findSimilarParties(entries, raw, { excludeId = '' } = {}) {
  const key = normalizeParty(raw)
  if (!key) return []
  const found = new Map()
  for (const e of entries) {
    if (e.id && e.id === excludeId) continue
    const n = String(e.counterparty || '').trim()
    if (!n || n === raw) continue
    if (isBizNumber(n)) continue
    const nk = normalizeParty(n)
    if (!similarKey(key, nk)) continue
    found.set(n, (found.get(n) || 0) + 1)
  }
  return [...found.entries()]
}

/* ------------------------------------------------------------------ */
/* 깨진 텍스트                                                          */
/* ------------------------------------------------------------------ */

// ${memo}, {memo}, ${counterparty} 같은 템플릿 잔존 + 값이 안 채워진 흔적
const BROKEN_PATTERNS = [
  { re: /\$\{[^}]*\}/, why: '템플릿 표현이 그대로 들어갔습니다' },
  { re: /(^|[\s·(])\{[a-zA-Z_][\w.]*\}($|[\s·)])/, why: '템플릿 표현이 그대로 들어갔습니다' },
  { re: /\[object Object\]/, why: '객체가 문자열로 변환된 값입니다' },
  { re: /(^|[\s·])undefined($|[\s·])/, why: '값이 비어(undefined) 그대로 저장되었습니다' },
  { re: /(^|[\s·])NaN($|[\s·])/, why: '숫자 계산이 실패(NaN)되었습니다' },
  { re: /(^|[\s·])null($|[\s·])/, why: '값이 비어(null) 그대로 저장되었습니다' },
]

/** 메모·적요·거래처에 깨진 텍스트가 있는지. { where, why } | null */
export function findBrokenText(entry) {
  const fields = [
    ['메모', entry?.memo],
    ['적요', entry?.description],
    ['거래처', entry?.counterparty],
    ['증빙번호', entry?.doc_no],
  ]
  for (const [where, value] of fields) {
    const s = String(value || '')
    if (!s) continue
    for (const p of BROKEN_PATTERNS) {
      if (p.re.test(s)) return { where, why: p.why, sample: s.slice(0, 60) }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 부가세                                                              */
/* ------------------------------------------------------------------ */

/**
 * 세액이 공급가액의 10%와 맞는지. 급여(세액 0), 면세, 일부 공제 카드처럼
 * 0인 경우는 정상으로 보고 넘어갑니다.
 */
export function checkVat(supply, vat) {
  const s = Math.round(Number(supply) || 0)
  const v = Math.round(Number(vat) || 0)
  if (s <= 0 || v <= 0) return null
  const expected = s * 0.1
  // 1원 반올림 + 0.5% 오차까지는 인정
  const tolerance = Math.max(100, expected * 0.005)
  const diff = Math.abs(v - Math.round(expected))
  if (diff <= tolerance) return null
  return {
    expected: Math.round(expected),
    actual: v,
    diff: v - Math.round(expected),
    rate: (v / s) * 100,
  }
}

/* ------------------------------------------------------------------ */
/* 비목·프로젝트                                                        */
/* ------------------------------------------------------------------ */

export function checkFields(entry) {
  const out = []
  const category = String(entry?.category || '').trim()
  const type = entry?.entry_type || 'opex'
  const allowed = CATEGORIES[type] || []

  if (!category) {
    out.push({ code: ISSUE.FIELD, field: 'category', text: '비목이 비어 있습니다.' })
  } else if (!allowed.includes(category)) {
    // 회사 관행상 세금계산서 있는 지출은 매입(purchase)으로 잡고 비목으로 계정과목을 표시한다
    // (예: purchase + 임차료/통신비). 그래서 매입·운영비의 비목 역전은 정상으로 본다.
    // 단, 어느 유형에도 없는 비목(오타 등)은 잘못이다.
    const elsewhere = Object.keys(CATEGORIES).find((t) => t !== type && (CATEGORIES[t] || []).includes(category))
    if (!elsewhere) {
      out.push({ code: ISSUE.FIELD, field: 'category', text: `등록된 비목이 아닙니다: “${category}”` })
    } else if (type === 'sale') {
      // 매출에 운영비·매입 비목이 붙은 경우만 잘못된 분류다.
      out.push({
        code: ISSUE.FIELD,
        field: 'category',
        text: `매출에 ${labelOf(elsewhere)} 비목이 붙어 있습니다: “${category}”`,
      })
    }
  }

  // 매출·매입은 프로젝트 손익에 반영되므로 비면 안 된다
  if ((type === 'sale' || type === 'purchase') && !entry?.project_id) {
    out.push({ code: ISSUE.FIELD, field: 'project_id', text: '프로젝트가 없어 손익에 반영되지 않습니다.' })
  }
  return out
}

const TYPE_LABEL = { sale: '매출', purchase: '매입', opex: '운영비' }
function labelOf(type) {
  return TYPE_LABEL[type] || type
}

/* ------------------------------------------------------------------ */
/* 1) 저장 직전 단일 건 점검                                             */
/* ------------------------------------------------------------------ */

/**
 * draft: 저장하려는 값 (entry_date, counterparty, category, description,
 *        supply_amount, vat_amount, memo, project_id, entry_type)
 * options.entries: 장부 전체 (중복·표기 대조용). 없어도 나머지 점검은 동작합니다.
 * options.excludeId: 수정 중인 행은 자기 자신과 비교하지 않습니다.
 */
export function checkEntryDraft(draft, { entries = [], excludeId = '' } = {}) {
  const out = []
  const type = draft.entry_type || 'opex'
  const supply = Math.round(Number(draft.supply_amount) || 0)
  const vat = Math.round(Number(draft.vat_amount) || 0)
  const total = supply + vat
  const date = String(draft.entry_date || '')
  const rawParty = String(draft.counterparty || '').trim()

  /* 1) 깨진 텍스트 */
  const broken = findBrokenText(draft)
  if (broken) {
    out.push({
      code: ISSUE.BROKEN,
      level: 'error',
      title: `${broken.where}에 깨진 텍스트가 있습니다`,
      detail: `${broken.why} — “${broken.sample}”`,
    })
  }

  /* 2) 중복 의심 */
  if (entries.length && date && total > 0) {
    const myKey = normalizeParty(rawParty)
    const sameAll = []
    const sameAmount = []
    for (const e of entries) {
      if (e.id && e.id === excludeId) continue
      if (e.entry_date !== date) continue
      if (Math.round(Number(e.total_amount) || 0) !== total) continue
      // 표기가 달라도 같은 거래처면 중복으로 본다
      if (myKey && similarKey(myKey, normalizeParty(e.counterparty))) sameAll.push(e)
      else sameAmount.push(e)
    }
    if (sameAll.length) {
      out.push({
        code: ISSUE.DUPLICATE,
        level: 'warn',
        title: `같은 내역이 이미 ${sameAll.length}건 있습니다`,
        detail: `${date} · ${rawParty} · ${total.toLocaleString()}원. 카드명세서가 여러 장인 경우 정상일 수 있습니다.`,
        entryIds: sameAll.map((e) => e.id),
      })
    } else if (sameAmount.length) {
      out.push({
        code: ISSUE.DUPLICATE,
        level: 'warn',
        title: `같은 날짜에 같은 금액의 다른 거래가 있습니다`,
        detail: `${date} · ${total.toLocaleString()}원 — ${sameAmount
          .slice(0, 3)
          .map((e) => e.counterparty)
          .join(', ')}`,
        entryIds: sameAmount.map((e) => e.id),
      })
    }
  }

  /* 3) 거래처 표기 흔들림 */
  if (entries.length && rawParty && !isBizNumber(rawParty)) {
    const similar = findSimilarParties(entries, rawParty, { excludeId })
    if (similar.length) {
      out.push({
        code: ISSUE.VARIANT,
        level: 'warn',
        title: '같은 거래처가 다른 이름으로도 들어 있습니다',
        detail: `“${rawParty}” 외에 ${similar.map(([n, c]) => `“${n}” ${c}건`).join(', ')} — 거래처별 집계가 갈립니다.`,
      })
    }
  }

  /* 4) 부가세 10% */
  const vatIssue = checkVat(supply, vat)
  if (vatIssue) {
    out.push({
      code: ISSUE.VAT,
      level: 'warn',
      title: `공급가액 ${supply.toLocaleString()}원 기준 세액은 ${vatIssue.expected.toLocaleString()}원입니다`,
      detail: `지금 ${vatIssue.actual.toLocaleString()}원(${vatIssue.rate.toFixed(1)}%) — ${Math.abs(vatIssue.diff).toLocaleString()}원 차이. 면세·부분공제·역산 확인해 주세요.`,
    })
  }

  /* 5) 비목·프로젝트 */
  for (const f of checkFields({ ...draft, entry_type: type })) {
    out.push({
      code: ISSUE.FIELD,
      level: 'info',
      title: f.text,
      field: f.field,
    })
  }

  return out
}

/* ------------------------------------------------------------------ */
/* 2) 장부 전체 스캔                                                     */
/* ------------------------------------------------------------------ */

/**
 * 이미 들어간 데이터에서 어긋난 걸 모읍니다. 대시보드 "데이터 점검" 카드용.
 * 항목마다 대표 entry 하나만 내보내되 count 로 묶습니다.
 */
export function auditEntries(entries) {
  if (!entries || !entries.length) return []

  const issues = []

  /* 깨진 텍스트 */
  for (const e of entries) {
    const b = findBrokenText(e)
    if (b) {
      issues.push({
        id: `broken-${e.id}`,
        code: ISSUE.BROKEN,
        level: 'error',
        entryId: e.id,
        date: e.entry_date,
        party: e.counterparty,
        amount: Math.round(Number(e.total_amount) || 0),
        title: `${b.where}에 깨진 텍스트`,
        detail: `“${b.sample}”`,
      })
    }
  }

  /* 완전중복 (같은 날짜·거래처·절대금액이 2건 이상). 결제(+)/취소(-)는 상계합니다. */
  const byKey = groupByDatePartyAbs(entries)
  for (const group of byKey.values()) {
    const pos = group.filter((e) => Math.round(Number(e.total_amount) || 0) > 0)
    const neg = group.filter((e) => Math.round(Number(e.total_amount) || 0) < 0)
    const net = pos.length - neg.length
    // 1건·상계완료(0)·취소로 고친 경우(순수 ±1건)는 정상으로 봅니다
    if (Math.abs(net) < 2) continue
    const side = net > 0 ? pos : neg
    const first = side[0] || group[0]
    const absAmt = Math.abs(Math.round(Number(first.total_amount) || 0))
    const extra = absAmt * (Math.abs(net) - 1)
    // 같은 금액이 여러 장 붙어 있는 경우가 많아 실제로 중복인지 단서로 남긴다
    const sources = [...new Set(group.map((e) => e.source || 'manual'))]
    const voidNote = neg.length ? ` · 취소 ${neg.length}건 상계됨` : ''
    issues.push({
      id: `dup-${side.map((e) => e.id).join('_')}`,
      code: ISSUE.DUPLICATE,
      level: 'warn',
      entryId: first.id,
      entryIds: side.map((e) => e.id),
      count: Math.abs(net),
      date: first.entry_date,
      party: first.counterparty,
      amount: Math.round(Number(first.total_amount) || 0),
      title: `${Math.abs(net)}건으로 같음`,
      detail: `중복 시 ${extra.toLocaleString()}원 과다${voidNote} · 출처 ${sources.join(', ')} — 카드명세서가 여러 장이거나 실제로 두 번 찍은 경우입니다.`,
    })
  }

  /* 거래처 표기 흔들림 — 접두/접미 관계로 묶어 본다 (BPEX + 부산항시설관리센터 등) */
  const cluster = new Map()
  const keyOf = (n) => normalizeParty(n)
  for (const [, v] of partyVariants(entries)) {
    let target = null
    for (const c of cluster.values()) {
      if (similarKey(keyOf(c.names[0]), v.key) || [...c.keys].some((k) => similarKey(k, v.key))) {
        target = c
        break
      }
    }
    if (target) {
      for (const n of v.names) target.names.add(n)
      target.keys.add(v.key)
      target.total += v.total
      target.count += v.count
    } else {
      cluster.set(v.key, { names: new Set(v.names), keys: new Set([v.key]), total: v.total, count: v.count })
    }
  }
  for (const [, c] of cluster) {
    if (c.names.size < 2) continue
    const list = [...c.names].sort((a, b) => a.length - b.length)
    const hasBizNo = list.some(isBizNumber)
    // 묶음에 속한 대표 행들을 모아 장부로 넘어갈 수 있게 합니다 (최대 20건)
    const refIds = []
    const freq = new Map()
    for (const e of entries) {
      const n = String(e?.counterparty || '').trim()
      if (!c.names.has(n)) continue
      freq.set(n, (freq.get(n) || 0) + 1)
      if (refIds.length < 20) refIds.push(e.id)
    }
    const byFreq = [...c.names].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0))
    issues.push({
      id: `var-${[...c.keys].sort().join('_')}`,
      code: ISSUE.VARIANT,
      level: 'warn',
      entryId: refIds[0] || null,
      entryIds: refIds,
      date: '',
      party: byFreq[0] || list[0],
      // 여러 표기를 한 번에 찾도록 공통 문자열로 검색합니다 (없으면 최다 빈도 이름)
      search: longestCommonSubstring(list) || byFreq[0] || list[0],
      amount: c.total,
      count: c.count,
      title: `표기가 ${c.names.size}종류`,
      detail:
        `가장 짧게 쓰는 이름은 “${list[0]}” · 총 ${c.count}건 / ${c.total.toLocaleString()}원` +
        (hasBizNo ? ' · 사업자번호만 적힌 행이 있어 거래처 연결이 안 됩니다' : '') +
        ` · 표기: ${list.slice(0, 4).join(' / ')}${list.length > 4 ? ' 외' : ''}`,
    })
  }

  /* 부가세 10% 아님 */
  for (const e of entries) {
    const v = checkVat(e.supply_amount, e.vat_amount)
    if (!v) continue
    issues.push({
      id: `vat-${e.id}`,
      code: ISSUE.VAT,
      level: 'warn',
      entryId: e.id,
      date: e.entry_date,
      party: e.counterparty,
      amount: Math.round(Number(e.total_amount) || 0),
      title: `세액 ${v.rate.toFixed(1)}%`,
      detail: `공급가액 ${Math.round(Number(e.supply_amount) || 0).toLocaleString()}원 · 세액 ${v.actual.toLocaleString()}원 (10%면 ${v.expected.toLocaleString()}원) · ${e.category || ''}`,
    })
  }

  /* 비목 누락·프로젝트 누락 */
  for (const e of entries) {
    for (const f of checkFields(e)) {
      const amount = Math.round(Number(e.total_amount) || 0)
      issues.push({
        id: `field-${e.id}-${f.field}`,
        code: ISSUE.FIELD,
        level: 'info',
        entryId: e.id,
        date: e.entry_date,
        party: e.counterparty,
        amount,
        title: f.field === 'category' ? '비목이 비어 있습니다' : '프로젝트 미지정',
        detail: `${amount.toLocaleString()}원 · ${e.entry_type === 'sale' ? '매출' : e.entry_type === 'purchase' ? '매입' : '운영비'}${
          f.field === 'project_id' ? ' · 손익에 반영되지 않습니다' : ''
        }`,
      })
    }
  }

  return issues
}

/* ------------------------------------------------------------------ */
/* 결제·취소 상계 묶음                                                   */
/* ------------------------------------------------------------------ */

/** 같은 날짜·거래처·절대금액 묶음 (중복 판정과 상계 표시가 함께 씁니다) */
function groupByDatePartyAbs(entries) {
  const byKey = new Map()
  for (const e of entries || []) {
    const total = Math.round(Number(e.total_amount) || 0)
    if (!e.entry_date || total === 0) continue
    const key = `${e.entry_date}|${normalizeParty(e.counterparty)}|${Math.abs(total)}`
    const o = byKey.get(key)
    if (o) o.push(e)
    else byKey.set(key, [e])
  }
  return byKey
}

/**
 * 결제(+)/취소(-)가 상계되어 정상이 된 묶음.
 * 대시보드 "상계로 해소됨" 표시용. [{ id, date, party, absAmount, pos, neg, entryId, entryIds }]
 */
export function findNettedGroups(entries) {
  const out = []
  for (const group of groupByDatePartyAbs(entries).values()) {
    if (group.length < 2) continue
    const pos = group.filter((e) => Math.round(Number(e.total_amount) || 0) > 0)
    const neg = group.filter((e) => Math.round(Number(e.total_amount) || 0) < 0)
    if (!neg.length) continue
    const net = pos.length - neg.length
    if (Math.abs(net) >= 2) continue
    const first = pos[0] || neg[0]
    const absAmount = Math.abs(Math.round(Number(first.total_amount) || 0))
    out.push({
      id: `net-${group.map((e) => e.id).join('_')}`,
      date: first.entry_date,
      party: first.counterparty,
      absAmount,
      pos: pos.length,
      neg: neg.length,
      entryId: first.id,
      entryIds: group.map((e) => e.id),
    })
  }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  return out
}

/* ------------------------------------------------------------------ */
/* 3) 대시보드 요약                                                     */
/* ------------------------------------------------------------------ */

export function summarizeAudit(issues) {
  const byCode = {}
  for (const key of Object.keys(ISSUE_META)) {
    byCode[key] = issues.filter((i) => i.code === key).length
  }
  const order = Object.keys(ISSUE_META)
  return {
    byCode,
    total: issues.length,
    worst: issues.some((i) => i.level === 'error')
      ? 'error'
      : issues.length
        ? 'warn'
        : 'ok',
    ranked: order.map((code) => ({ code, ...ISSUE_META[code], count: byCode[code] })).filter((x) => x.count > 0),
  }
}
