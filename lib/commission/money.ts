/**
 * Utilidades de dinero para el módulo de Comisión de Ventas.
 * Se opera en CENTAVOS internamente para evitar errores de punto flotante al
 * sumar montos con decimales (p. ej. RD$1,810.01 repetido muchas veces).
 */

export const toCents = (n: number): number => Math.round((Number(n) || 0) * 100)
export const fromCents = (c: number): number => c / 100

/** Redondea a 2 decimales de forma estable (vía centavos). */
export const round2 = (n: number): number => toCents(n) / 100

/** Suma robusta de montos en pesos (acumula en centavos y vuelve a pesos). */
export const sumMoney = (values: number[]): number =>
  fromCents(values.reduce((s, v) => s + toCents(v), 0))

/** Formato RD$ para presentación. */
export const fmtRD = (n: number): string =>
  "RD$" + round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Formato de porcentaje a partir de una fracción (0.27 → "27%"). */
export const fmtPct = (fraction: number, decimals = 0): string =>
  (round2(fraction * 100)).toFixed(decimals) + "%"
