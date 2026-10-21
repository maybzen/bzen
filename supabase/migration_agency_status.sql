-- 대행계약 대금집행 상태 추적용 컬럼 추가
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS agency_status text 
CHECK (agency_status IN ('계약중','입금완료','지급완료','정산완료')) 
DEFAULT '계약중';

ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS agency_fee_paid bigint 
DEFAULT 0;

COMMENT ON COLUMN public.projects.agency_status IS '대행계약 대금집행 상태 (계약중/입금완료/지급완료/정산완료)';
COMMENT ON COLUMN public.projects.agency_fee_paid IS '대행업체에 실제로 지급한 수수료·전달금';
