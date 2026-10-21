-- 대행계약 수수료 수익액 컬럼 추가
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS agency_fee bigint DEFAULT 0;

COMMENT ON COLUMN public.projects.agency_fee IS '대행계약 수수료 수익액 (우리 회사 매출)';
