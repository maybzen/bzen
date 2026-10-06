-- =====================================================================
-- bzen-accounting: 로그인 없는 외부인력 명단 (external_members)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (테이블 추가만)
--
-- 배경: profiles는 로그인 계정(auth.users)과 1:1 강제 연결이라
--   계정 없는 외부인력(허수정·장정아님형) 행을 만들 수 없습니다.
--   그래서 외부인력은 별도 표에 둡니다. 로그인 불가·계정관리 미노출.
--
-- 효과:
--   kind: 'external_partner' (외부협력·3.3%, 상주) | 'external' (외부단기·3.3%, 행사 알바)
--   구성원 화면에서 profiles와 합쳐서 보여주고, 급여관리 구분에도 반영됩니다.
--   휴무 자동부여·계정관리는 대상이 아닙니다.
-- =====================================================================

create table if not exists public.external_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  employment_type text not null default 'external_partner'
    check (employment_type in ('external_partner', 'external')),
  nickname text not null default '',
  department text not null default '',
  phone text not null default '',
  hire_date date,
  memo text not null default '',
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists external_members_name_lower_uidx
  on public.external_members (lower(full_name));

alter table public.external_members enable row level security;

drop policy if exists "external_members_select" on public.external_members;
create policy "external_members_select"
  on public.external_members for select to authenticated using (true);
drop policy if exists "external_members_insert" on public.external_members;
create policy "external_members_insert"
  on public.external_members for insert to authenticated with check (true);
drop policy if exists "external_members_update" on public.external_members;
create policy "external_members_update"
  on public.external_members for update to authenticated using (true) with check (true);
drop policy if exists "external_members_delete" on public.external_members;
create policy "external_members_delete"
  on public.external_members for delete to authenticated using (true);

-- 확인 (1행이 뜨면 성공)
select count(*) as external_members_ready from public.external_members;
