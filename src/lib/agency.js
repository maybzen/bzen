/**
 * 대행계약 대금집행 상태.
 *
 * 상태는 아래 순서로만 진행합니다.
 *   계약전 → 계약중 → 입금완료 → 정산중 → 지급완료
 *
 * 입금/지급 내역이 쌓이면 자동으로 앞 단계로 올려주되,
 * 이미 뒤 단계(수동 선택 포함)에 있으면 되돌리지 않습니다.
 * (수동으로 고친 값을 자동 갱신이 덮어쓰지 않게 하기 위함)
 */
export const AGENCY_STATUS_FLOW = ['계약전', '계약중', '입금완료', '정산중', '지급완료']

export function agencyStatusIndex(status) {
  return AGENCY_STATUS_FLOW.indexOf(String(status || '').trim())
}

/**
 * 입금·지급 내역으로 계산한 "권장 상태".
 * @param {object} p
 * @param {number} p.contract    총계약액 (부가세 포함)
 * @param {number} p.passThrough 대행업체 전달금 (총계약 − 수수료)
 * @param {number} p.paid        대행업체에 실제 지급한 금액
 * @param {number} p.collected   원청에서 실제 수금한 금액
 */
export function deriveAgencyStatus({ contract, passThrough, paid, collected } = {}) {
  const c = Number(contract) || 0
  const pt = Number(passThrough) || 0
  const p = Number(paid) || 0
  const col = Number(collected) || 0

  /* 지급이 전달금에 도달하면 지급완료 (1원 미만 반올림 오차 허용) */
  if (pt > 0 && p >= pt - 1) return '지급완료'
  /* 지급이 일부라도 있었으면 정산중 */
  if (p > 0) return '정산중'
  /* 원청 수금이 있으면 입금완료 */
  if (col > 0) return '입금완료'
  if (c > 0) return '계약중'
  return '계약전'
}

/** 자동 갱신 대상인지: 계산된 상태가 현재보다 앞설 때만 true */
export function isAgencyStatusAhead(derived, current) {
  const j = agencyStatusIndex(derived)
  if (j < 0) return false
  const i = agencyStatusIndex(current)
  /* 저장값이 비어 있거나 알 수 없는 값이면 자동값을 씁니다. */
  if (i < 0) return true
  return j > i
}
