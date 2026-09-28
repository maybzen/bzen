-- =====================================================================
-- bzen-accounting: 거래처 영업상태(정상/폐업) 컬럼 추가
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 소요 시간: 수 초 / 기존 데이터에 영향 없음 (컬럼 추가만, 기존분은 정상)
-- =====================================================================

alter table public.counterparties
  add column if not exists status text not null default '정상';

update public.counterparties set status = '정상' where status is null or status = '';

-- 확인 (정상 건수 뜨면 성공)
select status, count(*) from public.counterparties group by status;
