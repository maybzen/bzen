-- =====================================================================
-- bzen-accounting: 장부 source에 'card' 허용 (v4)
-- 법인카드 일괄등록(source='card')이 entries_source_check 에 걸려서 추가
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- (DB에는 MCP로 직접 적용 완료)
-- =====================================================================

alter table public.entries drop constraint entries_source_check;
alter table public.entries
  add constraint entries_source_check
  check (source = any (array['manual'::text, 'expense_report'::text, 'card'::text]));

-- 확인 (card 가 뜨면 성공)
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.entries'::regclass
  and conname = 'entries_source_check';
