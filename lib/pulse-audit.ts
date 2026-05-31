/**
 * Cálculo central de auditoría PULSE — fórmula y umbrales de alerta.
 *
 * Misma lógica que vivía inline en `components/pulsos-auditoria-page.tsx`
 * (useMemo `semanas`). Acá la unificamos para que el wizard de Cuadre
 * Semanal y la pantalla de auditoría legacy usen el mismo cálculo.
 *
 * Definiciones:
 *   - disparosLaser     = lecturaFinal - lecturaInicial  (lo que dice el equipo)
 *   - disparosOperador  = Σ disparos reportados por sesión (lo que reporta operadora)
 *   - diferencia        = disparosOperador - disparosLaser
 *   - porcentaje        = |diferencia| / disparosLaser × 100   (solo si disparosLaser > 0)
 *
 * Alerta (rangos exactos sobre |%|):
 *   - ≤  2 %  → "OK"
 *   - 3–15 %  → "Advertencia"
 *   - > 15 %  → "Critico"
 *
 * Estos thresholds vienen del helper compartido lib/pulse-colors.ts
 * (getAlerta) — única fuente de verdad para todo el módulo.
 *
 * Edge case: disparosLaser = 0 (no hubo uso real del equipo esa semana)
 *   - Si disparosOperador también = 0 → OK (semana inactiva legítima).
 *   - Si disparosOperador > 0 → Crítico (operadora reportó disparos sobre
 *     un equipo sin lectura — sospechoso).
 */

import { getAlerta as classifyAlerta } from "./pulse-colors"

export type AlertaNivel = "OK" | "Advertencia" | "Critico"

export interface DesviacionResult {
  disparosLaser: number
  disparosOperador: number
  diferencia: number
  porcentaje: number
  alerta: AlertaNivel
}

export function calcDesviacion(disparosLaser: number, disparosOperador: number): DesviacionResult {
  const laser = Math.max(0, Math.round(Number(disparosLaser) || 0))
  const operador = Math.max(0, Math.round(Number(disparosOperador) || 0))
  const diferencia = operador - laser

  if (laser === 0) {
    const alerta: AlertaNivel = operador === 0 ? "OK" : "Critico"
    return { disparosLaser: laser, disparosOperador: operador, diferencia, porcentaje: 0, alerta }
  }

  const porcentaje = Math.round((Math.abs(diferencia) / laser) * 1000) / 10
  // Thresholds centralizados en lib/pulse-colors.ts — fuente única de verdad.
  const alerta: AlertaNivel = classifyAlerta(porcentaje)
  return { disparosLaser: laser, disparosOperador: operador, diferencia, porcentaje, alerta }
}

// ─── Helpers de semana ────────────────────────────────────────────────────────

/** Convierte cualquier fecha ISO a el lunes de su semana (YYYY-MM-DD). */
export function lunesDeSemana(fechaIso: string): string {
  if (!fechaIso) return ""
  const d = new Date(`${String(fechaIso).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ""
  // getDay(): 0=Dom, 1=Lun, … 6=Sab. Desplazamos al lunes (1).
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

/** Devuelve la fecha n días después (formato ISO YYYY-MM-DD). */
export function addDays(fechaIso: string, days: number): string {
  if (!fechaIso) return ""
  const d = new Date(`${String(fechaIso).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ""
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Devuelve la fecha en formato local DR (DD/MM/YYYY). */
export function fmtFechaLocal(fechaIso?: string | null): string {
  if (!fechaIso) return "—"
  const raw = String(fechaIso).slice(0, 10)
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw
}
