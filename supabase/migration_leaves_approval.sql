-- =====================================================================
-- bzen-accounting: 휴무대장 결재(승인/반려) 컬럼 + 신규입사자 월차 정리
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- (DB에는 MCP로 직접 적용 완료)
-- =====================================================================

alter table public.leave_entries
  add column if not exists status text not null default '요청';
alter table public.leave_entries
  add column if not exists decided_by uuid;
alter table public.leave_entries
  add column if not exists decided_at timestamptz;

-- 기존 이관분은 승인 처리
update public.leave_entries set status = '승인' where status = '요청';

-- 올해 입사자(김혜린·박은영·이정현)는 연차가 아닌 월차
update public.leave_entries set leave_type = '월차'
  where person in ('김혜린', '박은영', '이정현') and leave_type = '연차';
