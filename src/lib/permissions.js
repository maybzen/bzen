import { useEffect, useState } from 'react'
import { getSettings } from './api'

/**
 * 직원 기본 메뉴 (설정 저장 전·조회 실패 시 기본값).
 */
export const STAFF_DEFAULT_PERMS = ['expense-reports', 'expenses', 'partners', 'projects', 'leaves']

/** 직원 로그인 직후 첫 화면 (권한에 없으면 아래 순서대로 대체) */
export const STAFF_LANDING = '/expense-reports'

const LANDING_BY_PERM = {
  'expense-reports': '/expense-reports',
  expenses: '/expenses',
  partners: '/partners',
  projects: '/projects',
  leaves: '/leaves',
}

/** 직원이 볼 수 있는 첫 화면. 설정에서 메뉴를 끈 경우를 대비해 순서대로 찾고, 없으면 설정으로 */
export function staffLanding(perms) {
  for (const key of Object.keys(LANDING_BY_PERM)) {
    if ((perms || []).includes(key)) return LANDING_BY_PERM[key]
  }
  return '/settings'
}

/** 토글로 관리하는 메뉴 정의 (설정·계정관리 화면과 공유)
 *  - 고정 공통(설정)은 여기서 뺍니다. 계정관리는 항상 관리자 전용. */
export const PERM_DEFS = [
  { key: 'expense-reports', label: '지출결의' },
  { key: 'partners', label: '거래처' },
  { key: 'projects', label: '프로젝트' },
  { key: 'sales', label: '매출' },
  { key: 'purchases', label: '매입' },
  { key: 'expenses', label: '운영비' },
  { key: 'fixed', label: '고정비' },
  { key: 'reports', label: '보고서' },
  { key: 'tax', label: '세금관리' },
  { key: 'collections', label: '수금관리' },
  { key: 'leaves', label: '휴무대장' },
]

export const PERM_LABEL = Object.fromEntries(PERM_DEFS.map((p) => [p.key, p.label]))

/** 고정 공통 메뉴: 역할·권한과 무관하게 항상 보입니다. */
export const STAFF_BASE_LABEL = '설정'

let cached = null

function getStaffSettings() {
  if (!cached) {
    cached = getSettings()
      .then((s) => ({
        global: Array.isArray(s?.staff_permissions) ? s.staff_permissions : STAFF_DEFAULT_PERMS,
        overrides:
          s?.staff_overrides && typeof s.staff_overrides === 'object' && !Array.isArray(s.staff_overrides)
            ? s.staff_overrides
            : {},
        financeViewers: Array.isArray(s?.finance_viewers)
          ? s.finance_viewers.filter((v) => typeof v === 'string')
          : [],
        projectScope: s?.project_scope === 'own' ? 'own' : 'all',
      }))
      .catch(() => ({ global: STAFF_DEFAULT_PERMS, overrides: {}, financeViewers: [], projectScope: 'all' }))
  }
  return cached
}

/** 전체 기본 권한 + 해당 계정의 추가 권한을 합친 실효 권한 */
export function effectivePerms(staffSettings, profile) {
  const global = staffSettings?.global || []
  const extra =
    (profile && staffSettings?.overrides && staffSettings.overrides[profile.id]) || []
  return [...new Set([...global, ...(Array.isArray(extra) ? extra : [])])]
}

/** 사원(관리자 제외) id 집합 */
export function staffIdsFromProfiles(profiles) {
  return new Set(
    (profiles || [])
      .filter((p) => p && p.id && p.role && p.role !== 'admin')
      .map((p) => p.id),
  )
}

/** 메모의 이용자 코드 목록 (E·SH·Z 등 현장 코드, 대문자 통일) */
export function memoUserCodes(entry) {
  const m = String(entry?.memo || '').match(/이용자\s+([^·]+)/)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
}

/**
 * 직원 화면 노출 여부.
 * - 등록자·지출자가 사원이면 보임 (본인 포함)
 * - 메모에 현장 코드가 있으면 보임. 단, 이용자가 Z뿐인 행은 제외
 * - 3842(대표님 카드) 행은 직원이 직접 등록한 것만 보임
 * 급여·세금·매출·매입처럼 관리자가 직접 넣은 행은 여기서 걸러집니다.
 */
export function isStaffVisible(entry, staffIds) {
  if (!entry) return false
  const registered =
    (staffIds?.has?.(entry.created_by) ?? false) || (staffIds?.has?.(entry.requester_id) ?? false)
  if (registered) return true
  const codes = memoUserCodes(entry)
  if (!codes.length) return false
  if (codes.every((c) => c === 'Z')) return false
  if (/3842/.test(String(entry.memo || ''))) return false
  return true
}

export function useStaffPermissions(profile) {
  const [settings, setSettings] = useState(null)
  useEffect(() => {
    let mounted = true
    getStaffSettings().then((s) => {
      if (mounted) setSettings(s)
    })
    return () => {
      mounted = false
    }
  }, [])
  return {
    perms: effectivePerms(settings, profile),
    /* 직원 미리보기용: 개인 추가분 제외한 전체 공통 권한 */
    global: settings?.global || [],
    /* 담당 프로젝트만 보기 여부 */
    projectScope: settings?.projectScope || 'all',
    loading: settings === null,
  }
}

/** 프로젝트 금액 열람 여부 (관리자 + 설정에서 허용한 직원) */
export function useFinanceView(profile, isAdmin) {
  const [viewers, setViewers] = useState(null)
  useEffect(() => {
    let mounted = true
    getStaffSettings().then((s) => {
      if (mounted) setViewers(Array.isArray(s?.financeViewers) ? s.financeViewers : [])
    })
    return () => {
      mounted = false
    }
  }, [])
  if (isAdmin) return true
  if (!profile?.id || !viewers) return false
  return viewers.includes(profile.id)
}
