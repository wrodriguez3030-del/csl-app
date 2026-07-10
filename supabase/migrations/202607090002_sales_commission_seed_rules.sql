-- ============================================================================
-- Semilla de reglas por defecto de COMISIÓN DE VENTAS para el business 'csl'.
-- Idempotente: sólo inserta si el business aún no tiene reglas. Valores
-- iniciales de la especificación (secciones 9-13); todos EDITABLES desde la UI.
-- Aditivo, sin DELETE/DROP. Aplicado a db-cls el 2026-07-09.
-- ============================================================================
do $$
declare csl uuid := (select id from public.businesses where slug = 'csl');
begin
  if csl is null then raise exception 'no existe business csl'; end if;
  if exists (select 1 from public.sales_commission_rules where business_id = csl) then
    raise notice 'reglas de comisión ya sembradas para csl';
    return;
  end if;
  insert into public.sales_commission_rules
    (business_id, name, rule_type, category, percentage, fixed_amount, min_amount, priority, effective_from, created_by)
  values
    (csl, 'Porcentaje sobre ventas con tarjeta', 'card_percentage',        null,                  0.27, null,  null,    100, '2000-01-01', 'seed'),
    (csl, 'Incentivo por unidad de producto',    'product_unit_incentive', null,                  null, 100,   null,    100, '2000-01-01', 'seed'),
    (csl, 'Comisión Faciales',                   'category_commission',    'FACIALES',            0.20, null,  null,    100, '2000-01-01', 'seed'),
    (csl, 'Comisión Hollywood / Aqua Peel',      'category_commission',    'HOLLYWOOD_AQUA_PEEL', 0.10, null,  null,    100, '2000-01-01', 'seed'),
    (csl, 'Comisión Tatuajes',                   'category_commission',    'TATUAJES',            0.10, null,  null,    100, '2000-01-01', 'seed'),
    (csl, 'Comisión HIFU',                       'category_commission',    'HIFU',                0.10, null,  null,    100, '2000-01-01', 'seed'),
    (csl, 'Comisión Masajes',                    'category_commission',    'MASAJES',             0.20, null,  null,    100, '2000-01-01', 'seed'),
    (csl, 'Láser tramo 2%',                      'laser_scale',            null,                  0.02, null,  260000,    1, '2000-01-01', 'seed'),
    (csl, 'Láser tramo 3%',                      'laser_scale',            null,                  0.03, null,  600000,    2, '2000-01-01', 'seed'),
    (csl, 'Láser tramo 4%',                      'laser_scale',            null,                  0.04, null,  800000,    3, '2000-01-01', 'seed'),
    (csl, 'Láser tramo 5%',                      'laser_scale',            null,                  0.05, null, 2000000,    4, '2000-01-01', 'seed'),
    (csl, 'Aporte de limpieza',                  'cleaning_contribution',  null,                  null, 400,   null,    100, '2000-01-01', 'seed');
  raise notice 'sembradas 12 reglas de comisión para csl';
end $$;
