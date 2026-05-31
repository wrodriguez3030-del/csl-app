/**
 * Fuente única de color por signo + clasificación de estado para todo el
 * módulo PulseControl. Usar SIEMPRE estas funciones — no duplicar lógica
 * con clases inline.
 *
 * Reglas globales:
 *   - valor < 0  → ROJO    (rojo-500)
 *   - valor > 0  → AZUL    (blue-500)
 *   - valor = 0  → VERDE   (emerald-500, neutro/consistente)
 *
 * Estado (a partir del % de diferencia):
 *   - |pct| ≤  5  → OK         (verde)
 *   - |pct| ≤ 15  → Advert.    (amarillo)
 *   - |pct| > 15  → Crítico    (rojo)
 *
 * Esta es la lógica que se debe ver en TODAS las semanas; tomada como
 * referencia el comportamiento correcto que ya se observa en semanas
 * recientes con datos completos.
 */

import { TrendingDown, TrendingUp, CheckCircle, AlertTriangle, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { createElement, type ReactNode } from "react"

// ── Color por signo ──────────────────────────────────────────────────────────

/** Clase Tailwind de texto para valores firmados (diferencia, %). */
export function signedColorClass(value: number): string {
  if (value < 0) return "text-red-500"
  if (value > 0) return "text-blue-500"
  return "text-emerald-500"
}

/** Variante más oscura para totales o etiquetas con énfasis. */
export function signedColorClassDark(value: number): string {
  if (value < 0) return "text-red-600"
  if (value > 0) return "text-blue-600"
  return "text-emerald-600"
}

/** Icono Lucide que acompaña el valor firmado (null si valor = 0). */
export function signedIcon(value: number) {
  if (value < 0) return TrendingDown
  if (value > 0) return TrendingUp
  return null
}

// ── Estado (alerta) por % de diferencia ──────────────────────────────────────

export type AlertaEstado = "OK" | "Advertencia" | "Critico"

/** Clasifica el % de diferencia a uno de los tres estados estándar. */
export function getAlerta(pct: number): AlertaEstado {
  const a = Math.abs(pct)
  if (a <= 5) return "OK"
  if (a <= 15) return "Advertencia"
  return "Critico"
}

/** Render del badge de estado. Mismo aspecto en todas las semanas/menús. */
export function alertaBadge(alerta: AlertaEstado): ReactNode {
  if (alerta === "OK") {
    return createElement(
      Badge,
      { className: "bg-green-500/20 text-green-600 border-green-500/30 gap-1 text-xs" },
      createElement(CheckCircle, { className: "h-3 w-3" }),
      "OK",
    )
  }
  if (alerta === "Advertencia") {
    return createElement(
      Badge,
      { className: "bg-yellow-500/20 text-yellow-600 border-yellow-500/30 gap-1 text-xs" },
      createElement(AlertTriangle, { className: "h-3 w-3" }),
      "Advert.",
    )
  }
  return createElement(
    Badge,
    { className: "bg-red-500/20 text-red-600 border-red-500/30 gap-1 text-xs" },
    createElement(XCircle, { className: "h-3 w-3" }),
    "Crítico",
  )
}
