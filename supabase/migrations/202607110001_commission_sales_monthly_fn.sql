-- Comisión de Ventas · función de agregación mensual de ventas.
-- El dashboard ejecutivo necesita la tendencia de 6 meses y comparativas vs el
-- mes anterior; agregar en SQL evita transferir miles de filas crudas por request
-- (el cuello de botella es el payload db-cls → Vercel).
-- Devuelve sumas por (año, mes, sucursal, medio de pago) del negocio dado.

create or replace function public.sc_sales_monthly(
  p_business uuid,
  p_from date,
  p_to_ex date,
  p_branch text default null,
  p_provider text default null
) returns table (
  y int,
  m int,
  branch text,
  payment text,
  gross numeric,
  n bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    extract(year from s.sale_date)::int as y,
    extract(month from s.sale_date)::int as m,
    coalesce(s.branch, '(sin sucursal)') as branch,
    coalesce(s.payment_method, 'OTROS') as payment,
    sum(s.gross_amount)::numeric as gross,
    count(*)::bigint as n
  from sales_commission_sales s
  where s.business_id = p_business
    and s.sale_date >= p_from
    and s.sale_date < p_to_ex
    and (p_branch is null or s.branch = p_branch)
    and (p_provider is null or s.provider_normalized = p_provider)
  group by 1, 2, 3, 4
$$;

revoke all on function public.sc_sales_monthly(uuid, date, date, text, text) from public;
grant execute on function public.sc_sales_monthly(uuid, date, date, text, text) to service_role;

notify pgrst, 'reload schema';
