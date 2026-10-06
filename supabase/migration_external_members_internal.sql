-- =====================================================================
-- bzen-accounting: 로그인 없는 내부 인력 허용 (손선욱형)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
--
-- 배경: profiles는 auth.users와 ON DELETE CASCADE라 계정을 지우면
--   구성원에서도 함께 사라집니다. 사이트를 안 쓰는 내부 인력(손선욱님)은
--   계정 없이 구성원·급여에 남아야 하므로 external_members에
--   employment_type='internal' 행으로 둡니다.
--
-- 효과:
--   external_members.employment_type: 'internal' | 'external_partner' | 'external'
--   - internal: 로그인 없는 내부 (4대보험·명세서 대상, 급여관리 '직원 급여'에 표시)
--   - external_partner / external: 기존 그대로 (3.3%)
--   external_members.card_code: 직접 정하는 카드 이용자 코드 (예: SH).
--   비우면 닉네임에서 자동(짧으면 그대로·길면 첫 글자). 박현정(S)과 겹치는
--   손선욱(Shine)은 코드 SH을 직접 적어 SH로 뜹니다.
-- =====================================================================

alter table public.external_members drop constraint if exists external_members_employment_type_check;
alter table public.external_members add constraint external_members_employment_type_check
  check (employment_type in ('internal','external_partner','external'));

alter table public.external_members add column if not exists card_code text not null default '';

-- 손선욱 복원 (계정 삭제돼도 구성원 유지)
insert into public.external_members (full_name, employment_type, nickname, card_code, active)
values ('손선욱','internal','Shine','SH', true)
on conflict (lower(full_name)) do update set employment_type='internal', card_code='SH', active=true;

-- 기존 코드 정리
update public.external_members set nickname='C', card_code='C' where full_name='허수정';
update public.external_members set card_code='BE' where full_name='장정아';
