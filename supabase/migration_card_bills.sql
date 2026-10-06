-- =====================================================================
-- bzen-accounting: 카드 청구서 대조 (월별 청구액 기록)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (테이블 추가만)
--
-- 효과:
--   card_bills: 월(YYYY-MM)별 카드 청구액. 법인카드 월별합계 화면에서 입력.
--   차액(청구액 − 등록합계)이 수수료·연회비 수준이면 정상, 크면 누락 의심.
-- =====================================================================

create table if not exists public.card_bills (
  id uuid primary key default gen_random_uuid(),
  bill_month text not null default '',
  billed_amount numeric not null default 0,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bill_month)
);

alter table public.card_bills enable row level security;

drop policy if exists "card_bills_select" on public.card_bills;
create policy "card_bills_select"
  on public.card_bills for select to authenticated using (true);
drop policy if exists "card_bills_insert" on public.card_bills;
create policy "card_bills_insert"
  on public.card_bills for insert to authenticated with check (true);
drop policy if exists "card_bills_update" on public.card_bills;
create policy "card_bills_update"
  on public.card_bills for update to authenticated using (true) with check (true);
drop policy if exists "card_bills_delete" on public.card_bills;
create policy "card_bills_delete"
  on public.card_bills for delete to authenticated using (true);

create index if not exists card_bills_month_idx on public.card_bills (bill_month);

-- 확인 (1행이 뜨면 성공)
select count(*) as card_bills_ready from public.card_bills;
