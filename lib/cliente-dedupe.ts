/**
 * Detección de clientes duplicados — fuente única usada por cualquier
 * pantalla que cree o edite un cliente (Clientes, modal Generar link,
 * captura manual).
 *
 * Reglas:
 *   - Comparación tolerante a guiones/espacios para teléfono y cédula
 *     (siempre vía `digitsOnly`).
 *   - Comparación tolerante a mayúsculas/acentos para nombre.
 *   - Multi-tenant: el caller pasa la lista ya filtrada por business_id
 *     (el backend la entrega así vía AsyncLocalStorage). Este helper
 *     no consulta tenant directamente — confía en que la lista que
 *     recibe ya es del negocio actual.
 *   - En edición se debe pasar el `currentClienteId` para excluirlo de
 *     la búsqueda (un cliente no es duplicado de sí mismo).
 */

import { digitsOnly } from "@/lib/formatters"
import type { ClienteCosmiatria } from "@/lib/types"

export type DuplicateMatchType = "telefono" | "documento" | "nombre"

export interface DuplicateMatch {
  cliente: ClienteCosmiatria
  matchType: DuplicateMatchType
  /** Mensaje listo para mostrar al usuario. */
  message: string
}

export interface ClienteDedupeInput {
  ClienteID?: string
  Nombre?: string
  Apellido?: string
  Telefono?: string
  DocumentoIdentidad?: string
}

/**
 * Normalización para comparación de nombre completo.
 *   - lowercase
 *   - strip de acentos (NFD + replace combining marks)
 *   - colapsa espacios múltiples
 *   - trim
 */
export function normalizeClientName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Nombre completo de un cliente (Nombre + Apellido) normalizado. */
function fullNameKey(value: { Nombre?: string; Apellido?: string }) {
  return normalizeClientName(`${value.Nombre || ""} ${value.Apellido || ""}`)
}

/**
 * Devuelve el primer cliente que coincide con `input` por teléfono,
 * documento o nombre completo. Excluye al propio cliente cuando se
 * pasa `currentClienteId` (caso edición).
 *
 * Prioridad de match: telefono > documento > nombre.
 * Si quieres todos los matches, usa `findAllExistingClienteMatches`.
 */
export function findExistingClienteMatch(
  input: ClienteDedupeInput,
  clientes: ClienteCosmiatria[],
  currentClienteId?: string,
): DuplicateMatch | null {
  const phoneKey = digitsOnly(input.Telefono)
  const docRaw = String(input.DocumentoIdentidad || "").trim()
  const docHasLetters = /[A-Za-z]/.test(docRaw)
  const docKey = docHasLetters ? docRaw.toUpperCase().replace(/\s+/g, " ") : digitsOnly(docRaw)
  const nameKey = fullNameKey(input)

  // Pasos: primero buscar telefono/documento (bloqueo duro), luego nombre.
  for (const cliente of clientes) {
    if (currentClienteId && cliente.ClienteID === currentClienteId) continue
    const cPhone = digitsOnly(cliente.Telefono)
    if (phoneKey && cPhone && cPhone === phoneKey) {
      return {
        cliente,
        matchType: "telefono",
        message: "Este cliente ya existe en el sistema (mismo teléfono).",
      }
    }
  }
  for (const cliente of clientes) {
    if (currentClienteId && cliente.ClienteID === currentClienteId) continue
    const cDocRaw = String(cliente.DocumentoIdentidad || "").trim()
    if (!cDocRaw) continue
    const cDocKey = /[A-Za-z]/.test(cDocRaw)
      ? cDocRaw.toUpperCase().replace(/\s+/g, " ")
      : digitsOnly(cDocRaw)
    if (docKey && cDocKey === docKey) {
      return {
        cliente,
        matchType: "documento",
        message: "Este cliente ya existe en el sistema (mismo documento).",
      }
    }
  }
  for (const cliente of clientes) {
    if (currentClienteId && cliente.ClienteID === currentClienteId) continue
    const cName = fullNameKey(cliente)
    if (nameKey && cName === nameKey) {
      return {
        cliente,
        matchType: "nombre",
        message: "Este cliente ya existe en el sistema (mismo nombre).",
      }
    }
  }
  return null
}

/** Versión que devuelve todos los matches (útil para diagnóstico). */
export function findAllExistingClienteMatches(
  input: ClienteDedupeInput,
  clientes: ClienteCosmiatria[],
  currentClienteId?: string,
): DuplicateMatch[] {
  const results: DuplicateMatch[] = []
  const seen = new Set<string>()
  const append = (match: DuplicateMatch | null) => {
    if (match && !seen.has(match.cliente.ClienteID)) {
      seen.add(match.cliente.ClienteID)
      results.push(match)
    }
  }
  const phoneKey = digitsOnly(input.Telefono)
  const docRaw = String(input.DocumentoIdentidad || "").trim()
  const docHasLetters = /[A-Za-z]/.test(docRaw)
  const docKey = docHasLetters ? docRaw.toUpperCase().replace(/\s+/g, " ") : digitsOnly(docRaw)
  const nameKey = fullNameKey(input)

  for (const cliente of clientes) {
    if (currentClienteId && cliente.ClienteID === currentClienteId) continue
    if (phoneKey && digitsOnly(cliente.Telefono) === phoneKey) {
      append({ cliente, matchType: "telefono", message: "Este cliente ya existe en el sistema (mismo teléfono)." })
    }
  }
  for (const cliente of clientes) {
    if (currentClienteId && cliente.ClienteID === currentClienteId) continue
    const cDocRaw = String(cliente.DocumentoIdentidad || "").trim()
    if (!cDocRaw) continue
    const cDocKey = /[A-Za-z]/.test(cDocRaw)
      ? cDocRaw.toUpperCase().replace(/\s+/g, " ")
      : digitsOnly(cDocRaw)
    if (docKey && cDocKey === docKey) {
      append({ cliente, matchType: "documento", message: "Este cliente ya existe en el sistema (mismo documento)." })
    }
  }
  for (const cliente of clientes) {
    if (currentClienteId && cliente.ClienteID === currentClienteId) continue
    if (nameKey && fullNameKey(cliente) === nameKey) {
      append({ cliente, matchType: "nombre", message: "Este cliente ya existe en el sistema (mismo nombre)." })
    }
  }
  return results
}
