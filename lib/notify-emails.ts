/**
 * Resolver de destinatarios de correo desde variables de entorno.
 *
 * Compatible con la lista hardcodeada legacy: si la env var no está definida,
 * cae al fallback que se usaba antes del refactor para que el comportamiento
 * en producción sea idéntico mientras no configures el env.
 *
 * Cómo lo configuras en Vercel (Settings → Environment Variables):
 *
 *   CSL_NOTIFY_EMAILS           → fallback común si no se define el específico
 *   CSL_NOTIFY_EMAILS_REPORTES  → reportes de mantenimiento
 *   CSL_NOTIFY_EMAILS_RRHH      → solicitudes de empleo aprobadas
 *   CSL_NOTIFY_EMAILS_FICHAS    → fichas dermatológicas
 *
 * Cada valor es una lista separada por comas, ej:
 *   "operaciones@cibao.com, soporte@cibao.com"
 */

type NotifyKind = "reportes" | "rrhh" | "fichas"

const LEGACY_FALLBACKS: Record<NotifyKind, readonly string[]> = {
  reportes: ["cibaospalaser@gmail.com", "cariascmad@gmail.com"],
  rrhh: ["cibaospalaser@gmail.com"],
  fichas: ["cibaospalaser@gmail.com"],
}

const ENV_PER_KIND: Record<NotifyKind, string> = {
  reportes: "CSL_NOTIFY_EMAILS_REPORTES",
  rrhh: "CSL_NOTIFY_EMAILS_RRHH",
  fichas: "CSL_NOTIFY_EMAILS_FICHAS",
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => EMAIL_RE.test(value))
}

/**
 * Devuelve la lista de destinatarios para el tipo dado.
 *
 * Orden de resolución:
 *   1. Env específico (`CSL_NOTIFY_EMAILS_<KIND>`)
 *   2. Env genérico  (`CSL_NOTIFY_EMAILS`)
 *   3. Fallback legacy (los hardcodeados originales)
 *
 * Se filtran emails inválidos y se deduplican preservando orden.
 */
export function getNotifyEmails(kind: NotifyKind): string[] {
  const fromKind = parseList(process.env[ENV_PER_KIND[kind]])
  if (fromKind.length) return dedupe(fromKind)

  const fromGeneric = parseList(process.env.CSL_NOTIFY_EMAILS)
  if (fromGeneric.length) return dedupe(fromGeneric)

  return [...LEGACY_FALLBACKS[kind]]
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}
