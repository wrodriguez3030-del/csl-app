-- CF PARA IMPRIMIR · Teléfono de sucursal para el pie del certificado.
--
-- El pie del certificado muestra: fecha de entrega + teléfono de la sucursal +
-- redes sociales. El catálogo de sucursales no tenía teléfono → se agrega de
-- forma aditiva. El certificado guarda un snapshot (sucursal_telefono) al emitir.
--
-- NO destructiva. Aplicada a db-cls el 2026-07-15.

alter table public.csl_sucursales
  add column if not exists telefono text;

notify pgrst, 'reload schema';
