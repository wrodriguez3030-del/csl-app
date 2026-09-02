-- ════════════════════════════════════════════════════════════════════════════
-- Ventas por CATEGORÍA (servicio) en un rango — espejo de sc_sales_monthly.
--
-- El tablero financiero muestra «Ventas por servicio» (láser, producto,
-- faciales, masaje…). Un año de CSL ≈ 10.400 filas: paginarlas desde el
-- servidor son 11 viajes; agregarlas aquí devuelve ≤ 30 filas en uno.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.sc_sales_by_category(
  p_business uuid,
  p_from date,
  p_to_ex date,
  p_branch text default null
) returns table (
  category text,
  branch text,
  gross numeric,
  n bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(s.category, 'OTROS') as category,
    coalesce(s.branch, '(sin sucursal)') as branch,
    coalesce(sum(s.gross_amount), 0)::numeric as gross,
    count(*)::bigint as n
  from public.sales_commission_sales s
  where s.business_id = p_business
    and s.sale_date >= p_from
    and s.sale_date <  p_to_ex
    and (p_branch is null or s.branch = p_branch)
  group by 1, 2
$$;

revoke all on function public.sc_sales_by_category(uuid, date, date, text) from public;
grant execute on function public.sc_sales_by_category(uuid, date, date, text) to service_role;

notify pgrst, 'reload schema';
