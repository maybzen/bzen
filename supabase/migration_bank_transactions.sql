-- 통장 거래내역 원본 (계좌별 조회용).
-- 장부(entries)와 별개로 통장 그대로를 보관합니다. 계좌 추가 시 해당 계좌 파일을 올려 넣습니다.
create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank text not null default '',
  acct_no text not null default '',
  transacted_at timestamptz,
  trans_date date,
  trans_type text not null default '',
  counterparty text not null default '',
  deposit numeric not null default 0,
  withdrawal numeric not null default 0,
  balance numeric not null default 0,
  branch text not null default '',
  memo text not null default '',
  created_at timestamptz not null default now()
);

alter table public.bank_transactions enable row level security;

drop policy if exists bank_transactions_all on public.bank_transactions;
create policy bank_transactions_all on public.bank_transactions
  for all to authenticated using (true) with check (true);

create index if not exists bank_transactions_acct_idx
  on public.bank_transactions (acct_no, trans_date desc);
