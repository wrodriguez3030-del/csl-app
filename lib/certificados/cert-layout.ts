/**
 * CF PARA IMPRIMIR · Núcleo de layout del certificado de regalo.
 *
 * Módulo PURO e ISOMÓRFICO (sin DOM, sin fuentes, sin red): es la ÚNICA fuente
 * de verdad de posiciones, tamaños y textos del certificado. Tanto la
 * previsualización (SVG en el DOM) como las exportaciones (PNG/JPG/PDF) y la
 * impresión consumen este mismo modelo → "lo que ves es lo que sale".
 *
 * Testeable en Node (ver scripts/test-gift-certificates.mjs).
 */

// ── Tipos ───────────────────────────────────────────────────────────────────
export type GiftTemplateId = "moderno" | "minimalista" | "premium"

export type GiftCertEstado =
  | "Borrador"
  | "Emitido"
  | "Entregado"
  | "Canjeado"
  | "Vencido"
  | "Anulado"

export const GIFT_TEMPLATES: { id: GiftTemplateId; nombre: string; descripcion: string }[] = [
  { id: "moderno", nombre: "Moderno turquesa", descripcion: "Cinta turquesa, título manuscrito, elegante." },
  { id: "minimalista", nombre: "Minimalista", descripcion: "Líneas limpias, detalles turquesa discretos." },
  { id: "premium", nombre: "Premium", descripcion: "Fondo marfil, detalles dorados, apariencia premium." },
]

export const GIFT_ESTADOS: GiftCertEstado[] = [
  "Borrador",
  "Emitido",
  "Entregado",
  "Canjeado",
  "Vencido",
  "Anulado",
]

/** Datos que el formulario/registro entrega al render. */
export interface GiftCertData {
  codigo: string
  otorgadoA: string
  cortesiaDe: string
  /** "Válido para" (servicio). La etiqueta SIEMPRE es "VÁLIDO PARA:", nunca "VÁLIDO POR". */
  validoPara: string
  /** Fecha de vencimiento (ISO YYYY-MM-DD). */
  validoHasta: string
  /** Fecha de emisión (ISO YYYY-MM-DD). */
  fechaEmision: string
  sucursal: string
  sucursalDireccion?: string
  sucursalTelefono?: string
  templateId: GiftTemplateId
}

// ── Marca / constantes visuales ─────────────────────────────────────────────
export const BRAND = {
  grisOscuro: "#33383D",
  grisSecundario: "#62686D",
  turquesa: "#18AEB8",
  turquesaOscuro: "#0E8A93",
  blanco: "#FFFFFF",
  marfil: "#FBF9F4",
  dorado: "#C9A24B",
} as const

export const INSTAGRAM_HANDLE = "@cibaospalaser"
export const FACEBOOK_HANDLE = "@cibaospalaser"

/** Lienzo de diseño (unidades abstractas). El export escala este viewBox. */
export const CANVAS = { w: 960, h: 800 } as const

// Ancho útil de los campos centrados (para estimar el ajuste a 2 líneas).
// Se mantiene < columna del QR (der.) para que el texto largo no lo tape.
const FIELD_WIDTH = 720

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

// ── Normalización de texto ──────────────────────────────────────────────────
/**
 * Limpia (trim + colapsa espacios) y MAYÚSCULAS para mostrar. `toUpperCase()`
 * de JS conserva acentos y Ñ (É, Á, Ñ…). El dato original NO se altera aquí:
 * esta transformación es solo para pintar el certificado.
 */
export function displayText(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase()
}

/** Fecha ISO → "14 DE AGOSTO DE 2026" (español, mayúsculas). Vacío si inválida. */
export function formatSpanishDateUpper(iso: string | null | undefined): string {
  if (!iso) return ""
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getDate()} DE ${MESES[date.getMonth()]} DE ${date.getFullYear()}`.toUpperCase()
}

/** Fecha ISO → "14 de agosto de 2026" (español, minúsculas — para el pie). */
export function formatSpanishDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getDate()} de ${MESES[date.getMonth()]} de ${date.getFullYear()}`
}

/**
 * Código corto de 4 dígitos para CONFIRMAR el certificado (se imprime bajo el QR
 * y se codifica en el QR). Derivado (hash estable) de los datos del certificado
 * → mismo dato = mismo código; se ve en la vista sin necesidad de guardar.
 */
export function confirmCode4(data: {
  otorgadoA?: string; cortesiaDe?: string; validoPara?: string; validoHasta?: string; fechaEmision?: string
}): string {
  const text = [data.otorgadoA, data.cortesiaDe, data.validoPara, data.validoHasta, data.fechaEmision]
    .map((v) => displayText(v || "")).join("|")
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return String((hash >>> 0) % 10000).padStart(4, "0")
}

/** Prefijo de sucursal para el código: RV (Rafael Vidal), JAR (Los Jardines), VO (Villa Olga). */
export function branchPrefix(sucursal?: string): string {
  const s = displayText(sucursal || "")
  if (s.includes("RAFAEL VIDAL") || s === "RV") return "RV"
  if (s.includes("JARDINES") || s === "JAR") return "JAR"
  if (s.includes("VILLA OLGA") || s === "VO") return "VO"
  return ""
}

/** Código de confirmación completo: prefijo de sucursal + 4 dígitos (ej. "RV-0024"). */
export function giftConfirmCode(data: {
  otorgadoA?: string; cortesiaDe?: string; validoPara?: string; validoHasta?: string; fechaEmision?: string; sucursal?: string
}): string {
  const pfx = branchPrefix(data.sucursal)
  const num = confirmCode4(data)
  return pfx ? `${pfx}-${num}` : num
}

// ── Ajuste automático de tamaño (por conteo de caracteres, §9 del spec) ──────
type Tier = { max: number; size: number }

function pickSize(len: number, tiers: Tier[]): number {
  for (const t of tiers) if (len <= t.max) return t.size
  return tiers[tiers.length - 1].size
}

// Tamaños en unidades de diseño (calibrados sobre las razones del spec).
const FIT = {
  otorgadoA: [{ max: 24, size: 46 }, { max: 32, size: 40 }, { max: Infinity, size: 34 }],
  cortesiaDe: [{ max: 24, size: 40 }, { max: 32, size: 35 }, { max: Infinity, size: 30 }],
  validoPara: [{ max: 30, size: 37 }, { max: 45, size: 32 }, { max: Infinity, size: 27 }],
  sucursal: [{ max: 35, size: 33 }, { max: Infinity, size: 29 }],
} as const

/** Tamaño de fuente (unidades) para un valor de campo según su longitud. */
export function autoFitSize(field: keyof typeof FIT, text: string): number {
  return pickSize(displayText(text).length, FIT[field] as unknown as Tier[])
}

/**
 * Parte un texto en HASTA `maxLines` líneas por palabras, estimando el ancho
 * con el ancho medio de glifo de Montserrat SemiBold (~0.58·size). Determinista
 * → idéntico en preview y export. Solo se permite envolver en "Válido para" y
 * "Sucursal de entrega"; los nombres se mantienen en una sola línea.
 */
export function wrapText(text: string, size: number, maxLines = 1, fieldWidth = FIELD_WIDTH): string[] {
  const clean = displayText(text)
  if (maxLines <= 1) return [clean]
  const maxChars = Math.max(1, Math.floor(fieldWidth / (size * 0.58)))
  if (clean.length <= maxChars) return [clean]
  const words = clean.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      lines.push(current)
      current = word
      if (lines.length === maxLines - 1) break
    } else {
      current = candidate
    }
  }
  // Lo que reste (incluida la palabra en curso) va en la última línea.
  const consumed = lines.join(" ")
  const rest = clean.slice(consumed ? consumed.length + 1 : 0).trim()
  if (rest) lines.push(rest)
  return lines.slice(0, maxLines)
}

// ── Pie (teléfono · dirección · IG · FB) ────────────────────────────────────
export interface FooterModel {
  telefono: string
  direccion: string
  instagram: string
  facebook: string
}

export function buildFooter(data: GiftCertData): FooterModel {
  return {
    telefono: String(data.sucursalTelefono ?? "").trim(),
    direccion: String(data.sucursalDireccion ?? "").trim(),
    instagram: INSTAGRAM_HANDLE,
    facebook: FACEBOOK_HANDLE,
  }
}

// ── Modelo de layout completo ───────────────────────────────────────────────
export interface FieldModel {
  label: string
  size: number
  lines: string[]
  color: string
}

export interface CertificateModel {
  templateId: GiftTemplateId
  codigo: string
  fields: {
    otorgadoA: FieldModel
    cortesiaDe: FieldModel
    validoPara: FieldModel
    validoHasta: FieldModel
    sucursal: FieldModel
  }
  footer: FooterModel
}

/** Etiquetas EXACTAS (§6). La de servicio es "VÁLIDO PARA:", jamás "VÁLIDO POR:". */
export const LABELS = {
  otorgadoA: "OTORGADO A:",
  cortesiaDe: "CORTESÍA DE:",
  validoPara: "VÁLIDO PARA:",
  validoHasta: "VÁLIDO HASTA:",
  sucursal: "SUCURSAL DE ENTREGA:",
} as const

/** Construye el modelo pintable a partir de los datos. Núcleo puro y testeable. */
export function buildCertificateModel(data: GiftCertData): CertificateModel {
  const otorgadoSize = autoFitSize("otorgadoA", data.otorgadoA)
  const cortesiaSize = autoFitSize("cortesiaDe", data.cortesiaDe)
  const validoSize = autoFitSize("validoPara", data.validoPara)
  const sucursalSize = autoFitSize("sucursal", data.sucursal)

  return {
    templateId: data.templateId,
    codigo: displayText(data.codigo),
    fields: {
      otorgadoA: {
        label: LABELS.otorgadoA,
        size: otorgadoSize,
        lines: wrapText(data.otorgadoA, otorgadoSize, 1),
        color: BRAND.grisOscuro,
      },
      cortesiaDe: {
        label: LABELS.cortesiaDe,
        size: cortesiaSize,
        lines: wrapText(data.cortesiaDe, cortesiaSize, 1),
        color: BRAND.grisOscuro,
      },
      validoPara: {
        label: LABELS.validoPara,
        size: validoSize,
        lines: wrapText(data.validoPara, validoSize, 2),
        color: BRAND.grisOscuro,
      },
      validoHasta: {
        label: LABELS.validoHasta,
        size: 30,
        lines: [formatSpanishDateUpper(data.validoHasta)],
        color: BRAND.grisOscuro,
      },
      sucursal: {
        label: LABELS.sucursal,
        size: sucursalSize,
        lines: wrapText(data.sucursal, sucursalSize, 2),
        color: BRAND.turquesa,
      },
    },
    footer: buildFooter(data),
  }
}

// ── Validación (compartida frontend/backend) ────────────────────────────────
export interface GiftCertValidationInput {
  otorgadoA?: string
  cortesiaDe?: string
  validoPara?: string
  validoHasta?: string
  fechaEmision?: string
  sucursal?: string
}

/** Devuelve la lista de errores (vacía = válido). Reglas §5, §13, §23. */
export function validateGiftCert(input: GiftCertValidationInput): string[] {
  const errors: string[] = []
  const req = (v: string | undefined) => String(v ?? "").trim().length > 0
  if (!req(input.otorgadoA)) errors.push('El campo "Otorgado a" es obligatorio.')
  if (!req(input.cortesiaDe)) errors.push('El campo "Cortesía de" es obligatorio.')
  if (!req(input.validoPara)) errors.push('El campo "Válido para" es obligatorio.')
  if (!req(input.sucursal)) errors.push("La sucursal de entrega es obligatoria.")
  // "Válido hasta" es OPCIONAL (puede desactivarse → certificado sin vencimiento).
  // Solo se valida el orden de fechas cuando hay vencimiento.
  if (req(input.validoHasta) && req(input.fechaEmision)) {
    const venc = new Date(`${input.validoHasta}T12:00:00`)
    const emi = new Date(`${input.fechaEmision}T12:00:00`)
    if (!Number.isNaN(venc.getTime()) && !Number.isNaN(emi.getTime()) && venc < emi) {
      errors.push("La fecha de vencimiento no puede ser anterior a la fecha de emisión.")
    }
  }
  return errors
}

/** Suma días a una fecha ISO y devuelve ISO (para vigencia automática §13). */
export function addDaysIso(iso: string, days: number): string {
  const base = new Date(`${iso || new Date().toISOString().slice(0, 10)}T12:00:00`)
  if (Number.isNaN(base.getTime())) return ""
  base.setDate(base.getDate() + days)
  return base.toISOString().slice(0, 10)
}
