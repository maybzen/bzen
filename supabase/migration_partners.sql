-- =====================================================================
-- bzen-accounting: 거래처 관리 + 직원 권한 마이그레이션
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 소요 시간: 수 초 / 기존 데이터에 영향 없음 (테이블·컬럼 추가만)
-- =====================================================================

-- 1) 거래처 마스터 -------------------------------------------------------
create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text not null default '',
  job_title text not null default '',
  email text not null default '',
  phone_main text not null default '',
  phone text not null default '',
  memo text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 거래처명 중복 방지 (대소문자 무시)
create unique index if not exists counterparties_name_lower_uidx
  on public.counterparties (lower(name));

-- 2) 거래처 서류 메타 (사업자등록증·통장사본 등) ---------------------------
create table if not exists public.partner_attachments (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.counterparties(id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  mime_type text not null default '',
  size_bytes bigint not null default 0,
  doc_type text not null default 'other', -- 'biz' | 'bank' | 'other'
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists partner_attachments_partner_idx
  on public.partner_attachments (partner_id);

-- 3) RLS: 읽기는 로그인 사용자 전체, 등록·수정·삭제는 앱 화면에서
--    관리자만 가능하도록 막습니다 (기존 projects 테이블과 동일한 방식)
alter table public.counterparties enable row level security;
alter table public.partner_attachments enable row level security;

drop policy if exists "counterparties_select" on public.counterparties;
create policy "counterparties_select"
  on public.counterparties for select to authenticated using (true);
drop policy if exists "counterparties_insert" on public.counterparties;
create policy "counterparties_insert"
  on public.counterparties for insert to authenticated with check (true);
drop policy if exists "counterparties_update" on public.counterparties;
create policy "counterparties_update"
  on public.counterparties for update to authenticated using (true) with check (true);
drop policy if exists "counterparties_delete" on public.counterparties;
create policy "counterparties_delete"
  on public.counterparties for delete to authenticated using (true);

drop policy if exists "partner_attachments_select" on public.partner_attachments;
create policy "partner_attachments_select"
  on public.partner_attachments for select to authenticated using (true);
drop policy if exists "partner_attachments_insert" on public.partner_attachments;
create policy "partner_attachments_insert"
  on public.partner_attachments for insert to authenticated with check (true);
drop policy if exists "partner_attachments_update" on public.partner_attachments;
create policy "partner_attachments_update"
  on public.partner_attachments for update to authenticated using (true) with check (true);
drop policy if exists "partner_attachments_delete" on public.partner_attachments;
create policy "partner_attachments_delete"
  on public.partner_attachments for delete to authenticated using (true);

-- 4) 서류 저장 버킷 (비공개) ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('partner-docs', 'partner-docs', false)
on conflict (id) do nothing;

drop policy if exists "partner_docs_select" on storage.objects;
create policy "partner_docs_select"
  on storage.objects for select to authenticated using (bucket_id = 'partner-docs');
drop policy if exists "partner_docs_insert" on storage.objects;
create policy "partner_docs_insert"
  on storage.objects for insert to authenticated with check (bucket_id = 'partner-docs');
drop policy if exists "partner_docs_update" on storage.objects;
create policy "partner_docs_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'partner-docs') with check (bucket_id = 'partner-docs');
drop policy if exists "partner_docs_delete" on storage.objects;
create policy "partner_docs_delete"
  on storage.objects for delete to authenticated using (bucket_id = 'partner-docs');

-- 5) 직원 권한 설정 컬럼 ---------------------------------------------------
-- 직원이 볼 수 있는 추가 메뉴 키 배열 (예: ["partners","sales"])
-- 기본 메뉴(대시보드·지출결의·프로젝트·설정)는 항상 보입니다.
alter table public.settings
  add column if not exists staff_permissions jsonb not null default '["partners"]'::jsonb;

-- 6) 확인 (각각 1행씩 뜨면 성공) -------------------------------------------
select count(*) as counterparties_ready from public.counterparties;
select id, staff_permissions from public.settings where id = 1;
select id, name, public from storage.buckets where id = 'partner-docs';
