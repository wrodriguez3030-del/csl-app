import type { FichaDermoCosmiatrica } from "./dermo-cosmiatria"
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { sendBusinessEmail, postResend, internalNotifyRecipients } from "./server/csl-email"

type Row = Record<string, unknown>

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function dateValue(value: unknown) {
  const raw = clean(value)
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : new Date().toISOString().slice(0, 10)
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

const CONSENTIMIENTO_COSMIATRIA = [
  "CONSENTIMIENTO INFORMADO",
  "PROCEDIMIENTO: LIMPIEZA FACIAL Y/O TRATAMIENTOS DE COSMIATRIA",
  "El tratamiento de cosmiatria en Cibao Spa Laser puede incluir limpieza facial profunda, peelings quimicos, tratamientos con laser, aparatologia estetica, extraccion, hidratacion, despigmentantes, protocolos antiacne, rejuvenecimiento y otros procedimientos disenados para mejorar la apariencia y salud de la piel.",
  "Confirmo que Cibao Spa Laser me ha explicado en palabras comprensibles la naturaleza del procedimiento, su finalidad, beneficios esperados, limitaciones, alternativas disponibles, molestias normales y cuidados necesarios antes y despues del tratamiento.",
  "Declaro que he informado de manera completa y verdadera mis antecedentes medicos, medicamentos, alergias, cirugias, embarazo, lactancia, enfermedades de la piel, exposicion solar reciente, tratamientos esteticos previos y cualquier condicion que pueda influir en el procedimiento.",
  "Comprendo que los procesos esteticos no son una ciencia exacta y que nadie puede garantizar resultados perfectos, permanentes o identicos entre personas. Los resultados dependen de mi tipo de piel, habitos, seguimiento de indicaciones y respuesta individual.",
  "Se me han informado posibles efectos secundarios como enrojecimiento, ardor, sensibilidad, resequedad, descamacion, brotes, irritacion, hinchazon, hematomas, hiperpigmentacion, hipopigmentacion, infeccion, cicatriz, reaccion alergica o resultado no deseado.",
  "Autorizo a Cibao Spa Laser a tomar y conservar datos, fotografias, evolucion clinica y firma digital como parte de mi expediente estetico. Este material sera usado para diagnostico, seguimiento, control interno y respaldo de la historia del tratamiento.",
  "Me comprometo a seguir las instrucciones indicadas antes, durante y despues del procedimiento, incluyendo el uso de protector solar, hidratacion, evitar exposicion solar directa, saunas, calor excesivo, manipulacion de la piel o productos no indicados cuando aplique.",
  "Entiendo que debo notificar de inmediato cualquier molestia intensa, reaccion inesperada, lesion, alergia, cambio de medicacion o condicion medica nueva antes de continuar con nuevas sesiones.",
  "Acepto que Cibao Spa Laser puede retrasar, modificar o suspender el procedimiento si el personal considera que existe riesgo, contraindicacion, falta de informacion clinica o incumplimiento de cuidados.",
  "Reconozco que se me ha dado oportunidad de hacer preguntas, que mis dudas fueron respondidas satisfactoriamente y que firmo este consentimiento libre y voluntariamente.",
  "Autorizo la realizacion del procedimiento en Cibao Spa Laser y libero al centro y a su personal de responsabilidad por complicaciones derivadas de informacion omitida, indicaciones incumplidas o reacciones individuales no previsibles.",
  "Este consentimiento aplica a la ficha dermo-cosmiatrica registrada y a los procedimientos relacionados con la evaluacion y tratamiento indicado para mi caso, sin sustituir una consulta medica dermatologica cuando sea necesaria.",
]

export function fichaDermoToDb(payload: Row) {
  const id = clean(payload.id || payload.FichaID) || `dermo_${Date.now()}`
  return {
    ficha_id: id,
    cliente_id: clean(payload.clienteId || payload.cliente_id || payload.ClienteID),
    fecha: dateValue(payload.fecha || payload.Fecha),
    sucursal: clean(payload.sucursal || payload.Sucursal),
    operadora: clean(payload.operadora || payload.Operadora),
    especialista: clean(payload.especialista || payload.nombreEspecialista || payload.NombreEspecialista || payload.operadora || payload.Operadora),
    nombre_cliente: clean(payload.nombre || payload.Nombre || payload.nombreCliente || payload.NombreCliente),
    nombre: clean(payload.nombre || payload.Nombre || payload.nombreCliente || payload.NombreCliente),
    documento: clean(payload.documento || payload.Documento || payload.cedula || payload.Cedula),
    edad: clean(payload.edad || payload.Edad),
    fecha_nacimiento: clean(payload.fechaNacimiento || payload.FechaNacimiento) || null,
    direccion: clean(payload.direccion || payload.Direccion),
    ciudad: clean(payload.ciudad || payload.Ciudad),
    telefono: clean(payload.telefono || payload.Telefono),
    ocupacion: clean(payload.ocupacion || payload.Ocupacion),
    motivo_consulta: clean(payload.motivoConsulta || payload.MotivoConsulta),
    cedula: clean(payload.cedula || payload.Cedula),
    email: clean(payload.email || payload.Email),
    correo: clean(payload.email || payload.Email || payload.correo || payload.Correo),
    tipo_piel: clean(payload.tipoPiel || payload.TipoPiel),
    fototipo: clean(payload.fototipo || payload.Fototipo),
    evaluacion_dermatologica_json: {
      tipoPiel: clean(payload.tipoPiel || payload.TipoPiel),
      fototipo: clean(payload.fototipo || payload.Fototipo),
      estadoGeneralPiel: clean(payload.estadoGeneralPiel || payload.EstadoGeneralPiel),
      sensibilidad: clean(payload.sensibilidad || payload.Sensibilidad),
      hidratacion: clean(payload.hidratacion || payload.Hidratacion),
      manchas: clean(payload.manchas || payload.Manchas),
      acne: clean(payload.acne || payload.Acne),
      rosacea: clean(payload.rosacea || payload.Rosacea),
      melasma: clean(payload.melasma || payload.Melasma),
      cicatrices: clean(payload.cicatrices || payload.Cicatrices),
      lesionesVisibles: clean(payload.lesionesVisibles || payload.LesionesVisibles),
      irritacion: clean(payload.irritacion || payload.Irritacion),
      observacionesPiel: clean(payload.observacionesPiel || payload.ObservacionesPiel),
    },
    antecedentes_medicos_json: arrayValue(payload.antecedentesMedicos || payload.AntecedentesMedicos),
    alergias: clean(payload.alergias || payload.Alergias),
    alergias_notas: clean(payload.alergiasNotas || payload.alergiasCuales || payload.AlergiasNotas),
    medicamentos: clean(payload.medicamentos || payload.Medicamentos),
    medicamentos_notas: clean(payload.medicamentosNotas || payload.medicamentosCuales || payload.MedicamentosNotas),
    embarazo: clean(payload.embarazo || payload.embarazada || payload.Embarazo),
    embarazo_notas: clean(payload.embarazoNotas || payload.EmbarazoNotas),
    lactancia: clean(payload.lactancia || payload.Lactancia),
    lactancia_notas: clean(payload.lactanciaNotas || payload.LactanciaNotas),
    piel_sensible: clean(payload.pielSensible || payload.PielSensible),
    piel_sensible_notas: clean(payload.pielSensibleNotas || payload.PielSensibleNotas),
    queloides: clean(payload.queloides || payload.Queloides),
    queloides_notas: clean(payload.queloidesNotas || payload.QueloidesNotas),
    exposicion_solar: clean(payload.exposicionSolar || payload.ExposicionSolar),
    exposicion_solar_notas: clean(payload.exposicionSolarNotas || payload.ExposicionSolarNotas),
    tratamientos_previos_json: arrayValue(payload.tratamientosPrevios || payload.TratamientosPrevios),
    observaciones_profesionales: clean(payload.observacionesProfesionales || payload.ObservacionesProfesionales),
    recomendaciones: clean(payload.recomendaciones || payload.Recomendaciones),
    declaracion_aceptada: Boolean(payload.declaracionAceptada || payload.DeclaracionAceptada),
    firma_cliente: clean(payload.firmaCliente || payload.firma || payload.FirmaCliente || payload.FirmaDigital),
    firma_especialista: clean(payload.firmaEspecialista || payload.FirmaEspecialista),
    estado: clean(payload.estado || payload.Estado) || "Completada",
    firma_digital: clean(payload.firma || payload.firmaDigital || payload.FirmaDigital || payload.firmaCliente),
    payload_json: { ...payload, id, estado: clean(payload.estado || payload.Estado) || "Completada" },
  }
}

export function fichaDermoFromDb(row: Row): FichaDermoCosmiatrica {
  const payload = (row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}) as Row
  return {
    ...(payload as unknown as FichaDermoCosmiatrica),
    id: clean(row.ficha_id || payload.id),
    clienteId: clean(row.cliente_id || payload.clienteId || payload.cliente_id),
    fecha: clean(row.fecha || payload.fecha),
    sucursal: clean(row.sucursal || payload.sucursal),
    operadora: clean(row.operadora || payload.operadora),
    especialista: clean(row.especialista || payload.especialista || row.operadora || payload.operadora),
    nombre: clean(row.nombre_cliente || row.nombre || payload.nombre || payload.nombreCliente),
    documento: clean(row.documento || payload.documento || row.cedula || payload.cedula),
    fechaNacimiento: clean(row.fecha_nacimiento || payload.fechaNacimiento),
    direccion: clean(row.direccion || payload.direccion),
    edad: clean(row.edad || payload.edad),
    ciudad: clean(row.ciudad || payload.ciudad),
    telefono: clean(row.telefono || payload.telefono),
    ocupacion: clean(row.ocupacion || payload.ocupacion),
    motivoConsulta: clean(row.motivo_consulta || payload.motivoConsulta),
    tipoPiel: clean(row.tipo_piel || payload.tipoPiel),
    estadoGeneralPiel: clean((row.evaluacion_dermatologica_json as Row)?.estadoGeneralPiel || payload.estadoGeneralPiel),
    sensibilidad: clean((row.evaluacion_dermatologica_json as Row)?.sensibilidad || payload.sensibilidad),
    hidratacion: clean((row.evaluacion_dermatologica_json as Row)?.hidratacion || payload.hidratacion),
    manchas: clean((row.evaluacion_dermatologica_json as Row)?.manchas || payload.manchas),
    acne: clean((row.evaluacion_dermatologica_json as Row)?.acne || payload.acne),
    rosacea: clean((row.evaluacion_dermatologica_json as Row)?.rosacea || payload.rosacea),
    melasma: clean((row.evaluacion_dermatologica_json as Row)?.melasma || payload.melasma),
    cicatrices: clean((row.evaluacion_dermatologica_json as Row)?.cicatrices || payload.cicatrices),
    lesionesVisibles: clean((row.evaluacion_dermatologica_json as Row)?.lesionesVisibles || payload.lesionesVisibles),
    irritacion: clean((row.evaluacion_dermatologica_json as Row)?.irritacion || payload.irritacion),
    observacionesPiel: clean((row.evaluacion_dermatologica_json as Row)?.observacionesPiel || payload.observacionesPiel),
    antecedentesMedicos: arrayValue(row.antecedentes_medicos_json || payload.antecedentesMedicos),
    antecedentesMedicosNotas: clean(payload.antecedentesMedicosNotas),
    alergiasNotas: clean(row.alergias_notas || payload.alergiasNotas || payload.alergiasCuales),
    medicamentosNotas: clean(row.medicamentos_notas || payload.medicamentosNotas || payload.medicamentosCuales),
    medicamentosFotosensibilizantes: clean(payload.medicamentosFotosensibilizantes),
    medicamentosFotosensibilizantesNotas: clean(payload.medicamentosFotosensibilizantesNotas),
    embarazo: clean(row.embarazo || payload.embarazo || payload.embarazada),
    embarazoNotas: clean(row.embarazo_notas || payload.embarazoNotas),
    lactancia: clean(row.lactancia || payload.lactancia),
    lactanciaNotas: clean(row.lactancia_notas || payload.lactanciaNotas),
    pielSensible: clean(row.piel_sensible || payload.pielSensible),
    pielSensibleNotas: clean(row.piel_sensible_notas || payload.pielSensibleNotas),
    queloides: clean(row.queloides || payload.queloides),
    queloidesNotas: clean(row.queloides_notas || payload.queloidesNotas),
    heridasActivas: clean(payload.heridasActivas),
    heridasActivasNotas: clean(payload.heridasActivasNotas),
    exposicionSolar: clean(row.exposicion_solar || payload.exposicionSolar),
    exposicionSolarNotas: clean(row.exposicion_solar_notas || payload.exposicionSolarNotas),
    retinoidesAcidos: clean(payload.retinoidesAcidos),
    retinoidesAcidosNotas: clean(payload.retinoidesAcidosNotas),
    tratamientosFacialesPrevios: clean(payload.tratamientosFacialesPrevios),
    laserPrevio: clean(payload.laserPrevio),
    peelingPrevio: clean(payload.peelingPrevio),
    limpiezaFacialPrevia: clean(payload.limpiezaFacialPrevia),
    rellenosBotoxRecientes: clean(payload.rellenosBotoxRecientes),
    cirugiasEsteticasRecientes: clean(payload.cirugiasEsteticasRecientes),
    usoAcidosRetinoides: clean(payload.usoAcidosRetinoides),
    fechaUltimoTratamiento: clean(payload.fechaUltimoTratamiento),
    tratamientosPreviosNotas: clean(payload.tratamientosPreviosNotas),
    observacionesProfesionales: clean(row.observaciones_profesionales || payload.observacionesProfesionales),
    recomendaciones: clean(row.recomendaciones || payload.recomendaciones),
    cuidadosSugeridos: clean(payload.cuidadosSugeridos),
    recomiendaProcedimiento: clean(payload.recomiendaProcedimiento),
    proximaEvaluacion: clean(payload.proximaEvaluacion),
    declaracionAceptada: Boolean(row.declaracion_aceptada || payload.declaracionAceptada),
    cedula: clean(row.cedula || payload.cedula),
    email: clean(row.email || payload.email),
    estado: (clean(row.estado || payload.estado) || "Completada") as FichaDermoCosmiatrica["estado"],
    firma: clean(row.firma_cliente || row.firma_digital || payload.firma || payload.firmaCliente),
    firmaEspecialista: clean(row.firma_especialista || payload.firmaEspecialista),
    nombreEspecialista: clean(row.especialista || payload.nombreEspecialista || payload.especialista),
    fechaRegistro: clean(row.created_at || payload.fechaRegistro),
    seObserva: arrayValue(payload.seObserva),
    tratamientosPrevios: arrayValue(payload.tratamientosPrevios),
    modificacionesPigmentarias: arrayValue(payload.modificacionesPigmentarias),
    lentigoSolar: arrayValue(payload.lentigoSolar),
    involucionCutanea: arrayValue(payload.involucionCutanea),
    texturaAlteraciones: arrayValue(payload.texturaAlteraciones),
    lipidizacionCutanea: arrayValue(payload.lipidizacionCutanea),
  }
}

function pdfText(value: unknown) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "")
}

function pdfSafe(value: unknown) {
  return clean(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/·/g, "-")
}

function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
}

function wrap(label: string, value: unknown, width = 92) {
  const text = `${label}: ${pdfText(Array.isArray(value) ? value.join(", ") : value)}`
  const lines: string[] = []
  let current = text
  while (current.length > width) {
    const cut = current.lastIndexOf(" ", width)
    const index = cut > 20 ? cut : width
    lines.push(current.slice(0, index))
    current = `  ${current.slice(index).trim()}`
  }
  lines.push(current)
  return lines
}

function wrapText(value: unknown, width = 92) {
  const text = pdfText(value)
  const lines: string[] = []
  let current = text
  while (current.length > width) {
    const cut = current.lastIndexOf(" ", width)
    const index = cut > 20 ? cut : width
    lines.push(current.slice(0, index))
    current = current.slice(index).trim()
  }
  if (current) lines.push(current)
  return lines
}

function buildPdf(lines: string[]) {
  const pageSize = 48
  const chunks: string[][] = []
  for (let index = 0; index < lines.length; index += pageSize) chunks.push(lines.slice(index, index + pageSize))
  const objects: string[] = []
  objects.push("<< /Type /Catalog /Pages 2 0 R >>")
  objects.push(`<< /Type /Pages /Kids [${chunks.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${chunks.length} >>`)
  chunks.forEach((chunk) => {
    const contentId = objects.length + 2
    const body = ["BT", "/F1 10 Tf", "50 760 Td", "14 TL", ...chunk.map((line) => `(${pdfEscape(line)}) Tj T*`), "ET"].join("\n")
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
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, "ascii")
}

export function buildFichaDermoPdf(row: Row, businessName = "Cibao Spa Laser") {
  return buildFichaDermoPrintPdf(fichaDermoFromDb(row), businessName)
}

type PdfCtx = {
  doc: PDFDocument
  page: PDFPage
  font: PDFFont
  bold: PDFFont
  width: number
  height: number
  margin: number
  teal: ReturnType<typeof rgb>
  text: ReturnType<typeof rgb>
  muted: ReturnType<typeof rgb>
}

function wrapPdfText(text: unknown, font: PDFFont, size: number, maxWidth: number) {
  const words = pdfSafe(Array.isArray(text) ? text.join(", ") : text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate
    else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : [""]
}

function drawText(ctx: PdfCtx, value: unknown, x: number, y: number, size = 8, font = ctx.font, color = ctx.text) {
  ctx.page.drawText(pdfSafe(value), { x, y, size, font, color })
}

function drawCentered(ctx: PdfCtx, value: unknown, y: number, size = 12, font = ctx.bold, color = ctx.teal) {
  const text = pdfSafe(value)
  ctx.page.drawText(text, { x: (ctx.width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color })
}

function section(ctx: PdfCtx, title: string, y: number) {
  ctx.page.drawRectangle({ x: ctx.margin, y: y - 2, width: ctx.width - ctx.margin * 2, height: 14, color: ctx.teal })
  drawText(ctx, title.toUpperCase(), ctx.margin + 4, y + 2, 8, ctx.bold, rgb(1, 1, 1))
  return y - 10
}

function field(ctx: PdfCtx, label: string, value: unknown, x: number, y: number, w: number, size = 7.2) {
  drawText(ctx, `${label}:`, x, y, size, ctx.bold, ctx.muted)
  const labelWidth = ctx.bold.widthOfTextAtSize(`${label}: `, size)
  const lines = wrapPdfText(value, ctx.font, size, Math.max(20, w - labelWidth - 4)).slice(0, 2)
  drawText(ctx, lines[0] || "-", x + labelWidth, y, size, ctx.font, ctx.text)
  if (lines[1]) drawText(ctx, lines[1], x, y - 8, size, ctx.font, ctx.text)
  ctx.page.drawLine({ start: { x, y: y - 3 }, end: { x: x + w, y: y - 3 }, thickness: 0.35, color: rgb(0.55, 0.55, 0.55) })
}

function fieldsRow(ctx: PdfCtx, y: number, fields: Array<[string, unknown]>, gap = 7) {
  const width = (ctx.width - ctx.margin * 2 - gap * (fields.length - 1)) / fields.length
  fields.forEach(([label, value], index) => field(ctx, label, value, ctx.margin + index * (width + gap), y, width))
  return y - 15
}

function drawTable(ctx: PdfCtx, title: string, headers: string[], rows: unknown[][], y: number) {
  y = section(ctx, title, y)
  const tableWidth = ctx.width - ctx.margin * 2
  const colWidth = tableWidth / headers.length
  headers.forEach((header, index) => {
    const x = ctx.margin + index * colWidth
    ctx.page.drawRectangle({ x, y: y - 2, width: colWidth, height: 12, color: ctx.teal })
    drawText(ctx, header, x + 3, y + 1, 6.5, ctx.bold, rgb(1, 1, 1))
  })
  y -= 14
  const safeRows = rows.length ? rows : [[""]]
  safeRows.forEach((row) => {
    headers.forEach((_, index) => {
      const x = ctx.margin + index * colWidth
      ctx.page.drawRectangle({ x, y: y - 2, width: colWidth, height: 13, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.4 })
      drawText(ctx, row[index] || "-", x + 3, y + 2, 6.2)
    })
    y -= 13
  })
  return y - 3
}

function drawParagraph(ctx: PdfCtx, text: string, x: number, y: number, w: number, size = 7.1, leading = 8.6) {
  const lines = wrapPdfText(text, ctx.font, size, w)
  lines.forEach((line, index) => drawText(ctx, line, x, y - index * leading, size))
  return y - lines.length * leading - 2
}

async function drawSignatureImage(ctx: PdfCtx, dataUrl: string | undefined, x: number, y: number, boxWidth: number, boxHeight: number) {
  ctx.page.drawRectangle({ x, y, width: boxWidth, height: boxHeight, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.6 })
  if (!dataUrl?.startsWith("data:image/")) {
    drawText(ctx, "Firma pendiente", x + 18, y + 31, 7, ctx.font, ctx.muted)
    return
  }
  const [, base64 = ""] = dataUrl.split(",", 2)
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"))
  try {
    const image = dataUrl.includes("image/jpeg") ? await ctx.doc.embedJpg(bytes) : await ctx.doc.embedPng(bytes)
    const scaled = image.scale(Math.min((boxWidth - 20) / image.width, (boxHeight - 16) / image.height, 1))
    ctx.page.drawImage(image, { x: x + (boxWidth - scaled.width) / 2, y: y + (boxHeight - scaled.height) / 2, width: scaled.width, height: scaled.height })
  } catch {
    drawText(ctx, "Firma guardada en expediente digital", x + 18, y + 31, 7, ctx.font, ctx.muted)
  }
}

async function drawSignature(ctx: PdfCtx, ficha: FichaDermoCosmiatrica, y: number) {
  y = section(ctx, "Firmas digitales", y)
  y -= 58
  const gap = 18
  const boxWidth = (ctx.width - ctx.margin * 2 - gap) / 2
  const boxHeight = 62
  const leftX = ctx.margin
  const rightX = ctx.margin + boxWidth + gap
  await drawSignatureImage(ctx, ficha.firma, leftX, y, boxWidth, boxHeight)
  await drawSignatureImage(ctx, ficha.firmaEspecialista, rightX, y, boxWidth, boxHeight)
  field(ctx, "Cliente", ficha.nombre || "Cliente", leftX, y - 12, boxWidth)
  field(ctx, "Especialista", ficha.nombreEspecialista || ficha.especialista || ficha.operadora || "Especialista", rightX, y - 12, boxWidth)
  y -= 31
  y = fieldsRow(ctx, y, [["Documento", ficha.documento || ficha.cedula], ["Fecha", ficha.fecha], ["Sucursal", ficha.sucursal], ["Declaracion", ficha.declaracionAceptada ? "Aceptada" : "Pendiente"]])
  return y
}
async function buildFichaDermoPrintPdf(ficha: FichaDermoCosmiatrica, businessName = "Cibao Spa Laser") {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const createCtx = (page = doc.addPage([612, 792])): PdfCtx => ({
    doc,
    page,
    font,
    bold,
    width: 612,
    height: 792,
    margin: 32,
    teal: rgb(0, 0.54, 0.48),
    text: rgb(0.07, 0.09, 0.15),
    muted: rgb(0.28, 0.31, 0.37),
  })
  const header = (ctx: PdfCtx, title = "FICHA DERMATOLOGICA / DERMO-COSMIATRICA") => {
    let y = 762
    drawCentered(ctx, businessName.toUpperCase(), y, 15, bold, ctx.teal)
    y -= 17
    drawCentered(ctx, title, y, 11, bold, ctx.text)
    ctx.page.drawLine({ start: { x: ctx.margin, y: y - 10 }, end: { x: ctx.width - ctx.margin, y: y - 10 }, thickness: 1.1, color: ctx.teal })
    return y - 27
  }

  let ctx = createCtx()
  let y = header(ctx)
  y = fieldsRow(ctx, y, [["ID", ficha.id], ["Fecha", ficha.fecha], ["Sucursal", ficha.sucursal], ["Estado", ficha.estado]])
  y = fieldsRow(ctx, y, [["Especialista", ficha.nombreEspecialista || ficha.especialista || ficha.operadora], ["Cliente ID", ficha.clienteId], ["Cliente", ficha.nombre]])

  y = section(ctx, "Datos del cliente", y)
  y = fieldsRow(ctx, y, [["Nombre", ficha.nombre], ["Documento", ficha.documento || ficha.cedula], ["Telefono", ficha.telefono], ["Email", ficha.email]])
  y = fieldsRow(ctx, y, [["Fecha nac.", ficha.fechaNacimiento], ["Edad", ficha.edad], ["Ciudad", ficha.ciudad], ["Ocupacion", ficha.ocupacion]])
  y = fieldsRow(ctx, y, [["Direccion", ficha.direccion], ["Motivo", ficha.motivoConsulta]])

  y = section(ctx, "Evaluacion dermatologica", y)
  y = fieldsRow(ctx, y, [["Tipo piel", ficha.tipoPiel], ["Fototipo", ficha.fototipo], ["Estado", ficha.estadoGeneralPiel], ["Sensibilidad", ficha.sensibilidad]])
  y = fieldsRow(ctx, y, [["Hidratacion", ficha.hidratacion], ["Manchas", ficha.manchas], ["Acne", ficha.acne], ["Rosacea", ficha.rosacea]])
  y = fieldsRow(ctx, y, [["Melasma", ficha.melasma], ["Cicatrices", ficha.cicatrices], ["Lesiones", ficha.lesionesVisibles], ["Irritacion", ficha.irritacion]])
  y = fieldsRow(ctx, y, [["Habitos", `Alcohol ${ficha.alcohol || "-"} | Cigarrillos ${ficha.cigarrillos || "-"} | Cafe ${ficha.cafe || "-"}`], ["Observaciones piel", ficha.observacionesPiel]])

  y = drawTable(ctx, "Antecedentes medicos", ["Campo", "Detalle"], [
    ["Antecedentes", ficha.antecedentesMedicos],
    ["Notas", ficha.antecedentesMedicosNotas],
    ["Alergias", `${ficha.alergias || "-"} ${ficha.alergiasNotas || ficha.alergiasCuales || ""}`],
    ["Medicamentos", `${ficha.medicamentos || "-"} ${ficha.medicamentosNotas || ficha.medicamentosCuales || ""}`],
    ["Fotosensibilizantes", `${ficha.medicamentosFotosensibilizantes || "-"} ${ficha.medicamentosFotosensibilizantesNotas || ""}`],
  ], y)

  y = drawTable(ctx, "Condiciones especiales", ["Condicion", "Respuesta"], [
    ["Embarazo", `${ficha.embarazo || ficha.embarazada || "-"} ${ficha.embarazoNotas || ""}`],
    ["Lactancia", `${ficha.lactancia || "-"} ${ficha.lactanciaNotas || ""}`],
    ["Piel sensible", `${ficha.pielSensible || "-"} ${ficha.pielSensibleNotas || ""}`],
    ["Queloides", `${ficha.queloides || "-"} ${ficha.queloidesNotas || ""}`],
    ["Heridas o lesiones", `${ficha.heridasActivas || "-"} ${ficha.heridasActivasNotas || ""}`],
    ["Exposicion solar", `${ficha.exposicionSolar || "-"} ${ficha.exposicionSolarNotas || ""}`],
    ["Retinoides/acidos", `${ficha.retinoidesAcidos || "-"} ${ficha.retinoidesAcidosNotas || ""}`],
  ], y)

  ctx = createCtx()
  y = header(ctx, "FICHA DERMATOLOGICA - EVALUACION Y DECLARACION")
  y = drawTable(ctx, "Tratamientos previos", ["Campo", "Detalle"], [
    ["Tratamientos faciales", ficha.tratamientosFacialesPrevios],
    ["Laser previo", ficha.laserPrevio],
    ["Peeling previo", ficha.peelingPrevio],
    ["Limpieza facial", ficha.limpiezaFacialPrevia],
    ["Rellenos/Botox", ficha.rellenosBotoxRecientes],
    ["Cirugias esteticas", ficha.cirugiasEsteticasRecientes],
    ["Acidos/retinoides", ficha.usoAcidosRetinoides],
    ["Ultimo tratamiento", ficha.fechaUltimoTratamiento],
    ["Notas", ficha.tratamientosPreviosNotas],
  ], y)
  y = section(ctx, "Observaciones profesionales", y)
  y = drawParagraph(ctx, ficha.observacionesProfesionales || ficha.observaciones || "-", ctx.margin, y, ctx.width - ctx.margin * 2)
  y = section(ctx, "Recomendaciones", y)
  y = drawParagraph(ctx, ficha.recomendaciones || "-", ctx.margin, y, ctx.width - ctx.margin * 2)
  y = fieldsRow(ctx, y, [["Cuidados sugeridos", ficha.cuidadosSugeridos], ["Recomienda procedimiento", ficha.recomiendaProcedimiento], ["Proxima evaluacion", ficha.proximaEvaluacion]])
  y = section(ctx, "Declaracion del cliente", y)
  const declaracion = `Declaro que la informacion suministrada en esta ficha dermatologica es verdadera y completa. Entiendo que ${businessName} y su personal utilizaran esta informacion para evaluar mi piel, mis antecedentes y las condiciones necesarias antes de realizar cualquier procedimiento estetico o dermatologico. Declaro que he informado sobre alergias, medicamentos, enfermedades, embarazo, lactancia, tratamientos previos y cualquier condicion relevante. Entiendo que omitir informacion puede afectar la seguridad y los resultados del tratamiento.`
  y = drawParagraph(ctx, declaracion, ctx.margin, y, ctx.width - ctx.margin * 2)
  y = fieldsRow(ctx, y, [["Aceptacion", ficha.declaracionAceptada ? "Aceptada" : "Pendiente"], ["Fecha registro", ficha.fechaRegistro]])
  await drawSignature(ctx, ficha, Math.max(y - 8, 160))

  const bytes = await doc.save()
  return Buffer.from(bytes)
}
function htmlEscape(value: unknown) {
  return clean(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function fichaDermoEmailHtml(row: Row, businessName = "Cibao Spa Laser") {
  const ficha = fichaDermoFromDb(row)
  const field = (label: string, value: unknown) => `<tr><td style="font-weight:700;border-top:1px solid #e5e7eb;padding:7px">${htmlEscape(label)}</td><td style="border-top:1px solid #e5e7eb;padding:7px">${htmlEscape(Array.isArray(value) ? value.join(", ") : value)}</td></tr>`
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827">
    <h1 style="color:#00897b">CONSENTIMIENTO INFORMADO ${htmlEscape(businessName.toUpperCase())}</h1>
    <p style="color:#4b5563">Ficha dermatologica firmada y guardada en el sistema.</p>
    <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:860px;border:1px solid #e5e7eb">
      ${field("ID de ficha", ficha.id)}
      ${field("Fecha", ficha.fecha)}
      ${field("Sucursal", ficha.sucursal)}
      ${field("Especialista", ficha.nombreEspecialista || ficha.especialista || ficha.operadora)}
      ${field("Cliente", ficha.nombre)}
      ${field("Documento", ficha.documento || ficha.cedula)}
      ${field("Telefono", ficha.telefono)}
      ${field("Correo", ficha.email)}
      ${field("Motivo", ficha.motivoConsulta)}
      ${field("Evaluacion", `Tipo piel: ${ficha.tipoPiel || "-"} | Fototipo: ${ficha.fototipo || "-"} | Sensibilidad: ${ficha.sensibilidad || "-"}`)}
      ${field("Antecedentes importantes", ficha.antecedentesMedicos)}
      ${field("Alergias", `${ficha.alergias || "-"} ${ficha.alergiasNotas || ficha.alergiasCuales || ""}`)}
      ${field("Medicamentos", `${ficha.medicamentos || "-"} ${ficha.medicamentosNotas || ficha.medicamentosCuales || ""}`)}
      ${field("Condiciones especiales", `Embarazo: ${ficha.embarazo || ficha.embarazada || "-"} | Lactancia: ${ficha.lactancia || "-"} | Queloides: ${ficha.queloides || "-"}`)}
      ${field("Observaciones", ficha.observacionesProfesionales || ficha.observaciones)}
      ${field("Recomendaciones", ficha.recomendaciones)}
      ${field("Declaracion", ficha.declaracionAceptada ? "Aceptada" : "Pendiente")}
    </table>
    ${ficha.firma ? `<h2>Firma cliente</h2><img src="${htmlEscape(ficha.firma)}" alt="Firma cliente" style="max-width:360px;border:1px solid #d1d5db;background:white" />` : ""}
    ${ficha.firmaEspecialista ? `<h2>Firma especialista</h2><img src="${htmlEscape(ficha.firmaEspecialista)}" alt="Firma especialista" style="max-width:360px;border:1px solid #d1d5db;background:white" />` : ""}
  </body></html>`
}
export async function sendFichaDermoEmail(row: Row, businessName = "Cibao Spa Laser", businessId?: string) {
  const bid = String(businessId || row.business_id || "")
  const from = (process.env.EMAIL_FROM || `${businessName} <onboarding@resend.dev>`).replace(/\\r\\n|\\n|\\r/g, "").trim()
  const pdf = await buildFichaDermoPdf(row, businessName)
  const clientEmail = clean(row.email)
  // Buzón interno POR TENANT (Gmail configurado del negocio) + cliente si dio email.
  const internal = await internalNotifyRecipients(bid)
  const candidates = [...internal, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) ? clientEmail : ""]
  const seen = new Set<string>()
  const recipients = candidates
    .map((value) => value.trim())
    .filter((value): value is string => {
      if (!value) return false
      const key = value.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  if (!recipients.length) return { sent: false, warning: "Sin destinatarios configurados" }

  const subject = `CONSENTIMIENTO INFORMADO ${businessName.toUpperCase()}`
  const html = fichaDermoEmailHtml(row, businessName)
  const filename = `ficha-dermatologia-${pdfText(row.ficha_id || "cliente")}.pdf`

  // PRIMERO desde el Gmail del negocio (si está configurado); RESPALDO Resend.
  return sendBusinessEmail(
    bid,
    { to: recipients, subject, html, attachments: [{ filename, content: pdf }] },
    () => postResend({
      from,
      to: recipients,
      subject,
      html,
      attachments: [{ filename, content: pdf.toString("base64") }],
    }),
  )
}



