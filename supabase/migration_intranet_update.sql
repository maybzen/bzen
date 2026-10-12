-- =====================================================================
-- bzen-accounting: 직함 칸 + 프로젝트 금액 열람자 + 회사명 정리
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > 붙여넣기 > Run
-- =====================================================================

-- 1) 구성원 직함 (예: 팀장·대리·과장). 설정/계정관리/구성원에서 편집
alter table public.profiles
  add column if not exists position text not null default '';

-- 2) 프로젝트 금액을 볼 수 있는 직원 id 목록 (관리자 외 예외, 예: 권혜민)
alter table public.settings
  add column if not exists finance_viewers jsonb not null default '[]';

-- 3) 직원 프로젝트 범위 ('all' 전체 | 'own' 담당만)
alter table public.settings
  add column if not exists project_scope text not null default 'all';

-- 3) 회사명 표기 통일
update public.settings set company_name = '(주)비젠커뮤니케이션' where id = 1;

-- 4) 분실 신고된 체크카드(9935)는 등록 목록에서 제외
update public.fund_cards set is_active = false, updated_at = now()
where number like '%9935' and is_active is not false;

-- 확인
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'position';
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'settings' and column_name = 'finance_viewers';
select company_name from public.settings where id = 1;
select number, is_active from public.fund_cards order by sort_order;
