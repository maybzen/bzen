-- =====================================================================
-- bzen-accounting: 수금에 입금처(거래처) 컬럼 추가
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- (DB에는 MCP로 직접 적용 완료. 수금 38건은 입금일 시트 기준으로 재구축)
-- =====================================================================

alter table public.collections
  add column if not exists counterparty text not null default '';
