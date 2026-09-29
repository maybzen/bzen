-- 홈페이지 확인 필요 목록 + 업데이트 체크리스트 (기기 공유용).
-- 기존에는 브라우저 localStorage라 PC마다 따로 보였습니다.
create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  list text not null default 'home',
  text text not null,
  done boolean not null default false,
  position int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.checklist_items enable row level security;

drop policy if exists checklist_items_all on public.checklist_items;
create policy checklist_items_all on public.checklist_items
  for all to authenticated using (true) with check (true);

create index if not exists checklist_items_list_idx
  on public.checklist_items (list, position, created_at);
