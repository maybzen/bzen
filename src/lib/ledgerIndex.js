/**
 * 검증용 장부 인덱스.
 *
 * 중복·표기 대조는 "장부 전체"와 비교해야 하므로 전량 행이 필요합니다.
 * 모달을 열 때마다 1천여 줄을 다시 읽지 않도록 모듈 레벨에 한 번만 캐시하고,
 * 등록·수정·삭제가 일어나면 무효화한 뒤 구독자에게 알립니다.
 */
import { useEffect, useState } from 'react'
import { auditEntries, findNettedGroups, partyVariants } from './validate'
import { aliasRoot, loadAliases } from './aliases'

let cache = null
let pending = null
const listeners = new Set()

function build(entries) {
  const opts = { aliasRoot }
  return {
    entries,
    partyIndex: partyVariants(entries, aliasRoot),
    issues: auditEntries(entries, opts),
    netted: findNettedGroups(entries, opts),
    loadedAt: Date.now(),
  }
}

async function load() {
  // api.js 가 이 모듈을 import 하므로 순환 참조를 피하려 동적으로 불러옵니다
  const { listEntries } = await import('./api')
  const [rows] = await Promise.all([listEntries({ maxRows: 20000 }), loadAliases().catch(() => [])])
  cache = build(rows || [])
  pending = null
  for (const fn of listeners) fn(cache)
  return cache
}

/** 저장 후 호출. 다음 대조 시 최신 데이터로 다시 읽습니다. */
export function invalidateLedgerIndex() {
  cache = null
  pending = null
  // 구독자(대시보드 점검 카드 등)가 있으면 바로 다시 읽어 새 결과를 밀어줍니다.
  // 구독자가 없으면 다음에 필요할 때 읽습니다.
  if (listeners.size > 0) {
    pending = load().catch(() => {
      pending = null
      return null
    })
  }
}

/** 강제로 다시 읽기 */
export function refreshLedgerIndex() {
  invalidateLedgerIndex()
  return ensureLedgerIndex()
}

export function ensureLedgerIndex() {
  if (cache) return Promise.resolve(cache)
  if (!pending) pending = load()
  return pending
}

/**
 * 대시보드/모달 공용 훅.
 * @returns {{ entries: any[], issues: any[], loading: boolean, ready: boolean }}
 */
export function useLedgerIndex({ enabled = true } = {}) {
  const [index, setIndex] = useState(cache)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return undefined

    let alive = true
    const onChange = (next) => {
      if (alive) setIndex(next)
    }
    listeners.add(onChange)

    if (!cache) {
      setLoading(true)
      ensureLedgerIndex()
        .then((next) => {
          if (alive) setIndex(next)
        })
        .catch(() => {
          /* 전사 조회 권한이 없으면 조용히 끄고, 나머지 점검은 계속 동작한다 */
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }

    return () => {
      alive = false
      listeners.delete(onChange)
    }
  }, [enabled])

  return {
    entries: index?.entries || [],
    issues: index?.issues || [],
    netted: index?.netted || [],
    partyIndex: index?.partyIndex || null,
    loading,
    ready: Boolean(index),
  }
}
