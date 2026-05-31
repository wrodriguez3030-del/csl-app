/**
 * Lógica de negocio pura para el módulo PulseControl.
 *
 * Sin dependencias de React, Supabase ni Next — importable desde
 * componentes, API handlers y scripts.
 */

export interface PulseReading {
  id: string
  business_id: string
  equipo_id: string
  serial?: string | null
  sucursal: string
  cabina?: string | null
  operadora?: string | null
  period_start: string
  period_end: string
  period_label?: string | null
  lectura_inicial: number
  lectura_final: number
  disp_laser: number
  disp_operador?: number | null
  diferencia?: number | null
  diferencia_pct?: number | null
  estado_cuadre?: string | null
  estado_mantenimiento?: string | null
  fallas?: string | null
  source_file?: string | null
  source_type?: string | null
  observaciones?: string | null
  created_at?: string
  updated_at?: string
}

/**
 * Devuelve la lectura_final más reciente para un equipo antes de una fecha.
 * Retorna null si no hay historial previo.
 */
export function findPrevLecturaFinal(
  readings: PulseReading[],
  equipoId: string,
  beforeDate: string,
): number | null {
  const prev = readings
    .filter(r => r.equipo_id === equipoId && r.period_end < beforeDate)
    .sort((a, b) => b.period_end.localeCompare(a.period_end))
  if (prev.length > 0 && Number(prev[0].lectura_final) > 0) return Number(prev[0].lectura_final)
  return null
}

export type LecturaInicialSource = 'historico' | 'p_cabeza' | 'primera_lectura'

/**
 * Calcula la lectura_inicial para un nuevo período de un equipo.
 *
 * Precedencia:
 *   1. Histórico: última lectura_final del equipo anterior a period_start
 *   2. P_Cabeza del equipo (cuando no hay historial)
 *   3. 0 (primera lectura del equipo)
 */
export function calculateLecturaInicial(
  readings: PulseReading[],
  equipoId: string,
  periodStart: string,
  pCabeza?: number | null,
): { value: number; source: LecturaInicialSource } {
  const fromHistory = findPrevLecturaFinal(readings, equipoId, periodStart)
  if (fromHistory !== null) return { value: fromHistory, source: 'historico' }
  if (pCabeza && Number(pCabeza) > 0) return { value: Number(pCabeza), source: 'p_cabeza' }
  return { value: 0, source: 'primera_lectura' }
}

/**
 * Verifica la continuidad de lecturas para un equipo y devuelve los cambios
 * necesarios (lectura_inicial de cada fila debe == lectura_final del anterior).
 */
export function recalculateContinuity(
  readingsByEquipo: PulseReading[],
): Array<{ id: string; equipo_id: string; period_start: string; lectura_inicial: number; disp_laser: number }> {
  const sorted = [...readingsByEquipo].sort((a, b) => a.period_start.localeCompare(b.period_start))
  const changes: ReturnType<typeof recalculateContinuity> = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    const correctInicial = Number(prev.lectura_final)
    if (Number(cur.lectura_inicial) !== correctInicial) {
      changes.push({
        id: cur.id,
        equipo_id: cur.equipo_id,
        period_start: String(cur.period_start),
        lectura_inicial: correctInicial,
        disp_laser: Number(cur.lectura_final) - correctInicial,
      })
    }
  }
  return changes
}
