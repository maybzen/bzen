-- =====================================================================
-- bzen-accounting: 장부 등록이 막히던 문제 수정 (직원 인트라넷 필수)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (정책만 추가)
--
-- 왜 필요한가:
--   migration_rls_hardening.sql 은 entries 에 select/update/delete 정책만
--   만들고 insert 정책을 만들지 않았습니다 ("insert는 열어둡니다" 주석만 있음).
--   RLS가 켜진 테이블은 정책이 없으면 기본 차단이라, 이 파일을 실행하기
--   전에는 직원·관리자 모두 장부 신규 등록(지출결의·운영비·매출·매입)이
--   "new row violates row-level security policy" 로 실패합니다.
--   이 파일은 insert를 로그인 전원에게 허용합니다 (수정·조회와 동일 수준).
-- 꼭 1회 실행하세요.
-- =====================================================================

alter table public.entries enable row level security;

drop policy if exists "entries_insert_all" on public.entries;
create policy "entries_insert_all"
  on public.entries for insert to authenticated with check (true);

-- 증빙 테이블(attachments) + 영수증 버킷(receipts)도 같은 이유로 열어둡니다.
-- (레포에 정책이 없어서 등록·조회가 막힐 수 있습니다. 이미 있으면 건너뜁니다)
alter table public.attachments enable row level security;

drop policy if exists "attachments_select_all" on public.attachments;
create policy "attachments_select_all"
  on public.attachments for select to authenticated using (true);

drop policy if exists "attachments_insert_all" on public.attachments;
create policy "attachments_insert_all"
  on public.attachments for insert to authenticated with check (true);

drop policy if exists "attachments_update_all" on public.attachments;
create policy "attachments_update_all"
  on public.attachments for update to authenticated using (true) with check (true);

drop policy if exists "attachments_delete_admin" on public.attachments;
create policy "attachments_delete_admin"
  on public.attachments for delete to authenticated using (public.is_admin());

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "receipts_select" on storage.objects;
create policy "receipts_select"
  on storage.objects for select to authenticated using (bucket_id = 'receipts');

drop policy if exists "receipts_insert" on storage.objects;
create policy "receipts_insert"
  on storage.objects for insert to authenticated with check (bucket_id = 'receipts');

drop policy if exists "receipts_update" on storage.objects;
create policy "receipts_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'receipts') with check (bucket_id = 'receipts');

drop policy if exists "receipts_delete" on storage.objects;
create policy "receipts_delete"
  on storage.objects for delete to authenticated using (bucket_id = 'receipts');

-- 확인 (entries 1행 + attachments 4행이 뜨면 성공)
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('entries', 'attachments') and cmd = 'INSERT'
order by tablename;
select id, name, public from storage.buckets where id = 'receipts';
