-- 프로젝트 ↔ 거래처 명시적 연결 (다대다).
-- 한 거래처가 여러 행사에 겹쳐도 각각 연결하므로 중복 문제 없습니다.
-- 장부에 있는 이름과 대장 이름이 달라도(법인격 표기 등) 여기서 한 번 묶으면 됩니다.
-- Supabase Dashboard → SQL Editor에서 1회 실행합니다.
create table if not exists public.project_partners (
  project_id uuid not null references public.projects(id) on delete cascade,
  partner_id uuid not null references public.counterparties(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (project_id, partner_id)
);

alter table public.project_partners enable row level security;

drop policy if exists project_partners_all on public.project_partners;
create policy project_partners_all on public.project_partners
  for all to authenticated using (true) with check (true);

-- 확인: 1행이면 성공
select count(*) as project_partners_ready from public.project_partners;
