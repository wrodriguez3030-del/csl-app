export type CertificadoRegaloData = {
  codigo: string
  otorgadoA: string
  cortesiaDe: string
  validoPor: string
  fecha: string
  sucursal?: string
}

export type CertificadoRegaloTipo = "Digital" | "Para imprimir" | "Talonario pre-impreso"
export type CertificadoRegaloEstado = "Emitido" | "Canjeado" | "Anulado"

export type CertificadoRegaloEmitido = CertificadoRegaloData & {
  emitidoEn: string
  firma: string
  tipo: CertificadoRegaloTipo
  estado?: CertificadoRegaloEstado
  canjeadoEn?: string
  notasEstado?: string
}

/**
 * Clave del borrador local de certificados. **Va partida por negocio.**
 *
 * Antes era una sola clave para todos: al cambiar de negocio, la pantalla mezclaba
 * lo guardado en el navegador con lo del servidor y REENVIABA lo que no estuviera
 * allí (`saveCertificadoRegalo`), que lo estampa con el negocio ACTIVO. Es decir,
 * los certificados de una empresa se recreaban como de la otra, y entraban en su
 * talonario. Con la clave partida, lo local solo puede pertenecer a quien lo emitió.
 *
 * La clave antigua se deja intacta y sin leer: no se puede saber de qué negocio era
 * su contenido, así que atribuirlo sería repetir el mismo error.
 */
export const CERTIFICADOS_REGALO_STORAGE_KEY = "csl_certificados_regalo_emitidos_v1"

export function certificadosRegaloStorageKey(businessSlug: string | null | undefined): string {
  return `${CERTIFICADOS_REGALO_STORAGE_KEY}:${businessSlug || "sin-negocio"}`
}

export function normalizeCertificateText(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase()
}

export function createCertificateCode() {
  const date = new Date()
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("")
  const random = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `CSL-GC-${stamp}-${random}`
}

export function certificateSignature(data: CertificadoRegaloData) {
  const text = [
    data.codigo,
    normalizeCertificateText(data.otorgadoA),
    normalizeCertificateText(data.cortesiaDe),
    normalizeCertificateText(data.validoPor),
    data.fecha,
    "CIBAO-SPA-LASER",
  ].join("|")
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).toUpperCase()
}

export function certificateValidationUrl(origin: string, data: CertificadoRegaloData) {
  const params = new URLSearchParams({
    c: data.codigo,
    o: normalizeCertificateText(data.otorgadoA),
    d: normalizeCertificateText(data.cortesiaDe),
    v: normalizeCertificateText(data.validoPor),
    f: data.fecha,
    s: certificateSignature(data),
  })
  return `${origin}/certificado-regalo/validar?${params.toString()}`
}
