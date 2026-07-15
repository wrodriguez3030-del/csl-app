/**
 * CF PARA IMPRIMIR · Exportación del certificado (solo navegador).
 *
 * Genera PNG/JPG/PDF a partir del MISMO SVG que la previsualización, con las
 * fuentes y el logo embebidos en base64 → el SVG es autocontenido y el canvas
 * no se contamina al rasterizar (toBlob funciona). El PDF incrusta ese raster
 * de alta resolución para garantizar que "lo que ves es lo que sale".
 *
 * El QR se genera LOCALMENTE con el paquete `qrcode` (sin servicios externos).
 */
import QRCode from "qrcode"
import { PDFDocument } from "pdf-lib"
import { BRAND, type GiftCertData } from "./cert-layout"
import { renderCertificate, TALON_CARD, CERT_ART_SRC } from "./cert-talonario"

// Lienzo del certificado (tarjeta física ≈ 9.78×6.3 in).
const CANVAS = TALON_CARD

// ── Carga y cache de assets pesados (fuente + arte oficial) ─────────────────
let cachedAssets: { montserratB64: string; artDataUri: string } | null = null

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

async function fetchB64(url: string): Promise<string> {
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`No se pudo cargar ${url} (HTTP ${r.status})`)
    return r.arrayBuffer()
  })
  return bufToB64(buf)
}

/** Carga (una vez) la fuente y el arte oficial embebibles para exportación/impresión. */
export async function loadCertAssets(): Promise<NonNullable<typeof cachedAssets>> {
  if (cachedAssets) return cachedAssets
  const [montserratB64, artB64] = await Promise.all([
    fetchB64("/fonts/Montserrat.ttf"),
    fetchB64(CERT_ART_SRC),
  ])
  cachedAssets = {
    montserratB64,
    artDataUri: `data:image/jpeg;base64,${artB64}`,
  }
  return cachedAssets
}

/** QR (data:URI PNG) desde una URL de validación. Local, sin red externa. */
export async function makeQrDataUri(validationUrl: string): Promise<string> {
  if (!validationUrl) return ""
  return QRCode.toDataURL(validationUrl, {
    margin: 1,
    width: 240,
    color: { dark: BRAND.grisOscuro, light: "#FFFFFF" },
    errorCorrectionLevel: "M",
  })
}

/** SVG del certificado DIGITAL listo para EXPORTAR (arte + fuente + QR embebidos). */
export async function buildExportSvg(data: GiftCertData, qrDataUri: string): Promise<string> {
  const assets = await loadCertAssets()
  return renderCertificate(data, {
    includeArt: true,
    artSrc: assets.artDataUri,
    embedFonts: true,
    montserratB64: assets.montserratB64,
    qrDataUri,
    code: data.codigo,
  })
}

// ── Rasterizado ─────────────────────────────────────────────────────────────
function svgToImage(svg: string): Promise<HTMLImageElement> {
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("No se pudo rasterizar el certificado."))
    img.src = url
  })
}

/** Rasteriza el SVG a un Blob de imagen (PNG/JPG) a alta resolución. */
export async function rasterizeSvg(
  svg: string,
  { scale = 3, type = "image/png", quality = 0.95 }: { scale?: number; type?: "image/png" | "image/jpeg"; quality?: number } = {},
): Promise<Blob> {
  const img = await svgToImage(svg)
  if (typeof img.decode === "function") {
    try { await img.decode() } catch { /* algunos navegadores ya lo resolvieron en onload */ }
  }
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(CANVAS.w * scale)
  canvas.height = Math.round(CANVAS.h * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D no disponible.")
  // Fondo blanco opaco (JPG no soporta transparencia).
  ctx.fillStyle = "#FFFFFF"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen."))), type, quality)
  })
}

/** PDF de una página (horizontal) con el certificado raster de alta resolución. */
export async function svgToPdfBytes(svg: string): Promise<Uint8Array> {
  const pngBlob = await rasterizeSvg(svg, { scale: 3, type: "image/png" })
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())
  const pdf = await PDFDocument.create()
  // Página horizontal 720×540 pt (10×7.5 in), misma proporción 4:3 que el lienzo.
  const pageW = 720
  const pageH = (pageW * CANVAS.h) / CANVAS.w
  const page = pdf.addPage([pageW, pageH])
  const png = await pdf.embedPng(pngBytes)
  page.drawImage(png, { x: 0, y: 0, width: pageW, height: pageH })
  return pdf.save()
}

/**
 * Imprime el SVG (vector, nitidez máxima) en una ventana limpia: horizontal,
 * sin barras del sistema ni chrome del navegador, en una sola página.
 * Devuelve false si el navegador bloqueó la ventana emergente.
 */
export function printSvg(svg: string, title = "Certificado"): boolean {
  const w = window.open("", "_blank")
  if (!w) return false
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>@page{size:landscape;margin:0}html,body{margin:0;padding:0;background:#fff}svg{width:100vw;height:auto;display:block}</style>` +
      `</head><body>${svg}</body></html>`,
  )
  w.document.close()
  w.focus()
  window.setTimeout(() => w.print(), 500)
  return true
}

// ── Descargas ───────────────────────────────────────────────────────────────
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/pdf") {
  downloadBlob(new Blob([bytes as unknown as BlobPart], { type: mime }), filename)
}

/** Base de nombre de archivo segura a partir del certificado. */
export function certFilenameBase(data: GiftCertData): string {
  const name = String(data.otorgadoA || data.codigo).trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_").slice(0, 40)
  return `CF_${data.codigo}_${name || "certificado"}`
}
