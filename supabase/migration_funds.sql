-- 자금관리 (계좌·대출·카드 마스터 + 잔고 스냅샷).
-- 직접 실행 완료. 기록용으로 보관합니다.
-- 주의: 카드 CVC는 DB에 저장하지 않습니다 (실물카드 확인).
create table if not exists public.fund_accounts (
  id uuid primary key default gen_random_uuid(),
  bank text not null default '', acct_no text not null default '', product text not null default '',
  note text not null default '', sort_order int not null default 0, is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.fund_loans (
  id uuid primary key default gen_random_uuid(),
  bank text not null default '', product text not null default '', period text not null default '',
  limit_amount bigint not null default 0, balance bigint not null default 0,
  pay_day int not null default 1, monthly_pay bigint not null default 0,
  note text not null default '', sort_order int not null default 0,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.fund_cards (
  id uuid primary key default gen_random_uuid(),
  issuer text not null default '', name text not null default '', number text not null default '',
  expiry text not null default '', holder text not null default '', note text not null default '',
  sort_order int not null default 0, is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.fund_snapshots (
  id uuid primary key default gen_random_uuid(),
  snap_date date not null unique, balances jsonb not null default '{}'::jsonb, memo text not null default '',
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

alter table public.fund_accounts enable row level security;
alter table public.fund_loans enable row level security;
alter table public.fund_cards enable row level security;
alter table public.fund_snapshots enable row level security;

drop policy if exists fund_admin_all on public.fund_accounts;
drop policy if exists fund_admin_all on public.fund_loans;
drop policy if exists fund_admin_all on public.fund_cards;
drop policy if exists fund_admin_all on public.fund_snapshots;
create policy fund_admin_all on public.fund_accounts for all to authenticated using (is_admin()) with check (is_admin());
create policy fund_admin_all on public.fund_loans for all to authenticated using (is_admin()) with check (is_admin());
create policy fund_admin_all on public.fund_cards for all to authenticated using (is_admin()) with check (is_admin());
create policy fund_admin_all on public.fund_snapshots for all to authenticated using (is_admin()) with check (is_admin());
