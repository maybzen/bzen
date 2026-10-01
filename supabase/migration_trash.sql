-- =====================================================================
-- bzen-accounting: 휴지통 (프로젝트 + 장부 soft delete)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (컬럼 추가 + 정책 1개 교체)
--
-- 효과:
--   projects / entries 에 deleted_at, deleted_by 추가
--   화면의 [삭제]는 휴지통 이동(UPDATE)이 됩니다
--   영구삭제(DELETE)는 관리자만 가능 (휴지통 우회 방지)
--   복원·영구삭제는 휴지통 메뉴(관리자 전용)에서 합니다
-- 꼭 1회 실행하세요. 실행 전에는 삭제 버튼이 예전처럼 즉시 삭제됩니다.
-- =====================================================================

-- 0) 관리자 판별 함수 (없을 때만 만듭니다. 있으면 손대지 않습니다)
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'is_admin') then
    create function public.is_admin()
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
    as $fn$
      select exists (
        select 1 from public.profiles where id = auth.uid() and role = 'admin'
      )
    $fn$;
  end if;
end
$$;

-- 1) 휴지통 컬럼
alter table public.projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;
alter table public.entries
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists projects_deleted_at_idx on public.projects (deleted_at);
create index if not exists entries_deleted_at_idx on public.entries (deleted_at);

-- 2) 영구삭제는 관리자만 (UPDATE=휴지통 이동·복원은 로그인 전원 유지)
drop policy if exists "entries_delete_all" on public.entries;
drop policy if exists "entries_delete_own" on public.entries;
drop policy if exists "entries_delete_admin" on public.entries;
create policy "entries_delete_admin"
  on public.entries for delete to authenticated using (public.is_admin());

-- projects 삭제 정책은 기존(관리자만)을 그대로 둡니다.

-- 3) 확인 (컬럼 2개씩 + 정책 1개가 뜨면 성공)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name in ('projects', 'entries')
  and column_name in ('deleted_at', 'deleted_by') order by table_name, column_name;
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'entries' and cmd = 'DELETE';
