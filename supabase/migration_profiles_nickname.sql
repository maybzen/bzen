-- =====================================================================
-- bzen-accounting: 구성원 닉네임 (카드 이용자 코드용)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (컬럼 1개 추가)
--
-- 효과:
--   profiles.nickname: 영어 닉네임 (예: Gianna). 첫 글자 대문자가 카드 코드(Z·B·G…)로 쓰입니다.
-- 실행하지 않아도 화면은 동작합니다 (닉네임 칸이 저장만 안 됩니다).
-- =====================================================================

alter table public.profiles
  add column if not exists nickname text not null default '';

-- 확인 (1행이 뜨면 성공)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name = 'nickname';
