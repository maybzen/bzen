/**
 * 거래처 표기 연동 (별칭 묶음).
 *
 * "코레일 ↔ 한국철도공사"처럼 표기는 다르지만 같은 곳이라 둘 다 남겨야 할 때 연결합니다.
 * 연결된 표기는 집계·검색·점검에서 같은 거래처로 취급됩니다.
 *
 * 정규화 로직은 validate.js 의 normalizeParty 와 동일합니다 (순환 참조 방지용 복제).
 * validate 쪽 정규화가 바뀌면 여기도 함께 바꾸세요.
 */
import { supabase } from './supabase'

function aliasNorm(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/(주식회사|유한회사|㈜|\(주\)|\(재\)|\(사\)|\(유\))/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function normName(raw) {
  return aliasNorm(raw)
}

let rowsCache = null
let pending = null

function buildGroups(rows) {
  // 정규화명 기준 union-find
  const parent = new Map()
  const rawOf = new Map() // norm -> Set(raw)
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x)
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)
    parent.set(x, r)
    return r
  };
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
  };
  for (const r of rows || []) {
    const na = aliasNorm(r.name_a)
    const nb = aliasNorm(r.name_b)
    if (!na || !nb || na === nb) continue
    if (!rawOf.has(na)) rawOf.set(na, new Set())
    if (!rawOf.has(nb)) rawOf.set(nb, new Set())
    rawOf.get(na).add(String(r.name_a))
    rawOf.get(nb).add(String(r.name_b))
    union(na, nb)
  }
  const groups = new Map() // root -> { norms:Set, raws:Set }
  for (const n of parent.keys()) {
    const r = find(n)
    if (!groups.has(r)) groups.set(r, { norms: new Set(), raws: new Set() })
    groups.get(r).norms.add(n)
    for (const raw of rawOf.get(n) || []) groups.get(r).raws.add(raw)
  }
  return groups
}

let groupsCache = new Map()

async function fetchRows() {
  const { data, error } = await supabase.from('party_aliases').select('id,name_a,name_b')
  if (error) throw new Error(error.message)
  return data || []
}

/** 별칭 목록을 읽어 묶음을 다시 계산합니다. 첫 호출 이후에는 캐시를 씁니다. */
export async function loadAliases() {
  if (rowsCache) return rowsCache
  if (!pending) {
    pending = fetchRows()
      .then((rows) => {
        rowsCache = rows
        groupsCache = buildGroups(rows)
        pending = null
        return rowsCache
      })
      .catch((err) => {
        pending = null
        throw err
      })
  }
  return pending
}

/** 캐시를 비웁니다 (연동·해제 후 호출). 다음 조회 때 다시 읽습니다. */
export function invalidateAliases() {
  rowsCache = null
  pending = null
  groupsCache = new Map()
}

/** 정규화명의 묶음 대표키. 묶음이 없으면 자기 자신. (동기, 캐시 기준) */
export function aliasRoot(norm) {
  const n = aliasNorm(norm)
  if (!n) return ''
  for (const [root, g] of groupsCache) {
    if (g.norms.has(n)) return root
  }
  return n
}

/** 원시 표기의 묶음 대표키. */
export function rootOf(raw) {
  return aliasRoot(raw)
}

/** raw 표기가 속한 묶음의 모든 원시 표기 (자기 자신 제외). */
export function linkedRaws(raw) {
  const n = aliasNorm(raw)
  if (!n) return []
  for (const g of groupsCache.values()) {
    if (g.norms.has(n)) return [...g.raws].filter((r) => r !== String(raw || '').trim())
  }
  return []
}

/** 검색어에 딸린 묶음의 원시 표기들 (검색 확장용). 정규화 포함 관계로 찾습니다. */
export function expansionsFor(query) {
  const q = aliasNorm(query)
  if (!q) return []
  const out = new Set()
  for (const g of groupsCache.values()) {
    let hit = false
    for (const n of g.norms) {
      if (n.includes(q) || q.includes(n)) {
        hit = true
        break
      }
    }
    if (hit) for (const r of g.raws) out.add(r)
  }
  return [...out]
}

/** 두 표기를 연동합니다. 같은 정규화명이면 묶을 필요가 없어 false. */
export async function linkNames(a, b, userId) {
  const ra = String(a || '').trim()
  const rb = String(b || '').trim()
  if (!ra || !rb || ra === rb) return false
  if (aliasNorm(ra) === aliasNorm(rb)) return false
  if (aliasRoot(ra) === aliasRoot(rb) && groupsCache.size) return false
  const [name_a, name_b] = ra < rb ? [ra, rb] : [rb, ra]
  const { error } = await supabase.from('party_aliases').insert({ name_a, name_b, created_by: userId || null })
  if (error) throw new Error(error.message)
  invalidateAliases()
  await loadAliases().catch(() => {})
  return true
}

/** 표기가 속한 연동을 해제합니다 (해당 표기가 들어간 묶음 행 삭제). */
export async function unlinkName(raw) {
  const t = String(raw || '').trim()
  if (!t) return 0
  const { data, error } = await supabase.from('party_aliases').select('id,name_a,name_b')
  if (error) throw new Error(error.message)
  const targets = (data || []).filter((r) => r.name_a === t || r.name_b === t)
  for (const r of targets) {
    // eslint-disable-next-line no-await-in-loop
    const { error: delError } = await supabase.from('party_aliases').delete().eq('id', r.id)
    if (delError) throw new Error(delError.message)
  }
  invalidateAliases()
  await loadAliases().catch(() => {})
  return targets.length
}
