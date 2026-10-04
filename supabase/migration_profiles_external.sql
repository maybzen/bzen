-- =====================================================================
-- bzen-accounting: 구성원 내부/외부 구분 (3.3% 선택제)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (컬럼만 추가)
--
-- 효과:
--   profiles.employment_type: 'internal' | 'external' (기본 internal)
--     - internal (기본): 사무형 내부 인력 — 손선욱·허수정·장정아님처럼
--       사무직처럼 근무하면 이쪽. 급여관리 직원 섹션·명세서 대상.
--     - external: 3.3% 사업소득 원천징수 대상 — 구성원 화면의 구분에서
--       해당 인원만 외부로 바꾸면 급여관리 단기·외부 섹션으로 집계됩니다.
--   profiles.card_code: 카드 이용자 코드 (영어 대문자, 선택 입력)
--     목록에 없는 분은 카드 화면의 "기타 직접입력"과 같은 값을 적으면 됩니다.
--
-- 실행하지 않아도 화면은 동작합니다 (구분 변경분은 SQL 실행 뒤부터 저장됩니다).
-- =====================================================================

alter table public.profiles
  add column if not exists employment_type text not null default 'internal';

alter table public.profiles
  add column if not exists card_code text not null default '';

-- 확인 (컬럼 2개가 뜨면 성공)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('employment_type', 'card_code') order by column_name;
