-- 프로젝트 계약금액 공급가액/부가세 분리 저장.
-- Supabase Dashboard → SQL Editor에서 1회 실행합니다.
alter table public.projects
  add column if not exists contract_supply bigint not null default 0;
alter table public.projects
  add column if not exists contract_vat bigint not null default 0;

-- 기존 합계(contract_amount)를 공급가액/부가세로 역산합니다 (합계/1.1).
-- 이미 분리값이 들어간 행은 건드리지 않습니다.
update public.projects
set contract_supply = round(contract_amount / 1.1),
    contract_vat = contract_amount - round(contract_amount / 1.1)
where contract_amount > 0 and coalesce(contract_supply, 0) = 0 and coalesce(contract_vat, 0) = 0;

-- 확인: 3열이 모두 채워지면 성공
select name, contract_amount as 합계, contract_supply as 공급가액, contract_vat as 부가세
from public.projects where contract_amount > 0 order by contract_amount desc;
