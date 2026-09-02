/**
 * Qué períodos se pueden calcular SOLOS al terminar de importar ventas.
 *
 * El cálculo mensual es el que aplica el reparto de las cuentas de recepción,
 * así que si nadie lo corre, esas unidades no llegan a nadie. Correrlo solo es
 * cómodo, pero escribe en el libro de liquidación: por eso este planificador
 * decide qué se toca y qué NO, y siempre dice por qué.
 *
 * Nunca se toca de forma automática:
 *   · un cálculo ya **FINALIZADO** (hay que anularlo a mano para rehacerlo), ni
 *   · un período **CERRADO** en el libro de liquidación.
 * Un borrador sí se recalcula — es exactamente lo que hace el botón manual.
 */

export type AutoRunSkipReason = "finalizado" | "cerrado"

export const AUTO_RUN_SKIP_LABEL: Readonly<Record<AutoRunSkipReason, string>> = {
  finalizado: "Ya estaba finalizado: anúlalo si quieres recalcularlo",
  cerrado: "Período cerrado en la liquidación",
}

export interface PeriodBranch { year: number; month: number; branch: string }
export interface ExistingRun extends PeriodBranch { status: string }
export interface AutoRunPlan {
  run: PeriodBranch[]
  skipped: (PeriodBranch & { reason: AutoRunSkipReason })[]
}

const keyOf = (p: PeriodBranch): string => `${p.year}-${p.month}|${p.branch}`

/** «2026-08» → { year, month }; `null` si no es un período válido. */
function parsePeriod(key: string): { year: number; month: number } | null {
  const m = String(key || "").match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1]), month = Number(m[2])
  return month >= 1 && month <= 12 ? { year, month } : null
}

/**
 * Planifica los cálculos automáticos de los períodos importados.
 * `existing.runs` son los runs vivos (no anulados cuentan por su estado) y
 * `existing.closed` los períodos con liquidación cerrada.
 */
export function planAutoRuns(
  periods: readonly string[],
  branches: readonly string[],
  existing: { runs: readonly ExistingRun[]; closed: readonly PeriodBranch[] },
): AutoRunPlan {
  const finalizados = new Set(existing.runs.filter((r) => r.status === "finalizado").map(keyOf))
  const cerrados = new Set(existing.closed.map(keyOf))
  const targets = periods
    .map(parsePeriod)
    .filter((p): p is { year: number; month: number } => p != null)
    .flatMap((p) => branches.map((branch) => ({ ...p, branch })))

  return targets.reduce<AutoRunPlan>((acc, t) => {
    const k = keyOf(t)
    if (finalizados.has(k)) return { ...acc, skipped: [...acc.skipped, { ...t, reason: "finalizado" }] }
    if (cerrados.has(k)) return { ...acc, skipped: [...acc.skipped, { ...t, reason: "cerrado" }] }
    return { ...acc, run: [...acc.run, t] }
  }, { run: [], skipped: [] })
}
