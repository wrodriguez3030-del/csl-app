-- ─────────────────────────────────────────────────────────────────────────────
-- 202606280002 — Permitir links públicos de Consentimiento Depilación Láser
-- ─────────────────────────────────────────────────────────────────────────────
-- El CHECK `csl_public_form_links_form_type_check` no incluía el nuevo
-- form_type 'consentimiento_depilacion_laser', por lo que generar un link de
-- depilación láser fallaría con: new row violates check constraint.
--
-- Migración ADITIVA y segura: NO borra datos. Solo DROP CONSTRAINT del check
-- viejo para recrearlo con TODOS los valores actuales + el nuevo.
-- (Valores actuales: ficha_dermatologica, consentimiento_masajes,
--  consentimiento_peeling, consentimiento_tatuajes_cejas, solicitud_empleo —
--  todos se conservan.)
--
-- Pre-condición: tabla csl_public_form_links existente. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.csl_public_form_links
  drop constraint if exists csl_public_form_links_form_type_check;

alter table public.csl_public_form_links
  add constraint csl_public_form_links_form_type_check
  check (
    form_type in (
      'ficha_dermatologica',
      'consentimiento_masajes',
      'consentimiento_peeling',
      'consentimiento_tatuajes_cejas',
      'consentimiento_depilacion_laser',
      'solicitud_empleo'
    )
  );

notify pgrst, 'reload schema';
