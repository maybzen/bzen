-- =====================================================================
-- bzen-accounting: 수금(입금) 관리 마이그레이션
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 소요 시간: 수 초 / 기존 데이터에 영향 없음 (테이블 추가만)
-- =====================================================================

-- 1) 수금 테이블 (프로젝트별 입금 내역) -------------------------------------
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  collected_on date not null,
  amount bigint not null default 0,
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists collections_project_idx
  on public.collections (project_id);
create index if not exists collections_date_idx
  on public.collections (collected_on);

-- 2) RLS: 로그인 사용자 전체 (화면 접근은 앱에서 권한으로 통제) --------------
alter table public.collections enable row level security;

drop policy if exists "collections_select" on public.collections;
create policy "collections_select"
  on public.collections for select to authenticated using (true);
drop policy if exists "collections_insert" on public.collections;
create policy "collections_insert"
  on public.collections for insert to authenticated with check (true);
drop policy if exists "collections_update" on public.collections;
create policy "collections_update"
  on public.collections for update to authenticated using (true) with check (true);
drop policy if exists "collections_delete" on public.collections;
create policy "collections_delete"
  on public.collections for delete to authenticated using (true);

-- 3) 확인 (1행 뜨면 성공) ---------------------------------------------------
select count(*) as collections_ready from public.collections;
