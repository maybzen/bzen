-- =====================================================================
-- bzen-accounting: 구성원 외부인력 구분 (사무형 외부 · 3.3%)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (컬럼만 추가)
--
-- 효과:
--   profiles.employment_type: 'internal' | 'external' (기본 internal)
--     - external = 로그인 계정 없이 근무하는 사무형 외부인력
--       (허수정·장정아: 3.3% 사업소득, 급여관리 단기·외부 섹션)
--   profiles.card_code: 법인카드 이용자 코드 (C · BE 등, 영어 대문자)
--
-- 실행하지 않아도 화면은 동작합니다 (컬럼이 없으면 이름 기준으로 판단).
-- =====================================================================

alter table public.profiles
  add column if not exists employment_type text not null default 'internal';

alter table public.profiles
  add column if not exists card_code text not null default '';

-- 기존 사무형 외부인력이 이미 profiles에 있으면 외부로 표시
update public.profiles
set employment_type = 'external',
    card_code = case full_name when '허수정' then 'C' when '장정아' then 'BE' else card_code end
where full_name in ('허수정', '장정아') and employment_type <> 'external';

-- 확인 (허수정·장정아가 있으면 external / C·BE 로 표시)
select full_name, employment_type, card_code from public.profiles
where full_name in ('허수정', '장정아', '손선욱') order by full_name;
