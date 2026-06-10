-- ─────────────────────────────────────────────────────────────────────────────
-- 202606090002 — Permitir links públicos de Consentimiento Peeling
-- ─────────────────────────────────────────────────────────────────────────────
-- El CHECK `csl_public_form_links_form_type_check` no incluía el nuevo
-- form_type 'consentimiento_peeling', por lo que generar un link de peeling
-- fallaba con: new row violates check constraint.
--
-- Migración ADITIVA y segura: NO borra datos. Solo DROP CONSTRAINT del check
-- viejo para recrearlo con TODOS los valores actuales + 'consentimiento_peeling'.
-- (Los valores actuales en uso: ficha_dermatologica, consentimiento_masajes,
--  consentimiento_tatuajes_cejas, solicitud_empleo — todos se conservan.)
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
      'solicitud_empleo'
    )
  );

notify pgrst, 'reload schema';
