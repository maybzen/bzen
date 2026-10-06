-- =====================================================================
-- bzen-accounting: 일정 기간(시작~종료) + 미리 알림
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (컬럼 2개 추가)
--
-- 효과:
--   due_end_date  : 종료일 (비우면 당일 일정과 동일)
--   remind_before : 며칠 전에 미리 보여줄지 (0 = 알림 없음, 예: 2)
-- 꼭 1회 실행하세요. 실행 전에는 기간·알림 입력칸이 안 보입니다.
-- =====================================================================

alter table public.checklist_items
  add column if not exists due_end_date date;
alter table public.checklist_items
  add column if not exists remind_before int not null default 0;

create index if not exists checklist_items_due_end_idx
  on public.checklist_items (list, due_end_date);

-- 확인 (2행이 뜨면 성공)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'checklist_items'
  and column_name in ('due_end_date', 'remind_before') order by column_name;
