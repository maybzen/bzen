-- 급여명세서 breakdown 저장용 테이블.
-- Supabase Dashboard → SQL Editor에서 1회 실행 후 급여관리 명세서 기능이 켜집니다.
create table if not exists public.payroll_slips (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references public.entries(id) on delete cascade,
  ym text not null,
  person text not null default '',
  base_pay bigint not null default 0,
  position_pay bigint not null default 0,
  meal_pay bigint not null default 0,
  overtime_pay bigint not null default 0,
  expense_pay bigint not null default 0,
  ded_pension bigint not null default 0,
  ded_health bigint not null default 0,
  ded_employment bigint not null default 0,
  ded_care bigint not null default 0,
  ded_income bigint not null default 0,
  ded_local_income bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payroll_slips enable row level security;

drop policy if exists payroll_slips_admin_all on public.payroll_slips;
create policy payroll_slips_admin_all on public.payroll_slips
  for all to authenticated using (is_admin()) with check (is_admin());

-- 확인: 1행이면 성공
select count(*) as payroll_slips_ready from public.payroll_slips;
