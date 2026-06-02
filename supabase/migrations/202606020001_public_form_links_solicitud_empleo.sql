-- ─────────────────────────────────────────────────────────────────────────
-- Fix: el CHECK de csl_public_form_links.form_type fue creado antes de que
-- "solicitud_empleo" existiera como tipo de formulario público, por lo que
-- generar el link de Solicitud de empleo falla con:
--   new row ... violates check constraint "csl_public_form_links_form_type_check"
--
-- Recreamos el constraint incluyendo los 4 tipos soportados hoy (espejo de
-- FormType en lib/server/public-form-links.ts). Idempotente y no destructivo.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.csl_public_form_links
  drop constraint if exists csl_public_form_links_form_type_check;

alter table public.csl_public_form_links
  add constraint csl_public_form_links_form_type_check
  check (form_type in (
    'ficha_dermatologica',
    'consentimiento_masajes',
    'consentimiento_tatuajes_cejas',
    'solicitud_empleo'
  ));
