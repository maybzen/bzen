-- 거래처 표기 연동 (별칭 묶음). 같은 곳인데 표기가 달라 둘 다 남겨야 할 때 연결합니다.
-- 예: 코레일 ↔ 한국철도공사. 연결된 표기는 같은 거래처로 집계·검색·점검됩니다.
create table if not exists public.party_aliases (
  id uuid primary key default gen_random_uuid(),
  name_a text not null,
  name_b text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint party_aliases_different check (name_a <> name_b),
  constraint party_aliases_unique unique (name_a, name_b)
);

alter table public.party_aliases enable row level security;

drop policy if exists party_aliases_all on public.party_aliases;
create policy party_aliases_all on public.party_aliases
  for all to authenticated using (true) with check (true);
