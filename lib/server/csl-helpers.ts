/**
 * Helpers genéricos para parseo y formato de valores.
 *
 * Usado por los handlers, transforms y builders del endpoint /api/csl.
 * Sin dependencias del SDK ni del runtime de Next.
 */

import type { ActionParams, Row } from "./csl-types"

// ---------- parsers de ActionParams ----------

export function textValue(params: ActionParams, key: string, fallback = "") {
  return String(params[key] ?? fallback)
}

export function numberValue(params: ActionParams, key: string, fallback = 0) {
  const value = Number(params[key] ?? fallback)
  return Number.isFinite(value) ? value : fallback
}

export function dateValue(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

export function parsePayload(params: ActionParams): Row {
  const raw = params.data
  if (typeof raw !== "string" || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Row) : {}
  } catch {
    return {}
  }
}

// ---------- parsers de Row ----------

export function textFrom(row: Row, key: string, fallback = "") {
  return String(row[key] ?? fallback)
}

export function numberFrom(row: Row, key: string, fallback = 0) {
  const value = Number(row[key] ?? fallback)
  return Number.isFinite(value) ? value : fallback
}

export function moneyNumber(value: unknown, fallback = 0) {
  const parsed = Number(String(value ?? fallback).replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function stringArrayFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export function parseJsonArray(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[]
  if (typeof value !== "string" || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as Row[]) : []
  } catch {
    return []
  }
}

export function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "")
}

// ---------- formatters de presentación ----------

export function formatPdfDate(value: unknown) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  const local = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (local) return `${local[1].padStart(2, "0")}/${local[2].padStart(2, "0")}/${local[3]}`
  return raw
}

export function formatCedula(value: unknown) {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`
}

export function formatPhone(value: unknown) {
  const digits = onlyDigits(value).slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

export function formatMoney(value: unknown) {
  const amount = moneyNumber(value)
  if (!amount) return String(value ?? "")
  return new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(amount)
}

export function formatHeightFeet(value: unknown) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  if (raw.includes("'") || /pie|ft/i.test(raw)) return raw
  const numeric = Number(raw.replace(/[^\d.]/g, ""))
  if (!Number.isFinite(numeric) || numeric <= 0) return raw
  if (numeric >= 100) {
    const totalInches = Math.round(numeric / 2.54)
    return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`
  }
  return `${raw} pies`
}

// ---------- escape para distintos formatos ----------

export function emailEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// ---------- error normalizado para clientes ----------

/**
 * Devuelve un mensaje de error amigable para el cliente.
 *
 * Detecta el caso "tabla faltante / cache de schema viejo" (PGRST205) y
 * sugiere el SQL correcto a aplicar según qué tabla menciona el mensaje
 * (consentimientos, certificados Depicenter, etc.). El frontend tiene su
 * propio `friendlyError()` que además interpreta este string para
 * mostrar banners sin filtrar tecnicismos al usuario.
 */
export function errorMessage(error: unknown, fallback = "Error desconocido") {
  // Detección unificada del caso PGRST205, venga como Error o como objeto
  const raw = error instanceof Error ? error.message : ""
  const obj = (error && typeof error === "object") ? (error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }) : null
  const objMsg = obj ? String(obj.message ?? "").trim() : ""
  const allText = `${raw} ${objMsg}`.toLowerCase()
  const looksMissing =
    String(obj?.code ?? "") === "PGRST205" ||
    /schema cache|could not find the table/i.test(`${raw} ${objMsg}`)

  if (looksMissing) {
    // Sugerencia específica según la tabla que el mensaje mencione
    if (/csl_certificados_depicenter/.test(allText)) {
      return "Falta crear la tabla en Supabase. Ejecuta `supabase/csl_certificados_depicenter.sql` en el SQL Editor y vuelve a intentar."
    }
    if (/csl_certificados_regalo/.test(allText)) {
      return "Falta crear la tabla en Supabase. Ejecuta `supabase/csl_certificados_regalo.sql` en el SQL Editor."
    }
    if (/csl_consent_/.test(allText)) {
      return "Falta crear la tabla en Supabase. Ejecuta `supabase/csl_consentimientos.sql` en el SQL Editor."
    }
    return "Falta crear o refrescar tablas en Supabase. Aplica los scripts SQL faltantes en el SQL Editor y vuelve a intentar."
  }

  if (error instanceof Error) return error.message
  if (obj) {
    const parts = [obj.message, obj.details, obj.hint]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
    if (parts.length) return parts.join(" | ")
    if (obj.code) return `Error Supabase: ${String(obj.code)}`
  }
  return fallback
}

// ---------- helpers de nombre ----------

export function nombrePartes(nombreCompleto: unknown) {
  const partes = String(nombreCompleto ?? "").trim().split(/\s+/).filter(Boolean)
  if (partes.length <= 1) return { nombre: partes[0] || "", apellido: "" }
  return {
    nombre: partes.slice(0, Math.ceil(partes.length / 2)).join(" "),
    apellido: partes.slice(Math.ceil(partes.length / 2)).join(" "),
  }
}
