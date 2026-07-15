/**
 * CF PARA IMPRIMIR · Renderizador SVG del certificado de regalo.
 *
 * ISOMÓRFICO: produce una cadena SVG a partir del modelo puro (cert-layout).
 * El MISMO SVG se usa para:
 *   · previsualización en el DOM (assets por URL, fuentes vía @font-face global)
 *   · exportación PNG/JPG/PDF (assets embebidos en base64 → SVG autocontenido,
 *     sin recursos externos → el canvas no se "contamina" al rasterizar)
 *   · impresión (vector, nitidez máxima)
 *
 * Tres diseños (moderno / minimalista / premium) comparten posiciones y datos;
 * solo cambian fondo, bordes, ornamentos y acentos de color.
 */
import {
  BRAND,
  CANVAS,
  buildCertificateModel,
  type FieldModel,
  type GiftCertData,
  type GiftTemplateId,
} from "./cert-layout"

export interface CertAssets {
  /** base64 puro (sin prefijo data:) de Montserrat — solo para export embebido. */
  montserratB64?: string
  /** base64 puro de Allura — solo para export embebido. */
  alluraB64?: string
  /** data:URI (export) o URL pública (preview) del logo. */
  logoSrc?: string
  /** data:URI del QR (siempre embebido; se genera local con `qrcode`). */
  qrDataUri?: string
  /** true → inyecta @font-face con las fuentes en base64 (export). */
  embedFonts?: boolean
}

const FONT_MONT = "CFMont"
const FONT_ALLURA = "CFAllura"

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

interface TemplateStyle {
  bg: string
  titleColor: string
  borderOuter: string
  borderInner: string | null
  accent: string
  gold: boolean
}

function templateStyle(id: GiftTemplateId): TemplateStyle {
  switch (id) {
    case "minimalista":
      return { bg: BRAND.blanco, titleColor: BRAND.grisOscuro, borderOuter: "#E3E6E8", borderInner: null, accent: BRAND.turquesa, gold: false }
    case "premium":
      return { bg: BRAND.marfil, titleColor: BRAND.grisOscuro, borderOuter: BRAND.dorado, borderInner: "#E7DCC2", accent: BRAND.turquesa, gold: true }
    case "moderno":
    default:
      return { bg: BRAND.blanco, titleColor: BRAND.turquesaOscuro, borderOuter: BRAND.turquesa, borderInner: null, accent: BRAND.turquesa, gold: false }
  }
}

/** Ornamentos de fondo/borde según el diseño. */
function decorations(id: GiftTemplateId, s: TemplateStyle): string {
  const { w, h } = CANVAS
  const parts: string[] = []
  // Fondo
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${s.bg}"/>`)

  if (id === "moderno") {
    // Cinta turquesa en esquina superior izquierda + borde turquesa redondeado.
    parts.push(`<path d="M0 0 L190 0 L0 190 Z" fill="${BRAND.turquesa}" opacity="0.14"/>`)
    parts.push(`<path d="M0 0 L120 0 L0 120 Z" fill="${BRAND.turquesa}"/>`)
    parts.push(`<rect x="22" y="22" width="${w - 44}" height="${h - 44}" rx="14" fill="none" stroke="${s.borderOuter}" stroke-width="3"/>`)
    parts.push(`<rect x="30" y="30" width="${w - 60}" height="${h - 60}" rx="10" fill="none" stroke="${s.borderOuter}" stroke-width="1" opacity="0.35"/>`)
  } else if (id === "minimalista") {
    // Marco hairline sobrio, sin adornos.
    parts.push(`<rect x="34" y="34" width="${w - 68}" height="${h - 68}" fill="none" stroke="${s.borderOuter}" stroke-width="1.5"/>`)
  } else {
    // premium: doble borde (dorado exterior + interior suave) + esquinas doradas.
    parts.push(`<rect x="20" y="20" width="${w - 40}" height="${h - 40}" fill="none" stroke="${s.borderOuter}" stroke-width="2.5"/>`)
    parts.push(`<rect x="30" y="30" width="${w - 60}" height="${h - 60}" fill="none" stroke="${s.borderInner || "#E7DCC2"}" stroke-width="1"/>`)
    const corner = (cx: number, cy: number, sx: number, sy: number) =>
      `<path d="M${cx} ${cy + sy * 34} L${cx} ${cy} L${cx + sx * 34} ${cy}" fill="none" stroke="${BRAND.dorado}" stroke-width="2.5"/>`
    parts.push(corner(40, 40, 1, 1))
    parts.push(corner(w - 40, 40, -1, 1))
    parts.push(corner(40, h - 40, 1, -1))
    parts.push(corner(w - 40, h - 40, -1, -1))
  }
  return parts.join("")
}

/** Divisor bajo el título. */
function divider(cx: number, y: number, s: TemplateStyle): string {
  const color = s.gold ? BRAND.dorado : s.accent
  return [
    `<line x1="${cx - 90}" y1="${y}" x2="${cx - 16}" y2="${y}" stroke="${color}" stroke-width="2"/>`,
    `<circle cx="${cx}" cy="${y}" r="4" fill="${color}"/>`,
    `<line x1="${cx + 16}" y1="${y}" x2="${cx + 90}" y2="${y}" stroke="${color}" stroke-width="2"/>`,
  ].join("")
}

/** Bloque etiqueta + valor(es) centrado. */
function fieldBlock(cx: number, labelY: number, valueY: number, f: FieldModel): string {
  const parts: string[] = []
  parts.push(
    `<text x="${cx}" y="${labelY}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="500" font-size="18" letter-spacing="2.5" fill="${BRAND.grisSecundario}">${esc(f.label)}</text>`,
  )
  f.lines.forEach((line, i) => {
    parts.push(
      `<text x="${cx}" y="${valueY + i * (f.size + 4)}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="600" font-size="${f.size}" letter-spacing="1" fill="${f.color}">${esc(line)}</text>`,
    )
  })
  return parts.join("")
}

// Íconos sociales (paths simplificados, escala 0..24).
const IG_PATH =
  "M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.2 15.58 2.2 15.2 2.2 12s0-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.2 8.8 2.2 12 2.2Zm0 3.05A6.75 6.75 0 1 0 18.75 12 6.75 6.75 0 0 0 12 5.25Zm0 11.13A4.38 4.38 0 1 1 16.38 12 4.38 4.38 0 0 1 12 16.38Zm6.9-11.4a1.58 1.58 0 1 0 1.57 1.58 1.58 1.58 0 0 0-1.57-1.58Z"
const FB_PATH =
  "M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z"

function footer(cx: number, y: number, model: ReturnType<typeof buildCertificateModel>["footer"], accent: string): string {
  // Línea 1: teléfono · dirección (los que existan). Línea 2: IG · FB con íconos.
  const parts: string[] = []
  const line1 = [model.telefono, model.direccion].filter(Boolean).join("   ·   ")
  if (line1) {
    parts.push(
      `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="500" font-size="15" letter-spacing="0.5" fill="${BRAND.grisSecundario}">${esc(line1)}</text>`,
    )
  }
  const y2 = line1 ? y + 24 : y
  // Íconos + handles centrados: calculamos posiciones alrededor del centro.
  const icon = (x: number, path: string) =>
    `<g transform="translate(${x} ${y2 - 13}) scale(0.66)"><path d="${path}" fill="${accent}"/></g>`
  const igTextX = cx - 150
  const fbTextX = cx + 40
  parts.push(icon(cx - 176, IG_PATH))
  parts.push(
    `<text x="${igTextX}" y="${y2}" font-family="${FONT_MONT}" font-weight="600" font-size="15" fill="${BRAND.grisOscuro}">${esc(model.instagram)}</text>`,
  )
  parts.push(icon(cx + 14, FB_PATH))
  parts.push(
    `<text x="${fbTextX}" y="${y2}" font-family="${FONT_MONT}" font-weight="600" font-size="15" fill="${BRAND.grisOscuro}">${esc(model.facebook)}</text>`,
  )
  return parts.join("")
}

/** Renderiza el certificado completo como SVG. */
export function renderCertificateSvg(data: GiftCertData, assets: CertAssets = {}): string {
  const model = buildCertificateModel(data)
  const s = templateStyle(data.templateId)
  const { w, h } = CANVAS
  const cx = w / 2

  let fontFace = ""
  if (assets.embedFonts && assets.montserratB64 && assets.alluraB64) {
    fontFace = `<style>
      @font-face{font-family:'${FONT_MONT}';src:url(data:font/ttf;base64,${assets.montserratB64}) format('truetype');font-weight:100 900;}
      @font-face{font-family:'${FONT_ALLURA}';src:url(data:font/ttf;base64,${assets.alluraB64}) format('truetype');}
    </style>`
  }

  const logo = assets.logoSrc
    ? `<image href="${esc(assets.logoSrc)}" x="${cx - 78}" y="40" width="156" height="88" preserveAspectRatio="xMidYMid meet"/>`
    : ""

  // Título manuscrito + firma de marca.
  const title = `<text x="${cx}" y="200" text-anchor="middle" font-family="${FONT_ALLURA}" font-size="66" fill="${s.titleColor}">Certificado de Regalo</text>`
  const brandLine = `<text x="${cx}" y="224" text-anchor="middle" font-family="${FONT_MONT}" font-weight="600" font-size="14" letter-spacing="5" fill="${s.accent}">CIBAO SPA LÁSER</text>`

  // Campos (posiciones fijas; los que envuelven usan tamaño menor y caben en su ranura).
  const f = model.fields
  const fields = [
    fieldBlock(cx, 280, 318, f.otorgadoA),
    fieldBlock(cx, 364, 402, f.cortesiaDe),
    fieldBlock(cx, 448, 486, f.validoPara),
    fieldBlock(cx, 540, 578, f.validoHasta),
    fieldBlock(cx, 616, 654, f.sucursal),
  ].join("")

  // QR + código (discretos, esquina inferior derecha, sin tapar el pie centrado).
  const qr = assets.qrDataUri
    ? `<image href="${esc(assets.qrDataUri)}" x="${w - 104}" y="${h - 150}" width="66" height="66"/>`
    : ""
  const code = `<text x="${w - 71}" y="${h - 60}" text-anchor="middle" font-family="${FONT_MONT}" font-weight="500" font-size="11" letter-spacing="0.5" fill="${BRAND.grisSecundario}">${esc(model.codigo)}</text>`

  const foot = footer(cx, h - 74, model.footer, s.accent)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Certificado de regalo Cibao Spa Láser">
${fontFace}
${decorations(data.templateId, s)}
${logo}
${title}
${brandLine}
${divider(cx, 244, s)}
${fields}
${qr}
${code}
${foot}
</svg>`
}
