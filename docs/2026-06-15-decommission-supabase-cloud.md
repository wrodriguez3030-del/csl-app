# Desmantelamiento del Supabase Cloud de csl-app

**Fecha:** 2026-06-15
**Versión:** 0.2.15
**Tipo:** cambio operativo / infraestructura (sin cambio de código de la app)

## Contexto

Tras la migración de csl-app a Supabase **self-hosted** (`db-cls.cibao-cloude.com`,
2026-06-02), el proyecto Cloud `pfqnyzbtwhfkemkixril` se había conservado como
**respaldo de rollback**. Seguía generando correos de inactividad de Supabase y
ocupando espacio. Se decidió eliminarlo definitivamente.

## Verificación previa (exhaustiva, triple-chequeada)

Antes de borrar nada se comprobó que el self-hosted contiene el **100%** del Cloud:

| Eje | Método | Resultado |
|-----|--------|-----------|
| **Estructura** | Comparación de OpenAPI de PostgREST (tablas, columnas, tipos, PK, RPC) | 35/35 tablas del Cloud presentes en self (self tiene 29 extra: HR/nómina). Sin diferencias reales de columnas/tipos (los `integer`↔`int32`, `bigint`↔`int64` son cosméticos). |
| **Datos** | 3 pasadas independientes de paridad por PK | 0 faltantes |
| **Datos (contenido)** | Comparación de `updated_at` Cloud vs self por PK | 0 filas con Cloud más nuevo que self |
| **Auth** | `/auth/v1/admin/users` ambos lados | 13/13 usuarios del Cloud presentes en self (self tiene 20) |
| **Storage** | Listado recursivo del bucket `brand-assets` | 1 objeto (`logos/cibao-spa-laser-logo.jpeg`, 40 680 B) presente idéntico en ambos |

### Reconciliación de 5 registros huérfanos

La verificación **por contenido** (no solo por conteo) reveló 5 registros que
existían solo en el Cloud y se migraron al self-hosted vía REST:

- `csl_ficha_dermatologica`: `dermo_1779661922939` (CARLOS ARIAS) y
  `dermo_1779633858916` (WILLIAN RODRIGUEZ), ambos del 24-may-2026.
- `csl_pulse_readings`: 3 lecturas de Rafael Vidal, cabinas 4/5, operadora
  MADELIN, del 31-may-2026. (Al insertar hubo que omitir las columnas generadas
  `disp_laser` y `diferencia`, que el DB recalcula solo.)

## Acción realizada

1. Migrados los 5 registros faltantes al self-hosted; re-verificado: 0 faltantes.
2. Proyecto Cloud `pfqnyzbtwhfkemkixril` **eliminado** desde el dashboard de
   Supabase (acción del usuario).
3. Confirmado: su endpoint REST ya no responde (`HTTP 000`); el self-hosted sigue
   `HTTP 200`.
4. Eliminado el archivo de credenciales obsoleto `.env.local.cloud-rollback`.
5. Verificado end-to-end en producción (`csl-app-eta.vercel.app`): home `200`,
   endpoint con DB (`/api/public/validar-depicenter`) `200` → `{"ok":true,"found":false}`,
   y el bundle apunta solo a `db-cls.cibao-cloude.com`.

## Estado final

- **Única fuente de verdad:** Supabase self-hosted `db-cls.cibao-cloude.com`
  (con backups cifrados al NAS).
- No queda copia en la nube de los datos de csl-app.
- No hay rollback al Cloud disponible (ni necesario).

## Notas técnicas útiles

- El REST del self-hosted bloquea el User-Agent `Python-urllib` (WAF) →
  usar un UA de navegador en scripts.
- `curl` dentro de loops de bash consume el `stdin` del loop → usar `</dev/null`.
