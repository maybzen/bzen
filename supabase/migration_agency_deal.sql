-- 대행계약 전용 컬럼 추가 및 상태 제약 조건 업데이트
-- 실행 순서: 기존 테이블에 컬럼이 없으면 추가, 있으면 스킵

-- 1. 대금집행 상태 컬럼 (계약전/계약중/입금완료/정산중/지급완료)
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS agency_status text 
DEFAULT '계약전';

-- 기존 제약 조건 제거 후 새로 생성 (상태 값 변경에 대응)
ALTER TABLE public.projects 
DROP CONSTRAINT IF EXISTS projects_agency_status_check;

ALTER TABLE public.projects 
ADD CONSTRAINT projects_agency_status_check 
CHECK (agency_status IN ('계약전','계약중','입금완료','정산중','지급완료'));

-- 2. 수수료 수익액 컬럼 (우리 회사 매출)
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS agency_fee bigint 
DEFAULT 0;

-- 3. 코멘트
COMMENT ON COLUMN public.projects.agency_status IS '대행계약 대금집행 상태 (계약전/계약중/입금완료/정산중/지급완료)';
COMMENT ON COLUMN public.projects.agency_fee IS '대행계약 수수료 수익액 (우리 회사 매출)';

-- 4. 인덱스 (상태 필터링 성능용)
CREATE INDEX IF NOT EXISTS idx_projects_agency_status ON public.projects(agency_status);
CREATE INDEX IF NOT EXISTS idx_projects_agency_fee ON public.projects(agency_fee);
