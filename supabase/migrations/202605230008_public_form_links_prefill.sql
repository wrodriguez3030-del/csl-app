-- ─────────────────────────────────────────────────────────────────────────────
-- 008 — prefill_payload en csl_public_form_links
-- ─────────────────────────────────────────────────────────────────────────────
-- Permite que el operador interno guarde datos del cliente al generar el
-- link (cedula, correo, dirección, sucursal, motivo consulta, servicio, etc.)
-- y que el form público los muestre PRE-CARGADOS cuando el cliente abre el
-- enlace. El cliente solo revisa/corrige + firma.
--
-- Schema-less por diseño (jsonb) — los campos relevantes dependen del
-- form_type. Validación de shape la hace el código.
--
-- Pre-condición: 007 ejecutado (tabla existe).
-- Rollback: alter table public.csl_public_form_links drop column prefill_payload;
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.csl_public_form_links
  add column if not exists prefill_payload jsonb;

comment on column public.csl_public_form_links.prefill_payload is
  'JSON opcional con campos pre-cargables del form para el cliente: nombre, telefono, documento, correo, direccion, sucursal, motivoConsulta, servicio. Hidratado en el form público al abrir el link.';
