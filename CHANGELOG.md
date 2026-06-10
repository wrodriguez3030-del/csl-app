# Changelog — csl-app (Mantenimiento CSL / DEPICENTER)

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico (SemVer)](https://semver.org/lang/es/).

> **Regla de oro:** ningún cambio se sube a `main` sin una entrada aquí y un
> bump de versión. Ver [`CONTRIBUTING.md`](./CONTRIBUTING.md) para el paso a paso.

## [Unreleased]

### Added
### Changed
### Fixed
### Removed
### Security

---

## [0.2.1] - 2026-06-09

### Added
- Botón **"Sincronizar directamente con la API"** en la barra superior de
  Clientes (junto a Descargar datos / Unificar / Nuevo cliente). Ejecuta el sync
  manual contra AgendaPro (`POST /api/integrations/agendapro/sync-clients`):
  deshabilita y muestra "Sincronizando…", trae nuevos, actualiza existentes,
  dedup (agendapro_client_id / cédula / teléfono / email), refresca la tabla y
  muestra resumen (nuevos / actualizados / duplicados / omitidos / errores). Si
  el negocio no tiene credenciales, avisa "No hay credenciales AgendaPro
  configuradas para este negocio."
- Permiso de acción **"Sincronizar API"** (`sincronizar-api`): admin/superadmin
  lo ven por defecto; un usuario normal solo si se le asigna. Multi-tenant —
  el token AgendaPro nunca se expone al frontend (la llamada es server-side).

---

## [0.2.0] - 2026-06-09

### Added
- Nuevo módulo **Consentimiento Peeling** (`kind: "peeling"`) en "Clientes y
  Consentimientos", ubicado entre Consentimiento Masajes y Eliminación de
  Tatuajes y Cejas. Clona el flujo completo de los consentimientos existentes:
  - Pantalla interna: selección/creación de cliente, datos, plantilla oficial de
    peeling (contraindicaciones, cuidados antes/después, riesgos, políticas,
    protección de datos), firmas digitales, PDF imprimible e historial.
  - Formulario público (link único + WhatsApp) para firma remota del cliente:
    `components/public-peeling-consent-form.tsx` + `formType:
    "consentimiento_peeling"`.
  - Notificación por email (Resend) `sendConsentPeelingEmail`.
  - Integración en "Historial Fichas y Consentimientos" con filtros por tipo,
    cliente, fecha y sucursal.
- Tabla `csl_consent_peeling` en `db-cls` (self-hosted): RLS multi-tenant por
  `business_id` (Cibao no ve Depicenter y viceversa), grants a `service_role`,
  índices y FKs a cliente/ficha. Migración
  `supabase/migrations/202606090001_csl_consent_peeling.sql`.
- Permiso de menú `consent-peeling` (admin/superadmin lo ven por defecto).

### Notas
- Sin cambios destructivos: solo CREATE TABLE/POLICY/INDEX. Sin DELETE/DROP.

---

## [0.1.0] - 2026-06-09

### Added
- Sistema de versionado y documentación para colaboradores:
  `CHANGELOG.md` + `CONTRIBUTING.md`.
- Mirror del repositorio a Gitea Cibao Cloud: `http://infra:3000/ARB/csl-app`
  (remoto `gitea`, además del `origin` en GitHub).

### Notas
- Línea base del versionado. App multi-tenant (CSL + Depicenter) sobre Supabase
  self-hosted (`db-cls.cibao-cloude.com`). Deploy: auto-promote a producción con
  `vercel --prod --yes` tras cada push aprobado.
