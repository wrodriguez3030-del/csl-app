# Cálculo Mensual de Incentivos — cableado de la UI · v0.34.0

Fecha: 2026-07-11 · Supabase: **solo local db-cls** (no Cloud)

Continúa la fundación de [v0.33.0](./2026-07-11-fundacion-calculo-mensual-incentivos.md).
Aquí se **cablea el motor** `run-engine.ts` a una pantalla completa: server → API →
UI + navegación. El roster se usa **ya sembrado** (25 colaboradores) y los
pacientes salen de **reservas** (la captura manual y el CRUD de roster quedan
para el siguiente incremento).

## Flujo

`Cálculo mensual` (submenú nuevo) → elegir **sucursal + mes + año** →
`getCommissionRunPreview` corre `computeRun` en el servidor (no persiste) →
se muestran KPIs del fondo láser, desglose por colaborador, bases por categoría
y alertas → **Guardar borrador** (`saveCommissionRun`) → **Finalizar**
(`finalizeCommissionRun`, inmutable) o **Anular** (`voidCommissionRun`, con
motivo, libera el período para recalcular).

**El servidor siempre recalcula**: el cliente solo envía sucursal/período, nunca
montos. Guardar/Finalizar/Anular exigen `sales_commission.calculate`.

## Server (`lib/server/commission.ts`)

| Función | Rol |
|---|---|
| `getCommissionCollaborators` | Roster por sucursal (para run y futura UI de roster) |
| `getCommissionRunPreview` | Arma la entrada del motor y corre `computeRun`; devuelve el resultado + el run guardado si existe |
| `saveCommissionRun` | Recalcula en el server y persiste `sales_commission_runs` + `_run_items` como borrador (upsert por sucursal+período; bloquea si hay run finalizado) |
| `getCommissionRuns` / `getCommissionRun` | Lista por período / detalle con ítems |
| `finalizeCommissionRun` / `voidCommissionRun` | Transiciones de estado (auditadas) |

Helpers puros de armado: `readRoster`, `readRunRules` (reglas activas →
`RunRules`: `card_percentage`, `product_unit_incentive`, `category_commission`,
`laser_scale`, `laser_split`), `readPatientsForRun` (prefiere `manual` sobre
`reservas`), `readRunSales` (reusa `fetchSalesForPeriod` paginado),
`computeRunForPeriod`.

## Navegación (4 lugares — patrón fix v0.28.3)

1. `TabId` `comision-calculo` en `lib/types.ts`.
2. `MENU_OPTIONS` en `lib/menus.ts` (visible para admin/superadmin vía
   `ALL_MENU_IDS`; asignable a otros roles por la UI de usuarios).
3. Sección en `components/sidebar.tsx` (ícono `Calculator`).
4. Import + `case` en `app/page.tsx`.

## QA

- `scripts/_smoke-calculo-mensual.mjs` (solo lectura, db-cls, Jun 2026):
  **14/14**. Neto por sucursal: RAFAEL VIDAL **22,702.24**, LOS JARDINES
  **31,526.65**, VILLA OLGA **27,416.50**. Invariantes: Σ neto ítems = neto
  total, base neta ≤ base bruta (tarjeta neteada), fondo ≤ base × 5 %.
  Detectó una alerta real: DAYHANA tiene incentivos en RAFAEL VIDAL pero está
  rostered en VILLA OLGA (el motor no la calcula en silencio).
- `npm run test:commission` → **110/110**. `npx tsc --noEmit` → **0**.
  `npm run build` → **OK**.

## Pendiente (siguiente incremento)

- **Roster CRUD** (alta/edición/baja de colaboradores por sucursal, con
  servicios, participación lineal/pacientes, evaluación, bono, limpieza).
- **Captura manual de pacientes** (usa las columnas `service`/`observation` ya
  creadas; hoy los pacientes salen de reservas).
- Reporte/impresión del run finalizado; lista de runs por período.
