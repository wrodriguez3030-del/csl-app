# Captura manual de pacientes atendidos · v0.36.0

Fecha: 2026-07-11 · Supabase: **solo local db-cls** (no Cloud)

Cierra el pendiente del módulo: además de derivar los pacientes de **Reservas**
(atenciones ASISTE), ahora se pueden **capturar/ajustar a mano** por colaborador.
Alimenta el reparto del incentivo láser (v0.35.0) y el Cálculo mensual (v0.34.0).

## Modelo

`sales_commission_patient_counts` (columnas `service`/`observation` ya creadas en
mig `202607110002`). La captura escribe filas con `source="manual"`.

**Merge por colaborador** (`readPatientsForRun`): para cada colaborador, si tiene
fila `manual` esa gana; si no, se usa su fila de `reservas`. Antes era
todo-o-nada por sucursal (una manual ocultaba TODAS las de reservas). Fuente del
período: `manual` (todas manual), `mixto` (algunas), `reservas` (ninguna manual).

## Server (`lib/server/commission.ts`)

| Función | Rol |
|---|---|
| `getCommissionPatientCapture` | roster (activo) + reservas base + manual → valor efectivo, fuente, servicio/observación por colaborador; total |
| `saveCommissionPatientCount` | upsert de la fila manual (patient_count, service, observation); auditado |
| `deleteCommissionPatientCount` | elimina la fila manual → revierte a reservas; auditado |

Permiso `sales_commission.calculate`. Multi-tenant por `business_id`.

## UI

`ComisionClientesPage` (submenú **Clientes atendidos**) rediseñada: selectores
mes/año/sucursal + tabla editable (Prestador, Reservas base, **Pacientes**
editable, Fuente, % participación, Observación, Guardar / **Revertir a
reservas**). Guardar invalida las cachés de láser y del cálculo mensual, así que
el nuevo valor se refleja de inmediato en el reparto.

## QA

- `scripts/_smoke-patient-capture.js` (db-cls, con limpieza garantizada):
  **7/7** — manual gana por colaborador, reservas de los demás intactas, sin
  residuo de prueba.
- `test:commission` **117/117** · `_smoke-calculo-mensual.mjs` 17/17
  (regresión: cuadre láser sigue 0.00) · `tsc` 0 · `build` OK.

## Pendiente (siguiente)

Reporte/export del run del Cálculo mensual + lista de runs por período; captura
de `service` por atención (hoy la observación es libre). Validación visual
autenticada del usuario (no tengo login).
