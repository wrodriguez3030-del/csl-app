/**
 * Sincronización COMPLETA de clientes AgendaPro desde el cliente (browser).
 *
 * AgendaPro pagina de ~30 en 30 y una sola llamada que recorra todo choca con el
 * límite de tiempo de la función. Por eso hacemos tandas cortas (`pagesPerTick`),
 * avanzando de página en página hasta que AgendaPro deja de devolver datos
 * (`reachedEnd`) o deja de avanzar (misma `firstId` que la tanda previa).
 *
 * Multi-tenant: `activeBusinessId` viaja en cada tanda → el sync usa el negocio
 * seleccionado.
 */

export interface AgendaProSyncProgress {
  page: number
  read: number
  created: number
  updated: number
}

export interface AgendaProSyncTotals {
  read: number
  created: number
  updated: number
  duplicates: number
  skipped: number
  errors: number
  error?: string
}

export async function runFullAgendaProSync(opts: {
  activeBusinessId?: string
  authHeaders: Record<string, string>
  onProgress?: (p: AgendaProSyncProgress) => void
}): Promise<AgendaProSyncTotals> {
  const PAGES_PER_TICK = 5
  const MAX_CHUNKS = 80 // salvaguarda anti-bucle (80×5 = 400 páginas ≈ 12k clientes)
  const acc: AgendaProSyncTotals = { read: 0, created: 0, updated: 0, duplicates: 0, skipped: 0, errors: 0 }
  let page = 1
  let prevFirstId: string | null = null

  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    const r = await fetch("/api/integrations/agendapro/sync-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts.authHeaders },
      body: JSON.stringify({ activeBusinessId: opts.activeBusinessId, page, pagesPerTick: PAGES_PER_TICK }),
    })
    const j = await r.json() as {
      ok?: boolean; error?: string; reachedEnd?: boolean; firstId?: string
      totalAgendaPro?: number; created?: number; updated?: number; duplicates?: number; skipped?: number; errors?: number
    }
    if (!j?.ok) { acc.error = j?.error || "Error al sincronizar."; break }
    acc.read += j.totalAgendaPro || 0
    acc.created += j.created || 0
    acc.updated += j.updated || 0
    acc.duplicates += j.duplicates || 0
    acc.skipped += j.skipped || 0
    acc.errors += j.errors || 0
    opts.onProgress?.({ page, read: acc.read, created: acc.created, updated: acc.updated })
    // Fin: AgendaPro no devolvió más datos.
    if (j.reachedEnd || (j.totalAgendaPro || 0) === 0) break
    // Guardia: AgendaPro dejó de avanzar (misma primera fila) → cortar.
    if (j.firstId && j.firstId === prevFirstId) break
    prevFirstId = j.firstId || null
    page += PAGES_PER_TICK
  }
  return acc
}
