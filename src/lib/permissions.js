import { useEffect, useState } from 'react'
import { getSettings } from './api'

/**
 * 직원이 볼 수 있는 추가 메뉴 키 목록.
 * 기본 메뉴(대시보드·지출결의·프로젝트·설정)는 항상 보입니다.
 * settings.staff_permissions 컬럼이 아직 없으면(마이그레이션 전)
 * 거래처만 기본 허용합니다.
 */
export const STAFF_DEFAULT_PERMS = ['expense-reports', 'partners', 'projects']

/** 토글로 관리하는 메뉴 정의 (설정·계정관리 화면과 공유)
 *  - 고정 공통(대시보드·설정)은 여기서 뺍니다. 계정관리는 항상 관리자 전용. */
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
export const STAFF_BASE_LABEL = '대시보드·설정'

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
      }))
      .catch(() => ({ global: [], overrides: {} }))
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
    loading: settings === null,
  }
}
