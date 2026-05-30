/**
 * POST /api/integrations/mantenimiento/import-lecturas
 *
 * Recibe filas parseadas del Excel "Dashboard Mantenimiento" y:
 *   1. Actualiza csl_equipos (p_cabeza, serie, cabina, operadora,
 *      fallas_recientes, ultima_actualizacion_pulsos, ultima_semana_pulsos).
 *   2. Inserta snapshot en csl_equipo_snapshots.
 *   3. Inserta fallas normalizadas en csl_equipo_fallas.
 *
 * CRÍTICO multi-tenant: toda actualización usa (business_id, equipo_id).
 * Nunca equipo_id solo.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"
import { runWithBusinessContext } from "@/lib/server/business-context"
import type { MantenimientoEquipoRow } from "@/lib/mantenimiento-dashboard-excel"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60
export const runtime = "nodejs"

interface ImportBody {
  rows: MantenimientoEquipoRow[]
  periodoInicio?: string
  periodoFin?: string
  etiquetaPeriodo?: string
  archivoNombre?: string
}

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }

  const ctx = await loadBusinessContext(user.id)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)

  return runWithBusinessContext(ctx, async () => {
    let body: ImportBody = { rows: [] }
    try { body = await request.json() } catch { /* empty body */ }

    if (!body.rows || !Array.isArray(body.rows) || body.rows.length === 0) {
      return json({ ok: false, error: "Se requiere un array de filas no vacío." }, 400)
    }

    const supabase = getSupabaseAdmin()
    const businessId = ctx.businessId
    const now = new Date().toISOString()
    const periodoInicio = body.periodoInicio || null
    const periodoFin = body.periodoFin || null

    let updated = 0
    let notFound = 0
    const warnings: string[] = []
    const errors: string[] = []

    // 1. Cargar equipos existentes de este tenant en una sola query
    const { data: existingEquipos, error: fetchError } = await supabase
      .from("csl_equipos")
      .select("equipo_id")
      .eq("business_id", businessId)

    if (fetchError) {
      return json({ ok: false, error: `Error cargando equipos: ${fetchError.message}` }, 500)
    }
    const existingSet = new Set((existingEquipos || []).map(e => String(e.equipo_id)))

    // 2. Actualizar cada equipo existente
    for (const row of body.rows) {
      if (!row.equipoId) continue

      if (!existingSet.has(row.equipoId)) {
        notFound++
        warnings.push(`Equipo ${row.equipoId} (${row.equipoRaw}) no encontrado en este tenant — no actualizado.`)
        continue
      }

      const fields: Record<string, unknown> = { ultima_actualizacion_pulsos: now }
      if (row.pulsos > 0) fields.p_cabeza = row.pulsos
      if (row.serie) fields.serie = row.serie
      if (row.cabina) fields.cabina = row.cabina
      if (row.operadora) fields.operadora = row.operadora
      if (row.fallasRaw !== undefined) fields.fallas_recientes = row.fallasRaw || null
      if (periodoFin) fields.ultima_semana_pulsos = periodoFin

      const { error } = await supabase
        .from("csl_equipos")
        .update(fields)
        .eq("business_id", businessId)
        .eq("equipo_id", row.equipoId)

      if (error) errors.push(`Equipo ${row.equipoId}: ${error.message}`)
      else updated++
    }

    // 3. Insertar snapshots en bulk
    const snapshotRows = body.rows
      .filter(r => r.equipoId)
      .map(row => ({
        business_id:     businessId,
        equipo_id:       row.equipoId,
        serie:           row.serie || null,
        sucursal:        row.sucursal || null,
        cabina:          row.cabina || null,
        operadora:       row.operadora || null,
        lectura_final:   row.pulsos || null,
        estado:          row.estadoExcel || null,
        fallas:          row.fallasRaw || null,
        periodo_inicio:  periodoInicio,
        periodo_fin:     periodoFin,
        etiqueta_periodo: body.etiquetaPeriodo || null,
        archivo_nombre:  body.archivoNombre || null,
        fuente:          "excel_dashboard_mantenimiento",
      }))

    let snapshotsSaved = 0
    if (snapshotRows.length > 0) {
      const { error: snapError } = await supabase
        .from("csl_equipo_snapshots")
        .insert(snapshotRows)
      if (snapError) errors.push(`Snapshots: ${snapError.message}`)
      else snapshotsSaved = snapshotRows.length
    }

    // 4. Insertar fallas en bulk
    const fallaRows: Array<Record<string, unknown>> = []
    for (const row of body.rows) {
      if (!row.equipoId || !row.fallas?.length) continue
      for (const codigo of row.fallas) {
        fallaRows.push({ business_id: businessId, equipo_id: row.equipoId, codigo_falla: codigo, periodo_inicio: periodoInicio, fuente: "excel" })
      }
    }

    let fallasSaved = 0
    if (fallaRows.length > 0) {
      const { error: fallaError } = await supabase
        .from("csl_equipo_fallas")
        .insert(fallaRows)
      if (fallaError) errors.push(`Fallas: ${fallaError.message}`)
      else fallasSaved = fallaRows.length
    }

    return json({ ok: errors.length === 0, updated, notFound, snapshotsSaved, fallasSaved, warnings, errors, totalRows: body.rows.length })
  })
}
