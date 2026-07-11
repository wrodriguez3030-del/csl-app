# Cálculo Mensual de Incentivos — fundación del motor · v0.33.0

Fecha: 2026-07-11 · Supabase: **solo local db-cls** (no Cloud)

## Contexto

El módulo de Comisión de Ventas ya tiene Dashboard, Importar, Prestadores,
Pacientes, **Comisión láser**, Liquidación, Reglas y Reportes. El "Comisión
láser" actual calcula el fondo sobre **todo el negocio** y **sin netear
tarjeta**. Este incremento entrega la **fundación** para formalizar la
liquidación como un **cálculo mensual por sucursal** persistido (run) que corrige
ambas cosas y unifica todos los componentes del incentivo en un solo motor.

Alcance de **v0.33.0 = motor + BD + fix + tests**. La UI (roster CRUD, captura
manual de pacientes, pantalla de cálculo mensual con desglose y
guardar/finalizar) se cablea en el **siguiente incremento**.

## Motor puro — `lib/commission/run-engine.ts`

`computeRun(input)` sin I/O. Recibe ventas persistidas del período, roster de
colaboradores, conteos de pacientes y reglas; devuelve bases por método de pago,
fondo láser, ítems por colaborador, totales y alertas.

Reglas de negocio (documentadas en el encabezado del archivo):

- **TARJETA** descuenta un % configurable (default **27 %**) *antes* de calcular
  incentivo: `tarjeta_neta = bruta × (1 − cardPct)`. Efectivo/transferencia no
  descuentan; el descuento no se paga como incentivo.
- **Base láser POR SUCURSAL** = efectivo + transferencia + tarjeta neta (+ otros
  métodos sin descuento) de las ventas `DEPILACION_LASER`.
- **Fondo láser** = base × % del **mayor tramo** alcanzado (escala configurable
  vía reglas `laser_scale`).
- El fondo se divide en parte **por pacientes** (fracción `laser_split`
  configurable) y parte **lineal** (el resto, en partes iguales entre los
  colaboradores lineales con servicio láser).
- **Nunca calcula en silencio**: sin pacientes cargados el fondo por pacientes
  pasa a lineal (con alerta) o queda sin repartir (con alerta); prestadores o
  pacientes fuera del roster generan alerta pero su incentivo se muestra.
- **Incentivo por servicio** = base neta atribuible × % de categoría
  (masajes/faciales 20 %, hollywood/tatuajes/HIFU 10 %, editables).
- **Productos** = unidades × monto fijo (default RD$100).
- **Evaluación cualitativa** (default 100 %) ajusta **solo** el incentivo de
  servicios.
- `bruto = productos + servicios_ajustado + láser + bono`;
  `neto = bruto − aporte de limpieza` (default RD$400, configurable, puede ser 0;
  no genera netos negativos fantasma).

## Base de datos — `202607110002_commission_incentives_module.sql`

Aplicada a **db-cls** (verificado con `scripts/_check-incentives-migration.js`).
No destructiva (solo ALTER ADD / CREATE / UPDATE de canonización / INSERT seed).

| Objeto | Rol |
|---|---|
| `sales_commission_collaborators` | Roster editable por sucursal/servicio: participación (lineal/pacientes/mixto/%), limpieza, bono, evaluación, activo, soft delete. Único vivo por `(business_id, branch, name)`. |
| `sales_commission_runs` | Run mensual por sucursal (`borrador`/`finalizado`/`anulado`), `card_pct`, snapshots (`base_summary`/`rules_snapshot`/`totals`/`alerts`), auditoría de finalizado/anulado/corregido. Único vivo por `(business_id, branch, year, month)`. |
| `sales_commission_run_items` | Detalle por colaborador del run (desglose por servicio, pacientes, láser lineal/pacientes, bono, limpieza, bruto/neto). |
| `sales_commission_patient_counts` (+cols) | `service` + `observation` para **captura manual** de pacientes. |
| Regla `laser_split` | Sembrada (default 100 % por pacientes). |

RLS por `business_id` + grants a `service_role` con el mismo patrón del módulo.
Seed de **25 colaboradores** para Cibao (`csl`); KARLA (RV) y LUISA (VO) entran
**inactivas** con nota "verificar si aplica".

## Fixes incluidos

- **Filtro por sucursal devolvía vacío.** Las ventas/cálculos/pacientes
  guardaban el nombre COMPLETO del Excel (`CIBAO SPA LASER AV. RAFAEL VIDAL`)
  mientras la UI filtra por el canónico (`RAFAEL VIDAL`). `normalizeBranch` ahora
  hace match en dos pasos (alias exacto → por **contención**, alias más largos
  primero, mínimo 8 chars) y la migración canoniza los datos existentes. Tras la
  migración, las sucursales en `sales_commission_sales` son exactamente
  `LOS JARDINES`, `VILLA OLGA`, `RAFAEL VIDAL`.
- **Colaboradores duplicados por tipeo.** `canonicalCollaborator` aplica
  equivalencias: AHSLEY→ASHLEY, YANIBLE→YANIBEL, KATHERINE→KATHERIN,
  ROQUELMI→RIQUELMI, EMELY→EMELI, JOHELY→JOELY, MADELIN→MADELINE.
- Categorías `ANESTESIA` y `BOTOX_PLASMA` + `CATEGORY_LABELS`.

## QA

- `npm run test:commission` → **110/110** (33 aserciones nuevas del motor de
  runs con los ejemplos del documento de negocio: tarjeta 27 %, base láser por
  sucursal, escala, split pacientes/lineal, servicios con tarjeta neteada,
  productos, evaluación, alertas).
- `npx tsc --noEmit` → **0 errores**.

## Pendiente (siguiente incremento — cablear la UI)

1. Capa server en `lib/server/commission.ts`: `getCommissionCollaborators` /
   `saveCommissionCollaborator` / `setCommissionCollaboratorActive`;
   `getCommissionRunPreview` (arma `ComputeRunInput` y llama `computeRun`) /
   `saveCommissionRun` / `getCommissionRun(s)` / `finalizeCommissionRun` /
   `voidCommissionRun`; `saveCommissionPatientCount` (manual).
2. Handlers en `app/api/csl/_handlers.ts`.
3. Páginas en `components/comision/`: roster de colaboradores, cálculo mensual
   (preview → desglose por colaborador + alertas → guardar/finalizar), captura
   manual de pacientes; + navegación.
