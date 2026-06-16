-- ============================================================================
-- Normalización de especialistas/operadoras (cosmiatría / fichas / consents)
-- y alta de BENITA. Corrección NO destructiva: solo INSERT aditivo + UPDATE de
-- variantes de mayúsculas/minúsculas hacia el nombre canónico. Sin DELETE/DROP.
--
-- Causa raíz: los selectores fusionan la fuente limpia (csl_operadoras, ya en
-- MAYÚSCULAS) con valores históricos de los registros guardados con
-- mayúsc/minúsc mezcladas ("Eidylee" vs "EIDYLEE", "Johely" vs "JOHELY").
-- El normalizador de frontend (lib/especialistas.ts) ya deduplica en pantalla;
-- esta migración además canoniza los datos almacenados.
--
-- ⚠️ Lado LÁSER intacto: csl_equipos / normalize-pulse usan ROQUELMI. Aquí el
-- nombre oficial de la misma persona en cosmiatría es RIQUELMI. No se tocan
-- las tablas de Pulsos.
-- ============================================================================

-- CSL business_id = 66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6

-- 1) Alta de BENITA en csl_operadoras (CSL / Los Jardines) si no existe ───────
insert into csl_operadoras (operadora_id, nombre, sucursal, estado, business_id, created_at, updated_at)
select 'BENITA', 'BENITA', 'Los Jardines', 'Activa', '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6', now(), now()
where not exists (
  select 1 from csl_operadoras
  where business_id = '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6'
    and upper(trim(nombre)) = 'BENITA'
);

-- 2) Normalizar fichas dermatológicas (ambas tablas históricas) ──────────────
update csl_ficha_dermatologica set operadora = 'EIDYLEE'
  where upper(trim(operadora)) = 'EIDYLEE' and operadora <> 'EIDYLEE';
update csl_ficha_dermatologica set operadora = 'JOHELY'
  where upper(trim(operadora)) = 'JOHELY' and operadora <> 'JOHELY';

update csl_fichas_dermatologia set operadora = 'EIDYLEE'
  where upper(trim(operadora)) = 'EIDYLEE' and operadora <> 'EIDYLEE';
update csl_fichas_dermatologia set operadora = 'JOHELY'
  where upper(trim(operadora)) = 'JOHELY' and operadora <> 'JOHELY';

-- 3) Normalizar consentimientos de masajes ───────────────────────────────────
update csl_consent_masajes set especialista = 'BENITA'
  where upper(trim(especialista)) = 'BENITA' and especialista <> 'BENITA';
update csl_consent_masajes set especialista = 'DAYHANA'
  where upper(trim(especialista)) = 'DAYHANA' and especialista <> 'DAYHANA';
update csl_consent_masajes set especialista_nombre = 'BENITA'
  where upper(trim(especialista_nombre)) = 'BENITA' and especialista_nombre <> 'BENITA';
update csl_consent_masajes set especialista_nombre = 'DAYHANA'
  where upper(trim(especialista_nombre)) = 'DAYHANA' and especialista_nombre <> 'DAYHANA';

-- 4) Normalizar consentimientos de tatuajes/cejas ────────────────────────────
update csl_consent_tatuajes_cejas set especialista = 'BENITA'
  where upper(trim(especialista)) = 'BENITA' and especialista <> 'BENITA';
update csl_consent_tatuajes_cejas set especialista = 'JOHELY'
  where upper(trim(especialista)) = 'JOHELY' and especialista <> 'JOHELY';
update csl_consent_tatuajes_cejas set especialista_nombre = 'BENITA'
  where upper(trim(especialista_nombre)) = 'BENITA' and especialista_nombre <> 'BENITA';
update csl_consent_tatuajes_cejas set especialista_nombre = 'JOHELY'
  where upper(trim(especialista_nombre)) = 'JOHELY' and especialista_nombre <> 'JOHELY';

-- 5) Auditoría en csl_maintenance_audit ──────────────────────────────────────
insert into csl_maintenance_audit (business_id, entity, table_name, record_key, op, change_source, user_email, details)
values
  ('66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6', 'especialista', 'csl_operadoras', 'BENITA', 'specialist_added', 'migration:202606160001',
   'automation', '{"nombre":"BENITA","sucursal":"Los Jardines","estado":"Activa"}'::jsonb),
  ('66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6', 'especialista', 'csl_ficha_dermatologica', 'operadora', 'specialist_normalized', 'migration:202606160001',
   'automation', '[{"old":"Eidylee","new":"EIDYLEE"},{"old":"Johely","new":"JOHELY"}]'::jsonb),
  ('66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6', 'especialista', 'csl_fichas_dermatologia', 'operadora', 'specialist_normalized', 'migration:202606160001',
   'automation', '[{"old":"Eidylee","new":"EIDYLEE"},{"old":"Johely","new":"JOHELY"}]'::jsonb),
  ('66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6', 'especialista', 'csl_consent_masajes', 'especialista/especialista_nombre', 'specialist_normalized', 'migration:202606160001',
   'automation', '[{"old":"Benita","new":"BENITA"},{"old":"Dayhana","new":"DAYHANA"}]'::jsonb),
  ('66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6', 'especialista', 'csl_consent_tatuajes_cejas', 'especialista/especialista_nombre', 'specialist_normalized', 'migration:202606160001',
   'automation', '[{"old":"Benita","new":"BENITA"},{"old":"Johely","new":"JOHELY"}]'::jsonb);

notify pgrst, 'reload schema';
