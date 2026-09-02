/**
 * Limpieza del LIBRO DE LIQUIDACIÓN al recalcular un período.
 *
 * `materializeRunToLedger` actualiza o crea la fila de cada persona del cálculo,
 * pero NO tocaba las de quien ya no sale. Si alguien se da de baja, se fusiona
 * con otra por alias o cambia de sucursal, su fila se quedaba con el importe
 * viejo y seguía cobrando. Pasó de verdad: EMELI y ASHLEY eran la misma persona
 * y el láser se pagó dos veces en junio, julio y agosto.
 */
import { canonicalCollaborator } from "./normalize"

/**
 * Nombres del libro que ya NO están en el cálculo (comparando por nombre
 * canónico, para que un alias no cuente como persona distinta). Devuelve los
 * nombres tal cual venían en el libro, para poder localizar sus filas.
 */
export function staleLedgerProviders(ledgerProviders: readonly string[], runNames: readonly string[]): string[] {
  const alive = new Set(runNames.map((n) => canonicalCollaborator(n)))
  return ledgerProviders.filter((p) => !alive.has(canonicalCollaborator(p)))
}

export interface LedgerRowRef { id: string; provider: string }
export interface LedgerDedupe {
  /** Nombre canónico → id de la fila que se conserva y se actualiza. */
  keep: Map<string, string>
  /** Ids de filas repetidas de la MISMA persona: hay que anularlas. */
  duplicates: string[]
}

/**
 * Una persona, una fila. Al fusionar dos nombres por alias (EMELI → ASHLEY) el
 * libro se queda con dos filas de la misma persona; si no se resuelve, el
 * cálculo actualiza una y deja la otra cobrando su importe viejo.
 * Gana la primera aparición (que es la del nombre ya canónico, por orden).
 */
export function dedupeLedgerRows(rows: readonly LedgerRowRef[]): LedgerDedupe {
  const byCanon = new Map<string, LedgerRowRef[]>()
  for (const r of rows) {
    const canon = canonicalCollaborator(r.provider)
    byCanon.set(canon, [...(byCanon.get(canon) || []), r])
  }
  const keep = new Map<string, string>()
  const duplicates: string[] = []
  for (const [canon, group] of byCanon) {
    // Gana la fila que YA se llama como el nombre canónico; si ninguna, la primera.
    const winner = group.find((r) => canonicalCollaborator(r.provider) === r.provider.trim().toUpperCase()) || group[0]
    keep.set(canon, winner.id)
    for (const r of group) if (r.id !== winner.id) duplicates.push(r.id)
  }
  return { keep, duplicates }
}
