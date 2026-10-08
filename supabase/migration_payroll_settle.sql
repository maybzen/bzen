-- =====================================================================
-- bzen-accounting: 급여명세서 정산액 5종 (연말정산·4대보험 정산)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- 소요 시간: 수 초 / 기존 데이터 변경 없음 (컬럼만 추가)
-- =====================================================================

alter table public.payroll_slips
  add column if not exists ded_income_settle bigint not null default 0;
alter table public.payroll_slips
  add column if not exists ded_health_settle bigint not null default 0;
alter table public.payroll_slips
  add column if not exists ded_care_settle bigint not null default 0;
alter table public.payroll_slips
  add column if not exists ded_pension_settle bigint not null default 0;
alter table public.payroll_slips
  add column if not exists ded_employment_settle bigint not null default 0;

-- 임의 추가정산액 행 [{label, amount}] (종류가 계속 생겨서 고정 컬럼으로 못 박지 않음)
alter table public.payroll_slips
  add column if not exists extra_ded jsonb not null default '[]';

-- 확인 (6행 뜨면 성공)
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'payroll_slips'
  and (column_name like '%_settle' or column_name = 'extra_ded') order by column_name;
