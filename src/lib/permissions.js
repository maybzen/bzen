import { useEffect, useState } from 'react'
import { getSettings } from './api'

/**
 * 직원이 볼 수 있는 추가 메뉴 키 목록.
 * 기본 메뉴(대시보드·지출결의·프로젝트·설정)는 항상 보입니다.
 * settings.staff_permissions 컬럼이 아직 없으면(마이그레이션 전)
 * 거래처만 기본 허용합니다.
 */
export const STAFF_DEFAULT_PERMS = ['partners']

/** 토글로 관리하는 메뉴 정의 (설정·계정관리 화면과 공유)
 *  - 고정 공통(대시보드·지출결의·거래처·프로젝트·설정)은 여기서 뺍니다. */
export const PERM_DEFS = [
  { key: 'sales', label: '매출' },
  { key: 'purchases', label: '매입' },
  { key: 'expenses', label: '운영비' },
  { key: 'reports', label: '보고서' },
]

export const PERM_LABEL = Object.fromEntries(PERM_DEFS.map((p) => [p.key, p.label]))

/** 고정 공통 메뉴: 역할·권한과 무관하게 항상 보입니다. */
export const STAFF_BASE_LABEL = '대시보드·지출결의·거래처·프로젝트·설정'

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
  return { perms: effectivePerms(settings, profile), loading: settings === null }
}
