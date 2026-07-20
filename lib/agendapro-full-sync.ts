/**
 * Sincronización de clientes AgendaPro desde el cliente (browser).
 *
 * AgendaPro pagina de ~30 en 30 (los más NUEVOS primero) y una sola llamada que
 * recorra todo choca con el límite de tiempo de la función. Por eso hacemos
 * tandas cortas (`pagesPerTick`), avanzando de página en página.
 *
 * Dos modos:
 *   - COMPLETO (`runFullAgendaProSync`): recorre todas las páginas hasta el final.
 *     Úsalo una vez para la migración inicial.
 *   - INCREMENTAL (`runIncrementalAgendaProSync`): recorre desde la página 1 y se
 *     DETIENE al llegar a una tanda sin clientes nuevos (0 creados) — es decir, al
 *     alcanzar los clientes ya sincronizados. Trae solo lo nuevo desde la última
 *     sincronización. Es el modo del día a día y del auto-sync.
 *
 * Multi-tenant: `activeBusinessId` viaja en cada tanda → usa el negocio activo.
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

async function runAgendaProSyncLoop(opts: {
  activeBusinessId?: string
  authHeaders: Record<string, string>
  onProgress?: (p: AgendaProSyncProgress) => void
  incremental: boolean
}): Promise<AgendaProSyncTotals> {
  const PAGES_PER_TICK = opts.incremental ? 2 : 5
  const MAX_CHUNKS = 80 // salvaguarda anti-bucle (≈ 12k clientes en modo completo)
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
    const chunkCreated = j.created || 0
    acc.read += j.totalAgendaPro || 0
    acc.created += chunkCreated
    acc.updated += j.updated || 0
    acc.duplicates += j.duplicates || 0
    acc.skipped += j.skipped || 0
    acc.errors += j.errors || 0
    opts.onProgress?.({ page, read: acc.read, created: acc.created, updated: acc.updated })
    // Fin: AgendaPro no devolvió más datos.
    if (j.reachedEnd || (j.totalAgendaPro || 0) === 0) break
    // Incremental: al llegar a una tanda SIN clientes nuevos, ya alcanzamos lo
    // ya sincronizado — paramos (no releemos todo).
    if (opts.incremental && chunkCreated === 0) break
    // Guardia: AgendaPro dejó de avanzar (misma primera fila) → cortar.
    if (j.firstId && j.firstId === prevFirstId) break
    prevFirstId = j.firstId || null
    page += PAGES_PER_TICK
  }
  return acc
}

/** Recorrido COMPLETO — para la migración inicial. */
export function runFullAgendaProSync(opts: {
  activeBusinessId?: string
  authHeaders: Record<string, string>
  onProgress?: (p: AgendaProSyncProgress) => void
}): Promise<AgendaProSyncTotals> {
  return runAgendaProSyncLoop({ ...opts, incremental: false })
}

/** Recorrido INCREMENTAL — solo lo nuevo desde la última sincronización. */
export function runIncrementalAgendaProSync(opts: {
  activeBusinessId?: string
  authHeaders: Record<string, string>
  onProgress?: (p: AgendaProSyncProgress) => void
}): Promise<AgendaProSyncTotals> {
  return runAgendaProSyncLoop({ ...opts, incremental: true })
}
