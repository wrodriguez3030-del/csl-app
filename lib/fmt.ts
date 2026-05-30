/**
 * Utilidades de formato numérico centralizadas.
 *
 * fmtN  — formatea con separador de miles en comas (en-US). Ej: 3686650 → "3,686,650"
 * parseN — convierte texto con/sin comas a número limpio. Ej: "3,686,650" → 3686650
 *
 * Usar en todos los campos de pulsos, lecturas, disparos y cantidades grandes.
 * No usar toLocaleString("es-DO") — ese formato usa puntos y falla en algunos
 * navegadores Windows donde el locale no está disponible.
 */

export function fmtN(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0"
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""))
  return isNaN(n) ? "0" : n.toLocaleString("en-US")
}

/** Parsea un string con o sin comas/puntos de miles a número entero limpio. */
export function parseN(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0
  if (typeof value === "number") return isNaN(value) ? 0 : value
  return Number(String(value).replace(/[^0-9.-]/g, "")) || 0
}
