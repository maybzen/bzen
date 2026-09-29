-- 일정 날짜 (대시보드 "이번 달 챙길 일" 수동 항목용).
-- Supabase SQL Editor에서 1회 실행. 실행 전에도 앱은 날짜 없이 동작합니다.
alter table public.checklist_items
  add column if not exists due_date date;

create index if not exists checklist_items_due_idx
  on public.checklist_items (list, due_date);
