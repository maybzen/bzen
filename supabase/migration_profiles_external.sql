-- =====================================================================
-- bzen-accounting: 구성원 내부/외부 구분 (3단계 선택제)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (컬럼만 추가)
--
-- 효과:
--   profiles.employment_type: 'internal' | 'external_partner' | 'external'
--   (기본 internal)
--     - internal: 내부 (4대보험·명세서). 예: 직원, 손선욱님
--     - external_partner: 외부협력 — 사무실 상주지만 세무상 외부·3.3%.
--       예: 허수정·장정아님. 급여관리에서 행사 알바와 분리 표시됩니다.
--     - external: 단기외부 — 행사 알바 등. 3.3%.
--   profiles.card_code: 카드 이용자 코드 (영어 대문자, 선택 입력)
--     목록에 없는 분은 카드 화면의 "기타 직접입력"과 같은 값을 적으면 됩니다.
--
-- 실행하지 않아도 화면은 동작합니다 (구분 변경분은 SQL 실행 뒤부터 저장됩니다).
-- 이미 이전 버전으로 실행한 DB에도 그대로 덮어씌울 수 있습니다.
-- =====================================================================

alter table public.profiles
  add column if not exists employment_type text not null default 'internal';

alter table public.profiles
  add column if not exists card_code text not null default '';

-- 확인 (컬럼 2개가 뜨면 성공)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('employment_type', 'card_code') order by column_name;
