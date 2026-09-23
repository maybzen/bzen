-- =====================================================================
-- bzen-accounting: 거래처 구분 컬럼 마이그레이션 (v5)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- (DB에는 MCP로 직접 적용 완료)
-- =====================================================================

alter table public.counterparties
  add column if not exists group_name text not null default '';

-- 확인
select group_name, count(*) as n
from public.counterparties
group by group_name
order by n desc;
