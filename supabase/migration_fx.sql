-- =====================================================================
-- bzen-accounting: 장부 외화 정보 컬럼 마이그레이션 (v3)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 기존 데이터에 영향 없음 (컬럼 추가만)
-- =====================================================================

-- 외화 결제 정보 (법인카드 해외 이용분 등)
alter table public.entries
  add column if not exists fx_currency text not null default '';
alter table public.entries
  add column if not exists fx_amount numeric not null default 0;
alter table public.entries
  add column if not exists fx_fee numeric not null default 0;

-- 확인 (3개 컬럼이 뜨면 성공)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'entries'
  and column_name in ('fx_currency', 'fx_amount', 'fx_fee')
order by column_name;
