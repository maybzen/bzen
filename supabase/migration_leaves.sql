-- =====================================================================
-- bzen-accounting: 휴무대장(연차·대휴·동계휴가·보건휴가·경조사) 마이그레이션
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 소요 시간: 수 초 / 기존 데이터에 영향 없음 (테이블 추가만)
-- =====================================================================

-- 1) 휴무대장 테이블 (발생/사용 내역) ------------------------------------------
create table if not exists public.leave_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default CURRENT_DATE,
  person text not null default '',
  leave_type text not null default '',
  direction text not null default '사용',
  days numeric not null default 0,
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists leave_entries_person_idx
  on public.leave_entries (person);
create index if not exists leave_entries_date_idx
  on public.leave_entries (entry_date);

-- 2) RLS: 로그인 사용자 전체 (화면 접근은 앱에서 권한으로 통제) --------------
alter table public.leave_entries enable row level security;

drop policy if exists "leave_entries_select" on public.leave_entries;
create policy "leave_entries_select"
  on public.leave_entries for select to authenticated using (true);
drop policy if exists "leave_entries_insert" on public.leave_entries;
create policy "leave_entries_insert"
  on public.leave_entries for insert to authenticated with check (true);
drop policy if exists "leave_entries_update" on public.leave_entries;
create policy "leave_entries_update"
  on public.leave_entries for update to authenticated using (true) with check (true);
drop policy if exists "leave_entries_delete" on public.leave_entries;
create policy "leave_entries_delete"
  on public.leave_entries for delete to authenticated using (true);

-- 3) 확인 (1행 뜨면 성공) -----------------------------------------------------
select count(*) as leave_entries_ready from public.leave_entries;
