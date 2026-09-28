-- =====================================================================
-- bzen-accounting: 휴무대장 사용기간(종료일) + 인사정보(생년월일·입사일)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- (DB에는 MCP로 직접 적용 완료. 일자별 144건은 시트 7개 탭에서 이관)
-- =====================================================================

alter table public.leave_entries
  add column if not exists end_date date;
alter table public.profiles
  add column if not exists birth_date date;
alter table public.profiles
  add column if not exists hire_date date;
