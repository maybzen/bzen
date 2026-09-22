import { useEffect, useState } from 'react'
import { getSettings } from './api'

/**
 * 직원이 볼 수 있는 추가 메뉴 키 목록.
 * 기본 메뉴(대시보드·지출결의·프로젝트·설정)는 항상 보입니다.
 * settings.staff_permissions 컬럼이 아직 없으면(마이그레이션 전)
 * 거래처만 기본 허용합니다.
 */
export const STAFF_DEFAULT_PERMS = ['partners']

/** 토글로 관리하는 메뉴 정의 (설정 화면과 공유) */
export const PERM_DEFS = [
  { key: 'partners', label: '거래처' },
  { key: 'sales', label: '매출' },
  { key: 'purchases', label: '매입' },
  { key: 'expenses', label: '운영비' },
  { key: 'reports', label: '보고서' },
]

let cached = null

export function getStaffPermissions() {
  if (!cached) {
    cached = getSettings()
      .then((s) =>
        Array.isArray(s?.staff_permissions) ? s.staff_permissions : STAFF_DEFAULT_PERMS,
      )
      .catch(() => [])
  }
  return cached
}

export function useStaffPermissions() {
  const [perms, setPerms] = useState(null)
  useEffect(() => {
    let mounted = true
    getStaffPermissions().then((p) => {
      if (mounted) setPerms(p)
    })
    return () => {
      mounted = false
    }
  }, [])
  return { perms: perms || [], loading: perms === null }
}
