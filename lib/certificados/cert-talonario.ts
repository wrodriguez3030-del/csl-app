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
  displayText,
  formatSpanishDateUpper,
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

export const defaultTalonarioCalibration: TalonarioCalibration = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  fontScale: 1,
}

// Auto-fit (por conteo de caracteres) en unidades de la tarjeta física.
type Tier = { max: number; size: number }
const FIT: Record<string, Tier[]> = {
  otorgadoA: [{ max: 24, size: 27 }, { max: 32, size: 23 }, { max: Infinity, size: 20 }],
  cortesiaDe: [{ max: 24, size: 24 }, { max: 32, size: 21 }, { max: Infinity, size: 18 }],
  validoPara: [{ max: 30, size: 22 }, { max: 45, size: 19 }, { max: Infinity, size: 16 }],
  sucursal: [{ max: 35, size: 20 }, { max: Infinity, size: 17 }],
}
function fit(field: string, text: string): number {
  const len = displayText(text).length
  for (const t of FIT[field]) if (len <= t.max) return t.size
  return FIT[field][FIT[field].length - 1].size
}

const LABEL_SIZE = 13
const CX = TALON_CARD.w / 2
const FIELD_WIDTH = 760

function esc(v: string): string {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Bloque etiqueta + valor(es), centrado en la tarjeta. `fs` = factor de tamaño. */
function block(labelY: number, valueY: number, label: string, lines: string[], size: number, color: string, fs: number): string {
  const parts = [
    `<text x="${CX}" y="${labelY}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="500" font-size="${(LABEL_SIZE * fs).toFixed(1)}" letter-spacing="1.6" fill="${BRAND.grisSecundario}">${esc(label)}</text>`,
  ]
  const vSize = size * fs
  lines.forEach((line, i) => {
    parts.push(
      `<text x="${CX}" y="${valueY + i * (vSize + 3)}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="600" font-size="${vSize.toFixed(1)}" letter-spacing="0.5" fill="${color}">${esc(line)}</text>`,
    )
  })
  return parts.join("")
}

export interface TalonarioAssets {
  embedFonts?: boolean
  montserratB64?: string
}

/**
 * SVG con SOLO los campos (fondo transparente), listo para superponer sobre el
 * talonario pre-impreso o para imprimir directamente sobre él.
 */
export function renderTalonarioSvg(
  data: GiftCertData,
  cal: TalonarioCalibration = defaultTalonarioCalibration,
  assets: TalonarioAssets = {},
): string {
  const { w, h } = TALON_CARD

  const oSize = fit("otorgadoA", data.otorgadoA)
  const cSize = fit("cortesiaDe", data.cortesiaDe)
  const vSize = fit("validoPara", data.validoPara)
  const sSize = fit("sucursal", data.sucursal)

  const fs = cal.fontScale || 1
  // Posiciones (área en blanco bajo el título pre-impreso "Certificado de Regalo").
  const fields = [
    block(348, 378, LABELS.otorgadoA, wrapText(data.otorgadoA, oSize, 1, FIELD_WIDTH), oSize, BRAND.grisOscuro, fs),
    block(404, 433, LABELS.cortesiaDe, wrapText(data.cortesiaDe, cSize, 1, FIELD_WIDTH), cSize, BRAND.grisOscuro, fs),
    block(460, 488, LABELS.validoPara, wrapText(data.validoPara, vSize, 2, FIELD_WIDTH), vSize, BRAND.grisOscuro, fs),
    block(520, 549, LABELS.validoHasta, [formatSpanishDateUpper(data.validoHasta)], 19, BRAND.grisOscuro, fs),
    block(576, 604, LABELS.sucursal, wrapText(data.sucursal, sSize, 2, FIELD_WIDTH), sSize, BRAND.turquesa, fs),
  ].join("")

  let fontFace = ""
  if (assets.embedFonts && assets.montserratB64) {
    fontFace = `<style>@font-face{font-family:'${FONT_MONT}';src:url(data:font/ttf;base64,${assets.montserratB64}) format('truetype');font-weight:100 900;}</style>`
  }

  // La calibración desplaza/escala TODO el bloque de campos (para alinear al papel).
  const t = `translate(${cal.offsetX} ${cal.offsetY}) scale(${cal.scale})`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Campos del certificado">
${fontFace}
<g transform="${t}">${fields}</g>
</svg>`
}
