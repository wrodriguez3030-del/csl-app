/**
 * Resolución de la OPERADORA OFICIAL para las vistas de PulseControl
 * (Auditoría/IA, Lecturas semanales, Cuadre semanal, Registro de servicios y
 * sus exportaciones Excel/PDF).
 *
 * PROBLEMA QUE RESUELVE
 * --------------------
 * Las lecturas/sesiones importadas desde Excel o AgendaPro traen el nombre de
 * la operadora tal cual venía en el archivo — que puede estar equivocado o ser
 * histórico (p.ej. "MADELIN" en Los Jardines Cabina 2 cuando la operadora
 * oficial de esa cabina es "LILIAN"). El Excel NO es la fuente de verdad.
 *
 * FUENTE DE VERDAD
 * ----------------
 * La asignación operadora ↔ cabina/equipo vive en el catálogo de EQUIPOS
 * (`csl_equipos`, expuesto como `db.equipos` → `Equipo[]`), que tiene
 * `Sucursal`, `Cabina`, `Operadora` y `EquipoID` por negocio. El catálogo
 * de Operadoras (`csl_operadoras`) solo guarda nombre + sucursal (sin cabina),
 * así que la relación por cabina sale de Equipos.
 *
 * AISLAMIENTO POR EMPRESA
 * -----------------------
 * `db.equipos` ya viene filtrado por `business_id` activo desde el backend
 * (getAllData → getRows con BusinessContext). Por eso el resolver construido
 * con esos equipos NUNCA puede devolver una operadora de otra empresa: solo
 * conoce las del negocio activo. La sucursal se normaliza para que
 * "JARDINES"/"Los Jardines"/"Cibao Spa Láser - Los Jardines" caigan todas en
 * "LOS JARDINES" y no se crucen entre sucursales.
 *
 * REGLA
 * -----
 *   1. Buscar operadora oficial por (sucursal, equipo) y, si no, (sucursal, cabina).
 *   2. Si existe → esa es la operadora mostrada (`source: "oficial"`).
 *   3. Si no existe → usar la del Excel como fallback (`source: "excel"`) y
 *      exponer `mismatch`/observación para la UI.
 */

import { normalizeSucursal, normalizeOperadora } from "@/lib/normalize-pulse"
import type { Equipo } from "@/lib/types"

/** Normaliza una cabina a su número/identificador canónico ("CABINA 2" → "2"). */
export function normalizeCabinaKey(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/CABINA/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Cabinas que NO representan una asignación real de operadora. */
const CABINA_NO_ASIGNA = new Set(["", "BACKUP", "TALLER", "SIN ASIGNAR"])

export interface OperadoraResolucion {
  /** Operadora a MOSTRAR: oficial si existe, si no la del Excel (fallback). */
  operadora: string
  /** Operadora oficial encontrada en el catálogo de equipos ("" si no hay). */
  oficial: string
  /** Operadora tal cual venía del Excel/AgendaPro (normalizada). */
  excel: string
  /** De dónde salió la operadora mostrada. */
  source: "oficial" | "excel" | "none"
  /** true si el Excel difería de la oficial (para observación/tooltip). */
  mismatch: boolean
  /** Texto listo para observación cuando hay diferencia o fallback. */
  observacion: string
}

export interface OperadoraResolver {
  resolve(args: {
    sucursal?: unknown
    cabina?: unknown
    equipo?: unknown
    operadoraExcel?: unknown
  }): OperadoraResolucion
}

/**
 * Construye un resolver a partir del catálogo de equipos del negocio activo.
 * Memorizar con useMemo([db.equipos]) en el componente para no reconstruir.
 */
export function buildOperadoraResolver(equipos: Equipo[] | undefined | null): OperadoraResolver {
  const byEquipo = new Map<string, string>()
  const byCabina = new Map<string, string>()

  for (const e of equipos || []) {
    const oficial = normalizeOperadora(e?.Operadora)
    if (!oficial) continue // equipo sin operadora asignada → no aporta verdad
    const suc = normalizeSucursal(e?.Sucursal)
    if (!suc) continue
    const eq = String(e?.EquipoID ?? "").trim().toUpperCase()
    const cab = normalizeCabinaKey(e?.Cabina)
    // Match más específico: por equipo (único dentro del negocio).
    if (eq) byEquipo.set(`${suc}|${eq}`, oficial)
    // Match por cabina: el primero con operadora gana (evita pisar con BACKUP/null).
    if (!CABINA_NO_ASIGNA.has(cab)) {
      const k = `${suc}|${cab}`
      if (!byCabina.has(k)) byCabina.set(k, oficial)
    }
  }

  return {
    resolve({ sucursal, cabina, equipo, operadoraExcel }) {
      const suc = normalizeSucursal(sucursal)
      const eq = String(equipo ?? "").trim().toUpperCase()
      const cab = normalizeCabinaKey(cabina)
      const excel = normalizeOperadora(operadoraExcel)

      const oficial =
        (suc && eq ? byEquipo.get(`${suc}|${eq}`) : "") ||
        (suc && cab ? byCabina.get(`${suc}|${cab}`) : "") ||
        ""

      if (oficial) {
        const mismatch = !!excel && excel !== oficial
        return {
          operadora: oficial,
          oficial,
          excel,
          source: "oficial",
          mismatch,
          observacion: mismatch ? `Excel: ${excel} / Oficial: ${oficial}` : "",
        }
      }

      // Sin asignación oficial → fallback Excel.
      return {
        operadora: excel,
        oficial: "",
        excel,
        source: excel ? "excel" : "none",
        mismatch: false,
        observacion: excel ? "Operadora tomada del archivo por falta de asignación oficial." : "",
      }
    },
  }
}
