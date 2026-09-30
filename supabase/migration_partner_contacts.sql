-- =====================================================================
-- bzen-accounting: 거래처 담당자 여러 명 (partner_contacts)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 소요 시간: 수 초 / 기존 데이터에 영향 없음 (테이블 추가만)
-- 배경: 거래처 1곳에 담당자가 여러 명일 때 추가 등록용.
--   기존 contact_person/job_title/email/phone 컬럼은 "대표 담당자"로 유지됩니다.
-- =====================================================================

create table if not exists public.partner_contacts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.counterparties(id) on delete cascade,
  name text not null default '',
  job_title text not null default '',
  email text not null default '',
  phone text not null default '',
  memo text not null default '',
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_contacts_partner_idx
  on public.partner_contacts (partner_id);

alter table public.partner_contacts enable row level security;

drop policy if exists "partner_contacts_select" on public.partner_contacts;
create policy "partner_contacts_select"
  on public.partner_contacts for select to authenticated using (true);

drop policy if exists "partner_contacts_insert" on public.partner_contacts;
create policy "partner_contacts_insert"
  on public.partner_contacts for insert to authenticated with check (true);

drop policy if exists "partner_contacts_update" on public.partner_contacts;
create policy "partner_contacts_update"
  on public.partner_contacts for update to authenticated using (true) with check (true);

drop policy if exists "partner_contacts_delete" on public.partner_contacts;
create policy "partner_contacts_delete"
  on public.partner_contacts for delete to authenticated using (true);
