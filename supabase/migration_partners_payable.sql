-- 외주 미지급 확정잔액 (수금관리 거래처별 뷰 연동용)
-- 2026-09-28 사용자 확인 15건 시드와 함께 사용합니다.
ALTER TABLE counterparties
  ADD COLUMN IF NOT EXISTS payable_balance bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN counterparties.payable_balance IS '미지급 확정잔액(원). 2026-09-28 사용자 확인 기준. 수금관리 거래처별 미지급(확정) 컬럼에 표시.';
