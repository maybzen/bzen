-- =====================================================================
-- bzen-accounting: 구성원 챙기는 생일(celebrate) 컬럼 추가
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 소요 시간: 수 초 / 기존 데이터에 영향 없음 (컬럼 추가만)
-- 배경: 실생일과 챙기는 날이 다를 때 (예: 박현정 실생일 11/19 → 챙기는 날 10/05)
-- =====================================================================

alter table public.profiles
  add column if not exists birth_celebrate date;

comment on column public.profiles.birth_celebrate is
  '실제로 챙기는 생일(케이크·선물). 비어 있으면 birth_date(실생일)를 씁니다.';
