/**
 * Formato y derivados de las pantallas financieras de Incentivos de Ventas.
 * Lógica PURA (sin React): etiquetas de servicio, participaciones, crecimiento
 * y totales de la tabla de flujo.
 */
import type { SaleCategory } from "@/lib/commission/classification"
import { SALE_CATEGORY_KEYS } from "./categorias"
import type { FlujoMes } from "@/components/bi-finance/bi-shared"

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/** Nombres con los que el negocio llama a cada servicio (los del Excel). */
export const SERVICE_LABELS: Readonly<Record<SaleCategory, string>> = {
  DEPILACION_LASER: "LÁSER",
  PRODUCTO: "PRODUCTO",
  FACIALES: "FACIALES",
  MASAJES: "MASAJE",
  TATUAJES: "TATUAJES",
  HOLLYWOOD_AQUA_PEEL: "HOLLYWOOD PEEL",
  ANESTESIA: "APLICACIÓN ANEST.",
  BOTOX_PLASMA: "BOTOX/PLASMA",
  HIFU: "HIFU",
  OTROS: "OTROS",
}

/** Los 8 del Excel se muestran siempre; HIFU y OTROS solo si tienen ventas. */
export const ALWAYS_SHOWN_SERVICES: readonly SaleCategory[] = SALE_CATEGORY_KEYS.filter((k) => k !== "HIFU" && k !== "OTROS")

export interface ServiceRow { id: SaleCategory; label: string; monto: number; pct: number }
export interface ShareRow { branch: string; monto: number; pct: number }

const pctOf = (part: number, total: number): number => (total > 0 ? round2((part / total) * 100) : 0)

/** Ventas por servicio, de mayor a menor, con su participación. */
export function serviceRows(porServicio: Readonly<Record<string, number>> | undefined): ServiceRow[] {
  const map = porServicio || {}
  const total = SALE_CATEGORY_KEYS.reduce((s, k) => s + (Number(map[k]) || 0), 0)
  return SALE_CATEGORY_KEYS
    .filter((k) => ALWAYS_SHOWN_SERVICES.includes(k) || (Number(map[k]) || 0) > 0)
    .map((id) => { const monto = round2(Number(map[id]) || 0); return { id, label: SERVICE_LABELS[id], monto, pct: pctOf(monto, total) } })
    .sort((a, b) => b.monto - a.monto)
}

/** Participación de cada sucursal sobre el total, de mayor a menor. */
export function shareRows(byBranch: Readonly<Record<string, number>> | undefined): ShareRow[] {
  const map = byBranch || {}
  const total = Object.values(map).reduce((s, v) => s + (Number(v) || 0), 0)
  return Object.entries(map)
    .map(([branch, v]) => { const monto = round2(Number(v) || 0); return { branch, monto, pct: pctOf(monto, total) } })
    .sort((a, b) => b.monto - a.monto)
}

/** «▲ 12.3%» / «▼ 4.0%» / «—» si no hay año anterior. */
export function fmtGrowth(pct: number | null | undefined): string {
  if (pct == null) return "—"
  const v = Number(pct) || 0
  return `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`
}

/** Rentabilidad %; `null` si no hubo ventas (no es 0, es «no aplica»). */
export function rentPct(margen: number, ventas: number): number | null {
  return ventas > 0 ? round2((margen / ventas) * 100) : null
}

/** Columnas de inversión por sucursal presentes en la serie (orden estable). */
export function inversionBranches(rows: readonly FlujoMes[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r.inversionByBranch || {})))].sort()
}

/** Fila TOTAL de la tabla de flujo. Suma columnas; no suma porcentajes. */
export function flujoTotals(rows: readonly FlujoMes[]): FlujoMes {
  const add = (f: (r: FlujoMes) => number) => round2(rows.reduce((s, r) => s + (f(r) || 0), 0))
  const inversionByBranch = inversionBranches(rows).reduce<Record<string, number>>(
    (acc, b) => ({ ...acc, [b]: add((r) => r.inversionByBranch?.[b] || 0) }), {})
  return {
    key: "TOTAL", label: "Total", short: "Total",
    ventas: add((r) => r.ventas), gastosOperativos: add((r) => r.gastosOperativos),
    inversionGeneral: add((r) => r.inversionGeneral), inversionByBranch,
    retiros: add((r) => r.retiros), egresos: add((r) => r.egresos), neto: add((r) => r.neto),
  }
}

/** Texto plano del análisis IA, para copiar o imprimir. */
export function analysisToText(
  answer: { resumen_ejecutivo?: string; hallazgos?: string[]; riesgos?: string[]; recomendaciones?: string[]; acciones?: string[]; nivel_confianza?: string; datos_faltantes?: string[] },
  meta: { model?: string | null; period: string },
): string {
  const list = (title: string, items?: string[]) => (items?.length ? [`\n${title}`, ...items.map((i) => `  · ${i}`)] : [])
  return [
    `ANÁLISIS FINANCIERO — ${meta.period}`,
    meta.model ? `Modelo: ${meta.model}` : "",
    answer.resumen_ejecutivo ? `\nRESUMEN EJECUTIVO\n  ${answer.resumen_ejecutivo}` : "",
    ...list("HALLAZGOS", answer.hallazgos),
    ...list("RIESGOS", answer.riesgos),
    ...list("RECOMENDACIONES", answer.recomendaciones),
    ...list("PLAN DE ACCIÓN", answer.acciones),
    ...list("DATOS FALTANTES", answer.datos_faltantes),
    answer.nivel_confianza ? `\nNivel de confianza: ${answer.nivel_confianza}` : "",
  ].filter(Boolean).join("\n")
}
