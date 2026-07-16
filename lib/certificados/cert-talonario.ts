/**
 * CF PARA IMPRIMIR · Overlay para TALONARIO PRE-IMPRESO.
 *
 * El papel del certificado YA trae impreso el fondo (lazo, logo, título
 * "Certificado de Regalo", cintas). Aquí solo se imprimen los CAMPOS variables
 * (etiquetas + valores) en el área en blanco inferior, para que caigan sobre el
 * papel pre-impreso. Fondo TRANSPARENTE (no se reimprime el diseño).
 *
 * Mismo modelo de datos y etiquetas EXACTAS que el módulo digital (reutiliza
 * cert-layout). Incluye calibración (desplazamiento/escala/tamaño de letra) para
 * ajustar a la impresora/tarjeta reales.
 */
import {
  BRAND,
  LABELS,
  INSTAGRAM_HANDLE,
  FACEBOOK_HANDLE,
  displayText,
  formatSpanishDateUpper,
  formatSpanishDate,
  wrapText,
  type GiftCertData,
} from "./cert-layout"

/** Tarjeta física ≈ 9.78 × 6.3 in → viewBox donde 100 uds = 1 in. */
export const TALON_CARD = { w: 978, h: 630 } as const

const FONT_MONT = "CFMont"

export interface TalonarioCalibration {
  offsetX: number
  offsetY: number
  scale: number
  fontScale: number
}

// Por defecto el talonario va desplazado para quedar CENTRADO bajo el título
// pre-impreso (el lazo empuja el logo/título a la derecha). Valores validados
// contra la impresión real. El certificado DIGITAL usa calibración cero (ZERO_CAL).
export const defaultTalonarioCalibration: TalonarioCalibration = {
  offsetX: 130,
  offsetY: -8,
  scale: 1,
  fontScale: 1,
}

const ZERO_CAL: TalonarioCalibration = { offsetX: 0, offsetY: 0, scale: 1, fontScale: 1 }

// Auto-fit (por conteo de caracteres) en unidades de la tarjeta física.
type Tier = { max: number; size: number }
const FIT: Record<string, Tier[]> = {
  otorgadoA: [{ max: 24, size: 21 }, { max: 32, size: 18 }, { max: Infinity, size: 16 }],
  cortesiaDe: [{ max: 24, size: 19 }, { max: 32, size: 17 }, { max: Infinity, size: 15 }],
  validoPara: [{ max: 30, size: 18 }, { max: 45, size: 16 }, { max: Infinity, size: 14 }],
  sucursal: [{ max: 35, size: 17 }, { max: Infinity, size: 14 }],
}
function fit(field: string, text: string): number {
  const len = displayText(text).length
  for (const t of FIT[field]) if (len <= t.max) return t.size
  return FIT[field][FIT[field].length - 1].size
}

const LABEL_SIZE = 11
const CX = TALON_CARD.w / 2
const FIELD_WIDTH = 760

function esc(v: string): string {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Bloque etiqueta + valor(es), centrado. `fs` = calibración; `labelSize` ya escalado. */
function block(labelY: number, valueY: number, label: string, lines: string[], size: number, color: string, fs: number, labelSize: number): string {
  const parts = [
    `<text x="${CX}" y="${labelY}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="500" font-size="${(labelSize * fs).toFixed(1)}" letter-spacing="${labelSize > 8 ? 1.6 : 1}" fill="${BRAND.grisSecundario}">${esc(label)}</text>`,
  ]
  const vSize = size * fs
  lines.forEach((line, i) => {
    parts.push(
      `<text x="${CX}" y="${valueY + i * (vSize + 3)}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="600" font-size="${vSize.toFixed(1)}" letter-spacing="0.5" fill="${color}">${esc(line)}</text>`,
    )
  })
  return parts.join("")
}

// Posición/tamaño del QR según formato: digital (grande) o talonario (mitad).
type QrSpec = { x: number; y: number; size: number; code: number }
const QR_FULL: QrSpec = { x: 806, y: 452, size: 120, code: 12 }
// Talonario: QR alejado del borde derecho (margen amplio) para que al calibrar
// horizontalmente no se salga; movido 2 cm a la izquierda respecto al borde.
const QR_COMPACT: QrSpec = { x: 713, y: 456, size: 60, code: 8 }

function qrBlock(qrDataUri: string, code: string, q: QrSpec): string {
  const parts = [
    // Recuadro blanco detrás del QR → legible aunque caiga sobre una cinta clara.
    `<rect x="${q.x - 5}" y="${q.y - 5}" width="${q.size + 10}" height="${q.size + 10}" rx="5" fill="#FFFFFF"/>`,
    `<image href="${qrDataUri}" x="${q.x}" y="${q.y}" width="${q.size}" height="${q.size}"/>`,
  ]
  if (code) {
    parts.push(
      `<text x="${q.x + q.size / 2}" y="${q.y + q.size + q.code + 2}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="500" font-size="${q.code}" letter-spacing="0.3" fill="${BRAND.grisSecundario}">${esc(code)}</text>`,
    )
  }
  return parts.join("")
}

// Íconos sociales (paths escala 0..24).
const IG_PATH =
  "M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.2 15.58 2.2 15.2 2.2 12s0-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.2 8.8 2.2 12 2.2Zm0 3.05A6.75 6.75 0 1 0 18.75 12 6.75 6.75 0 0 0 12 5.25Zm0 11.13A4.38 4.38 0 1 1 16.38 12 4.38 4.38 0 0 1 12 16.38Zm6.9-11.4a1.58 1.58 0 1 0 1.57 1.58 1.58 1.58 0 0 0-1.57-1.58Z"
const FB_PATH =
  "M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z"

/**
 * Pie del certificado: fecha de entrega (pequeña) + teléfono de la sucursal +
 * redes sociales (Instagram/Facebook @cibaospalaser con ícono).
 */
type FooterSpec = {
  y1: number; dateSize: number
  y2: number; socialSize: number; iconScale: number
  igX: number; igTx: number; fbX: number; fbTx: number
}
const FOOTER_FULL: FooterSpec = { y1: 552, dateSize: 10.5, y2: 578, socialSize: 11, iconScale: 0.5, igX: -168, igTx: -150, fbX: 18, fbTx: 36 }
const FOOTER_COMPACT: FooterSpec = { y1: 544, dateSize: 9.5, y2: 566, socialSize: 10, iconScale: 0.46, igX: -150, igTx: -133, fbX: 16, fbTx: 33 }

function footerBlock(data: GiftCertData, f: FooterSpec): string {
  const parts: string[] = []
  const dateStr = formatSpanishDate(data.fechaEmision)
  const phone = String(data.sucursalTelefono ?? "").trim()
  const line1 = `Fecha de entrega: ${dateStr}` + (phone ? `     ·     Tel. ${phone}` : "")
  parts.push(
    `<text x="${CX}" y="${f.y1}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="500" font-size="${f.dateSize}" letter-spacing="0.2" fill="${BRAND.grisSecundario}">${esc(line1)}</text>`,
  )
  const icon = (x: number, path: string) => `<g transform="translate(${x} ${f.y2 - f.socialSize * 0.75}) scale(${f.iconScale})"><path d="${path}" fill="${BRAND.turquesa}"/></g>`
  parts.push(icon(CX + f.igX, IG_PATH))
  parts.push(`<text x="${CX + f.igTx}" y="${f.y2}" font-family="${FONT_MONT}" font-weight="600" font-size="${f.socialSize}" fill="${BRAND.grisOscuro}">${esc(INSTAGRAM_HANDLE)}</text>`)
  parts.push(icon(CX + f.fbX, FB_PATH))
  parts.push(`<text x="${CX + f.fbTx}" y="${f.y2}" font-family="${FONT_MONT}" font-weight="600" font-size="${f.socialSize}" fill="${BRAND.grisOscuro}">${esc(FACEBOOK_HANDLE)}</text>`)
  return parts.join("")
}

// Formatos: digital (grande) y talonario compacto (~mitad). pos=[labelY, valueY].
type FmtSpec = { scale: number; pos: [number, number][]; vh: number; qr: QrSpec; footer: FooterSpec }
const FMT_FULL: FmtSpec = {
  scale: 1,
  pos: [[316, 340], [362, 386], [408, 432], [456, 478], [500, 523]],
  vh: 16, qr: QR_FULL, footer: FOOTER_FULL,
}
const FMT_COMPACT: FmtSpec = {
  scale: 0.73, // +40% respecto al compacto anterior (0.52)
  pos: [[322, 341], [364, 383], [406, 425], [448, 467], [490, 509]],
  vh: 12, qr: QR_COMPACT, footer: FOOTER_COMPACT,
}

export interface CertRenderOpts {
  /** Calibración (solo para impresión en talonario físico). */
  cal?: TalonarioCalibration
  /** QR (data:URI) de validación — se dibuja en la esquina derecha. */
  qrDataUri?: string
  /** Código legible bajo el QR. */
  code?: string
  /** true → incluye el arte oficial de fondo (certificado DIGITAL completo). */
  includeArt?: boolean
  /** data:URI o URL del arte de fondo. */
  artSrc?: string
  /** true → formato COMPACTO (~mitad) para imprimir sobre el talonario físico. */
  compact?: boolean
  embedFonts?: boolean
  montserratB64?: string
}

/**
 * Renderiza el certificado en el FORMATO ÚNICO oficial:
 *   · includeArt=false → SOLO campos + QR (para imprimir sobre el talonario físico).
 *   · includeArt=true  → arte oficial de fondo + campos + QR (certificado DIGITAL).
 * Ambos comparten las MISMAS posiciones → un solo formato consistente.
 */
export function renderCertificate(data: GiftCertData, opts: CertRenderOpts = {}): string {
  const { w, h } = TALON_CARD
  // Digital (sin cal) → cero; talonario pasa su propia calibración (default 130/-8).
  const cal = opts.cal ?? ZERO_CAL

  const F = opts.compact ? FMT_COMPACT : FMT_FULL
  const sc = F.scale
  const labelSize = LABEL_SIZE * sc
  // En el talonario, los 3 campos principales (Otorgado a, Cortesía de, Válido
  // para) van MÁS GRANDES que la fecha/sucursal → jerarquía visual.
  const boost = opts.compact ? 1.32 : 1
  const priLabel = labelSize * (opts.compact ? 1.2 : 1)
  const oSize = fit("otorgadoA", data.otorgadoA) * sc * boost
  const cSize = fit("cortesiaDe", data.cortesiaDe) * sc * boost
  const vSize = fit("validoPara", data.validoPara) * sc * boost
  const sSize = fit("sucursal", data.sucursal) * sc
  const fs = cal.fontScale || 1

  // Bloque de campos centrado en el área en blanco, sin rozar las cintas.
  const fields = [
    block(F.pos[0][0], F.pos[0][1], LABELS.otorgadoA, wrapText(data.otorgadoA, oSize, 1, FIELD_WIDTH), oSize, BRAND.grisOscuro, fs, priLabel),
    block(F.pos[1][0], F.pos[1][1], LABELS.cortesiaDe, wrapText(data.cortesiaDe, cSize, 1, FIELD_WIDTH), cSize, BRAND.grisOscuro, fs, priLabel),
    block(F.pos[2][0], F.pos[2][1], LABELS.validoPara, wrapText(data.validoPara, vSize, 2, FIELD_WIDTH), vSize, BRAND.grisOscuro, fs, priLabel),
    block(F.pos[3][0], F.pos[3][1], LABELS.validoHasta, [data.validoHasta ? formatSpanishDateUpper(data.validoHasta) : "NO VENCE"], F.vh, BRAND.grisOscuro, fs, labelSize),
    block(F.pos[4][0], F.pos[4][1], LABELS.sucursal, wrapText(data.sucursal, sSize, 2, FIELD_WIDTH), sSize, BRAND.turquesa, fs, labelSize),
  ].join("")

  const footer = footerBlock(data, F.footer)
  const qr = opts.qrDataUri ? qrBlock(opts.qrDataUri, opts.code || "", F.qr) : ""

  let fontFace = ""
  if (opts.embedFonts && opts.montserratB64) {
    fontFace = `<style>@font-face{font-family:'${FONT_MONT}';src:url(data:font/ttf;base64,${opts.montserratB64}) format('truetype');font-weight:100 900;}</style>`
  }

  const art = opts.includeArt && opts.artSrc
    ? `<image href="${opts.artSrc}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    : ""

  // La calibración desplaza/escala campos + QR (para alinear al papel físico).
  const t = `translate(${cal.offsetX} ${cal.offsetY}) scale(${cal.scale})`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Certificado de regalo">
${fontFace}
${art}
<g transform="${t}">${fields}${footer}${qr}</g>
</svg>`
}

export interface TalonarioAssets {
  embedFonts?: boolean
  montserratB64?: string
  qrDataUri?: string
  code?: string
}

/** SOLO campos + QR (fondo transparente) para imprimir sobre el talonario físico. */
export function renderTalonarioSvg(
  data: GiftCertData,
  cal: TalonarioCalibration = defaultTalonarioCalibration,
  assets: TalonarioAssets = {},
): string {
  return renderCertificate(data, {
    cal,
    qrDataUri: assets.qrDataUri,
    code: assets.code,
    includeArt: false,
    compact: true,
    embedFonts: assets.embedFonts,
    montserratB64: assets.montserratB64,
  })
}

/** Ruta pública del arte oficial del certificado (fondo del formato digital). */
export const CERT_ART_SRC = "/certificados/talonario-preimpreso.jpg"
