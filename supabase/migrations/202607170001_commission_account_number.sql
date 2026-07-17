-- Número de cuenta bancaria por prestador en el roster de comisión.
-- Se muestra/edita en el editor "Personal que aplica incentivo láser" y se
-- exporta en la columna M ("Cuenta") de la hoja "Liquidación final" del Excel.
-- Es por (prestador, sucursal): un prestador en varias sucursales lleva la misma
-- cuenta en cada fila. Aplicada a db-cls el 2026-07-17.
ALTER TABLE public.sales_commission_collaborators
  ADD COLUMN IF NOT EXISTS account_number text;

NOTIFY pgrst, 'reload schema';
