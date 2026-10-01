-- =====================================================================
-- bzen-accounting: 프로젝트 등록·수정을 직원도 가능하게
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (정책만 교체)
--
-- 효과:
--   조회·등록·수정 = 로그인 사용자 전체 (직원 포함)
--   삭제 = 관리자만 유지
-- 기존 정책 이름이 달라도 동작합니다 (전부 걷어내고 재생성).
-- 이 파일을 실행하기 전에는, 직원이 저장 버튼을 눌러도 DB에서 막힙니다.
-- 꼭 1회 실행하세요.
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

-- 1) projects 정책 교체
alter table public.projects enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'projects'
  loop
    execute format('drop policy if exists %I on public.projects', r.policyname);
  end loop;
end
$$;

create policy "projects_select"
  on public.projects for select to authenticated using (true);
create policy "projects_insert"
  on public.projects for insert to authenticated with check (true);
create policy "projects_update"
  on public.projects for update to authenticated using (true) with check (true);
create policy "projects_delete"
  on public.projects for delete to authenticated using (public.is_admin());

-- 2) 확인 (4행이 뜨면 성공)
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'projects' order by cmd;
