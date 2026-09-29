-- 프로젝트 ↔ 거래처 연결에 역할 구분 (협력 / 대행).
-- 대행 = 수의계약(여성기업·소기업 5,500만원 한도)으로 계약만 하고
-- 실제 행사는 다른 업체가 진행, 수수료만 받는 방식. 대표만 관리합니다.
ALTER TABLE public.project_partners
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT '협력';

COMMENT ON COLUMN public.project_partners.role IS '협력(기본) / 대행(계약만 하고 행사는 업체가 진행, 수수료 수취)';
