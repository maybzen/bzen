-- =====================================================================
-- bzen-accounting: 계정별 추가 메뉴 권한 마이그레이션 (v2)
-- 실행 위치: Supabase Dashboard > SQL Editor > New query > Run
-- 기존 데이터에 영향 없음 (컬럼 추가만)
-- 전제: supabase/migration_partners.sql 이 이미 적용되어 있어야 합니다.
-- =====================================================================

-- 직원별 추가 메뉴: { "<user_uuid>": ["expenses", ...] }
-- 전체 직원 기본 권한(settings.staff_permissions)에 더해 적용됩니다.
alter table public.settings
  add column if not exists staff_overrides jsonb not null default '{}'::jsonb;

-- 확인 (staff_overrides 키가 뜨면 성공)
select id, staff_permissions, staff_overrides from public.settings where id = 1;
