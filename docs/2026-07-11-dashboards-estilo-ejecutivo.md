# Dashboards con estilo EJECUTIVO en todo el sistema · v0.38.0

Fecha: 2026-07-11

El usuario pidió llevar el estilo del **dashboard ejecutivo de Comisión de
Ventas** (KPIs con chip de ícono, paneles redondeados, charts limpios, look
"tipo Canva") a todos los dashboards del sistema.

## Estrategia (máximo alcance, mínimo riesgo)

La mayoría de los dashboards ya usaban la **`KpiCard` compartida**
(`components/kpi-card.tsx`) → rediseñarla actualiza todo de una vez:

| Dashboard | Cómo se actualizó |
|---|---|
| Panel Mantenimiento (reportes/piezas + cuadres) | `KpiCard` compartida |
| PulseControl (dashboard + mantenimiento) | `KpiCard` compartida |
| RR.HH. (dashboard + ponche) | `KpiCard` compartida |
| **Compras** | Restyle completo (encabezado, filtros, 8 KPIs, alerta-insight) |
| **Materiales** | Restyle completo (KPIs, tops, 5 charts al estilo ejecutivo) |
| Comisión de Ventas | Ya era la referencia (v0.32) |

## Piezas nuevas

- **`components/kpi-card.tsx`** (rediseño): tarjeta blanca `rounded-2xl` +
  sombra suave; chip de ícono con tono semántico (marca/éxito/alerta/crítico);
  label uppercase 10px; valor `text-lg font-black tabular-nums` en tinta de
  marca; nota opcional. El texto siempre en tinta neutra (el color va en el
  chip/marca, según dataviz).
- **`components/dashboard-kit.tsx`**: `DashHeader`, `DashPanel` (título +
  "acción →"), `EmptyChart`, `InsightItem`, `DashSkeletonRow`, constantes de
  charts (`CHART_COLORS` paleta categórica **validada** con
  `validate_palette.js` — todas PASS; `STATUS_COLORS` reservados; ejes/grid
  recesivos; estilo de tooltip).

## Reglas dataviz aplicadas

- Paleta categórica en **orden fijo**, nunca ciclada (el donut de estados de
  Materiales usaba 8 colores ciclados → ahora **colores semánticos por
  estado**: aprobada/completa=verde, pendiente=ámbar, parcial=naranja,
  rechazada=rojo, comprada=teal, otro=gris).
- Texto en tinta neutra; el color identifica marcas, no números.
- Barras con radio 4px y `LabelList` selectivo; grid punteado sin ejes duros;
  tendencias como área con degradado de la marca; tooltips redondeados.
- Un solo eje por chart (sin dual axis).

## QA

`tsc` 0 · `build` OK · `test:commission` 129/129 (cero cambios de lógica).
**Validación visual autenticada pendiente del usuario** (sin login no puedo
ver las pantallas renderizadas).
