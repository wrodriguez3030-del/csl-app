/**
 * Generación de PDFs server-side: reporte de servicio + solicitud de empleo.
 *
 * Implementación en dos capas:
 *   - "raw PDF" (objects + xref) para layouts simples.
 *   - `pdf-lib` para insertar la firma digital sobre el PDF generado.
 *
 * NB: el contenido textual se normaliza con `pdfText` (sin tildes ni
 * caracteres > U+007E) para evitar romper la fuente Helvetica estándar.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import {
  formatCedula,
  formatHeightFeet,
  formatMoney,
  formatPdfDate,
  formatPhone,
  parseJsonArray,
} from "./csl-helpers"
import type { Row } from "./csl-types"

export function pdfText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

export function wrapPdfLine(label: string, value: unknown, width = 96) {
  const text = `${label}: ${pdfText(value)}`
  const lines: string[] = []
  let current = text
  while (current.length > width) {
    const cut = current.lastIndexOf(" ", width)
    const index = cut > 24 ? cut : width
    lines.push(current.slice(0, index))
    current = `  ${current.slice(index).trim()}`
  }
  lines.push(current)
  return lines
}

function buildRawPdf(lines: string[]) {
  const pageSize = 48
  const chunks: string[][] = []
  for (let index = 0; index < lines.length; index += pageSize) chunks.push(lines.slice(index, index + pageSize))
  const objects: string[] = []
  objects.push("<< /Type /Catalog /Pages 2 0 R >>")
  const pageObjectIds = chunks.map((_, index) => 3 + index * 2)
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${chunks.length} >>`)
  chunks.forEach((chunk, index) => {
    const pageId = pageObjectIds[index]
    const contentId = pageId + 1
    const body = [
      "BT",
      "/F1 10 Tf",
      "50 760 Td",
      "14 TL",
      ...chunk.map((line) => `(${pdfEscape(line)}) Tj T*`),
      "ET",
    ].join("\n")
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentId} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(body, "ascii")} >>\nstream\n${body}\nendstream`)
  })

  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, "ascii")
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, "ascii")
}

export function buildReportePdf(row: Row) {
  const piezas = parseJsonArray(row.piezas_json)
  const lines = [
    "CIBAO SPA LASER - REPORTE DE SERVICIO",
    "------------------------------------------------------------",
    ...wrapPdfLine("Reporte", row.report_id),
    ...wrapPdfLine("Fecha", row.fecha),
    ...wrapPdfLine("Sucursal", row.sucursal),
    ...wrapPdfLine("Empresa", row.empresa || "CIBAO SPA LASER, CSL, S.R.L."),
    ...wrapPdfLine("Cliente", row.cliente),
    ...wrapPdfLine("Domicilio", row.domicilio),
    ...wrapPdfLine("Ciudad", row.ciudad),
    ...wrapPdfLine("Equipo ID", row.equipo_id),
    ...wrapPdfLine("Modelo", row.modelo),
    ...wrapPdfLine("Serie", row.serie),
    ...wrapPdfLine("Numero", row.numero),
    ...wrapPdfLine("Tipo de servicio", row.tipo),
    ...wrapPdfLine("Estado equipo", row.estado_equipo),
    ...wrapPdfLine("Prioridad", row.prioridad),
    ...wrapPdfLine("Pulsos cabeza", Number(row.p_cabeza || 0).toLocaleString("es-DO")),
    ...wrapPdfLine("Pulsos totales", Number(row.p_totales || 0).toLocaleString("es-DO")),
    ...wrapPdfLine("Tecnico / Atendio", row.atendio),
    "",
    "PROBLEMA OBSERVADO",
    ...wrapPdfLine("", row.problema),
    "",
    "CORRECCION REALIZADA",
    ...wrapPdfLine("", row.correccion),
    "",
    "CHECKLIST / PRUEBAS",
    ...wrapPdfLine("", row.checklist),
    "",
    "OBSERVACIONES",
    ...wrapPdfLine("", row.observaciones),
    "",
    "PIEZAS INTERVENIDAS",
    ...(piezas.length ? piezas.flatMap((pieza, index) => [
      `${index + 1}. ${pdfText(pieza.pieza || pieza.Pieza || "")}`,
      ...wrapPdfLine("   Categoria", pieza.categoria || pieza.Categoria),
      ...wrapPdfLine("   Accion", pieza.accion || pieza.Accion || pieza.accionRealizada),
      ...wrapPdfLine("   Estado", pieza.estado || pieza.Estado || pieza.estadoPieza),
    ]) : ["Sin piezas intervenidas"]),
    "",
    ...wrapPdfLine("Firma cliente incluida", row.firma_cliente ? "Si" : "No"),
    ...wrapPdfLine("Firma tecnico incluida", row.firma_tecnico ? "Si" : "No"),
  ]
  return buildRawPdf(lines)
}

function buildSolicitudPdfBase(row: Row) {
  const payload = (row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}) as Row
  const familia = parseJsonArray(payload.familia)
  const educacion = parseJsonArray(payload.educacion)
  const complementarios = parseJsonArray(payload.complementarios)
  const experiencia = parseJsonArray(payload.experiencia)
  const referencias = parseJsonArray(payload.referencias)
  const hasFirma = /^data:image\/(png|jpe?g);base64,/i.test(String(row.firma_digital || payload.firma || ""))
  const boolText = (value: unknown) => value ? "Si" : "No"
  const pages: string[] = []
  let content = ""
  let y = 760
  const margin = 28
  const width = 556
  const teal = "0 .54 .47"
  const text = (x: number, yy: number, value: unknown, size = 8, bold = false) => {
    content += `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${yy} Td (${pdfEscape(pdfText(value))}) Tj ET\n`
  }
  const line = (x1: number, y1: number, x2: number, y2: number, color = ".65 .65 .65") => {
    content += `${color} RG .4 w ${x1} ${y1} m ${x2} ${y2} l S\n`
  }
  const fill = (x: number, yy: number, w: number, h: number, color = teal) => {
    content += `${color} rg ${x} ${yy} ${w} ${h} re f\n`
  }
  const finish = () => { pages.push(content); content = ""; y = 760 }
  const ensure = (height: number) => { if (y - height < 38) finish() }
  const section = (title: string) => {
    ensure(28)
    y -= 20
    fill(margin, y, width, 14)
    text(margin + 4, y + 4, title, 8, true)
    y -= 8
  }
  const rowLine = (items: { label: string; value: unknown; w: number }[]) => {
    ensure(18)
    let x = margin
    items.forEach((item) => {
      text(x, y, `${item.label}:`, 7, true)
      text(x + Math.min(58, item.w * .38), y, item.value, 7)
      line(x, y - 4, x + item.w - 8, y - 4)
      x += item.w
    })
    y -= 16
  }
  const tableHeader = (headers: string[], widths: number[]) => {
    ensure(34)
    fill(margin, y - 12, width, 12)
    let x = margin + 3
    headers.forEach((header, index) => {
      text(x, y - 8, header, 6, true)
      x += widths[index]
    })
    y -= 15
  }
  const tableRow = (values: unknown[], widths: number[]) => {
    ensure(16)
    let x = margin + 3
    values.forEach((value, index) => {
      text(x, y, String(value || "").slice(0, Math.max(10, Math.floor(widths[index] / 4.2))), 6)
      x += widths[index]
    })
    line(margin, y - 4, margin + width, y - 4, ".85 .85 .85")
    y -= 14
  }
  const dataTable = (title: string, records: Row[], headers: string[], widths: number[], values: (record: Row) => unknown[]) => {
    section(title)
    tableHeader(headers, widths)
    if (!records.length) tableRow([""], [width])
    records.forEach((record) => tableRow(values(record), widths))
  }

  text(250, 770, "CIBAO SPA LASER", 12, true)
  text(248, 752, "SOLICITUD DE EMPLEO", 10, true)
  line(margin, 736, margin + width, 736, teal)
  y = 720
  rowLine([
    { label: "Puesto", value: row.puesto_solicitado, w: 185 },
    { label: "Fecha completado", value: formatPdfDate(row.fecha_solicitud), w: 185 },
    { label: "Ingreso laboral", value: formatPdfDate(payload.fechaIngresoLaboral || payload.FechaIngresoLaboral), w: 186 },
  ])
  section("DATOS PERSONALES")
  rowLine([{ label: "Nombres", value: row.nombre, w: 278 }, { label: "Apellidos", value: row.apellido, w: 278 }])
  rowLine([{ label: "Cedula", value: formatCedula(row.cedula), w: 185 }, { label: "Fecha Nac", value: formatPdfDate(row.fecha_nacimiento), w: 185 }, { label: "Tipo Sangre", value: payload.tipoSangre || payload.TipoSangre, w: 186 }])
  rowLine([{ label: "Sexo", value: row.sexo, w: 185 }, { label: "Estatura", value: formatHeightFeet(payload.estatura || payload.Estatura), w: 185 }, { label: "Peso", value: payload.peso || payload.Peso, w: 186 }])
  rowLine([{ label: "Estado Civil", value: payload.estadoCivil || payload.EstadoCivil, w: 278 }, { label: "Nacionalidad", value: row.nacionalidad, w: 278 }])
  rowLine([{ label: "Tel. Residencia", value: formatPhone(payload.telefonoResidencia), w: 278 }, { label: "Celular", value: formatPhone(payload.celular || row.telefono), w: 278 }])
  rowLine([{ label: "Direccion", value: row.direccion, w: 556 }])
  rowLine([{ label: "Email", value: row.email, w: 278 }, { label: "Licencia", value: `${payload.licenciaConducir || ""} Cat: ${payload.categoriaLicencia || ""}`, w: 278 }])
  rowLine([{ label: "AFP", value: `${payload.perteneceAFP || ""} ${payload.cualAFP || ""}`, w: 556 }])
  rowLine([{ label: "Pretensiones Salariales", value: formatMoney(row.salario || payload.pretensionesSalariales), w: 556 }])
  rowLine([{ label: "Emergencia", value: payload.emergenciaContacto, w: 556 }])
  section("DATOS BANCARIOS")
  rowLine([{ label: "Banco", value: payload.banco, w: 185 }, { label: "Tipo cuenta", value: payload.tipoCuenta, w: 185 }, { label: "No. cuenta", value: payload.numeroCuenta, w: 186 }])
  section("SALUD Y ANTECEDENTES")
  rowLine([{ label: "Problema emocional", value: payload.problemaEmocional, w: 556 }])
  rowLine([{ label: "Enfermedad largo tiempo", value: payload.enfermedadLargoTiempo, w: 556 }])
  rowLine([{ label: "Problemas con la justicia", value: payload.problemasJusticia, w: 556 }])
  rowLine([{ label: "Otras posiciones", value: payload.otrasPosiciones, w: 556 }])
  dataTable("COMPOSICION FAMILIAR", familia, ["Nombre", "Parentesco", "Edad", "Direccion", "Ocupacion"], [105, 90, 45, 180, 136], (item) => [item.nombre, item.parentesco, item.edad, item.direccion, item.ocupacion])
  dataTable("ESTUDIOS REALIZADOS", educacion, ["Escolaridad", "Institucion", "Curso/Carrera", "Nivel", "C/P"], [100, 150, 150, 100, 56], (item) => [item.escolaridad, item.institucion, item.curso, item.nivel, item.estado])
  dataTable("ESTUDIOS COMPLEMENTARIOS", complementarios, ["Curso", "Institucion", "Ano"], [180, 240, 136], (item) => [item.curso, item.institucion, item.ano])
  section("INFORMACION COMPLEMENTARIA")
  rowLine([{ label: "Office", value: `Excel ${boolText(payload.excel)} | Access ${boolText(payload.access)} | Word ${boolText(payload.word)} | Power Point ${boolText(payload.powerPoint)}`, w: 556 }])
  rowLine([{ label: "Otros", value: payload.otrosConocimientos, w: 556 }])
  dataTable("EXPERIENCIA LABORAL", experiencia, ["Desde", "Hasta", "Empresa", "Telefono", "Superior", "Puesto"], [70, 70, 120, 90, 100, 106], (item) => [formatPdfDate(item.desde), formatPdfDate(item.hasta), item.empresa, formatPhone(item.telefono), item.superior, item.puesto])
  dataTable("REFERENCIAS PERSONALES", referencias, ["Nombre", "Ocupacion", "Telefono"], [220, 190, 146], (item) => [item.nombre, item.ocupacion, formatPhone(item.telefono)])
  rowLine([{ label: "Fecha disponibilidad", value: formatPdfDate(payload.disponibilidad), w: 556 }])
  rowLine([{ label: "Observaciones", value: row.observaciones, w: 556 }])
  ensure(65)
  text(70, y - 18, "Certifico que la informacion anteriormente suministrada es correcta y autorizo a verificar la misma.", 7)
  if (!hasFirma) {
    line(220, y - 40, 390, y - 40)
    text(255, y - 54, "Firma del Solicitante", 8, true)
  }
  finish()

  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>"]
  const pageIds = pages.map((_, index) => 3 + index * 2)
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`)
  pages.forEach((page, index) => {
    const pageId = pageIds[index]
    const contentId = pageId + 1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentId} 0 R >>`)
    objects.push(`<< /Length ${Buffer.byteLength(page, "ascii")} >>\nstream\n${page}\nendstream`)
  })
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, "ascii")
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, "ascii")
}

export async function buildSolicitudPdf(row: Row) {
  const payload = (row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}) as Row
  const firma = String(row.firma_digital || payload.firma || "")
  const basePdf = buildSolicitudPdfBase(row)
  if (!/^data:image\/(png|jpe?g);base64,/i.test(firma)) return basePdf

  try {
    const doc = await PDFDocument.load(basePdf)
    const page = doc.getPages().at(-1) || doc.addPage([612, 792])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const [, base64 = ""] = firma.split(",", 2)
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"))
    const image = firma.includes("image/jpeg") ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
    const maxWidth = 170
    const maxHeight = 52
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const textColor = rgb(0.05, 0.07, 0.12)
    const signatureX = 220 + (170 - drawWidth) / 2
    const signatureY = 92

    page.drawRectangle({ x: 214, y: 82, width: 182, height: 72, color: rgb(1, 1, 1) })
    page.drawImage(image, { x: signatureX, y: signatureY, width: drawWidth, height: drawHeight })
    page.drawLine({ start: { x: 220, y: 80 }, end: { x: 390, y: 80 }, thickness: 0.6, color: textColor })
    page.drawText("Firma del Solicitante", { x: 255, y: 65, size: 8, font, color: textColor })

    const saved = await doc.save()
    return Buffer.from(saved)
  } catch {
    return basePdf
  }
}
