/**
 * Tamaño del número en las tarjetas de KPI de los tableros.
 *
 * Antes la clase era `truncate text-lg`: un importe largo se cortaba con «…»
 * («RD$147,733,900.35» → «RD$147,73…») y el tablero mentía. La regla ahora es
 * al revés — **el número se ve entero SIEMPRE**; lo que cede es el tamaño de la
 * letra, en escalones, según cuántos caracteres trae el valor.
 *
 * Los cortes están calculados para la tarjeta más estrecha del sistema
 * (columna de 240 px: 240 − 32 de padding − 44 del icono − 12 del hueco ≈ 152 px
 * de ancho útil) con dígitos tabulares, cuyo avance ronda 0,6 em.
 */

/** Clases fijas de la línea del valor. Sin `truncate` y sin partir el número. */
export const KPI_VALUE_BASE = "font-black tabular-nums whitespace-nowrap text-[color:var(--brand-primary-dark)]"

const STEPS: { max: number; cls: string }[] = [
  { max: 11, cls: "text-lg" },   // «2,213», «58.7%», «RD$12,345»
  { max: 14, cls: "text-base" }, // «RD$123,456.00»
  { max: 18, cls: "text-sm" },   // «RD$147,733,900.35» ← historial completo
]
const SMALLEST = "text-xs"

/** Escalón de tamaño para que `value` quepa completo. */
export function kpiValueClass(value: string | number | null | undefined): string {
  const len = String(value ?? "").length
  return STEPS.find((s) => len <= s.max)?.cls ?? SMALLEST
}

/** Clase completa de la línea del valor: base + escalón. */
export function kpiValueClasses(value: string | number | null | undefined): string {
  return `${kpiValueClass(value)} ${KPI_VALUE_BASE}`
}
