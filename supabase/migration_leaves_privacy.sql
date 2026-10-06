-- =====================================================================
-- bzen-accounting: 휴무대장 본인만 보기 (직원은 자기 내역만)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (정책만 교체)
--
-- 효과:
--   조회: 관리자 전체, 직원은 본인 행만 (본인이 등록했거나 본인 이름)
--   등록: 관리자 전체, 직원은 본인 이름으로만
--   수정: 관리자 전체, 직원은 본인 행만 (단, 승인으로는 못 바꿈 → 셀프승인 방지)
--   삭제: 관리자 전체, 직원은 본인의 승인요청(대기) 행만
-- 꼭 1회 실행하세요. 실행 전에는 직원이 전원 내역을 볼 수 있습니다.
-- =====================================================================

-- 본인 행 판별: 내가 등록했거나, 이름이 내 이름인 행
create or replace function public.is_own_leave(row_created_by uuid, row_person text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select
    row_created_by = auth.uid()
    or row_person = (select full_name from public.profiles where id = auth.uid())
$fn$;

alter table public.leave_entries enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'leave_entries'
  loop
    execute format('drop policy if exists %I on public.leave_entries', r.policyname);
  end loop;
end
$$;

create policy "leave_entries_select"
  on public.leave_entries for select to authenticated
  using (public.is_admin() or public.is_own_leave(created_by, person));
create policy "leave_entries_insert"
  on public.leave_entries for insert to authenticated
  with check (public.is_admin() or public.is_own_leave(created_by, person));
create policy "leave_entries_update"
  on public.leave_entries for update to authenticated
  using (public.is_admin() or public.is_own_leave(created_by, person))
  with check (public.is_admin() or (public.is_own_leave(created_by, person) and status <> '승인'));
create policy "leave_entries_delete"
  on public.leave_entries for delete to authenticated
  using (public.is_admin() or (public.is_own_leave(created_by, person) and status = '요청'));

-- 확인 (4행이 뜨면 성공)
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'leave_entries' order by cmd;
