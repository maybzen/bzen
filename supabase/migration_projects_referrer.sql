-- 대행계약 소개자 (계약 연결해준 분, 예: 협회 담당자).
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS referrer text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.projects.referrer IS '대행계약 소개자 (예: 부산컨벤션산업협회 정가희 국장)';
