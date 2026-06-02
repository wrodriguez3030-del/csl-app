# Fase 2 (parte 1) — Horarios y Ponche · Diseño

**Fecha:** 2026-06-02
**Módulo:** Recursos Humanos (RR.HH.) — csl-app
**Alcance:** Horarios y turnos + Ponche / reloj checador.
**Fuera de alcance (specs siguientes):** Asistencia (consolidación/cálculo), Permisos y licencias.

## Contexto

El módulo RR.HH. está planeado en 6 fases (ver `components/hr/rrhh-skeletons.tsx`).
La **Fase 1 · Personal** está cerrada y desplegada: Empleados, Contratos
(`hr_contracts`), Documentos (`hr_documents`), Dashboard y Solicitudes, todo
multi-tenant con `business_id` + RLS.

La **Fase 2 · Asistencia** son 4 subsistemas con dependencias:
Horarios → Ponche → Asistencia → Permisos. Este spec cubre el cimiento
(**Horarios + Ponche**); Asistencia consume ambos y va en un spec posterior.

## Decisiones de diseño

- **Identificación de ponche:** kiosco compartido por sucursal + **PIN numérico**
  por empleado. Sin hardware extra.
- **Foto / GPS:** fuera de alcance. Se dejan columnas nullable en `hr_punches`
  para una fase futura, pero no se capturan.
- **Multi-tenant:** tablas `hr_*` con `business_id NOT NULL` REFERENCES
  `csl_businesses(id)` + RLS por tenant (select/insert/update/delete sobre
  `business_id = (SELECT business_id FROM csl_user_profiles WHERE user_id = auth.uid())`)
  + policy `service_all` (`auth.role() = 'service_role'`). Idéntico a Fase 1.
- **PIN:** se guarda **hasheado** (`hr_pin_hash`), nunca en texto plano.

## Modelo de datos

Migración nueva: `supabase/migrations/2026XXXX_hr_phase2_schedules_punches.sql`.

### `hr_schedules` — definición de horarios
| col | tipo | notas |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid NOT NULL | FK csl_businesses ON DELETE CASCADE |
| name | text NOT NULL | ej. "Turno mañana" |
| type | text NOT NULL | `fijo` \| `rotativo` |
| entry_time | time | entrada |
| exit_time | time | salida |
| lunch_start | time | inicio almuerzo (nullable) |
| lunch_end | time | fin almuerzo (nullable) |
| workdays | text[] | ej. `{lun,mar,mie,jue,vie}` |
| late_tolerance_min | int NOT NULL DEFAULT 0 | tolerancia tardanza |
| status | text NOT NULL DEFAULT 'activo' | `activo` \| `inactivo` |
| created_at / updated_at | timestamptz | |

Índices: `(business_id)`, `(business_id, status)`.

### `hr_schedule_assignments` — horario asignado a empleado
| col | tipo | notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid NOT NULL | FK csl_businesses |
| employee_id | text NOT NULL | ref csl_empleados.empleado_id |
| schedule_id | uuid NOT NULL | FK hr_schedules ON DELETE CASCADE |
| sucursal | text | opcional |
| start_date | date NOT NULL | |
| end_date | date | null = vigente |
| created_at / updated_at | timestamptz | |

Índices: `(business_id)`, `(business_id, employee_id)`. Índice único parcial
para evitar dos asignaciones vigentes (`end_date IS NULL`) del mismo empleado.

### `hr_punches` — marcas de ponche
| col | tipo | notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid NOT NULL | FK csl_businesses |
| employee_id | text NOT NULL | |
| type | text NOT NULL | `entrada`\|`salida`\|`almuerzo_inicio`\|`almuerzo_fin`\|`salida_autorizada` |
| punched_at | timestamptz NOT NULL DEFAULT now() | |
| sucursal | text | |
| source | text NOT NULL DEFAULT 'kiosk' | `kiosk` \| `manual` |
| device_info | text | UA/dispositivo |
| ip | text | |
| is_correction | bool NOT NULL DEFAULT false | |
| correction_reason | text | obligatorio si is_correction |
| approved_by | uuid | quien aprueba la corrección |
| photo_url | text | nullable, futuro |
| gps | text | nullable, futuro |
| created_at / updated_at | timestamptz | |

Índices: `(business_id)`, `(business_id, employee_id, punched_at)`,
`(business_id, sucursal, punched_at)`.

### `csl_empleados` — columna nueva
- `hr_pin_hash text` (nullable). PIN hasheado para identificación en kiosco.

## Backend (`app/api/csl/_handlers.ts`)

Mismo patrón Fase 1: cada handler resuelve `business_id` del perfil, filtra por
él, y devuelve `{ ok:true, records:[], tableMissing:true }` ante error `42P01`.

**Horarios**
- `getHrSchedules` · `saveHrSchedule` (upsert onConflict id) · `deleteHrSchedule`
- `getHrScheduleAssignments` (filtro opcional employee_id) · `saveHrScheduleAssignment` · `deleteHrScheduleAssignment`

**Ponche (admin)**
- `getHrPunches` (filtros: rango de fecha, employee_id, sucursal)
- `saveHrPunch` (alta/corrección manual; `is_correction=true` exige `correction_reason`)
- `deleteHrPunch`

**Kiosco**
- `setHrEmployeePin` (admin asigna/resetea PIN → guarda `hr_pin_hash`)
- `punchByPin` (valida PIN dentro del `business_id`; identifica empleado;
  infiere el próximo `type` lógico según la última marca del día; registra
  `source=kiosk`, `device_info`, `ip`; devuelve nombre del empleado + tipo
  registrado para la confirmación en pantalla)

## Frontend

- Reemplazar los exports placeholder `RrhhHorariosPage` y `RrhhPonchePage` del
  barrel `components/hr/rrhh-skeletons.tsx` por componentes reales:
  `components/hr/rrhh-horarios-page.tsx` y `components/hr/rrhh-ponche-page.tsx`.
  El dispatcher en `app/page.tsx` **no se toca** (los `case` ya existen).
- **Horarios:** CRUD de horarios (tabla + modal, estilo Fase 1) + panel de
  asignación de horario a empleados.
- **Ponche:**
  - Vista admin: listado de marcas con filtros, alta/corrección manual con motivo.
  - **Modo kiosco:** pantalla completa, teclado numérico grande para PIN,
    botones Entrada / Salida / Almuerzo (inicio/fin) / Salida autorizada,
    confirmación con el nombre del empleado y el tipo registrado.
  - Gestión del PIN del empleado desde Empleados o desde la vista de Ponche.

## No incluido (YAGNI / fases siguientes)

- Cálculo de tarde / ausente / horas extra / consolidación → **Asistencia** (spec siguiente).
- Permisos y licencias.
- Captura de foto / GPS.
- Nómina y pagos.

## Criterios de aceptación

1. Migración idempotente aplicada: 3 tablas `hr_*` + columna `hr_pin_hash` + RLS
   por tenant + `service_all`, sin romper datos existentes.
2. Admin puede crear horarios y asignarlos a empleados; los datos quedan
   aislados por `business_id` (CSL no ve Depicenter y viceversa).
3. Admin puede asignar/resetear el PIN de un empleado.
4. En modo kiosco, un empleado con PIN válido registra una marca; el tipo se
   infiere correctamente según su última marca del día; queda con `source=kiosk`.
5. Admin puede listar, filtrar y corregir marcas (corrección exige motivo).
6. Las pantallas Horarios y Ponche dejan de mostrar el placeholder y muestran
   la funcionalidad real; el resto del menú RR.HH. sigue intacto.
