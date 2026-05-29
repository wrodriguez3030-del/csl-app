/**
 * Envío de notificaciones server-side a través de Resend.
 *
 * Si falta `RESEND_API_KEY` (o no hay destinatarios configurados), las
 * funciones devuelven `{ sent: false, warning }` sin lanzar — el flujo
 * principal continúa y el cliente recibe el aviso para mostrarlo en UI.
 */

import { getNotifyEmails } from "@/lib/notify-emails"
import { emailEscape, formatCedula, formatHeightFeet, formatMoney, formatPhone, parseJsonArray } from "./csl-helpers"
import { buildReportePdf, buildSolicitudPdf, pdfText } from "./csl-pdf"
import type { Row } from "./csl-types"

function cleanEnv(value: unknown) {
  return String(value || "").replace(/\\r\\n|\\n|\\r/g, "").trim()
}

// Resolver business_id del row → nombre legible para usar en el header
// del email, el subject y el `from` (cuando no hay EMAIL_FROM configurado).
// Mantiene CSL como fallback para back-compat con rows sin business_id.
const BUSINESS_EMAIL_NAME_BY_ID: Record<string, string> = {
  "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6": "Cibao Spa Laser",
  "03b96698-c5df-4b4b-84df-1160a7ad56b9": "Depicenter Skin Láser",
}

function resolveBusinessNameForEmail(row: Row): string {
  const bid = String(row.business_id || "")
  return BUSINESS_EMAIL_NAME_BY_ID[bid] || "Cibao Spa Laser"
}

async function resendWarning(response: Response) {
  const text = await response.text().catch(() => "")
  try {
    const json = JSON.parse(text) as { message?: string; error?: string; name?: string }
    return [json.name, json.message || json.error].filter(Boolean).join(": ") || text || "No se pudo enviar el correo"
  } catch {
    return text || "No se pudo enviar el correo"
  }
}

function approvedSolicitudEmailHtml(row: Row) {
  const payload = (row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}) as Row
  const field = (label: string, value: unknown) => `<tr><td><b>${label}</b></td><td>${emailEscape(value)}</td></tr>`
  const section = (title: string, rows: string) => `
    <h2 style="margin:22px 0 8px;color:#00897b">${title}</h2>
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:860px;border:1px solid #e5e7eb">${rows}</table>`
  const arrayTable = (title: string, records: Row[], headers: string[], rowBuilder: (record: Row) => unknown[]) => records.length ? `
    <h2 style="margin:22px 0 8px;color:#00897b">${title}</h2>
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:860px;border:1px solid #e5e7eb">
      <thead><tr>${headers.map((header) => `<th style="text-align:left;background:#f3f4f6">${emailEscape(header)}</th>`).join("")}</tr></thead>
      <tbody>${records.map((record) => `<tr>${rowBuilder(record).map((value) => `<td style="border-top:1px solid #e5e7eb">${emailEscape(value)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>` : ""
  const firma = String(row.firma_digital || payload.firma || "")
  const familia = parseJsonArray(payload.familia)
  const educacion = parseJsonArray(payload.educacion)
  const complementarios = parseJsonArray(payload.complementarios)
  const experiencia = parseJsonArray(payload.experiencia)
  const referencias = parseJsonArray(payload.referencias)
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827">
    <h1 style="color:#00897b">Solicitud de empleo aprobada</h1>
    <p>Se aprobó una solicitud y fue migrada a empleados.</p>
    ${section("Datos principales", `
      ${field("Solicitud", row.solicitud_id)}
      ${field("Estado", row.estado)}
      ${field("Puesto", row.puesto_solicitado)}
      ${field("Nombre", `${row.nombre || ""} ${row.apellido || ""}`.trim())}
      ${field("Cédula", formatCedula(row.cedula))}
      ${field("Fecha nacimiento", row.fecha_nacimiento)}
      ${field("Tipo de sangre", payload.tipoSangre || payload.TipoSangre)}
      ${field("Sexo", row.sexo)}
      ${field("Estatura", formatHeightFeet(payload.estatura || payload.Estatura))}
      ${field("Peso", payload.peso || payload.Peso)}
      ${field("Estado civil", payload.estadoCivil || payload.EstadoCivil)}
      ${field("Nacionalidad", row.nacionalidad)}
    `)}
    ${section("Contacto y dirección", `
      ${field("Teléfono residencia", formatPhone(payload.telefonoResidencia))}
      ${field("Celular", formatPhone(payload.celular || row.telefono))}
      ${field("Email", row.email)}
      ${field("Ciudad", row.ciudad)}
      ${field("Sector", row.sector)}
      ${field("Dirección", row.direccion)}
      ${field("Calle", payload.calle)}
      ${field("Número", payload.numeroDir)}
      ${field("Contacto emergencia", payload.emergenciaContacto)}
    `)}
    ${section("Datos laborales y bancarios", `
      ${field("Fecha ingreso laboral", payload.fechaIngresoLaboral || payload.FechaIngresoLaboral)}
      ${field("Licencia conducir", payload.licenciaConducir)}
      ${field("Categoría licencia", payload.categoriaLicencia)}
      ${field("Pertenece AFP", payload.perteneceAFP)}
      ${field("AFP", payload.cualAFP)}
      ${field("Banco", payload.banco)}
      ${field("Tipo cuenta", payload.tipoCuenta)}
      ${field("Número cuenta", payload.numeroCuenta)}
      ${field("Pretensiones salariales", formatMoney(row.salario || payload.pretensionesSalariales))}
      ${field("Disponibilidad", payload.disponibilidad)}
      ${field("Otras posiciones", payload.otrasPosiciones)}
    `)}
    ${section("Salud y antecedentes", `
      ${field("Problema emocional", payload.problemaEmocional)}
      ${field("Enfermedad largo tiempo", payload.enfermedadLargoTiempo)}
      ${field("Problemas con la justicia", payload.problemasJusticia)}
    `)}
    ${section("Habilidades", `
      ${field("Excel", payload.excel ? "Si" : "No")}
      ${field("Access", payload.access ? "Si" : "No")}
      ${field("Word", payload.word ? "Si" : "No")}
      ${field("Power Point", payload.powerPoint ? "Si" : "No")}
      ${field("Windows", payload.windows ? "Si" : "No")}
      ${field("MS-DOS", payload.msDos ? "Si" : "No")}
      ${field("Central telefónica", payload.centralTelefonica ? "Si" : "No")}
      ${field("Fax", payload.fax ? "Si" : "No")}
      ${field("Otros conocimientos", payload.otrosConocimientos)}
      ${field("Observaciones", row.observaciones)}
    `)}
    ${arrayTable("Composición familiar", familia, ["Nombre", "Parentesco", "Edad", "Dirección", "Ocupación"], (item) => [item.nombre, item.parentesco, item.edad, item.direccion, item.ocupacion])}
    ${arrayTable("Educación", educacion, ["Escolaridad", "Institución", "Curso/Carrera", "Nivel", "Estado"], (item) => [item.escolaridad, item.institucion, item.curso, item.nivel, item.estado])}
    ${arrayTable("Estudios complementarios", complementarios, ["Curso", "Institución", "Año"], (item) => [item.curso, item.institucion, item.ano])}
    ${arrayTable("Experiencia laboral", experiencia, ["Desde", "Hasta", "Empresa", "Teléfono", "Superior", "Jefe", "Puesto", "Tareas"], (item) => [item.desde, item.hasta, item.empresa, formatPhone(item.telefono), item.superior, item.inmediato, item.puesto, item.tareas])}
    ${arrayTable("Referencias personales", referencias, ["Nombre", "Ocupación", "Teléfono"], (item) => [item.nombre, item.ocupacion, formatPhone(item.telefono)])}
    ${firma ? `<h2>Firma</h2><img src="${emailEscape(firma)}" alt="Firma" style="max-width:320px;border:1px solid #d1d5db;background:white" />` : ""}
  </body></html>`
}

export async function sendApprovedSolicitudEmail(row: Row) {
  const apiKey = cleanEnv(process.env.RESEND_API_KEY)
  if (!apiKey) return { sent: false, warning: "Falta RESEND_API_KEY" }

  const recipients = getNotifyEmails("rrhh")
  if (!recipients.length) return { sent: false, warning: "Sin destinatarios configurados (CSL_NOTIFY_EMAILS_RRHH)" }

  const from = cleanEnv(process.env.EMAIL_FROM) || "CSL Recursos Humanos <onboarding@resend.dev>"
  const pdf = await buildSolicitudPdf(row)
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: `Solicitud aprobada - ${row.nombre || ""} ${row.apellido || ""}`.trim(),
      html: approvedSolicitudEmailHtml(row),
      attachments: [{
        filename: `solicitud-${pdfText(row.solicitud_id || "empleo")}.pdf`,
        content: pdf.toString("base64"),
      }],
    }),
  })

  if (!response.ok) return { sent: false, warning: await resendWarning(response) }
  return { sent: true }
}

/**
 * Resumen HTML del consentimiento de masajes para notificación operativa.
 * Lee tanto las columnas dedicadas como `payload_json` (donde viajan los
 * campos nuevos: instrucciones, contraindicacionesList, declaracion, etc.).
 */
function consentMasajeEmailHtml(row: Row) {
  const payload = (row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}) as Row
  const field = (label: string, value: unknown) =>
    `<tr><td style="font-weight:700;border-top:1px solid #e5e7eb;padding:7px;width:200px;color:#0B3442">${emailEscape(label)}</td><td style="border-top:1px solid #e5e7eb;padding:7px;color:#102A3A">${emailEscape(value)}</td></tr>`
  const checklist = (label: string, marked: unknown) => {
    const list = Array.isArray(marked) ? (marked as unknown[]).map((v) => String(v)) : []
    if (list.length === 0) return field(label, "—")
    const items = list.map((item) => `<li style="margin:2px 0">${emailEscape(item)}</li>`).join("")
    return `<tr><td style="font-weight:700;border-top:1px solid #e5e7eb;padding:7px;vertical-align:top;color:#0B3442">${emailEscape(label)}</td><td style="border-top:1px solid #e5e7eb;padding:7px;color:#102A3A"><ul style="margin:0;padding-left:18px">${items}</ul></td></tr>`
  }

  const tipoMasaje = String(row.tipo_masaje || payload.tipoMasaje || "")
  const tipoMasajeOtro = String(payload.tipoMasajeOtro || "")
  const tipo = tipoMasaje === "Otro" && tipoMasajeOtro ? `Otro · ${tipoMasajeOtro}` : tipoMasaje
  const zona = String(row.zona_tratar || payload.zonaTratar || "")
  const zonaOtro = String(payload.zonaTratarOtro || "")
  const zonaTexto = zona === "Otro" && zonaOtro ? `Otro · ${zonaOtro}` : zona
  const embarazo = String(row.embarazo || payload.embarazo || "")
  const embarazoNotas = String(payload.embarazoNotas || "")
  const alergiasSiNo = String(payload.alergiasSiNo || (row.alergias ? "Sí" : ""))
  const alergiasNotas = String(payload.alergiasNotas || row.alergias || "")

  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#102A3A;background:#F7FAFC;padding:24px">
    <div style="max-width:760px;margin:0 auto;background:#FFFFFF;border:1px solid #E1ECF2;border-radius:14px;overflow:hidden">
      <div style="background:linear-gradient(90deg,#14B7B0,#22C7C9);padding:18px 22px;color:#FFFFFF">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.9">${emailEscape(resolveBusinessNameForEmail(row))}</div>
        <h1 style="margin:4px 0 0 0;font-size:22px">Consentimiento de Masajes registrado</h1>
      </div>
      <div style="padding:18px 22px">
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">
          ${field("ID", row.consent_id)}
          ${field("Fecha", row.fecha)}
          ${field("Sucursal", row.sucursal)}
          ${field("Estado", row.estado)}
          ${field("Cliente", row.cliente_nombre)}
          ${field("Documento", row.documento)}
          ${field("Teléfono", row.telefono)}
          ${field("Correo", row.correo)}
          ${field("Especialista", row.especialista_nombre)}
          ${field("Tipo de masaje", tipo)}
          ${field("Zona a tratar", zonaTexto)}
          ${field("Presión preferida", payload.presionPreferida)}
          ${field("Embarazo", embarazo === "Sí" && embarazoNotas ? `Sí · ${embarazoNotas}` : (embarazo || "—"))}
          ${field("Alergias", alergiasSiNo === "Sí" && alergiasNotas ? `Sí · ${alergiasNotas}` : (alergiasSiNo || "—"))}
          ${checklist("Instrucciones marcadas", payload.instrucciones)}
          ${checklist("Contraindicaciones marcadas", payload.contraindicacionesList)}
          ${checklist("Políticas aceptadas", payload.politicasAceptadas)}
          ${field("Observaciones médicas", payload.observacionesMedicas)}
          ${field("Observaciones especialista", row.observaciones)}
          ${field("Declaración aceptada", payload.declaracionAceptada ? "Sí" : "No")}
          ${field("Autorización aceptada", payload.autorizacionAceptada ? "Sí" : "No")}
        </table>
        ${row.firma_cliente ? `<div style="margin-top:18px"><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:6px">Firma del cliente</div><img src="${emailEscape(row.firma_cliente)}" alt="Firma cliente" style="max-width:320px;border:1px solid #E1ECF2;background:white;padding:6px;border-radius:8px" /></div>` : ""}
      </div>
      <div style="padding:14px 22px;background:#F7FAFC;border-top:1px solid #E1ECF2;font-size:11px;color:#64748B">
        Notificación generada automáticamente por el Sistema Integral CSL.
      </div>
    </div>
  </body></html>`
}

export async function sendConsentMasajeEmail(row: Row) {
  const apiKey = cleanEnv(process.env.RESEND_API_KEY)
  if (!apiKey) return { sent: false, warning: "Falta RESEND_API_KEY" }

  // Reutiliza la misma lista de destinatarios que la ficha dermatológica.
  const internal = getNotifyEmails("fichas")
  const clientEmail = String(row.correo || "").trim()
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

  const businessName = resolveBusinessNameForEmail(row)
  const from = cleanEnv(process.env.EMAIL_FROM) || `${businessName} <onboarding@resend.dev>`
  const subject = `Consentimiento Masajes · ${String(row.cliente_nombre || row.consent_id || "").trim()}`.trim()

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      html: consentMasajeEmailHtml(row),
    }),
  })

  if (!response.ok) return { sent: false, warning: await resendWarning(response) }
  return { sent: true }
}

/**
 * Resumen HTML del consentimiento de eliminación de tatuajes/cejas.
 * Mismo patrón que el de masajes: lee columnas + payload_json (donde
 * viajan listas, Sí/No con notas y aceptaciones).
 */
function consentTatuajeCejaEmailHtml(row: Row) {
  const payload = (row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}) as Row
  const field = (label: string, value: unknown) =>
    `<tr><td style="font-weight:700;border-top:1px solid #e5e7eb;padding:7px;width:200px;color:#0B3442">${emailEscape(label)}</td><td style="border-top:1px solid #e5e7eb;padding:7px;color:#102A3A">${emailEscape(value)}</td></tr>`
  const checklist = (label: string, marked: unknown) => {
    const list = Array.isArray(marked) ? (marked as unknown[]).map((v) => String(v)) : []
    if (list.length === 0) return field(label, "—")
    const items = list.map((item) => `<li style="margin:2px 0">${emailEscape(item)}</li>`).join("")
    return `<tr><td style="font-weight:700;border-top:1px solid #e5e7eb;padding:7px;vertical-align:top;color:#0B3442">${emailEscape(label)}</td><td style="border-top:1px solid #e5e7eb;padding:7px;color:#102A3A"><ul style="margin:0;padding-left:18px">${items}</ul></td></tr>`
  }

  const tipoProc = String(payload.tipoProcedimiento || row.tipo_procedimiento || "")
  const tipoProcOtro = String(payload.tipoProcedimientoOtro || "")
  const tipoTexto = tipoProc === "Otro" && tipoProcOtro ? `Otro · ${tipoProcOtro}` : tipoProc
  const zona = String(row.zona_tratar || payload.zonaTratar || "")
  const zonaOtro = String(payload.zonaTratarOtro || "")
  const zonaTexto = zona === "Otra zona" && zonaOtro ? `Otra · ${zonaOtro}` : zona
  const tipoPig = String(payload.tipoPigmento || "")
  const tipoPigOtro = String(payload.tipoPigmentoOtro || "")
  const tipoPigTexto = tipoPig === "Otro" && tipoPigOtro ? `Otro · ${tipoPigOtro}` : tipoPig
  const colores = Array.isArray(payload.coloresPigmento) ? (payload.coloresPigmento as unknown[]).map((c) => String(c)) : []
  const coloresOtro = String(payload.coloresPigmentoOtro || "")
  const coloresTexto = colores.length
    ? colores.map((c) => (c === "Otro" && coloresOtro ? `Otro (${coloresOtro})` : c)).join(", ")
    : "—"
  const yesNoNote = (siNo: unknown, notas: unknown) => {
    const s = String(siNo || "")
    const n = String(notas || "")
    if (s === "Sí" && n) return `Sí · ${n}`
    return s || "—"
  }

  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#102A3A;background:#F7FAFC;padding:24px">
    <div style="max-width:760px;margin:0 auto;background:#FFFFFF;border:1px solid #E1ECF2;border-radius:14px;overflow:hidden">
      <div style="background:linear-gradient(90deg,#14B7B0,#22C7C9);padding:18px 22px;color:#FFFFFF">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.9">${emailEscape(resolveBusinessNameForEmail(row))}</div>
        <h1 style="margin:4px 0 0 0;font-size:22px">Consentimiento Eliminación de Tatuajes y Cejas</h1>
      </div>
      <div style="padding:18px 22px">
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">
          ${field("ID", row.consent_id)}
          ${field("Fecha", row.fecha)}
          ${field("Sucursal", row.sucursal)}
          ${field("Estado", row.estado)}
          ${field("Cliente", row.cliente_nombre)}
          ${field("Documento", row.documento)}
          ${field("Teléfono", row.telefono)}
          ${field("Correo", row.correo)}
          ${field("Especialista", row.especialista_nombre)}
          ${field("Tipo de procedimiento", tipoTexto)}
          ${field("Zona a tratar", zonaTexto)}
          ${field("Tipo de pigmento", tipoPigTexto)}
          ${field("Colores", coloresTexto)}
          ${field("Antigüedad aproximada", payload.antiguedadPigmento)}
          ${field("Tamaño aproximado", payload.tamanoAproximado)}
          ${field("Sesiones previas", yesNoNote(payload.sesionesPreviasSiNo, payload.cantidadSesionesPrevias))}
          ${field("Reacción previa al láser", payload.reaccionPreviaLaser)}
          ${field("Embarazo / Lactancia", yesNoNote(payload.embarazoLactanciaSiNo, payload.embarazoLactanciaNotas))}
          ${field("Alergias", yesNoNote(payload.alergiasSiNo, payload.alergiasNotas))}
          ${field("Medicamentos", yesNoNote(payload.medicamentosSiNo, payload.medicamentosNotas))}
          ${field("Exposición solar reciente", yesNoNote(payload.exposicionSolarSiNo, payload.exposicionSolarNotas))}
          ${field("Antecedentes de queloides", yesNoNote(payload.queloidesSiNo, payload.queloidesNotas))}
          ${field("Observaciones del pigmento", payload.observacionesPigmento)}
          ${field("Observaciones del especialista", row.observaciones)}
          ${checklist("Instrucciones marcadas", payload.instruccionesAntes)}
          ${checklist("Cuidados después marcados", payload.cuidadosDespuesList)}
          ${checklist("Riesgos aceptados", payload.riesgosAceptadosList)}
          ${checklist("Políticas aceptadas", payload.politicasAceptadas)}
          ${field("Declaración sobre resultados", payload.declaracionResultadosAceptada ? "Aceptada" : "Pendiente")}
          ${field("Autorización fotográfica", payload.autorizacionFotograficaAceptada ? "Autorizada" : "No autorizada")}
          ${field("Autorización del procedimiento", payload.autorizacionProcedimientoAceptada ? "Aceptada" : "Pendiente")}
        </table>
        ${row.firma_cliente ? `<div style="margin-top:18px"><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.14em;margin-bottom:6px">Firma del cliente</div><img src="${emailEscape(row.firma_cliente)}" alt="Firma cliente" style="max-width:320px;border:1px solid #E1ECF2;background:white;padding:6px;border-radius:8px" /></div>` : ""}
      </div>
      <div style="padding:14px 22px;background:#F7FAFC;border-top:1px solid #E1ECF2;font-size:11px;color:#64748B">
        Notificación generada automáticamente por el Sistema Integral CSL.
      </div>
    </div>
  </body></html>`
}

export async function sendConsentTatuajeCejaEmail(row: Row) {
  const apiKey = cleanEnv(process.env.RESEND_API_KEY)
  if (!apiKey) return { sent: false, warning: "Falta RESEND_API_KEY" }

  const internal = getNotifyEmails("fichas")
  const clientEmail = String(row.correo || "").trim()
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

  const businessName = resolveBusinessNameForEmail(row)
  const from = cleanEnv(process.env.EMAIL_FROM) || `${businessName} <onboarding@resend.dev>`
  const subject = `Consentimiento Tatuajes/Cejas · ${String(row.cliente_nombre || row.consent_id || "").trim()}`.trim()

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      html: consentTatuajeCejaEmailHtml(row),
    }),
  })

  if (!response.ok) return { sent: false, warning: await resendWarning(response) }
  return { sent: true }
}

export async function sendReporteEmail(row: Row) {
  const apiKey = cleanEnv(process.env.RESEND_API_KEY)
  if (!apiKey) return { sent: false, warning: "Falta RESEND_API_KEY" }

  const recipients = getNotifyEmails("reportes")
  if (!recipients.length) return { sent: false, warning: "Sin destinatarios configurados (CSL_NOTIFY_EMAILS_REPORTES)" }

  const from = cleanEnv(process.env.EMAIL_FROM) || "CSL Recursos Humanos <onboarding@resend.dev>"
  const pdf = buildReportePdf(row)
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: `Nuevo reporte de mantenimiento ${row.report_id || ""}`.trim(),
      html: `<p>Se creó un nuevo reporte de mantenimiento.</p><p><b>Reporte:</b> ${emailEscape(row.report_id)}</p><p><b>Sucursal:</b> ${emailEscape(row.sucursal)}</p><p><b>Equipo:</b> ${emailEscape(row.equipo_id)}</p><p>El PDF está adjunto.</p>`,
      attachments: [{
        filename: `reporte-${pdfText(row.report_id || "mantenimiento")}.pdf`,
        content: pdf.toString("base64"),
      }],
    }),
  })

  if (!response.ok) return { sent: false, warning: await resendWarning(response) }
  return { sent: true }
}
