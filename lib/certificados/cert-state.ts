/**
 * CF PARA IMPRIMIR · Máquina de estados del certificado de regalo.
 *
 * PURA e ISOMÓRFICA: la usan el backend (fuente de verdad, §15/§23) y la UI
 * (para mostrar/ocultar botones). El backend NUNCA confía en el estado que
 * manda el cliente: revalida aquí antes de escribir.
 */
import type { GiftCertEstado } from "./cert-layout"

export type GiftCertAction =
  | "editar"
  | "emitir"
  | "entregar"
  | "canjear"
  | "anular"
  | "duplicar"

/** ¿El certificado está vencido? (solo aplica a Emitido/Entregado). */
export function isExpired(validoHasta: string | null | undefined, today: string): boolean {
  if (!validoHasta) return false
  return String(validoHasta) < String(today)
}

/**
 * Estado EFECTIVO para mostrar: si un Emitido/Entregado ya pasó su fecha de
 * vencimiento, se muestra como "Vencido" (calculado, no se persiste solo).
 */
export function effectiveEstado(
  estado: GiftCertEstado | string,
  validoHasta: string | null | undefined,
  today: string,
): GiftCertEstado {
  const e = String(estado) as GiftCertEstado
  if ((e === "Emitido" || e === "Entregado") && isExpired(validoHasta, today)) return "Vencido"
  return e
}

const TERMINAL: ReadonlySet<string> = new Set(["Canjeado", "Anulado"])

/**
 * ¿Se permite la acción sobre un certificado en `estado`, considerando su
 * vencimiento? `today` en ISO (YYYY-MM-DD). Devuelve motivo del bloqueo o null.
 */
export function transitionError(
  action: GiftCertAction,
  estado: GiftCertEstado | string,
  validoHasta: string | null | undefined,
  today: string,
): string | null {
  const eff = effectiveEstado(estado, validoHasta, today)

  switch (action) {
    case "editar":
      // Solo los borradores se editan libremente. Emitido en adelante: bloqueado
      // (el código y los datos quedan congelados; §14/§15).
      return eff === "Borrador" ? null : "Solo se pueden editar certificados en borrador."
    case "emitir":
      return eff === "Borrador" ? null : "Solo se puede emitir un certificado en borrador."
    case "entregar":
      return eff === "Emitido" ? null : "Solo se puede marcar como entregado un certificado emitido."
    case "canjear":
      if (eff === "Canjeado") return "El certificado ya fue canjeado (no se permite doble canje)."
      if (eff === "Vencido") return "No se puede canjear un certificado vencido."
      if (eff === "Anulado") return "No se puede canjear un certificado anulado."
      if (eff === "Borrador") return "No se puede canjear un borrador; primero debe emitirse."
      // Canjeable desde Emitido o Entregado.
      return eff === "Emitido" || eff === "Entregado" ? null : "El certificado no está en un estado canjeable."
    case "anular":
      if (TERMINAL.has(eff)) return "No se puede anular un certificado ya canjeado o anulado."
      return null
    case "duplicar":
      // Duplicar como nuevo siempre es posible (crea otro registro en borrador).
      return null
    default:
      return "Acción no reconocida."
  }
}

export function canDo(
  action: GiftCertAction,
  estado: GiftCertEstado | string,
  validoHasta: string | null | undefined,
  today: string,
): boolean {
  return transitionError(action, estado, validoHasta, today) === null
}
