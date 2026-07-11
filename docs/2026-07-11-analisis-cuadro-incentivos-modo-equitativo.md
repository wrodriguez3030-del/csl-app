# Análisis del cuadro "SISTEMA INCENTIVOS .xlsx" → modo EQUITATIVO · v0.37.0

Fecha: 2026-07-11 · Fuente: `C:\Users\ADMIN\Downloads\SISTEMA INCENTIVOS .xlsx`
(cuadro oficial del negocio, Junio; 1 hoja, 3 secciones por sucursal)

## Qué dice el cuadro (modelo real)

Por sucursal y mes:

1. **Base láser** = total de la sucursal con tarjeta neteada al 27% menos las
   otras categorías (masaje, producto, faciales, anestesia…) a valor bruto.
2. **Fondo** = base × % (el cuadro usa 2%).
3. **Reparto** (¡NO es 50/50!):
   - Cuota per cápita = **fondo ÷ N elegibles** (RV: 14,480.11÷8 = 1,810.01).
   - Quien tiene **0 pacientes** ("lineal") cobra **exactamente su cuota**.
   - El **resto** (fondo − cuotas) se reparte **por pacientes** entre quienes
     atendieron: RIQUELMI 246→1,973.69 · ROSA 192→1,540.44 · DIANA 206→1,652.76
     · MADELINE 244→1,957.64 · EMELY 240→1,925.55.
4. **Elegibles de Junio**: RV = LUISA, YANIBEL, KARLA (0 pac) + RIQUELMI, ROSA,
   DIANA, MADELINE, EMELY (8) · LJ = LESLIE, YADIBEL, ASHLEY (0 pac) + NAYELI,
   KATHERINE, LILIAN, YAMILKA (7) · VO = ANGELICA, GIPSY (0 pac) + YESSICA,
   SAHOMY (4). JOELY/BENITA/EIDYLEE/DAYHANA/ISAURY/MARIELA **fuera del láser**
   (cobran solo sus categorías).
5. **Liquidación** = productos (RD$100/u; DAYHANA/ISAURY a **RD$50/u**) +
   incentivos servicios × evaluación cualitativa + bono extra − aporte limpieza
   (RD$400; 0 para DAYHANA/ISAURY/MARIELA).

## Qué se implementó (v0.37.0)

- **Modo EQUITATIVO** en el motor (`laserDistributionMode`), **default** vía
  regla `laser_split_mode` (editable en Reglas; "No" vuelve al modo de pesos
  50/50). Test unitario replica el cuadro de Junio RV **al centavo** con cuadre
  exacto Σ = fondo.
- **Tarifa de producto por colaborador** (`product_unit_amount`, "50 P/P") —
  DDL aplicado a db-cls, editable en el editor de personal.
- **Roster alineado al cuadro de Junio** (`_align-roster-to-excel-june.js`,
  reversible por UI): RV=8 · LJ=7 · VO=4 elegibles, ISAURY dada de alta (sin
  láser, RD$50/u, sin limpieza).
- **UX**: selector de período compartido y persistente entre Comisión láser /
  Clientes atendidos / Cálculo mensual; franja del modo de reparto vigente;
  tarjeta "Cuota (fondo÷N)"; columnas Bono y Prod. RD$/u en el editor (+fix:
  guardar ya no reseteaba el bono); labels de Reglas aclarados.

## Discrepancias detectadas (DECISIÓN DE NEGOCIO, no se tocaron)

| # | Cuadro | Sistema | Impacto Jun RV |
|---|---|---|---|
| 1 | **2% fijo** aunque su escala diga 600k→3% | Aplica la escala (base 711,574 → **3%**) | fondo 21,347.24 vs 14,480.11 (≈+6,867) |
| 2 | Base = total sucursal neteado − categorías a bruto (aprox.) | Netea la tarjeta de las ventas láser reales (spec §1B) | base 711,574.50 vs 724,005.50 (−1.7%) |
| 3 | Pacientes contados a mano (1,128/864/303) | Reservas ASISTE (1,076/850/297) | ajustable en Clientes atendidos (captura manual) |

**Si se desea el 2% fijo del cuadro:** en Reglas de comisión desactivar los
tramos 600k/800k/2M de la escala láser (queda solo 260k→2%).

## QA

`test:commission` **129/129** · smoke db-cls 17/17 (equitativo, cuadre 0.00 en
las 3 sucursales) · captura 7/7 · `tsc` 0 · `build` OK.
