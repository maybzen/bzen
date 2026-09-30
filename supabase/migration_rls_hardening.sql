-- =====================================================================
-- bzen-accounting: RLS 보강 (장부·프로필·설정)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (정책만 추가)
--
-- 왜 필요한가:
--   화면에서 아무리 가려도, 로그인한 계정은 콘솔·API로 장부 전체를 읽을 수
--   있습니다. 이 파일은 "쓰기"를 잠급니다. 읽기는 공유 장부라 열어둡니다.
--   (직원 급여 숨김은 화면단에서 처리합니다)
-- 주의: 파일 전체를 한 번에 실행하세요 (정책 없이 RLS만 켜지면 막힙니다).
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

-- 1) 장부(entries): 읽기는 공유, 수정·삭제는 본인(등록자) 또는 관리자만 ----------
alter table public.entries enable row level security;

drop policy if exists "entries_select_shared" on public.entries;
create policy "entries_select_shared"
  on public.entries for select to authenticated using (true);

drop policy if exists "entries_update_own" on public.entries;
create policy "entries_update_own"
  on public.entries for update to authenticated
  using (created_by = auth.uid() or is_admin())
  with check (created_by = auth.uid() or is_admin());

drop policy if exists "entries_delete_own" on public.entries;
create policy "entries_delete_own"
  on public.entries for delete to authenticated
  using (created_by = auth.uid() or is_admin());

-- insert는 열어둡니다 (일괄등록이 created_by 없이 들어오는 경우가 있음)

-- 2) 프로필(profiles): 읽기는 공유(이름·부서 표시용), 쓰기는 관리자만 ------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_shared" on public.profiles;
create policy "profiles_select_shared"
  on public.profiles for select to authenticated using (true);

drop policy if exists "profiles_write_admin" on public.profiles;
create policy "profiles_write_admin"
  on public.profiles for insert to authenticated with check (is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin"
  on public.profiles for delete to authenticated using (is_admin());

-- 3) 설정(settings): 읽기는 공유(직원 권한 조회용), 쓰기는 관리자만 --------------
alter table public.settings enable row level security;

drop policy if exists "settings_select_shared" on public.settings;
create policy "settings_select_shared"
  on public.settings for select to authenticated using (true);

drop policy if exists "settings_write_admin" on public.settings;
create policy "settings_write_admin"
  on public.settings for all to authenticated
  using (is_admin()) with check (is_admin());
