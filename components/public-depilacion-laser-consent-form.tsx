"use client"

import { useState } from "react"
import { CheckCircle2, Download, FileSignature, Loader2, Send, UserRound } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/signature-pad"
import { displayPhone, displayDocumento } from "@/lib/formatters"
import { getBusinessBranding } from "@/lib/business"

// Public form de Consentimiento de Depilación Láser (eliminación del vello no
// deseado). Mismo modelo que Tatuajes/Cejas: el cliente solo ve "Cliente
// vinculado" (lectura) + documento formal + aceptación de políticas + firma.
// Texto LITERAL del PDF oficial "PROCEDIMIENTO: ELIMINACIÓN DEL VELLO NO
// DESEADO" (con erratas evidentes corregidas). Mantener ambos bloques
// sincronizados: buildPrintHtml (PDF) y el JSX de render (web).

function ReadOnlyField({ label, value, className }: { label: string; value?: string; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1 min-h-[40px] rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  )
}

export interface PublicDepilacionLaserPrefill {
  clienteId?: string
  nombre?: string
  telefono?: string
  documento?: string
  correo?: string
  direccion?: string
  sucursal?: string
  especialista?: string
  servicio?: string
}

interface Props {
  prefill?: PublicDepilacionLaserPrefill
  onSubmit: (payload: Record<string, unknown>) => Promise<{ recordId?: string } | void>
  businessSlug?: string
}

// Título visible (web). El PDF usa el encabezado formal de dos líneas.
const TITULO_DOC = "Consentimiento informado para eliminación del vello no deseado"
const PDF_TITULO = "CONSENTIMIENTO INFORMADO"
const PDF_SUBTITULO = "PROCEDIMIENTO: ELIMINACIÓN DEL VELLO NO DESEADO"

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildPdfBaseName(nombre: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const slug = (nombre || "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "cliente"
  return `consentimiento-depilacion-laser-${slug}-${today}`
}

function buildPrintHtml(args: {
  cliente: Required<PublicDepilacionLaserPrefill>
  fechaFirma: string
  firmaDataUrl: string
  recordId: string
  businessName?: string
  logoUrl?: string
  primaryColor?: string
}) {
  const {
    cliente, fechaFirma, firmaDataUrl, recordId,
    businessName = "CIBAO SPA LASER", logoUrl = "", primaryColor = "#00897b",
  } = args
  const logoSrc = logoUrl ? `${typeof window !== "undefined" ? window.location.origin : ""}${logoUrl}` : ""
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>${escapeHtml(buildPdfBaseName(cliente.nombre))}</title>
<style>
  @page { size: letter; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11px; margin: 0; }
  .header { border-bottom: 3px solid ${primaryColor}; padding-bottom: 10px; margin-bottom: 14px; }
  .brand-logo { max-height: 66px; max-width: 220px; object-fit: contain; display: block; margin: 0 auto 6px; }
  .logo { font-size: 18px; font-weight: 800; color: ${primaryColor}; letter-spacing: .02em; }
  .center { text-align: center; }
  .meta { color: #475569; font-size: 10px; margin-top: 2px; }
  h1 { font-size: 14px; margin: 6px 0 2px; }
  .subtitle { font-size: 11.5px; font-weight: 700; color: ${primaryColor}; margin: 0 0 2px; }
  h2 { font-size: 11.5px; background: ${primaryColor}; color: white; padding: 5px 8px; margin: 10px 0 5px; text-transform: uppercase; letter-spacing: .03em; border-radius: 4px; break-after: avoid; page-break-after: avoid; }
  p { margin: 3px 0; line-height: 1.4; text-align: justify; }
  ul, ol { margin: 3px 0 3px 18px; line-height: 1.45; break-inside: auto; page-break-inside: auto; }
  li { margin: 2px 0; break-inside: avoid; page-break-inside: avoid; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin: 4px 0; }
  .field { padding: 3px 0; border-bottom: 1px dotted #aab6c5; break-inside: avoid; page-break-inside: avoid; }
  .field b { color: #0f172a; min-width: 100px; display: inline-block; }
  .accept { margin-top: 6px; padding: 6px 8px; border: 1px solid #99f6e4; background: #f0fdfa; border-radius: 4px; font-weight: 700; color: #0f766e; }
  .sign-box { margin-top: 12px; border: 1px solid #d7dee8; border-radius: 6px; padding: 10px; break-inside: avoid; page-break-inside: avoid; }
  .sign-img { max-width: 320px; max-height: 110px; object-fit: contain; display: block; margin: 6px auto; border-bottom: 1px solid #111827; }
  .sign-cap { text-align: center; font-weight: 700; font-size: 10px; color: #334155; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 9px; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<div class="header center">
  ${logoSrc ? `<img class="brand-logo" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(businessName)}" onerror="this.style.display='none'" />` : ""}
  <div class="logo">${escapeHtml(businessName.toUpperCase())}</div>
  <h1>${escapeHtml(PDF_TITULO)}</h1>
  <div class="subtitle">${escapeHtml(PDF_SUBTITULO)}</div>
  <div class="meta">Fecha de firma: ${escapeHtml(fechaFirma)} · Ref: ${escapeHtml(recordId)}</div>
</div>

<h2>Datos del cliente</h2>
<div class="grid2">
  <div class="field"><b>Nombre:</b> ${escapeHtml(cliente.nombre || "—")}</div>
  <div class="field"><b>Teléfono:</b> ${escapeHtml(displayPhone(cliente.telefono) || "—")}</div>
  <div class="field"><b>Cédula / Doc:</b> ${escapeHtml(displayDocumento(cliente.documento) || "—")}</div>
  <div class="field"><b>Correo:</b> ${escapeHtml(cliente.correo || "—")}</div>
  <div class="field" style="grid-column: 1 / -1"><b>Dirección:</b> ${escapeHtml(cliente.direccion || "—")}</div>
  <div class="field"><b>Sucursal:</b> ${escapeHtml(cliente.sucursal || "—")}</div>
  <div class="field"><b>Especialista:</b> ${escapeHtml(cliente.especialista || "—")}</div>
</div>

<h2>Descripción del procedimiento</h2>
<p>La depilación láser es un método efectivo y duradero para eliminar el vello no deseado en diferentes áreas del cuerpo. En Cibao Spa Laser, ofrecemos una experiencia segura y profesional, utilizando tecnología de vanguardia.</p>

<h2>Confirmación del cliente</h2>
<ol>
  <li><b>CONFIRMO</b> que Cibao Spa Laser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del (los) procedimientos a efectuar; incluyendo los posibles riesgos, otras soluciones alternativas de procedimientos (cuando existan), así como las molestias que se pueden sentir, aun teniendo un periodo post-tratamiento normal. Han sido contestadas a satisfacción todas las preguntas que libremente he formulado acerca de todo el procedimiento.</li>
  <li><b>ACEPTO y CONSIENTO</b>, que al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento.</li>
</ol>

<h2>Instrucciones antes del procedimiento</h2>
<ul>
  <li><b>Evitar la Exposición al Sol:</b> No expongas el área a tratar al sol durante al menos 2 semanas antes del procedimiento. La piel bronceada puede aumentar el riesgo de efectos secundarios.</li>
  <li><b>No Utilizar Autobronceadores:</b> Abstente de usar cremas bronceadoras o autobronceadores en la zona afectada al menos 2 semanas antes del tratamiento.</li>
  <li><b>Informar sobre Medicación:</b> Informa a tu médico o especialista sobre cualquier medicamento que estés tomando, especialmente anticoagulantes, o si tienes algún tratamiento de piel en curso.</li>
  <li><b>Evitar Antiinflamatorios y Alcohol:</b> Evita el uso de antiinflamatorios (como aspirina o ibuprofeno) y alcohol 48 horas antes del procedimiento para reducir el riesgo de sangrado y hematomas.</li>
  <li><b>No Usar Crema en la Zona a Tratar:</b> El día del procedimiento, no apliques cremas, lociones o maquillaje en el área que será tratada.</li>
  <li><b>Hidratar la Piel:</b> Mantén la piel bien hidratada días antes del procedimiento, aplicando crema hidratante en las áreas a tratar, salvo indicación contraria.</li>
  <li><b>Consultar sobre Alergias:</b> Asegúrate de informar al profesional sobre cualquier alergia, especialmente a anestésicos locales o productos similares que puedan usarse durante el procedimiento.</li>
  <li><b>Preparar Preguntas:</b> Haz una lista de preguntas que quieras hacerle al profesional antes del procedimiento. Asegúrate de entender completamente el proceso y los cuidados posteriores.</li>
</ul>

<h2>Cuidados después del tratamiento</h2>
<ul>
  <li><b>Evitar la exposición solar prolongada:</b> Después de la sesión, evita la exposición al sol en el área tratada durante al menos 1 semana. Usa bloqueador solar con un alto factor de protección (SPF) para proteger la piel y prevenir manchas.</li>
  <li><b>Cuidado de la Piel:</b> Mantén la piel limpia e hidratada. Utiliza cremas o lociones suaves recomendadas por nuestro especialista.</li>
  <li><b>No Rasurarse ni Depilar:</b> No uses cera, pinzas ni otros métodos de depilación durante el tratamiento. Es normal que el vello caiga en las semanas siguientes.</li>
  <li><b>Evitar Actividades Intensas:</b> Evita ejercicios físicos intensos, saunas o jacuzzis durante los primeros días después del tratamiento, ya que el sudor puede causar irritación en la piel.</li>
  <li>Si experimentas enrojecimiento o hinchazón, aplica compresas frías y, si es necesario, puedes tomar un analgésico suave. Si los síntomas persisten, contacta a nuestro equipo.</li>
</ul>

<h2>Consideraciones generales</h2>
<ul>
  <li><b>Modo de acción del tratamiento.</b> La luz láser penetra la piel y luego es absorbida por la melanina o pigmento del vello, causando un calentamiento rápido del tallo y raíz del mismo. Este proceso debilita el folículo completo del vello.</li>
  <li>La reducción del vello mediante el láser es un procedimiento común que es practicado de forma segura y efectiva en miles de pacientes cada año. Las complicaciones son extremadamente raras, y normalmente menores; sin embargo, algunas complicaciones pueden ocurrir.</li>
  <li><b>Las sesiones.</b> Las sesiones láser se realizan cada 5 semanas las primeras 5 sesiones, luego va aumentando el tiempo según los resultados, las citas se van colocando cada 7 u 8 semanas.</li>
  <li><b>Información.</b> El láser no penetra más allá de las capas de la piel (epidermis y la dermis), lo que quiere decir que no afecta ninguna glándula, ni vasos, ni músculos.</li>
  <li><b>Exposición de los ojos.</b> Lentes protectores serán puestos durante el proceso. Es muy importante mantener puestos estos lentes durante todo el tratamiento con láser para proteger los ojos, ya que no deben ser expuestos accidentalmente a la luz del láser.</li>
  <li><b>Herpes.</b> Los pacientes que en alguna ocasión han presentado herpes labial, deben usar Aciclovir tres días antes de cada sesión del tratamiento como prevención.</li>
  <li><b>Advertencia.</b> Los vellos muy rubios, muy finos y blancos (canas) no se eliminan con el láser.</li>
</ul>

<h2>Beneficios</h2>
<p>Los beneficios del tratamiento mediante láser: para la mayoría de los pacientes este proceso causará la reducción considerable del vello. Esto supone una reducción estable y a largo plazo del número o cantidad de vello que volverá a crecer después del tratamiento.</p>

<h2>Probabilidad de éxito</h2>
<p>El láser destruye el folículo del vello en crecimiento, pero no el de los folículos latente o inactivo. El resultado de cada tratamiento es la destrucción de un porcentaje de los folículos del vello. Varios tratamientos serán necesarios para la reducción del vello. La reducción del vello será prolongada e incluso permanente. No obstante, algunos pacientes pueden no experimentar una total eliminación de su vello hasta después de varios procesos con láser. Los resultados dependen del tipo de piel y vello, así como de la asociación de la producción de vello a alguna entidad médica; ejemplo: ovario poliquístico.</p>
<p>Luego de examinar su tipo de piel y vello, el o la especialista le recomendará un número determinado de sesiones para lograr la eliminación o reducción máxima del vello. Al finalizar las sesiones recomendadas, el paciente debe darse mantenimiento cada dos meses; dependiendo cada caso en particular, de ser necesario.</p>

<h2>Riesgos y posibles complicaciones</h2>
<p><b>COMPRENDO</b> que los procesos estéticos no son una ciencia exacta y que nadie puede garantizar la perfección absoluta, por lo que se me han informado los riesgos y posibles complicaciones. A pesar de que se tomen precauciones, la depilación láser puede conllevar ciertos riesgos y complicaciones.</p>
<ul>
  <li><b>Malestar o incomodidad.</b> Algún dolor ligero puede sentirse durante el tratamiento con láser, aunque la mayoría de las personas toleran bien el proceso.</li>
  <li><b>Cicatrización.</b> El tratamiento láser puede provocar hinchazón, llagas o sequedad del área tratada, que requerirán para su total desaparición de un período de entre 1 a 3 semanas. Una vez recuperada la superficie de la piel, puede quedar rosada y sensible a los rayos del sol durante 2 – 4 semanas adicionales. Solo un porcentaje muy reducido de pacientes experimentan este problema.</li>
  <li><b>Hematomas / Hinchazón / Infección.</b> Hematomas podrán verse en el área tratada durante un período de 2 – 3 días. Hinchazón: puede ocurrir después del procedimiento y durar varias horas, especialmente si han sido tratadas las áreas de la nariz o los pómulos. Una infección cutánea de la piel es una complicación rara pero posible.</li>
  <li><b>Cambios en la pigmentación (cambios en el color de la piel).</b> El área tratada puede volverse más clara o bien más oscura que la piel a su alrededor; este efecto se resuelve normalmente de manera espontánea en un período de varios meses, pero puede durar bastante más. Para disminuir este riesgo le explicamos al paciente que debe usar filtro solar tres veces al día y evitar la exposición al sol durante el tratamiento.</li>
  <li><b>Cicatrices.</b> La formación de una cicatriz es algo poco probable; sin embargo, es una posibilidad siempre y cuando sea intervenida la superficie de la piel. Para minimizar las posibilidades de tal complicación es extremadamente importante seguir todas las instrucciones que le serán dadas antes y después de su tratamiento con láser.</li>
</ul>

<h2>Contraindicaciones</h2>
<ul>
  <li><b>Embarazo y Lactancia:</b> Aunque no hay estudios concluyentes sobre la seguridad del láser en mujeres embarazadas, se suele recomendar evitar el procedimiento durante este periodo. La lactancia tampoco es un momento ideal para realizarlo.</li>
  <li><b>Piel Bronceada:</b> La exposición solar o el uso de camas de bronceado antes del tratamiento pueden aumentar el riesgo de quemaduras y cambios en la pigmentación de la piel. Se recomienda no haber estado expuesto al sol al menos 4-6 semanas antes de la sesión.</li>
  <li><b>Trastornos de la Piel:</b> Condiciones como eczema, psoriasis, dermatitis o infecciones cutáneas en el área a tratar pueden contraindicar el uso de láser hasta que la piel esté completamente sana.</li>
  <li><b>Uso de Medicamentos:</b> Algunos medicamentos, como los que sensibilizan la piel (por ejemplo, retinoides o ciertos antibióticos), pueden aumentar el riesgo de efectos secundarios. Es importante informar al especialista sobre cualquier medicación.</li>
  <li><b>Historial de Cicatrices Queloides:</b> Las personas con tendencia a formar cicatrices queloides pueden tener un mayor riesgo de desarrollar cicatrices anormales después del tratamiento.</li>
  <li><b>Diabetes No Controlada:</b> Las personas con diabetes mal controlada pueden tener un mayor riesgo de infecciones o complicaciones en la piel.</li>
  <li><b>Síndromes de Hipersensibilidad:</b> Algunas condiciones que implican hipersensibilidad de la piel o trastornos de coagulación pueden impedir la realización del tratamiento.</li>
  <li><b>Tatuajes en el Área:</b> La depilación láser no se debe realizar sobre tatuajes, ya que el láser puede afectar la tinta y causar quemaduras o reacciones adversas.</li>
  <li><b>Ciertas Condiciones Médicas:</b> Enfermedades o condiciones como lupus eritematoso, enfermedades autoinmunitarias o enfermedades que afectan la piel pueden ser contraindicaciones.</li>
  <li><b>Uso de Productos Irritantes:</b> El uso reciente de productos químicos o tratamientos estéticos que irritan la piel, como peelings químicos o microdermoabrasión, puede requerir un periodo de espera antes de la depilación láser.</li>
</ul>

<h2>Declaraciones finales del cliente</h2>
<p>El fin del procedimiento que he solicitado tiene como objetivo mejorar mi apariencia física.</p>
<p><b>COMPRENDO</b> que los resultados están en relación directamente proporcional a la capacidad que tiene mi organismo de eliminación de los materiales que se hayan aplicado.</p>
<p><b>CONSIENTO</b> en aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico y de registro para mi historia clínica, propiedad de Cibao Spa Laser.</p>
<p><b>Acepto</b> que Cibao Spa Laser retrase o suspenda el procedimiento si lo cree preciso.</p>
<p><b>ME COMPROMETO</b> a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Laser para antes, durante y después de la intervención arriba mencionada.</p>
<p>Yo entiendo que el personal médico y otros asistentes se basarán en declaraciones hechas por mí con el fin de determinar si el proceso puede ser seguro y efectivo para mi persona. Yo entiendo que la reducción del vello mediante tratamiento con láser no es una ciencia exacta, y que no se me pueden ofrecer garantías o seguridad total en cuanto a los resultados de este procedimiento.</p>

<h2>Políticas y procedimientos</h2>
<ul>
  <li>Reservas y cancelaciones con 48 h de antelación.</li>
  <li>Horario de lunes a viernes de 9:00 a.m. a 8:00 p.m.; sábados de 8:00 a.m. a 4:00 p.m. Si la cancelación de la cita o reprogramación no es comunicada, se dará por realizada la sesión.</li>
  <li>Validez: 2 años desde la fecha de compra.</li>
  <li>Los pagos se podrán realizar en efectivo, transferencias o con tarjeta de crédito. Los precios en Cibao Spa Laser no incluyen el ITBIS.</li>
  <li>El tiempo de la cita no puede extenderse bajo ningún motivo porque perjudicará nuestro itinerario programado.</li>
  <li>Si atendemos alguna cita con retraso por responsabilidad nuestra, los tiempos serán repuestos por el Centro. Si los retrasos son ocasionados por el cliente, lo atenderemos solo el tiempo restante hasta completar la hora del término de cita.</li>
</ul>

<h2>Protección de datos</h2>
<p>Cibao Spa Laser enviará información, respuesta a consultas y contactos genéricos, mientras dure nuestra relación y tengamos su consentimiento de destinatario. No se cederán datos a terceros salvo obligación legal.</p>

<h2>Autorización</h2>
<p>He sido informado sobre el procedimiento de eliminación del vello no deseado, incluidos los riesgos, complicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido respuestas satisfactorias. Entiendo que los resultados pueden variar de una persona a otra y que no se garantiza la eliminación completa del vello no deseado.</p>
<p>Doy mi consentimiento para realizar el procedimiento en Cibao Spa Laser y libero a Cibao Spa Laser y su personal de cualquier responsabilidad Legal en lo Penal y Civil en caso de complicaciones que puedan surgir durante o después del tratamiento.</p>
<div class="accept">☑ ACEPTO LAS POLÍTICAS DE LA EMPRESA</div>

<div class="sign-box">
  ${firmaDataUrl ? `<img class="sign-img" src="${firmaDataUrl}" alt="Firma del cliente" />` : '<div class="sign-img"></div>'}
  <div class="sign-cap">Firma del cliente — ${escapeHtml(cliente.nombre || "Cliente")}</div>
</div>

<div class="footer">
  ${escapeHtml(businessName)} · Documento generado el ${escapeHtml(new Date().toLocaleString("es-DO"))} · Ref ${escapeHtml(recordId)}
</div>

</body></html>`
  // Red de seguridad: cualquier "Cibao Spa Laser/Láser" embebido en el cuerpo
  // legal se reemplaza por la marca del tenant.
  return html.replace(/Cibao Spa L[aá]ser/g, businessName)
}

export function PublicDepilacionLaserConsentForm({ prefill = {}, onSubmit, businessSlug = "csl" }: Props) {
  const branding = getBusinessBranding(businessSlug)
  const businessName = branding.name
  const cliente: Required<PublicDepilacionLaserPrefill> = {
    clienteId: prefill.clienteId || "",
    nombre: prefill.nombre || "",
    telefono: prefill.telefono || "",
    documento: prefill.documento || "",
    correo: prefill.correo || "",
    direccion: prefill.direccion || "",
    sucursal: prefill.sucursal || "",
    especialista: prefill.especialista || "",
    servicio: prefill.servicio || "",
  }

  const [firma, setFirma] = useState("")
  const [aceptado, setAceptado] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState<{ recordId: string; fechaFirma: string; firma: string } | null>(null)

  const submit = async () => {
    setError("")
    if (!cliente.nombre.trim()) return setError("Falta el nombre del cliente. Comuníquese con recepción.")
    if (!cliente.telefono.trim()) return setError("Falta el teléfono. Comuníquese con recepción.")
    if (!cliente.sucursal) return setError("Falta la sucursal. Comuníquese con recepción.")
    if (!aceptado) return setError("Debes aceptar las políticas de la empresa antes de firmar.")
    if (!firma) return setError("Debes firmar antes de enviar.")
    setSubmitting(true)
    try {
      const id = `CDL-${Date.now()}`
      const payload = {
        id,
        clienteId: cliente.clienteId,
        cliente_id: cliente.clienteId,
        fecha: new Date().toISOString().slice(0, 10),
        sucursal: cliente.sucursal,
        nombreCliente: cliente.nombre,
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        documento: cliente.documento,
        cedula: cliente.documento,
        correo: cliente.correo,
        email: cliente.correo,
        direccion: cliente.direccion,
        nombreEspecialista: cliente.especialista,
        especialista: cliente.especialista,
        observaciones: cliente.servicio || "",
        firmaCliente: firma,
        firmaEspecialista: "",
        // Aceptación única "ACEPTO LAS POLÍTICAS DE LA EMPRESA" — sincronizamos
        // los flags legales para que el contrato quede cumplido a nivel DB.
        aceptaPoliticas: true,
        aceptaProcedimiento: true,
        aceptaRiesgos: true,
        aceptaProteccionDatos: true,
        declaracionAceptada: true,
        autorizacionAceptada: true,
        // estado lo fuerza el backend a "Pendiente de revisión"
      } as unknown as Record<string, unknown>
      const result = await onSubmit(payload)
      const recordId = (result && typeof result === "object" && "recordId" in result && result.recordId) ? String(result.recordId) : id
      setSuccess({ recordId, fechaFirma: new Date().toLocaleString("es-DO"), firma })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo enviar el formulario")
      setSubmitting(false)
    }
  }

  const downloadPdf = () => {
    if (!success) return
    const html = buildPrintHtml({
      cliente,
      fechaFirma: success.fechaFirma,
      firmaDataUrl: success.firma,
      recordId: success.recordId,
      businessName,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
    })
    const popup = window.open("", "_blank", "width=1000,height=900")
    if (!popup) return
    popup.document.write(html)
    popup.document.close()
    popup.onload = () => {
      try { popup.document.title = buildPdfBaseName(cliente.nombre) } catch {}
      setTimeout(() => popup.print(), 400)
    }
  }

  if (success) {
    return (
      <main className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-md space-y-4">
          <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-green-500" />
            <h1 className="text-2xl font-bold">Consentimiento firmado correctamente</h1>
            <p className="mt-2 text-muted-foreground">
              Gracias. {businessName} recibió tu consentimiento de depilación láser firmado.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">Ref: {success.recordId}</p>
          </div>
          <Button onClick={downloadPdf} variant="outline" className="w-full gap-2">
            <Download className="h-4 w-4" /> Descargar PDF formal
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Se abrirá el diálogo de impresión — elige "Guardar como PDF" para conservar tu copia.
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-5 text-sm">
      {/* Encabezado de marca del tenant */}
      <div className="flex flex-col items-center gap-2 pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={branding.logoUrl} alt={businessName} className="h-16 w-auto object-contain" />
        <p className="text-sm font-semibold text-muted-foreground">{businessName}</p>
      </div>

      {/* 1) Cliente vinculado (solo lectura) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4" /> Cliente vinculado
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Estos datos fueron cargados por el personal. Si algún dato es
            incorrecto, comuníquese con recepción.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyField label="Nombre" value={cliente.nombre} />
          <ReadOnlyField label="Teléfono" value={displayPhone(cliente.telefono)} />
          <ReadOnlyField label="Cédula / Documento" value={displayDocumento(cliente.documento)} />
          <ReadOnlyField label="Correo" value={cliente.correo} />
          <ReadOnlyField label="Dirección" value={cliente.direccion} className="sm:col-span-2" />
          <ReadOnlyField label="Sucursal" value={cliente.sucursal} />
          {cliente.especialista ? <ReadOnlyField label="Especialista" value={cliente.especialista} /> : null}
          {cliente.servicio ? (
            <ReadOnlyField label="Servicio" value={cliente.servicio} className="sm:col-span-2" />
          ) : null}
        </CardContent>
      </Card>

      {/* 2) Documento formal completo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{TITULO_DOC}</CardTitle>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {PDF_SUBTITULO}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-[13px] leading-relaxed text-foreground/90">
          <Section title="Descripción del procedimiento">
            <p>
              La depilación láser es un método efectivo y duradero para eliminar el vello no
              deseado en diferentes áreas del cuerpo. En {businessName}, ofrecemos una experiencia
              segura y profesional, utilizando tecnología de vanguardia.
            </p>
          </Section>

          <Section title="Confirmación del cliente">
            <ol className="ml-5 list-decimal space-y-2">
              <li><strong>CONFIRMO</strong> que {businessName} me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del (los) procedimientos a efectuar; incluyendo los posibles riesgos, otras soluciones alternativas de procedimientos (cuando existan), así como las molestias que se pueden sentir, aun teniendo un periodo post-tratamiento normal. Han sido contestadas a satisfacción todas las preguntas que libremente he formulado acerca de todo el procedimiento.</li>
              <li><strong>ACEPTO y CONSIENTO</strong>, que al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento.</li>
            </ol>
          </Section>

          <Section title="Instrucciones antes del procedimiento">
            <ul className="ml-5 list-disc space-y-1">
              <li><strong>Evitar la Exposición al Sol:</strong> No expongas el área a tratar al sol durante al menos 2 semanas antes del procedimiento. La piel bronceada puede aumentar el riesgo de efectos secundarios.</li>
              <li><strong>No Utilizar Autobronceadores:</strong> Abstente de usar cremas bronceadoras o autobronceadores en la zona afectada al menos 2 semanas antes del tratamiento.</li>
              <li><strong>Informar sobre Medicación:</strong> Informa a tu médico o especialista sobre cualquier medicamento que estés tomando, especialmente anticoagulantes, o si tienes algún tratamiento de piel en curso.</li>
              <li><strong>Evitar Antiinflamatorios y Alcohol:</strong> Evita el uso de antiinflamatorios (como aspirina o ibuprofeno) y alcohol 48 horas antes del procedimiento para reducir el riesgo de sangrado y hematomas.</li>
              <li><strong>No Usar Crema en la Zona a Tratar:</strong> El día del procedimiento, no apliques cremas, lociones o maquillaje en el área que será tratada.</li>
              <li><strong>Hidratar la Piel:</strong> Mantén la piel bien hidratada días antes del procedimiento, aplicando crema hidratante en las áreas a tratar, salvo indicación contraria.</li>
              <li><strong>Consultar sobre Alergias:</strong> Asegúrate de informar al profesional sobre cualquier alergia, especialmente a anestésicos locales o productos similares que puedan usarse durante el procedimiento.</li>
              <li><strong>Preparar Preguntas:</strong> Haz una lista de preguntas que quieras hacerle al profesional antes del procedimiento. Asegúrate de entender completamente el proceso y los cuidados posteriores.</li>
            </ul>
          </Section>

          <Section title="Cuidados después del tratamiento">
            <ul className="ml-5 list-disc space-y-1">
              <li><strong>Evitar la exposición solar prolongada:</strong> Después de la sesión, evita la exposición al sol en el área tratada durante al menos 1 semana. Usa bloqueador solar con un alto factor de protección (SPF) para proteger la piel y prevenir manchas.</li>
              <li><strong>Cuidado de la Piel:</strong> Mantén la piel limpia e hidratada. Utiliza cremas o lociones suaves recomendadas por nuestro especialista.</li>
              <li><strong>No Rasurarse ni Depilar:</strong> No uses cera, pinzas ni otros métodos de depilación durante el tratamiento. Es normal que el vello caiga en las semanas siguientes.</li>
              <li><strong>Evitar Actividades Intensas:</strong> Evita ejercicios físicos intensos, saunas o jacuzzis durante los primeros días después del tratamiento, ya que el sudor puede causar irritación en la piel.</li>
              <li>Si experimentas enrojecimiento o hinchazón, aplica compresas frías y, si es necesario, puedes tomar un analgésico suave. Si los síntomas persisten, contacta a nuestro equipo.</li>
            </ul>
          </Section>

          <Section title="Consideraciones generales">
            <ul className="ml-5 list-disc space-y-1">
              <li><strong>Modo de acción del tratamiento.</strong> La luz láser penetra la piel y luego es absorbida por la melanina o pigmento del vello, causando un calentamiento rápido del tallo y raíz del mismo. Este proceso debilita el folículo completo del vello.</li>
              <li>La reducción del vello mediante el láser es un procedimiento común que es practicado de forma segura y efectiva en miles de pacientes cada año. Las complicaciones son extremadamente raras, y normalmente menores; sin embargo, algunas complicaciones pueden ocurrir.</li>
              <li><strong>Las sesiones.</strong> Las sesiones láser se realizan cada 5 semanas las primeras 5 sesiones, luego va aumentando el tiempo según los resultados, las citas se van colocando cada 7 u 8 semanas.</li>
              <li><strong>Información.</strong> El láser no penetra más allá de las capas de la piel (epidermis y la dermis), lo que quiere decir que no afecta ninguna glándula, ni vasos, ni músculos.</li>
              <li><strong>Exposición de los ojos.</strong> Lentes protectores serán puestos durante el proceso. Es muy importante mantener puestos estos lentes durante todo el tratamiento con láser para proteger los ojos, ya que no deben ser expuestos accidentalmente a la luz del láser.</li>
              <li><strong>Herpes.</strong> Los pacientes que en alguna ocasión han presentado herpes labial, deben usar Aciclovir tres días antes de cada sesión del tratamiento como prevención.</li>
              <li><strong>Advertencia.</strong> Los vellos muy rubios, muy finos y blancos (canas) no se eliminan con el láser.</li>
            </ul>
          </Section>

          <Section title="Beneficios">
            <p>
              Los beneficios del tratamiento mediante láser: para la mayoría de los pacientes este
              proceso causará la reducción considerable del vello. Esto supone una reducción estable
              y a largo plazo del número o cantidad de vello que volverá a crecer después del
              tratamiento.
            </p>
          </Section>

          <Section title="Probabilidad de éxito">
            <p>
              El láser destruye el folículo del vello en crecimiento, pero no el de los folículos
              latente o inactivo. El resultado de cada tratamiento es la destrucción de un porcentaje
              de los folículos del vello. Varios tratamientos serán necesarios para la reducción del
              vello. La reducción del vello será prolongada e incluso permanente. No obstante,
              algunos pacientes pueden no experimentar una total eliminación de su vello hasta
              después de varios procesos con láser. Los resultados dependen del tipo de piel y vello,
              así como de la asociación de la producción de vello a alguna entidad médica; ejemplo:
              ovario poliquístico.
            </p>
            <p>
              Luego de examinar su tipo de piel y vello, el o la especialista le recomendará un
              número determinado de sesiones para lograr la eliminación o reducción máxima del vello.
              Al finalizar las sesiones recomendadas, el paciente debe darse mantenimiento cada dos
              meses; dependiendo cada caso en particular, de ser necesario.
            </p>
          </Section>

          <Section title="Riesgos y posibles complicaciones">
            <p>
              <strong>COMPRENDO</strong> que los procesos estéticos no son una ciencia exacta y que
              nadie puede garantizar la perfección absoluta, por lo que se me han informado los
              riesgos y posibles complicaciones. A pesar de que se tomen precauciones, la depilación
              láser puede conllevar ciertos riesgos y complicaciones.
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li><strong>Malestar o incomodidad.</strong> Algún dolor ligero puede sentirse durante el tratamiento con láser, aunque la mayoría de las personas toleran bien el proceso.</li>
              <li><strong>Cicatrización.</strong> El tratamiento láser puede provocar hinchazón, llagas o sequedad del área tratada, que requerirán para su total desaparición de un período de entre 1 a 3 semanas. Una vez recuperada la superficie de la piel, puede quedar rosada y sensible a los rayos del sol durante 2 – 4 semanas adicionales. Solo un porcentaje muy reducido de pacientes experimentan este problema.</li>
              <li><strong>Hematomas / Hinchazón / Infección.</strong> Hematomas podrán verse en el área tratada durante un período de 2 – 3 días. Hinchazón: puede ocurrir después del procedimiento y durar varias horas, especialmente si han sido tratadas las áreas de la nariz o los pómulos. Una infección cutánea de la piel es una complicación rara pero posible.</li>
              <li><strong>Cambios en la pigmentación (cambios en el color de la piel).</strong> El área tratada puede volverse más clara o bien más oscura que la piel a su alrededor; este efecto se resuelve normalmente de manera espontánea en un período de varios meses, pero puede durar bastante más. Para disminuir este riesgo le explicamos al paciente que debe usar filtro solar tres veces al día y evitar la exposición al sol durante el tratamiento.</li>
              <li><strong>Cicatrices.</strong> La formación de una cicatriz es algo poco probable; sin embargo, es una posibilidad siempre y cuando sea intervenida la superficie de la piel. Para minimizar las posibilidades de tal complicación es extremadamente importante seguir todas las instrucciones que le serán dadas antes y después de su tratamiento con láser.</li>
            </ul>
          </Section>

          <Section title="Contraindicaciones">
            <ul className="ml-5 list-disc space-y-1">
              <li><strong>Embarazo y Lactancia:</strong> Aunque no hay estudios concluyentes sobre la seguridad del láser en mujeres embarazadas, se suele recomendar evitar el procedimiento durante este periodo. La lactancia tampoco es un momento ideal para realizarlo.</li>
              <li><strong>Piel Bronceada:</strong> La exposición solar o el uso de camas de bronceado antes del tratamiento pueden aumentar el riesgo de quemaduras y cambios en la pigmentación de la piel. Se recomienda no haber estado expuesto al sol al menos 4-6 semanas antes de la sesión.</li>
              <li><strong>Trastornos de la Piel:</strong> Condiciones como eczema, psoriasis, dermatitis o infecciones cutáneas en el área a tratar pueden contraindicar el uso de láser hasta que la piel esté completamente sana.</li>
              <li><strong>Uso de Medicamentos:</strong> Algunos medicamentos, como los que sensibilizan la piel (por ejemplo, retinoides o ciertos antibióticos), pueden aumentar el riesgo de efectos secundarios. Es importante informar al especialista sobre cualquier medicación.</li>
              <li><strong>Historial de Cicatrices Queloides:</strong> Las personas con tendencia a formar cicatrices queloides pueden tener un mayor riesgo de desarrollar cicatrices anormales después del tratamiento.</li>
              <li><strong>Diabetes No Controlada:</strong> Las personas con diabetes mal controlada pueden tener un mayor riesgo de infecciones o complicaciones en la piel.</li>
              <li><strong>Síndromes de Hipersensibilidad:</strong> Algunas condiciones que implican hipersensibilidad de la piel o trastornos de coagulación pueden impedir la realización del tratamiento.</li>
              <li><strong>Tatuajes en el Área:</strong> La depilación láser no se debe realizar sobre tatuajes, ya que el láser puede afectar la tinta y causar quemaduras o reacciones adversas.</li>
              <li><strong>Ciertas Condiciones Médicas:</strong> Enfermedades o condiciones como lupus eritematoso, enfermedades autoinmunitarias o enfermedades que afectan la piel pueden ser contraindicaciones.</li>
              <li><strong>Uso de Productos Irritantes:</strong> El uso reciente de productos químicos o tratamientos estéticos que irritan la piel, como peelings químicos o microdermoabrasión, puede requerir un periodo de espera antes de la depilación láser.</li>
            </ul>
          </Section>

          <Section title="Declaraciones finales del cliente">
            <p>El fin del procedimiento que he solicitado tiene como objetivo mejorar mi apariencia física.</p>
            <p><strong>COMPRENDO</strong> que los resultados están en relación directamente proporcional a la capacidad que tiene mi organismo de eliminación de los materiales que se hayan aplicado.</p>
            <p><strong>CONSIENTO</strong> en aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico y de registro para mi historia clínica, propiedad de {businessName}.</p>
            <p><strong>Acepto</strong> que {businessName} retrase o suspenda el procedimiento si lo cree preciso.</p>
            <p><strong>ME COMPROMETO</strong> a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por {businessName} para antes, durante y después de la intervención arriba mencionada.</p>
            <p>Yo entiendo que el personal médico y otros asistentes se basarán en declaraciones hechas por mí con el fin de determinar si el proceso puede ser seguro y efectivo para mi persona. Yo entiendo que la reducción del vello mediante tratamiento con láser no es una ciencia exacta, y que no se me pueden ofrecer garantías o seguridad total en cuanto a los resultados de este procedimiento.</p>
          </Section>

          <Section title="Políticas y procedimientos">
            <ul className="ml-5 list-disc space-y-1">
              <li>Reservas y cancelaciones con 48 h de antelación.</li>
              <li>Horario de lunes a viernes de 9:00 a.m. a 8:00 p.m.; sábados de 8:00 a.m. a 4:00 p.m. Si la cancelación de la cita o reprogramación no es comunicada, se dará por realizada la sesión.</li>
              <li>Validez: 2 años desde la fecha de compra.</li>
              <li>Los pagos se podrán realizar en efectivo, transferencias o con tarjeta de crédito. Los precios en {businessName} no incluyen el ITBIS.</li>
              <li>El tiempo de la cita no puede extenderse bajo ningún motivo porque perjudicará nuestro itinerario programado.</li>
              <li>Si atendemos alguna cita con retraso por responsabilidad nuestra, los tiempos serán repuestos por el Centro. Si los retrasos son ocasionados por el cliente, lo atenderemos solo el tiempo restante hasta completar la hora del término de cita.</li>
            </ul>
          </Section>

          <Section title="Protección de datos">
            <p>
              {businessName} enviará información, respuesta a consultas y contactos genéricos,
              mientras dure nuestra relación y tengamos su consentimiento de destinatario. No se
              cederán datos a terceros salvo obligación legal.
            </p>
          </Section>

          <Section title="Autorización">
            <p>
              He sido informado sobre el procedimiento de eliminación del vello no deseado, incluidos
              los riesgos, complicaciones y beneficios. He tenido la oportunidad de hacer preguntas y
              he recibido respuestas satisfactorias. Entiendo que los resultados pueden variar de una
              persona a otra y que no se garantiza la eliminación completa del vello no deseado.
            </p>
            <p>
              Doy mi consentimiento para realizar el procedimiento en {businessName} y libero a
              {businessName} y su personal de cualquier responsabilidad Legal en lo Penal y Civil en
              caso de complicaciones que puedan surgir durante o después del tratamiento.
            </p>
          </Section>
        </CardContent>
      </Card>

      {/* 3) Aceptación de políticas y firma */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="h-4 w-4" /> Aceptación de políticas y firma
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-2xl border bg-primary/5 p-4 text-sm leading-relaxed text-muted-foreground">
            Declaro que he leído, comprendido y aceptado el contenido de este consentimiento
            informado, así como las políticas de la empresa. Confirmo que la información
            suministrada es verdadera y completa, y autorizo a {businessName} y a su personal a
            realizar el procedimiento descrito.
          </p>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 bg-white p-4 transition-colors ${
              aceptado
                ? "border-emerald-300 bg-emerald-50/30"
                : "border-rose-400 bg-rose-50/40 ring-1 ring-rose-200"
            }`}
          >
            <Checkbox checked={aceptado} onCheckedChange={(c) => setAceptado(c === true)} className="mt-1 h-5 w-5" />
            <span className="flex-1 text-base font-bold leading-snug text-foreground">
              ACEPTO LAS POLÍTICAS DE LA EMPRESA
              {!aceptado ? (
                <span className="mt-1.5 block text-xs font-semibold text-rose-600">
                  Pendiente — marca esta casilla para poder enviar.
                </span>
              ) : null}
            </span>
          </label>
          <div className={!firma ? "rounded-xl ring-2 ring-rose-400 ring-offset-2" : ""}>
            <SignaturePad label="Firma del cliente *" value={firma} onChange={setFirma} />
          </div>
          {!firma ? (
            <p className="text-[11px] font-semibold text-rose-600">
              Pendiente — firma en el recuadro de arriba para poder enviar.
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            La firma del especialista la completará el personal al finalizar el consentimiento.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          ⚠ {error}
        </div>
      ) : null}

      {!submitting && (!aceptado || !firma) ? (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3 text-sm">
          <p className="font-bold text-rose-700">⚠ Para firmar y enviar, completa:</p>
          <ul className="mt-1 list-disc pl-5 text-rose-700">
            {!aceptado ? <li>Marcar la casilla "ACEPTO LAS POLÍTICAS DE LA EMPRESA"</li> : null}
            {!firma ? <li>Firmar en el recuadro de Firma del cliente</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-3 border-t bg-white/95 px-3 py-3 backdrop-blur">
        <Button
          onClick={submit}
          disabled={submitting || !aceptado || !firma}
          className="w-full gap-2"
          size="lg"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting ? "Enviando..." : "Firmar y enviar consentimiento"}
        </Button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 font-heading text-xs font-black uppercase tracking-wider text-[color:var(--brand-primary-dark)]">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}
